package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

var (
	poblado  = map[string]float64{"latitude": 6.2088, "longitude": -75.5670}
	bogotaPt = map[string]float64{"latitude": 4.7110, "longitude": -74.0721}
)

// adoptionBody es el formulario para dar en adopción, con una foto ya subida.
func (h *harness) adoptionBody(u user, at map[string]float64, zone string, extra map[string]any) map[string]any {
	h.t.Helper()
	photo, res := h.upload(u, "adoption", jpegBytes(len(zone)))
	if res.Status != http.StatusCreated {
		h.t.Fatalf("foto de adopción = %d", res.Status)
	}
	body := map[string]any{
		"name": "Luna", "species": "dog", "sex": "female", "age": "young", "size": "medium", "breed": "Criolla",
		"description": "Juguetona, sana y muy cariñosa con niños.", "vaccinated": true, "sterilized": true,
		"photos": []string{photo.ID}, "location": at, "zone": zone, "address": "Calle 10 # 20-30",
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func (h *harness) acceptTerms(u user) {
	h.t.Helper()
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/adoption-terms", u.Token, nil, nil)
}

func (h *harness) publishAdoption(u user, at map[string]float64, zone string, extra map[string]any) app.Adoption {
	h.t.Helper()
	var ad app.Adoption
	h.must(http.StatusCreated, http.MethodPost, "/v1/adoptions", u.Token, h.adoptionBody(u, at, zone, extra), &ad)
	return ad
}

func applicationBody(extra map[string]any) map[string]any {
	body := map[string]any{
		"fullName": "Camila Restrepo", "household": 3, "neighborhood": "Laureles", "city": "Medellín",
		"hadPets": true, "petsCount": 2, "reason": "Tenemos patio, tiempo para pasearla y mucho amor para darle.",
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestPublishingAdoptionNeedsTermsAndValidData(t *testing.T) {
	h := newHarness(t)
	shelter := h.user("Refugio Patitas", true)
	newbie := h.user("Sin Verificar", false)

	body := h.adoptionBody(shelter, laureles, "Laureles, Medellín", nil)
	h.expectError(http.StatusForbidden, "adoption_terms", http.MethodPost, "/v1/adoptions", shelter.Token, body)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/adoptions", newbie.Token, body)
	h.acceptTerms(shelter)
	if n := h.count(`SELECT count(*) FROM consents WHERE user_id = $1 AND kind = 'adoption_terms' AND granted`, shelter.ID); n != 1 {
		t.Fatalf("consentimiento = %d", n)
	}
	for field, bad := range map[string]any{
		"name": "", "species": "dragon", "sex": "x", "age": "old", "size": "huge", "description": "",
		"photos": []string{}, "location": map[string]float64{"latitude": 99, "longitude": 0}, "zone": "",
		"address": strings.Repeat("a", 121),
	} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/adoptions", shelter.Token,
			h.adoptionBody(shelter, laureles, "Laureles, Medellín", map[string]any{field: bad}))
	}
	// Fotos de otro tipo no sirven.
	other, _ := h.upload(shelter, "owned", jpegBytes(9))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/adoptions", shelter.Token,
		h.adoptionBody(shelter, laureles, "Laureles, Medellín", map[string]any{"photos": []string{other.ID}}))

	ad := h.publishAdoption(shelter, laureles, "Laureles, Medellín", nil)
	if ad.Status != "available" || ad.Name != "Luna" || len(ad.Photos) != 1 || ad.Address == nil || ad.Owner.ID != shelter.ID {
		t.Fatalf("publicada = %+v", ad)
	}
	// Para las demás personas no hay dirección.
	var seen app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID, "", nil, &seen)
	if seen.Address != nil || seen.Pending != 0 {
		t.Fatalf("vista pública = %+v", seen)
	}
	res := h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID, "", nil, nil)
	if strings.Contains(string(res.Body), "Calle 10") {
		t.Fatalf("filtra la dirección: %s", res.Body)
	}

	// Límite diario para evitar abusos.
	for i := 0; i < 9; i++ {
		h.publishAdoption(shelter, laureles, "Laureles, Medellín", nil)
	}
	h.expectError(http.StatusTooManyRequests, "rate_limited", http.MethodPost, "/v1/adoptions", shelter.Token,
		h.adoptionBody(shelter, laureles, "Laureles, Medellín", nil))
}

