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

func registerBody(email, username string) map[string]any {
	return map[string]any{
		"name": "Valentina Arango", "email": email, "username": username, "password": "Patitas2026",
		"lang": "es", "acceptTerms": true, "confirmAge": true,
	}
}

func TestRegisterVerifyAndLogin(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("Valen@PawFound.app", "@Valen_A"), &session)
	if !session.NeedsVerification || session.Me.User.Verified || session.Me.User.Email != "valen@pawfound.app" || session.Me.User.Username != "valen_a" {
		t.Fatalf("registro: %+v", session)
	}
	if session.Me.User.Phone != nil {
		t.Fatal("el registro no pide celular")
	}
	tok := session.AccessToken

	// Duplicados y validaciones.
	h.expectError(http.StatusConflict, "email_taken", http.MethodPost, "/v1/auth/register", "", registerBody("valen@pawfound.app", "otra"))
	h.expectError(http.StatusConflict, "username_taken", http.MethodPost, "/v1/auth/register", "", registerBody("otra@pawfound.app", "valen_a"))
	h.expectError(http.StatusUnprocessableEntity, "invalid_username", http.MethodPost, "/v1/auth/register", "", registerBody("otra@pawfound.app", "a b"))
	for _, bad := range []map[string]any{
		{"password": "corta"},
		{"password": "sinmayusculas1"},
		{"password": "SINMINUSCULAS1"},
		{"password": "SinNumeros"},
		{"name": "Valentina"},
		{"acceptTerms": false},
		{"email": "no-es-correo"},
	} {
		body := registerBody("otra@pawfound.app", "otra_cuenta")
		for k, v := range bad {
			body[k] = v
		}
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/auth/register", "", body)
	}

	// Sin insignia azul no se publica.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets", tok, lostReport("Max", laureles, nil))

	// Código incorrecto descuenta intentos; el reenvío respeta 45 s.
	h.expectError(http.StatusUnprocessableEntity, "wrong_code", http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "000000"})
	h.expectError(http.StatusTooManyRequests, "rate_limited", http.MethodPost, "/v1/auth/email/resend", tok, nil)
	h.clock.Advance(46 * time.Second)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/email/resend", tok, nil, nil)
	if h.mailer.codes["valen@pawfound.app"] != "123456" {
		t.Fatalf("el código debe llegar al correo: %v", h.mailer.codes)
	}
	var me app.Me
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "123456"}, &me)
	if !me.User.Verified {
		t.Fatal("la verificación debe otorgar la insignia azul")
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "123456"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/auth/email/resend", tok, nil)

	// Login con correo o con usuario; mismo error para cuenta inexistente y contraseña incorrecta.
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "valen@pawfound.app", "password": "Otra2026"})
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "nadie", "password": "Otra2026"})
	var login app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": " VALEN@pawfound.app", "password": "Patitas2026"}, &login)
	if login.NeedsVerification || login.ExpiresIn <= 0 {
		t.Fatalf("login: %+v", login)
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "@Valen_A", "password": "Patitas2026"}, &login)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "valen@pawfound.app", "password": "Patitas2026"}, nil)

	// El celular es opcional, se agrega en el perfil y no se verifica.
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", tok, map[string]string{"phone": "300 123 4567"}, &me)
	if me.User.Phone == nil || *me.User.Phone != "+573001234567" {
		t.Fatalf("celular: %+v", me.User.Phone)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_phone", http.MethodPatch, "/v1/me", tok, map[string]string{"phone": "123"})
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", tok, map[string]string{"phone": ""}, &me)
	if me.User.Phone != nil {
		t.Fatal("el celular se puede borrar")
	}
}

func TestVerificationLocksAfterFiveAttempts(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("lock@pawfound.app", "lock"), &session)
	tok := session.AccessToken
	for i := 0; i < 4; i++ {
		h.expectError(http.StatusUnprocessableEntity, "wrong_code", http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "999999"})
	}
	h.expectError(http.StatusTooManyRequests, "locked", http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "999999"})
	// Bloqueado, ni el código correcto sirve.
	h.expectError(http.StatusTooManyRequests, "locked", http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "123456"})
	// Pasado el bloqueo, el código ya venció (10 min desde el envío).
	h.clock.Advance(11 * time.Minute)
	h.expectError(http.StatusGone, "expired", http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "123456"})
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/email/resend", tok, nil, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/email/verify", tok, map[string]string{"code": "123456"}, nil)

	// Entrar sin verificar envía un código nuevo, salvo que el último siga recién enviado.
	var other app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("sin@pawfound.app", "sin_verificar"), &other)
	delete(h.mailer.codes, "sin@pawfound.app")
	var login app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "sin_verificar", "password": "Patitas2026"}, &login)
	if !login.NeedsVerification || h.mailer.codes["sin@pawfound.app"] != "" {
		t.Fatalf("no debe reenviar dentro de los 45 s: %+v %v", login.NeedsVerification, h.mailer.codes)
	}
	h.clock.Advance(46 * time.Second)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "sin_verificar", "password": "Patitas2026"}, &login)
	if h.mailer.codes["sin@pawfound.app"] != "123456" {
		t.Fatal("al entrar sin verificar debe llegar un código nuevo")
	}
}

