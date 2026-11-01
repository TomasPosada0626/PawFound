package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestStoriesLifecycle(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	stranger := h.user("Carlos Mejía", true)
	unverified := h.user("Sin Verificar", false)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	storiesPath := "/v1/pets/" + pet.ID + "/stories"

	// Solo la familia, con la cuenta verificada, y con algo que contar.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, storiesPath, stranger.Token, map[string]string{"text": "hola"})
	if res := h.do(http.MethodPost, storiesPath, unverified.Token, map[string]string{"text": "hola"}); res.Status != http.StatusForbidden {
		t.Fatalf("sin verificar = %d", res.Status)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, storiesPath, owner.Token, map[string]string{"text": "  "})
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/pets/no-existe/stories", owner.Token, map[string]string{"text": "hola"})

	// Una foto ajena no se puede usar.
	foreign, res := h.upload(stranger, "story", jpegBytes(1))
	if res.Status != http.StatusCreated {
		t.Fatalf("foto ajena = %d %s", res.Status, res.Body)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, storiesPath, owner.Token, map[string]string{"photoId": foreign.ID})

	var first app.StoryItem
	h.must(http.StatusCreated, http.MethodPost, storiesPath, owner.Token, map[string]string{"text": "Lo vieron por el parque"}, &first)
	photo, res := h.upload(owner, "story", jpegBytes(2))
	if res.Status != http.StatusCreated {
		t.Fatalf("foto = %d %s", res.Status, res.Body)
	}
	var second app.StoryItem
	h.must(http.StatusCreated, http.MethodPost, storiesPath, owner.Token, map[string]string{"photoId": photo.ID}, &second)
	if second.Photo == nil {
		t.Fatal("la actualización debe traer su foto")
	}

	// Son públicas: se ven sin cuenta, con su foto, cerca del caso.
	feedPath := "/v1/stories?lat=6.24471&lng=-75.59162"
	var feed []app.Story
	h.must(http.StatusOK, http.MethodGet, feedPath, "", nil, &feed)
	if len(feed) != 1 || feed[0].Pet.ID != pet.ID || len(feed[0].Items) != 2 || feed[0].Items[1].Photo == nil {
		t.Fatalf("historias = %+v", feed)
	}
	h.expectError(http.StatusBadRequest, "invalid_input", http.MethodGet, "/v1/stories?lat=x&lng=y", "", nil)

	// Solo la familia las quita; quitar una que no existe no falla.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, "/v1/stories/"+first.ID, stranger.Token, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/stories/no-existe", owner.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/stories/"+first.ID, owner.Token, nil, nil)
	h.must(http.StatusOK, http.MethodGet, feedPath, "", nil, &feed)
	if len(feed[0].Items) != 1 {
		t.Fatalf("tras quitar una = %d", len(feed[0].Items))
	}

	// Tope por caso.
	for i := 1; i < app.MaxStoryItems; i++ {
		h.must(http.StatusCreated, http.MethodPost, storiesPath, owner.Token, map[string]string{"text": fmt.Sprintf("novedad %d", i)}, nil)
	}
	h.expectError(http.StatusUnprocessableEntity, "story_full", http.MethodPost, storiesPath, owner.Token, map[string]string{"text": "una más"})

	// De vuelta en casa, la historia se quita y ya no se puede agregar.
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, storiesPath, owner.Token, map[string]string{"text": "hola"})
	h.must(http.StatusOK, http.MethodGet, feedPath, "", nil, &feed)
	if len(feed) != 0 {
		t.Fatalf("un caso cerrado no sale en historias: %+v", feed)
	}
}