func TestSearchAdoptionsByDistanceCityAndFilters(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Refugio Patitas", true)
	h.acceptTerms(owner)
	near := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	cat := h.publishAdoption(owner, belen, "Belén, Medellín", map[string]any{"name": "Michi", "species": "cat", "sex": "male", "size": "small", "age": "puppy"})
	far := h.publishAdoption(owner, poblado, "El Poblado, Medellín", map[string]any{"name": "Toby", "sex": "male", "size": "large", "age": "senior"})
	h.publishAdoption(owner, bogotaPt, "Chapinero, Bogotá", map[string]any{"name": "Rocky"})
	withdrawn := h.publishAdoption(owner, laureles, "Laureles, Medellín", map[string]any{"name": "Kira"})
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/adoptions/"+withdrawn.ID, owner.Token, nil, nil)

	search := func(query string) []string {
		t.Helper()
		var list []app.Adoption
		h.must(http.StatusOK, http.MethodGet, "/v1/adoptions?lat=6.2447&lng=-75.5916&"+query, "", nil, &list)
		names := make([]string, len(list))
		for i, ad := range list {
			names[i] = ad.Name
		}
		return names
	}
	// La más cercana primero y solo dentro de la distancia elegida.
	if got := strings.Join(search("radius=2500"), ","); got != "Luna,Michi" {
		t.Fatalf("2,5 km = %q", got)
	}
	if got := strings.Join(search("radius=10000"), ","); got != "Luna,Michi,Toby" {
		t.Fatalf("10 km = %q", got)
	}
	if got := strings.Join(search("city=Bogot%C3%A1"), ","); got != "Rocky" {
		t.Fatalf("en Bogotá = %q", got)
	}
	for query, want := range map[string]string{
		"radius=10000&species=cat": "Michi", "radius=10000&sex=male": "Michi,Toby", "radius=10000&size=large": "Toby",
		"radius=10000&age=puppy": "Michi", "radius=10000&species=dog&sex=female": "Luna",
	} {
		if got := strings.Join(search(query), ","); got != want {
			t.Fatalf("%s = %q, quería %q", query, got, want)
		}
	}
	h.expectError(http.StatusBadRequest, "invalid_input", http.MethodGet, "/v1/adoptions?lat=x", "", nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodGet, "/v1/adoptions?lat=99&lng=0", "", nil)

	// Lo retirado solo lo ve quien lo publicó.
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/adoptions/"+withdrawn.ID, "", nil)
	var mine []app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/me/adoptions", owner.Token, nil, &mine)
	if len(mine) != 4 {
		t.Fatalf("mis adopciones = %d", len(mine))
	}
	_ = near
	_ = cat
	_ = far
}

