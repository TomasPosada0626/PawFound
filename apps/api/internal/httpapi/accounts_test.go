package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
)

func registerBody(email, phone string) map[string]any {
	return map[string]any{
		"name": "Valentina Arango", "email": email, "phone": phone, "password": "Patitas2026",
		"lang": "es", "acceptTerms": true, "confirmAge": true,
	}
}

func TestRegisterVerifyAndLogin(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("Valen@PawFound.app", "300 123 4567"), &session)
	if !session.NeedsVerification || session.Me.User.Verified || session.Me.User.Email != "valen@pawfound.app" {
		t.Fatalf("registro: %+v", session)
	}
	if *session.Me.User.Phone != "+573001234567" || session.Me.User.Username != "valen" {
		t.Fatalf("celular/usuario: %+v", session.Me.User)
	}
	tok := session.AccessToken

	// Duplicados y validaciones.
	h.expectError(http.StatusConflict, "email_taken", http.MethodPost, "/v1/auth/register", "", registerBody("valen@pawfound.app", "3109998877"))
	h.expectError(http.StatusUnprocessableEntity, "invalid_phone", http.MethodPost, "/v1/auth/register", "", registerBody("otra@pawfound.app", "6011234567"))
	weak := registerBody("otra@pawfound.app", "3109998877")
	weak["password"] = "corta"
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/auth/register", "", weak)
	noTerms := registerBody("otra@pawfound.app", "3109998877")
	noTerms["acceptTerms"] = false
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/auth/register", "", noTerms)

	// Sin insignia azul no se publica.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets", tok, lostReport("Max", laureles, nil))

	// Código incorrecto descuenta intentos; el reenvío respeta 45 s.
	h.expectError(http.StatusUnprocessableEntity, "wrong_code", http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "000000"})
	h.expectError(http.StatusTooManyRequests, "rate_limited", http.MethodPost, "/v1/auth/phone/resend", tok, nil)
	h.clock.Advance(46 * time.Second)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/phone/resend", tok, nil, nil)
	var me app.Me
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "123456"}, &me)
	if !me.User.Verified {
		t.Fatal("la verificación debe otorgar la insignia azul")
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "123456"})

	// Login: mismo error para correo inexistente y contraseña incorrecta.
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "valen@pawfound.app", "password": "Otra2026"})
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "nadie@pawfound.app", "password": "Otra2026"})
	var login app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": " VALEN@pawfound.app", "password": "Patitas2026"}, &login)
	if login.NeedsVerification || login.ExpiresIn <= 0 {
		t.Fatalf("login: %+v", login)
	}

	// Un celular verificado no se puede usar en otra cuenta.
	h.expectError(http.StatusConflict, "phone_taken", http.MethodPost, "/v1/auth/register", "", registerBody("tercera@pawfound.app", "+573001234567"))
}

func TestVerificationLocksAfterFiveAttempts(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("lock@pawfound.app", "3001112233"), &session)
	tok := session.AccessToken
	for i := 0; i < 4; i++ {
		h.expectError(http.StatusUnprocessableEntity, "wrong_code", http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "999999"})
	}
	h.expectError(http.StatusTooManyRequests, "locked", http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "999999"})
	// Bloqueado, ni el código correcto sirve.
	h.expectError(http.StatusTooManyRequests, "locked", http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "123456"})
	h.clock.Advance(6 * time.Minute)
	// Pasado el bloqueo, el código ya venció (10 min desde el envío).
	h.clock.Advance(5 * time.Minute)
	h.expectError(http.StatusGone, "expired", http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "123456"})
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/phone/resend", tok, nil, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/phone/verify", tok, map[string]string{"code": "123456"}, nil)

	// Cambiar de número (paso de login social) vuelve a exigir verificación.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/phone", tok, map[string]string{"phone": "3207654321"}, nil)
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", tok, nil, &me)
	if me.User.Verified || *me.User.Phone != "+573207654321" {
		t.Fatalf("cambio de número: %+v", me.User)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_phone", http.MethodPost, "/v1/auth/phone", tok, map[string]string{"phone": "123"})
}