func TestDirectChatLocationArchiveAndClose(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	helper := h.user("Carlos Mejía", true)
	stranger := h.user("Otra Persona", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))

	var direct struct {
		ThreadID string `json:"threadId"`
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/direct", helper.Token, nil, &direct)
	messagesPath := "/v1/threads/" + direct.ThreadID + "/messages"
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", helper.Token, nil, nil)

	share := func(location map[string]any) map[string]any {
		return map[string]any{"text": "", "lang": "es", "location": location}
	}
	// Una persona comparte dónde está solo en un directo, nunca en el grupo.
	current := map[string]any{"kind": "current", "location": laureles}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, share(current))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, messagesPath, helper.Token, share(map[string]any{"kind": "otro"}))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, messagesPath, helper.Token, share(map[string]any{"kind": "current"}))
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, messagesPath, helper.Token,
		share(map[string]any{"kind": "current", "location": map[string]float64{"latitude": 99, "longitude": 0}}))

	var shared app.Message
	h.must(http.StatusCreated, http.MethodPost, messagesPath, helper.Token, share(current), &shared)
	if shared.Location == nil || shared.Location.Hidden {
		t.Fatalf("ubicación = %+v", shared.Location)
	}
	var meeting app.Message
	h.must(http.StatusCreated, http.MethodPost, messagesPath, helper.Token,
		share(map[string]any{"kind": "meeting", "location": laureles, "label": "Parque"}), &meeting)
	if meeting.Location == nil || meeting.Location.Label != "Parque" {
		t.Fatalf("punto de encuentro = %+v", meeting.Location)
	}

	// Una veterinaria sí se puede compartir en el grupo: es un lugar público.
	if _, err := h.app.SeedPlacesSnapshot(context.Background()); err != nil {
		t.Fatal(err)
	}
	var places struct {
		Places []app.Place `json:"places"`
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/places?lat=6.24471&lng=-75.59162&radius=15000", "", nil, &places)
	if len(places.Places) == 0 {
		t.Fatal("debe haber veterinarias cargadas")
	}
	var vet app.Message
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token,
		share(map[string]any{"kind": "place", "placeId": places.Places[0].ID}), &vet)
	if vet.Location == nil || vet.Location.Label != places.Places[0].Name {
		t.Fatalf("veterinaria = %+v", vet.Location)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, messagesPath, helper.Token,
		share(map[string]any{"kind": "place", "placeId": "no-existe"}))

	// Dejar de compartir: solo quien la envió, y las coordenadas se borran.
	stopPath := "/v1/messages/" + shared.ID + "/location"
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, stopPath, owner.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodDelete, "/v1/messages/no-existe/location", helper.Token, nil)
	var text app.Message
	h.must(http.StatusCreated, http.MethodPost, messagesPath, helper.Token, map[string]string{"text": "hola", "lang": "es"}, &text)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, "/v1/messages/"+text.ID+"/location", helper.Token, nil)
	var hidden app.Message
	h.must(http.StatusOK, http.MethodDelete, stopPath, helper.Token, nil, &hidden)
	if hidden.Location == nil || !hidden.Location.Hidden || hidden.Location.Location != nil {
		t.Fatalf("debe quedar sin coordenadas: %+v", hidden.Location)
	}
	if n := h.count(`SELECT count(*) FROM messages WHERE id = $1 AND location_lat IS NULL AND location_lng IS NULL`, shared.ID); n != 1 {
		t.Fatal("las coordenadas deben borrarse de la base")
	}

	// Archivar es solo para quien lo pide.
	var archived struct {
		Archived bool `json:"archived"`
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/threads/"+direct.ThreadID+"/archive", helper.Token, nil, &archived)
	if !archived.Archived {
		t.Fatal("debe quedar archivado")
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/threads/"+direct.ThreadID+"/archive", helper.Token, nil, &archived)
	if archived.Archived {
		t.Fatal("debe quedar sin archivar")
	}

	// Cerrar: solo un directo y solo sus dos personas. Oculta las ubicaciones y ya nadie escribe.
	closePath := "/v1/threads/" + direct.ThreadID + "/close"
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, closePath, stranger.Token, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+pet.GroupID+"/close", helper.Token, nil)
	h.must(http.StatusNoContent, http.MethodPost, closePath, owner.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPost, closePath, helper.Token, nil, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, messagesPath, helper.Token, map[string]string{"text": "hola", "lang": "es"})
	if n := h.count(`SELECT count(*) FROM messages WHERE id = $1 AND location_hidden_at IS NOT NULL`, meeting.ID); n != 1 {
		t.Fatal("cerrar el directo oculta sus ubicaciones")
	}

	// Salir: el chat desaparece de la lista de quien sale.
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/threads/"+direct.ThreadID, helper.Token, nil, nil)
	res := h.must(http.StatusOK, http.MethodGet, "/v1/threads", helper.Token, nil, nil)
	if strings.Contains(string(res.Body), direct.ThreadID) {
		t.Fatal("el chat no debe seguir en la lista")
	}
}

func TestPlacesSearchAndReport(t *testing.T) {
	h := newHarness(t)
	reporter := h.user("Valentina Arango", true)
	if n, err := h.app.SeedPlacesSnapshot(context.Background()); err != nil || n == 0 {
		t.Fatalf("cargar veterinarias = %d, %v", n, err)
	}

	var near struct {
		Places      []app.Place `json:"places"`
		Attribution string      `json:"attribution"`
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/places?lat=6.24471&lng=-75.59162&kind=vet", "", nil, &near)
	if len(near.Places) == 0 || near.Attribution == "" {
		t.Fatalf("veterinarias = %d, atribución %q", len(near.Places), near.Attribution)
	}
	if near.Places[0].Location.Lat == 0 {
		t.Fatal("cada lugar debe traer su ubicación")
	}
	var far struct {
		Places []app.Place `json:"places"`
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/places?lat=1&lng=1&radius=999999", "", nil, &far)
	if len(far.Places) != 0 {
		t.Fatalf("lejos de todo = %d", len(far.Places))
	}
	h.expectError(http.StatusBadRequest, "invalid_input", http.MethodGet, "/v1/places?lat=x&lng=y", "", nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodGet, "/v1/places?lat=99&lng=0", "", nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodGet, "/v1/places?lat=6.2&lng=-75.5&kind=refugio", "", nil)

	reportPath := "/v1/places/" + near.Places[0].ID + "/report"
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, reportPath, reporter.Token, map[string]string{"note": " "})
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/places/no-existe/report", reporter.Token, map[string]string{"note": "cerró"})
	if res := h.do(http.MethodPost, reportPath, "", map[string]string{"note": "cerró"}); res.Status != http.StatusUnauthorized {
		t.Fatalf("sin cuenta = %d", res.Status)
	}
	h.must(http.StatusNoContent, http.MethodPost, reportPath, reporter.Token, map[string]string{"note": "Ya cerró"}, nil)
	if n := h.count(`SELECT count(*) FROM place_reports WHERE place_id = $1 AND note = 'Ya cerró'`, near.Places[0].ID); n != 1 {
		t.Fatal("el aviso debe quedar guardado")
	}
}