func TestApplyAcceptDeclineAndAdopt(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Refugio Patitas", true)
	camila := h.user("Camila Restrepo", true)
	david := h.user("David Gómez", true)
	other := h.user("Otra Persona", true)
	h.device(owner)
	h.device(camila)
	h.device(david)
	h.device(other)
	for _, u := range []user{owner, camila, david, other} {
		h.acceptTerms(u)
	}
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	apply := "/v1/adoptions/" + ad.ID + "/apply"

	// El informe es corto pero completo.
	for field, bad := range map[string]any{
		"fullName": "", "household": 0, "neighborhood": "", "city": "", "reason": "Porque sí",
	} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, apply, camila.Token, applicationBody(map[string]any{field: bad}))
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, apply, camila.Token,
		applicationBody(map[string]any{"hadPets": false, "petsCount": 2}))
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, apply, owner.Token, applicationBody(nil))

	var sent app.Application
	h.must(http.StatusCreated, http.MethodPost, apply, camila.Token, applicationBody(nil), &sent)
	if sent.Status != "pending" || sent.Adoption == nil || sent.Adoption.ID != ad.ID {
		t.Fatalf("solicitud = %+v", sent)
	}
	h.expectError(http.StatusConflict, "already_applied", http.MethodPost, apply, camila.Token, applicationBody(nil))
	h.must(http.StatusCreated, http.MethodPost, apply, david.Token, applicationBody(map[string]any{"fullName": "David Gómez"}), nil)
	// Con los correos apagados en Ajustes, el aviso sigue llegando por la app pero no por correo.
	h.exec(`UPDATE users SET notification_prefs = notification_prefs || '{"email": false}' WHERE id = $1`, owner.ID)
	h.must(http.StatusCreated, http.MethodPost, apply, other.Token, applicationBody(map[string]any{"fullName": "Otra Persona"}), nil)

	// A quien publicó le llega por la app y por correo.
	if got := h.pushesTo(owner); len(got) != 3 || got[0].URL != "/pawfamily/mias" || !strings.Contains(got[0].Body, "Luna") {
		t.Fatalf("avisos a quien publicó = %+v", got)
	}
	if len(h.mailer.notices) != 2 || !strings.Contains(h.mailer.notices[0], "Luna") {
		t.Fatalf("correos = %v", h.mailer.notices)
	}

	var applications []app.Application
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID+"/applications", owner.Token, nil, &applications)
	if len(applications) != 3 || applications[0].Reason == "" || applications[0].Household != 3 {
		t.Fatalf("solicitudes = %+v", applications)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/adoptions/"+ad.ID+"/applications", camila.Token, nil)
	var mine app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID, owner.Token, nil, &mine)
	if mine.Pending != 3 {
		t.Fatalf("pendientes = %d", mine.Pending)
	}

	// Rechazar una: le llega un aviso amable.
	var davidApp string
	for _, a := range applications {
		if a.Applicant.ID == david.ID {
			davidApp = a.ID
		}
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/adoption-applications/"+davidApp+"/decline", camila.Token, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/adoption-applications/"+davidApp+"/decline", owner.Token, nil, nil)
	if got := h.pushesTo(david); len(got) != 1 || !strings.Contains(got[0].Body, "otro hogar") {
		t.Fatalf("aviso de rechazo = %+v", got)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/adoption-applications/"+davidApp+"/accept", owner.Token, nil)

	// Aceptar abre un chat directo y la mascota queda en proceso.
	var accepted map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/adoption-applications/"+sent.ID+"/accept", owner.Token, nil, &accepted)
	threadID := accepted["threadId"]
	if threadID == "" || h.count(`SELECT count(*) FROM thread_members WHERE thread_id = $1 AND user_id IN ($2, $3)`, threadID, owner.ID, camila.ID) != 2 {
		t.Fatalf("chat = %v", accepted)
	}
	if h.count(`SELECT count(*) FROM messages WHERE thread_id = $1 AND kind = 'system' AND body = 'adoption_accepted'`, threadID) != 1 {
		t.Fatal("falta el mensaje del chat")
	}
	if got := h.pushesTo(camila); len(got) != 1 || got[0].URL != "/chat/"+threadID {
		t.Fatalf("aviso de aceptada = %+v", got)
	}
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+threadID+"/messages", camila.Token, map[string]string{"text": "¡Gracias!"}, nil)
	// Quien fue aceptada ve la dirección; las demás personas no.
	var forCamila, forOther app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID, camila.Token, nil, &forCamila)
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions/"+ad.ID, other.Token, nil, &forOther)
	if forCamila.Status != "in_process" || forCamila.Address == nil || *forCamila.MyApplication != "accepted" || forOther.Address != nil {
		t.Fatalf("tras aceptar = %+v / %+v", forCamila, forOther)
	}
	var myApps []app.Application
	h.must(http.StatusOK, http.MethodGet, "/v1/me/adoption-applications", camila.Token, nil, &myApps)
	if len(myApps) != 1 || myApps[0].Status != "accepted" || myApps[0].ThreadID == nil || myApps[0].Adoption == nil || myApps[0].Adoption.Address == nil {
		t.Fatalf("mis solicitudes = %+v", myApps)
	}

	// Marcarla adoptada rechaza con amabilidad las que seguían esperando y cierra la publicación.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/adoptions/"+ad.ID+"/adopted", camila.Token, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/adoptions/"+ad.ID+"/adopted", owner.Token, nil, nil)
	if got := h.pushesTo(other); len(got) != 1 || !strings.Contains(got[0].Body, "ya no está disponible") {
		t.Fatalf("aviso a quien esperaba = %+v", got)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/adoptions/"+ad.ID+"/adopted", owner.Token, nil)
	late := h.user("Tarde", true)
	h.acceptTerms(late)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, apply, late.Token, applicationBody(nil))
	var list []app.Adoption
	h.must(http.StatusOK, http.MethodGet, "/v1/adoptions?lat=6.2447&lng=-75.5916", "", nil, &list)
	if len(list) != 0 {
		t.Fatalf("una adoptada no se lista: %+v", list)
	}
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/me/adoption-applications", "", nil)
}

