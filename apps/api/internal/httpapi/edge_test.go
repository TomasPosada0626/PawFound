package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestEmailProviderAndAntiAbuseLimits(t *testing.T) {
	h := newHarness(t)
	// Sin proveedor de correo (producción sin configurar): el registro falla claro y no deja la
	// cuenta a medias, así la persona puede reintentar con el mismo correo.
	h.app.Mailer = nil
	h.expectError(http.StatusServiceUnavailable, "provider_unavailable", http.MethodPost, "/v1/auth/register", "", registerBody("sin@pawfound.app", "sin_correo"))
	if n := h.count(`SELECT count(*) FROM users WHERE email = 'sin@pawfound.app'`); n != 0 {
		t.Fatal("quedó una cuenta sin poder verificarse")
	}
	h.app.Mailer = h.mailer
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("sin@pawfound.app", "sin_correo"), &session)

	// Antiabuso: máximo 5 códigos por correo por hora (el intento sin proveedor no llegó a contar
	// porque falla antes; el registro gastó uno).
	for i := 0; i < 4; i++ {
		h.clock.Advance(46 * time.Second)
		h.must(http.StatusOK, http.MethodPost, "/v1/auth/email/resend", session.AccessToken, nil, nil)
	}
	h.clock.Advance(46 * time.Second)
	h.expectError(http.StatusTooManyRequests, "rate_limited", http.MethodPost, "/v1/auth/email/resend", session.AccessToken, nil)
	// Una cuenta ya verificada no pide códigos.
	verified := h.user("Verificada", true)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/auth/email/resend", verified.Token, nil)
}

func TestOAuthLinksVerifiedEmailToExistingAccount(t *testing.T) {
	h := newHarness(t)
	var session app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("ana@gmail.com", "ana_g"), &session)
	idp := newTestIDP(t)
	h.app.Google = idp.provider("google")
	var viaGoogle app.Session
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "google", "idToken": idp.token("g-9", "ANA@gmail.com", true)}, &viaGoogle)
	if viaGoogle.Me.User.ID != session.Me.User.ID || !viaGoogle.Me.User.Verified {
		t.Fatalf("debía entrar a la cuenta existente: %+v", viaGoogle.Me.User)
	}
	// Una cuenta suspendida no entra ni por Google.
	h.exec(`UPDATE users SET suspended_at = now() WHERE id = $1`, session.Me.User.ID)
	h.expectError(http.StatusForbidden, "suspended", http.MethodPost, "/v1/auth/oauth", "", map[string]string{"provider": "google", "idToken": idp.token("g-9", "ana@gmail.com", true)})
	h.expectError(http.StatusForbidden, "suspended", http.MethodPost, "/v1/auth/login", "", map[string]string{"email": "ana@gmail.com", "password": "Patitas2026"})
	h.expectError(http.StatusForbidden, "suspended", http.MethodPost, "/v1/auth/refresh", "", map[string]string{"refreshToken": session.RefreshToken})
	h.must(http.StatusAccepted, http.MethodPost, "/v1/auth/password-reset", "", map[string]string{"email": "ana@gmail.com"}, nil)
	if len(h.mailer.links) != 0 {
		t.Fatal("una cuenta suspendida no recibe enlaces de restablecimiento")
	}
}