func TestRefreshRotationAndReuseDetection(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("rot@pawfound.app", "rot"), &session)
	var next app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken}, &next)
	if next.RefreshToken == session.RefreshToken {
		t.Fatal("el refresh token debe rotar")
	}
	// Reintento enseguida con el viejo (la respuesta se perdió en la red): no cierra la sesión.
	var retried app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken}, &retried)
	if retried.RefreshToken == next.RefreshToken || retried.RefreshToken == session.RefreshToken {
		t.Fatal("el reintento recibe un token propio")
	}
	// Pasado el margen, reusar el viejo es sospechoso: revoca toda la familia.
	h.clock.Advance(3 * time.Minute)
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken})
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": next.RefreshToken})
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": retried.RefreshToken})

	var again app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "rot@pawfound.app", "password": "Patitas2026"}, &again)
	if !again.NeedsVerification {
		t.Fatal("una cuenta sin verificar debe recibir otro código al entrar")
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/logout", "", map[string]string{"refreshToken": again.RefreshToken}, nil)
	// Cerrar sesión es definitivo, aunque sea dentro del margen de reintento.
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": again.RefreshToken})
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": "inventado"})

	// La sesión se renueva sola mientras se use; solo vence tras un año sin abrir la app.
	var fresh app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "rot@pawfound.app", "password": "Patitas2026"}, &fresh)
	h.clock.Advance(200 * 24 * time.Hour)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": fresh.RefreshToken}, &fresh)
	h.clock.Advance(366 * 24 * time.Hour)
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": fresh.RefreshToken})
}

func TestPasswordReset(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("reset@pawfound.app", "reset"), &session)
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
	// Google ya confirmó el correo: la cuenta queda verificada, sin código.
	if session.NeedsVerification || !session.Me.User.Verified || session.Me.User.Email != "daniel@gmail.com" || session.Me.User.Lang != "en" {
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
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "facebook", "idToken": "x"})
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

func TestProfilePhoto(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Restrepo", true)
	other := h.user("Otra Persona", true)
	unverified := h.user("Sin Verificar", false)

	// Sin insignia azul no se sube foto de perfil.
	if _, res := h.upload(unverified, "avatar", jpegBytes(1)); res.Status != http.StatusForbidden {
		t.Fatalf("foto sin verificar = %d", res.Status)
	}
	photo, res := h.upload(ana, "avatar", jpegBytes(2))
	if res.Status != http.StatusCreated {
		t.Fatalf("subir foto = %d %s", res.Status, res.Body)
	}
	// Solo se acepta una foto propia subida como avatar.
	foreign, _ := h.upload(other, "avatar", jpegBytes(3))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPatch, "/v1/me", ana.Token, map[string]string{"photoId": foreign.ID})
	petPhoto, _ := h.upload(ana, "pet", jpegBytes(4))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPatch, "/v1/me", ana.Token, map[string]string{"photoId": petPhoto.ID})

	var me app.Me
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", ana.Token, map[string]string{"photoId": photo.ID, "title": "paw_angel"}, &me)
	if me.User.PhotoURL == nil || !strings.HasSuffix(*me.User.PhotoURL, "/v1/media/"+photo.ID) || me.User.Title != "paw_angel" {
		t.Fatalf("perfil con foto: %+v", me.User)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPatch, "/v1/me", ana.Token, map[string]string{"title": "inventado"})

	// La ven las demás personas: perfil público y resumen en los reportes.
	var profile app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+ana.ID, "", nil, &profile)
	if profile.User.PhotoURL == nil || *profile.User.PhotoURL != *me.User.PhotoURL {
		t.Fatalf("perfil público: %+v", profile.User)
	}
	pet := h.report(ana, lostReport("Max", laureles, nil))
	if pet.Owner == nil || pet.Owner.PhotoURL == nil {
		t.Fatalf("resumen de la familia: %+v", pet.Owner)
	}

	// Cambiar la foto borra la anterior; quitarla vuelve al avatar.
	second, _ := h.upload(ana, "avatar", jpegBytes(5))
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", ana.Token, map[string]string{"photoId": second.ID}, &me)
	if n := h.count(`SELECT count(*) FROM media WHERE id = $1`, photo.ID); n != 0 {
		t.Fatal("la foto anterior debe borrarse")
	}
	var cleared app.Me
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", ana.Token, map[string]string{"photoId": ""}, &cleared)
	if cleared.User.PhotoURL != nil || h.count(`SELECT count(*) FROM media WHERE id = $1`, second.ID) != 0 {
		t.Fatalf("sin foto: %+v", cleared.User)
	}
}

