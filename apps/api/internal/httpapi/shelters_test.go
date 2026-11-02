package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestShelterIsVerifiedWithAValidNIT(t *testing.T) {
	h := newHarness(t)
	shelter := h.user("Fundación Huellitas", true)
	newbie := h.user("Sin Verificar", false)
	copycat := h.user("Refugio Copia", true)
	moderator := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, moderator.ID)
	h.device(shelter)

	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/shelter", newbie.Token, map[string]string{"name": "X", "nit": "900123456-8"})
	for _, bad := range []map[string]string{{"name": "", "nit": "900123456-8"}, {"name": "Huellitas", "nit": "900123456-1"}, {"name": "Huellitas", "nit": "abc"}} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/shelter", shelter.Token, bad)
	}
	// Con el dígito de verificación correcto queda verificado al instante.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Fundación Huellitas", "nit": "900.123.456-8"}, nil)
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", shelter.Token, nil, &me)
	if me.User.ShelterStatus == nil || *me.User.ShelterStatus != "verified" || me.User.ShelterName == nil {
		t.Fatalf("estado = %+v", me.User)
	}
	if p := h.profile(shelter, ""); p.User.Shelter == nil || *p.User.Shelter != "Fundación Huellitas" {
		t.Fatalf("perfil = %+v", p.User)
	}
	h.acceptTerms(shelter)
	ad := h.publishAdoption(shelter, laureles, "Laureles, Medellín", nil)
	if ad.Owner.Shelter == nil {
		t.Fatalf("publicación = %+v", ad.Owner)
	}
	// Un NIT verifica una sola cuenta; corregir el nombre con el mismo NIT sí se puede.
	h.expectError(http.StatusConflict, "nit_taken", http.MethodPost, "/v1/me/shelter", copycat.Token, map[string]string{"name": "Copia", "nit": "9001234568"})
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Fundación Huellitas Medellín", "nit": "900123456-8"}, nil)

	ctx := context.Background()
	list, err := h.app.Shelters(ctx)
	if err != nil || len(list) != 1 || list[0].NIT != "900123456-8" || list[0].ShelterName != "Fundación Huellitas Medellín" {
		t.Fatalf("refugios = %+v %v", list, err)
	}
	// Moderación puede quitar la verificación; entonces no vuelve a verificarse sola.
	mod, err := h.app.LoadActor(ctx, moderator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "reject_shelter", UserID: shelter.ID, Note: "El NIT es de otra empresa"}); err != nil {
		t.Fatal(err)
	}
	if got := h.pushesTo(shelter); len(got) != 1 || got[0].URL != "/pawfamily/refugio" {
		t.Fatalf("aviso = %+v", got)
	}
	if p := h.profile(shelter, ""); p.User.Shelter != nil {
		t.Fatalf("sin verificación = %+v", p.User)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Huellitas", "nit": "900123456-8"})
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "reject_shelter", UserID: shelter.ID}); err == nil {
		t.Fatal("ya estaba sin verificación")
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "verify_shelter", UserID: shelter.ID}); err != nil {
		t.Fatal(err)
	}
	if p := h.profile(shelter, ""); p.User.Shelter == nil {
		t.Fatalf("verificación devuelta = %+v", p.User)
	}
}

func TestAdoptingEarnsTheNewMemberBadge(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	adopter := h.user("Quien Adopta", true)
	h.device(adopter)
	h.acceptTerms(owner)
	h.acceptTerms(adopter)
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	var sent app.Application
	h.must(http.StatusCreated, http.MethodPost, "/v1/adoptions/"+ad.ID+"/apply", adopter.Token, applicationBody(nil), &sent)
	h.must(http.StatusOK, http.MethodPost, "/v1/adoption-applications/"+sent.ID+"/accept", owner.Token, nil, nil)
	if count, tier := badgeOf(h.profile(adopter, ""), "new_member"); count != 0 || tier != 0 {
		t.Fatalf("antes de adoptar = %d/%d", count, tier)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/adoptions/"+ad.ID+"/adopted", owner.Token, nil, nil)
	if count, tier := badgeOf(h.profile(adopter, ""), "new_member"); count != 1 || tier != 1 {
		t.Fatalf("Nuevo integrante = %d/%d", count, tier)
	}
	got := h.pushesTo(adopter)
	if last := got[len(got)-1]; last.URL != "/profile" || last.Title != "🏡 ¡Bienvenido el nuevo integrante!" {
		t.Fatalf("aviso = %+v", last)
	}
}
