package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestApplicationsExpireAfterFourteenDays(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	owner := h.user("Refugio", true)
	camila := h.user("Camila", true)
	for _, u := range []user{owner, camila} {
		h.acceptTerms(u)
		h.device(u)
	}
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	h.must(http.StatusCreated, http.MethodPost, "/v1/adoptions/"+ad.ID+"/apply", camila.Token, applicationBody(nil), nil)

	h.clock.Advance(13 * 24 * time.Hour)
	if expired, _, err := h.app.RunAdoptionTasks(ctx); err != nil || expired != 0 {
		t.Fatalf("antes de 14 días no vence: %d %v", expired, err)
	}
	h.clock.Advance(24 * time.Hour)
	if expired, _, err := h.app.RunAdoptionTasks(ctx); err != nil || expired != 1 {
		t.Fatalf("a los 14 días vence: %d %v", expired, err)
	}
	var mine []app.Application
	h.must(http.StatusOK, http.MethodGet, "/v1/me/adoption-applications", camila.Token, nil, &mine)
	if len(mine) != 1 || mine[0].Status != "expired" {
		t.Fatalf("solicitud vencida = %+v", mine)
	}
	if got := h.pushesTo(camila); len(got) != 1 || got[0].URL != "/pawfamily/solicitudes" || !strings.Contains(got[0].Body, "Luna") {
		t.Fatalf("aviso de solicitud vencida = %+v", got)
	}
	var updated app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID, owner.Token, nil, &updated)
	if updated.Pending != 0 {
		t.Fatalf("una vencida ya no está pendiente: %d", updated.Pending)
	}
}

func TestAdoptionFollowUpAndUpdates(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	owner := h.user("Refugio", true)
	camila := h.user("Camila", true)
	stranger := h.user("Otra", true)
	for _, u := range []user{owner, camila, stranger} {
		h.acceptTerms(u)
		h.device(u)
	}
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	updates := "/v1/adoptions/" + ad.ID + "/updates"
	var application app.Application
	h.must(http.StatusCreated, http.MethodPost, "/v1/adoptions/"+ad.ID+"/apply", camila.Token, applicationBody(nil), &application)
	// Antes de adoptar no hay novedades que contar.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, updates, camila.Token, map[string]string{"body": "Hola"})
	h.must(http.StatusOK, http.MethodPost, "/v1/adoption-applications/"+application.ID+"/accept", owner.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/adoptions/"+ad.ID+"/adopted", owner.Token, nil, nil)

	// A los 7 y a los 30 días se le pide una foto a la nueva familia, una vez cada uno.
	day := 24 * time.Hour
	h.clock.Advance(6 * day)
	if _, n, _ := h.app.RunAdoptionTasks(ctx); n != 0 {
		t.Fatal("antes de 7 días no hay recordatorio")
	}
	h.clock.Advance(day)
	if _, n, _ := h.app.RunAdoptionTasks(ctx); n != 1 {
		t.Fatal("a los 7 días llega el recordatorio")
	}
	if _, n, _ := h.app.RunAdoptionTasks(ctx); n != 0 {
		t.Fatal("no se repite")
	}
	h.clock.Advance(23 * day)
	if _, n, _ := h.app.RunAdoptionTasks(ctx); n != 1 {
		t.Fatal("a los 30 días llega el segundo")
	}
	followups := 0
	for _, p := range h.pushesTo(camila) {
		if p.URL == "/pawfamily/"+ad.ID && strings.Contains(p.Title, "¿Cómo está") {
			followups++
		}
	}
	if followups != 2 {
		t.Fatalf("recordatorios de seguimiento = %d", followups)
	}

	// Solo quien adoptó cuenta novedades; las ven ella y quien dio en adopción.
	photo, _ := h.upload(camila, "adoption", jpegBytes(7))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, updates, camila.Token, map[string]string{"body": "  "})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, updates, owner.Token, map[string]string{"body": "Hola"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, updates, stranger.Token, map[string]string{"body": "Hola"})
	var created app.AdoptionUpdate
	h.must(http.StatusCreated, http.MethodPost, updates, camila.Token, map[string]string{"photo": photo.ID, "body": "Ya duerme en su cama"}, &created)
	if created.Photo == nil || created.Body != "Ya duerme en su cama" {
		t.Fatalf("novedad = %+v", created)
	}
	var seen []app.AdoptionUpdate
	h.must(http.StatusOK, http.MethodGet, updates, owner.Token, nil, &seen)
	if len(seen) != 1 || seen[0].ID != created.ID {
		t.Fatalf("quien dio en adopción ve la novedad: %+v", seen)
	}
	h.must(http.StatusOK, http.MethodGet, updates, camila.Token, nil, &seen)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, updates, stranger.Token, nil)
	if got := h.pushesTo(owner); len(got) == 0 || got[len(got)-1].URL != "/pawfamily/"+ad.ID {
		t.Fatalf("a quien dio en adopción le llega la novedad: %+v", got)
	}
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/adoptions/ad_nada/updates", owner.Token, nil)
}

func TestShelterPublicProfile(t *testing.T) {
	h := newHarness(t)
	shelter := h.user("Refugio Patitas", true)
	person := h.user("Persona", true)
	for _, u := range []user{shelter, person} {
		h.acceptTerms(u)
	}
	h.exec(`UPDATE users SET shelter_status = 'verified', shelter_name = 'Refugio Patitas', shelter_nit = '900123456-8' WHERE id = $1`, shelter.ID)
	h.publishAdoption(shelter, laureles, "Laureles, Medellín", nil)
	h.publishAdoption(person, laureles, "Laureles, Medellín", map[string]any{"name": "Toby"})

	var profile app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+shelter.ID, "", nil, &profile)
	if profile.Shelter == nil || profile.Shelter.Name != "Refugio Patitas" || profile.Shelter.Available != 1 || profile.Shelter.Adopted != 0 {
		t.Fatalf("resumen del refugio = %+v", profile.Shelter)
	}
	var list []app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+shelter.ID+"/adoptions", "", nil, &list)
	if len(list) != 1 || list[0].Name != "Luna" {
		t.Fatalf("mascotas del refugio = %+v", list)
	}
	// Una persona natural no muestra resumen de refugio.
	var personal app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+person.ID, "", nil, &personal)
	if personal.Shelter != nil {
		t.Fatalf("una persona no es refugio: %+v", personal.Shelter)
	}
}