// La página /restablecer de la web llama a la API desde el navegador: solo ese origen.
func TestPasswordResetCORSOnlyForWeb(t *testing.T) {
	h := newHarness(t)
	preflight := func(origin string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodOptions, h.srv.URL+"/v1/auth/password-reset/confirm", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		res, err := h.srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		return res
	}
	if res := preflight("https://pawfound.test"); res.StatusCode != http.StatusNoContent ||
		res.Header.Get("Access-Control-Allow-Origin") != "https://pawfound.test" || !strings.Contains(res.Header.Get("Access-Control-Allow-Headers"), "Content-Type") {
		t.Fatalf("preflight de la web = %d %v", res.StatusCode, res.Header)
	}
	if res := preflight("https://otro-sitio.example"); res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("otro origen no recibe permiso CORS")
	}
	body := strings.NewReader(`{"token":"inventado","password":"NuevaClave2027"}`)
	req, _ := http.NewRequest(http.MethodPost, h.srv.URL+"/v1/auth/password-reset/confirm", body)
	req.Header.Set("Origin", "https://pawfound.test")
	req.Header.Set("Content-Type", "application/json")
	res, err := h.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusGone || res.Header.Get("Access-Control-Allow-Origin") != "https://pawfound.test" {
		t.Fatalf("confirmación desde la web = %d %v", res.StatusCode, res.Header)
	}
}

func TestActiveSessionsCount(t *testing.T) {
	h := newHarness(t)
	var first, second app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("disp@pawfound.app", "disp"), &first)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "disp", "password": "Patitas2026"}, &second)
	if second.Me.ActiveSessions != 2 {
		t.Fatalf("dos dispositivos con la sesión abierta, contó %d", second.Me.ActiveSessions)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/logout", "", map[string]string{"refreshToken": first.RefreshToken}, nil)
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", second.AccessToken, nil, &me)
	if me.ActiveSessions != 1 {
		t.Fatalf("tras cerrar sesión en uno, contó %d", me.ActiveSessions)
	}
}

func TestModeratorRemovesProfilePhoto(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Restrepo", true)
	mod := h.user("Moderadora", true)
	_, _ = h.app.DB.Exec(context.Background(), `UPDATE users SET role = 'moderator' WHERE id = $1`, mod.ID)
	photo, _ := h.upload(ana, "avatar", jpegBytes(7))
	h.must(http.StatusOK, http.MethodPatch, "/v1/me", ana.Token, map[string]string{"photoId": photo.ID}, nil)

	actor := app.Actor{ID: mod.ID, Name: "Moderadora", Verified: true, Role: "moderator"}
	if err := h.app.Moderate(context.Background(), actor, app.ModerationInput{UserID: ana.ID, Action: "remove_photo", Note: "foto inapropiada"}); err != nil {
		t.Fatal(err)
	}
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", ana.Token, nil, &me)
	if me.User.PhotoURL != nil || h.count(`SELECT count(*) FROM media WHERE id = $1`, photo.ID) != 0 {
		t.Fatalf("la foto debía quitarse y borrarse: %+v", me.User)
	}
	if h.count(`SELECT count(*) FROM moderation_actions WHERE action = 'remove_photo' AND target_user_id = $1`, ana.ID) != 1 {
		t.Fatal("la decisión queda en la bitácora")
	}
	// Sin foto ya no hay nada que quitar.
	if err := h.app.Moderate(context.Background(), actor, app.ModerationInput{UserID: ana.ID, Action: "remove_photo"}); err == nil {
		t.Fatal("quitar una foto que no existe debe fallar")
	}
}