func TestRefreshRotationAndReuseDetection(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("rot@pawfound.app", "3005556677"), &session)
	var next app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken}, &next)
	if next.RefreshToken == session.RefreshToken {
		t.Fatal("el refresh token debe rotar")
	}
	// Reusar el viejo revoca toda la familia: también el nuevo deja de servir.
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken})
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": next.RefreshToken})

	var again app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "rot@pawfound.app", "password": "Patitas2026"}, &again)
	if !again.NeedsVerification {
		t.Fatal("una cuenta sin verificar debe recibir otro código al entrar")
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/logout", "", map[string]string{"refreshToken": again.RefreshToken}, nil)
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": again.RefreshToken})
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": "inventado"})

	// Vencido.
	var fresh app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "rot@pawfound.app", "password": "Patitas2026"}, &fresh)
	h.clock.Advance(31 * 24 * time.Hour)
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": fresh.RefreshToken})
}

func TestPasswordReset(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("reset@pawfound.app", "3001239876"), &session)
	// Misma respuesta exista o no la cuenta.
	h.must(http.StatusAccepted, http.MethodPost, "/v1/auth/password-reset", "", map[string]string{"email": "nadie@pawfound.app"}, nil)
	h.must(http.StatusAccepted, http.MethodPost, "/v1/auth/password-reset", "", map[string]string{"email": "reset@pawfound.app"}, nil)
	if len(h.mailer.links) != 1 || !strings.HasPrefix(h.mailer.links[0], "https://pawfound.test/restablecer?token=") {
		t.Fatalf("enlaces = %v", h.mailer.links)
	}
	token := strings.TrimPrefix(h.mailer.links[0], "https://pawfound.test/restablecer?token=")
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/auth/password-reset/confirm", "", map[string]string{"token": token, "password": "corta"})
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/password-reset/confirm", "", map[string]string{"token": token, "password": "NuevaClave2027"}, nil)
	h.expectError(http.StatusGone, "expired", http.MethodPost, "/v1/auth/password-reset/confirm", "", map[string]string{"token": token, "password": "OtraClave2028"})
	// Las sesiones abiertas se cierran.
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken})
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "reset@pawfound.app", "password": "NuevaClave2027"}, nil)
}

func TestOAuthLogin(t *testing.T) {
	h := newHarness(t)
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k", "kty": "RSA",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer jwks.Close()
	h.app.Google = &auth.OIDCProvider{Name: "google", Issuers: []string{"https://accounts.google.com"}, JWKSURL: jwks.URL, Audiences: []string{"pawfound-android"}}
	sign := func(sub, email string, verified bool) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": "https://accounts.google.com", "aud": "pawfound-android",
			"sub": sub, "email": email, "email_verified": verified, "name": "Daniel Ruiz", "exp": time.Now().Add(time.Hour).Unix(),
		})
		tok.Header["kid"] = "k"
		s, _ := tok.SignedString(key)
		return s
	}
	var session app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "google", "idToken": sign("g-1", "daniel@gmail.com", true), "lang": "en"}, &session)
	if !session.NeedsPhone || session.Me.User.Email != "daniel@gmail.com" || session.Me.User.Lang != "en" {
		t.Fatalf("oauth: %+v", session)
	}
	var again app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "google", "idToken": sign("g-1", "daniel@gmail.com", true)}, &again)
	if again.Me.User.ID != session.Me.User.ID {
		t.Fatal("el mismo sub debe entrar a la misma cuenta")
	}
	// Correo sin verificar por el proveedor: no se crea ni se enlaza.
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "google", "idToken": sign("g-2", "otro@gmail.com", false)})
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "google", "idToken": "basura"})
	h.expectError(http.StatusServiceUnavailable, "provider_unavailable", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "facebook", "idToken": "x"})
	h.expectError(http.StatusServiceUnavailable, "provider_unavailable", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "apple", "idToken": "x"})
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "myspace", "idToken": "x"})
}

