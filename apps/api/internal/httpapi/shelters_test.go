package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestShelterVerificationWithNIT(t *testing.T) {
	h := newHarness(t)
	shelter := h.user("Fundación Huellitas", true)
	newbie := h.user("Sin Verificar", false)
	moderator := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, moderator.ID)
	h.device(shelter)

	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/shelter", newbie.Token, map[string]string{"name": "X", "nit": "900123456-8"})
	for _, bad := range []map[string]string{{"name": "", "nit": "900123456-8"}, {"name": "Huellitas", "nit": "900123456-1"}, {"name": "Huellitas", "nit": "abc"}} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/shelter", shelter.Token, bad)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Fundación Huellitas", "nit": "900.123.456-8"}, nil)
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", shelter.Token, nil, &me)
	if me.User.ShelterStatus == nil || *me.User.ShelterStatus != "pending" || me.User.ShelterName == nil {
		t.Fatalf("estado = %+v", me.User)
	}
	// Mientras no se verifique, nadie más lo ve como refugio.
	if p := h.profile(shelter, ""); p.User.Shelter != nil {
		t.Fatalf("perfil sin verificar = %+v", p.User)
	}

	ctx := context.Background()
	pending, err := h.app.PendingShelters(ctx)
	if err != nil || len(pending) != 1 || pending[0].NIT != "900123456-8" || pending[0].ShelterName != "Fundación Huellitas" {
		t.Fatalf("pendientes = %+v %v", pending, err)
	}
	mod, err := h.app.LoadActor(ctx, moderator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "verify_shelter", UserID: shelter.ID}); err != nil {
		t.Fatal(err)
	}
	if got := h.pushesTo(shelter); len(got) != 1 || got[0].URL != "/pawfamily/refugio" {
		t.Fatalf("aviso = %+v", got)
	}
	if p := h.profile(shelter, ""); p.User.Shelter == nil || *p.User.Shelter != "Fundación Huellitas" {
		t.Fatalf("perfil verificado = %+v", p.User)
	}
	// Sus publicaciones lo muestran como refugio verificado.
	h.acceptTerms(shelter)
	ad := h.publishAdoption(shelter, laureles, "Laureles, Medellín", nil)
	if ad.Owner.Shelter == nil {
		t.Fatalf("publicación = %+v", ad.Owner)
	}
	// Ya verificado no puede cambiar los datos sin pasar otra vez por moderación.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Otro", "nit": "900123456-8"})
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "verify_shelter", UserID: shelter.ID}); err == nil {
		t.Fatal("no hay nada pendiente")
	}

	// Rechazada: puede corregir y volver a pedirla.
	other := h.user("Refugio Falso", true)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/shelter", other.Token, map[string]string{"name": "Refugio Falso", "nit": "9001234568"}, nil)
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "reject_shelter", UserID: other.ID, Note: "NIT de otra empresa"}); err != nil {
		t.Fatal(err)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/me", other.Token, nil, &me)
	if *me.User.ShelterStatus != "rejected" {
		t.Fatalf("rechazado = %+v", me.User)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/shelter", other.Token, map[string]string{"name": "Refugio Real", "nit": "900123456-8"}, nil)
}
