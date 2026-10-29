package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// Un cuerpo que no es JSON nunca llega a la lógica: 400 con un código traducible.
func TestMalformedJSONEverywhere(t *testing.T) {
	h := newHarness(t)
	u := h.user("Cuerpo Roto", true)
	pet := h.report(u, lostReport("Max", laureles, nil))
	endpoints := []struct{ method, path, token string }{
		{http.MethodPost, "/v1/auth/register", ""},
		{http.MethodPost, "/v1/auth/login", ""},
		{http.MethodPost, "/v1/auth/oauth", ""},
		{http.MethodPost, "/v1/auth/refresh", ""},
		{http.MethodPost, "/v1/auth/logout", ""},
		{http.MethodPost, "/v1/auth/password-reset", ""},
		{http.MethodPost, "/v1/auth/password-reset/confirm", ""},
		{http.MethodPost, "/v1/auth/email/verify", u.Token},
		{http.MethodPost, "/v1/pets/" + pet.ID + "/stories", u.Token},
		{http.MethodPost, "/v1/places/plc_x/report", u.Token},
		{http.MethodPatch, "/v1/me", u.Token},
		{http.MethodPut, "/v1/me/lang", u.Token},
		{http.MethodPut, "/v1/me/notification-prefs", u.Token},
		{http.MethodPut, "/v1/me/privacy", u.Token},
		{http.MethodPut, "/v1/me/alert-zone", u.Token},
		{http.MethodPost, "/v1/me/devices", u.Token},
		{http.MethodDelete, "/v1/me/devices", u.Token},
		{http.MethodPost, "/v1/me/owned-pets", u.Token},
		{http.MethodPost, "/v1/pets", u.Token},
		{http.MethodPost, "/v1/pets/" + pet.ID + "/sightings", u.Token},
		{http.MethodPost, "/v1/pets/" + pet.ID + "/reunite", u.Token},
		{http.MethodPost, "/v1/pets/" + pet.ID + "/report", u.Token},
		{http.MethodPost, "/v1/threads/" + pet.GroupID + "/messages", u.Token},
		{http.MethodPost, "/v1/users/" + u.ID + "/report", u.Token},
	}
	for _, e := range endpoints {
		req, _ := http.NewRequest(e.method, h.srv.URL+e.path, strings.NewReader(`{"roto":`))
		if e.token != "" {
			req.Header.Set("Authorization", "Bearer "+e.token)
		}
		res, err := h.srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s %s = %d", e.method, e.path, res.StatusCode)
		}
	}
}

func TestReportValidationCoversEveryField(t *testing.T) {
	h := newHarness(t)
	for field, extra := range map[string]map[string]any{
		"kind": {"kind": "stolen"}, "sex": {"sex": "x"}, "age": {"age": "x"}, "size": {"size": "x"},
		"description": {"description": strings.Repeat("a", 501)},
		"photos":      {"photos": []string{"1", "2", "3", "4", "5", "6"}},
	} {
		u := h.user("Valida "+field, true)
		body := lostReport("X", laureles, extra)
		body["lastSeenAt"] = h.clock.Now().Add(-time.Minute)
		res := h.do(http.MethodPost, "/v1/pets", u.Token, body)
		if res.Status != http.StatusUnprocessableEntity || !strings.Contains(string(res.Body), `"field":"`+field+`"`) {
			t.Errorf("%s: %d %s", field, res.Status, res.Body)
		}
	}
	// Sin proveedor de correo, el restablecimiento responde igual (y queda en el log).
	h.app.Mailer = nil
	var session struct{ AccessToken string }
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("mail@pawfound.app", "mail"), &session)
	h.must(http.StatusAccepted, http.MethodPost, "/v1/auth/password-reset", "", map[string]string{"email": "mail@pawfound.app"}, nil)
}