func TestProfileAndPreferences(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	other := h.user("Otro Usuario", true)
	var me app.Me
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", ana.Token, map[string]any{
		"username": "@Ana_G", "bio": strings.Repeat("a", 200),
		"avatar": "fox", "title": "rescuer", "city": "Medellín", "neighborhood": "Laureles", "name": "Ana María Gómez",
	}, &me)
	if me.User.Username != "ana_g" || len(me.User.Bio) != 150 || me.User.Avatar != "fox" || *me.User.Neighborhood != "Laureles" {
		t.Fatalf("perfil: %+v", me.User)
	}
	h.expectError(http.StatusConflict, "username_taken", http.MethodPatch, "/v1/me", other.Token, map[string]string{"username": "ana_g"})
	h.expectError(http.StatusUnprocessableEntity, "invalid_username", http.MethodPatch, "/v1/me", other.Token, map[string]string{"username": "a b"})
	for _, bad := range []map[string]string{{"avatar": "dragon"}, {"title": "rey"}, {"name": "A"}, {"city": " "}} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPatch, "/v1/me", other.Token, bad)
	}
	var prefs map[string]any
	h.must(http.StatusOK, http.MethodPut, "/v1/me/notification-prefs", ana.Token, map[string]any{"angelAlerts": false, "quietHours": true}, &prefs)
	if prefs["angelAlerts"] != false || prefs["quietHours"] != true || prefs["lostNearby"] != true {
		t.Fatalf("prefs: %+v", prefs)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPut, "/v1/me/notification-prefs", ana.Token, map[string]any{"quietFrom": "25:00"})
	h.must(http.StatusOK, http.MethodPut, "/v1/me/privacy", ana.Token, map[string]string{"whoCanMessage": "verified"}, nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPut, "/v1/me/privacy", ana.Token, map[string]string{"whoCanMessage": "friends"})
	h.must(http.StatusNoContent, http.MethodPut, "/v1/me/lang", ana.Token, map[string]string{"lang": "en"}, nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPut, "/v1/me/lang", ana.Token, map[string]string{"lang": "fr"})

	h.alertZone(ana, map[string]float64{"latitude": 6.24471, "longitude": -75.59162}, "Laureles")
	h.must(http.StatusOK, http.MethodGet, "/v1/me", ana.Token, nil, &me)
	if me.AlertZone == nil || me.AlertZone.Location.Lat == 6.24471 || me.User.Lang != "en" || me.PrivacyPrefs.WhoCanMessage != "verified" {
		t.Fatalf("la zona debe quedar aproximada: %+v", me)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPut, "/v1/me/alert-zone", ana.Token, map[string]any{"location": map[string]float64{"latitude": 99, "longitude": 0}, "zone": "x"})
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/alert-zone", ana.Token, nil, nil)
	if n := h.count(`SELECT count(*) FROM consents WHERE user_id = $1 AND kind = 'alert_zone'`, ana.ID); n != 2 {
		t.Fatalf("consentimientos auditables = %d", n)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/devices", ana.Token, map[string]string{"token": "a b", "platform": "android"})
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/devices", ana.Token, map[string]string{"token": "x", "platform": "windows"})
	h.device(ana)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/devices", ana.Token, map[string]string{"token": "ExponentPushToken[" + ana.ID + "]"}, nil)

	// Sin token, o con uno inválido.
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/me", "", nil)
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/me", "no.es.token", nil)
	res := h.do(http.MethodPost, "/v1/me/devices", ana.Token, "{")
	if res.Status != http.StatusBadRequest {
		t.Fatalf("JSON inválido = %d", res.Status)
	}
}

func TestHealthAndSecurityHeaders(t *testing.T) {
	h := newHarness(t)
	res := h.do(http.MethodGet, "/health", "", nil)
	if res.Status != http.StatusOK || res.Header.Get("X-Content-Type-Options") != "nosniff" ||
		res.Header.Get("Content-Security-Policy") == "" || res.Header.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("health: %d %v", res.Status, res.Header)
	}
	if res := h.do(http.MethodGet, "/ready", "", nil); res.Status != http.StatusOK {
		t.Fatalf("ready = %d", res.Status)
	}
	// Límite por IP en login.
	for i := 0; i < 10; i++ {
		h.do(http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "x" + string(rune('a'+i)) + "@pawfound.app", "password": "x"})
	}
	if res := h.do(http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "z@pawfound.app", "password": "x"}); res.Status != http.StatusTooManyRequests || res.Header.Get("Retry-After") == "" {
		t.Fatalf("límite de login = %d", res.Status)
	}
	_ = context.Background()
}