func TestReportAdoptionForMoneyAndModeration(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Vende Perros", true)
	reporter := h.user("Vecina Atenta", true)
	moderator := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, moderator.ID)
	h.acceptTerms(owner)
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)

	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/adoptions/"+ad.ID+"/report", reporter.Token, map[string]string{"reason": "spam"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/adoptions/"+ad.ID+"/report", owner.Token, map[string]string{"reason": "money"})
	h.must(http.StatusNoContent, http.MethodPost, "/v1/adoptions/"+ad.ID+"/report", reporter.Token,
		map[string]string{"reason": "money", "note": "Pide 200.000 por la vacuna"}, nil)

	ctx := context.Background()
	queue, err := h.app.ModerationQueue(ctx, "open", 10)
	if err != nil || len(queue) != 1 || queue[0].TargetKind != "adoption" || queue[0].Reason != "money" || queue[0].AdoptionID == nil {
		t.Fatalf("cola = %+v %v", queue, err)
	}
	detail, err := h.app.ModerationReport(ctx, queue[0].ID)
	if err != nil || detail.Adoption == nil || detail.Adoption.Address == nil || detail.Reported == nil || detail.Reported.ID != owner.ID {
		t.Fatalf("detalle = %+v %v", detail, err)
	}
	mod, err := h.app.LoadActor(ctx, moderator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "remove_adoption", ReportID: queue[0].ID}); err != nil {
		t.Fatal(err)
	}
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/adoptions/"+ad.ID, reporter.Token, nil)
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "suspend", UserID: owner.ID, Note: "Pidió dinero por adoptar"}); err != nil {
		t.Fatal(err)
	}
	h.expectError(http.StatusForbidden, "suspended", http.MethodGet, "/v1/me/adoptions", owner.Token, nil)
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "restore_adoption", AdoptionID: ad.ID}); err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "remove_adoption", AdoptionID: "ad_nada"}); err == nil {
		t.Fatal("una adopción inexistente debe fallar")
	}
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/adoptions/ad_nada/report", reporter.Token, map[string]string{"reason": "money"})
}

func TestWithdrawingAdoptionClosesPendingApplications(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	applicant := h.user("Quien Adopta", true)
	h.device(applicant)
	h.acceptTerms(owner)
	h.acceptTerms(applicant)
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	h.must(http.StatusCreated, http.MethodPost, "/v1/adoptions/"+ad.ID+"/apply", applicant.Token, applicationBody(nil), nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, "/v1/adoptions/"+ad.ID, applicant.Token, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/adoptions/"+ad.ID, owner.Token, nil, nil)
	if n := h.count(`SELECT count(*) FROM adoption_applications WHERE adoption_id = $1 AND status = 'declined'`, ad.ID); n != 1 {
		t.Fatalf("solicitudes rechazadas = %d", n)
	}
	if got := h.pushesTo(applicant); len(got) != 1 {
		t.Fatalf("aviso = %+v", got)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, "/v1/adoptions/"+ad.ID, owner.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/adoptions/"+ad.ID+"/apply", applicant.Token, applicationBody(nil))
}