func TestValidationEdges(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	other := h.user("Otra", true)
	newbie := h.user("Nueva", false)
	pet := h.report(owner, lostReport("Max", laureles, nil))

	for field, body := range map[string]map[string]any{
		"species":     {"name": "X", "species": "dragon", "sex": "male", "age": "adult", "size": "small"},
		"sex":         {"name": "X", "species": "dog", "sex": "x", "age": "adult", "size": "small"},
		"age":         {"name": "X", "species": "dog", "sex": "male", "age": "x", "size": "small"},
		"size":        {"name": "X", "species": "dog", "sex": "male", "age": "adult", "size": "x"},
		"photos":      {"name": "X", "species": "dog", "sex": "male", "age": "adult", "size": "small", "photos": []string{"a", "b", "c", "d", "e", "f"}},
		"description": {"name": "X", "species": "dog", "sex": "male", "age": "adult", "size": "small", "description": strings.Repeat("a", 501)},
	} {
		res := h.do(http.MethodPost, "/v1/me/owned-pets", owner.Token, body)
		if res.Status != http.StatusUnprocessableEntity || !strings.Contains(string(res.Body), field) {
			t.Errorf("mis mascotas %s: %d %s", field, res.Status, res.Body)
		}
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/owned-pets", owner.Token, map[string]any{
		"name": "X", "species": "dog",
		"sex": "male", "age": "adult", "size": "small", "photos": []string{"med_ajena"},
	})
	h.expectError(http.StatusNotFound, "not_found", http.MethodPut, "/v1/me/owned-pets/own_nada", owner.Token, map[string]any{
		"name": "X", "species": "dog",
		"sex": "male", "age": "adult", "size": "small",
	})

	for field, body := range map[string]map[string]any{
		"at":       {"at": h.clock.Now().Add(3 * time.Hour), "location": belen, "zone": "Belén"},
		"location": {"at": h.clock.Now(), "location": map[string]float64{"latitude": 0, "longitude": 0}, "zone": "Belén"},
		"zone":     {"at": h.clock.Now(), "location": belen, "zone": " "},
	} {
		res := h.do(http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", other.Token, body)
		if res.Status != http.StatusUnprocessableEntity || !strings.Contains(string(res.Body), field) {
			t.Errorf("avistamiento %s: %d %s", field, res.Status, res.Body)
		}
	}
	for _, path := range []string{"/join", "/direct"} {
		h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+path, newbie.Token, nil)
		h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/pets/pet_nada"+path, other.Token, nil)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/threads/"+pet.GroupID, other.Token, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+owner.ID+"/like", newbie.Token, nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/pets/"+pet.ID+"/report", other.Token, map[string]string{"reason": "feo"})
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/users/u_nadie/report", other.Token, map[string]string{"reason": "spam"})
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/pets/pet_nada/helpers", owner.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/pets/pet_nada/reunite", owner.Token, map[string]any{})
	h.expectError(http.StatusNotFound, "not_found", http.MethodDelete, "/v1/pets/pet_nada", owner.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/pets/pet_nada/matches", owner.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/pets/pet_nada/sightings", other.Token, map[string]any{"at": h.clock.Now(), "location": belen, "zone": "Belén"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/thr_nada/messages", other.Token, map[string]string{"text": "hola"})

	// Un caso cerrado ya no recibe avistamientos.
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{}, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", other.Token, map[string]any{"at": h.clock.Now(), "location": belen, "zone": "Belén"})
	// Una mascota encontrada no exige nombre; una perdida sí.
	found := map[string]any{
		"kind": "found", "species": "cat", "sex": "unknown", "age": "unknown", "size": "small",
		"photos": []string{}, "location": belen, "zone": "Belén", "foundCondition": "x", "lastSeenAt": h.clock.Now(),
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/pets", other.Token, found)
	found["foundCondition"], found["foundCustody"] = "good", "x"
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/pets", other.Token, found)
	delete(found, "foundCustody")
	h.report(other, found)
}

func TestModerationSuggestions(t *testing.T) {
	hours := func(n int) *int { return &n }
	cases := []struct {
		user    *app.UserBrief
		history []app.ActionEntry
		want    string
	}{
		{nil, nil, "dismiss"},
		{&app.UserBrief{}, nil, "warn"},
		{&app.UserBrief{Warnings: 1}, nil, "mute24"},
		{&app.UserBrief{Warnings: 1}, []app.ActionEntry{{Action: "mute", Hours: hours(24)}}, "mute168"},
		{&app.UserBrief{Warnings: 2}, []app.ActionEntry{{Action: "mute", Hours: hours(24)}, {Action: "mute", Hours: hours(168)}}, "suspend"},
		{&app.UserBrief{SuspendedAt: &time.Time{}}, nil, "none"},
	}
	for _, c := range cases {
		if got := app.SuggestSanction(c.user, c.history); got != c.want {
			t.Errorf("SuggestSanction = %q, want %q", got, c.want)
		}
	}
}
