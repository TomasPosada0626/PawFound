package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestContactPhoneOnThePosterIsTheFamilyDecision(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	stranger := h.user("Otra Persona", true)
	unverified := h.user("Sin Verificar", false)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	path := "/v1/pets/" + pet.ID + "/contact"

	// Nada se muestra hasta que la familia lo activa.
	var seen app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, "", nil, &seen)
	if seen.ContactPhone != nil {
		t.Fatalf("por defecto no hay celular: %v", *seen.ContactPhone)
	}

	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPut, path, stranger.Token, map[string]string{"phone": "3001234567"})
	if res := h.do(http.MethodPut, path, unverified.Token, map[string]string{"phone": "3001234567"}); res.Status != http.StatusForbidden {
		t.Fatalf("sin verificar = %d", res.Status)
	}
	h.expectError(http.StatusUnprocessableEntity, "invalid_phone", http.MethodPut, path, owner.Token, map[string]string{"phone": "123"})
	h.expectError(http.StatusNotFound, "not_found", http.MethodPut, "/v1/pets/no-existe/contact", owner.Token, map[string]string{"phone": "3001234567"})

	var updated app.Pet
	h.must(http.StatusOK, http.MethodPut, path, owner.Token, map[string]string{"phone": "300 123 4567"}, &updated)
	if updated.ContactPhone == nil || *updated.ContactPhone != "+573001234567" {
		t.Fatalf("celular = %v", updated.ContactPhone)
	}

	// Quien abre el caso lo ve, para que el afiche salga igual si otra persona lo comparte.
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, "", nil, &seen)
	if seen.ContactPhone == nil {
		t.Fatal("el caso debe traer el celular activado")
	}
	// Pero no sale en las listas: nadie puede juntar celulares recorriendo el mapa.
	res := h.must(http.StatusOK, http.MethodGet, "/v1/pets?lat=6.24471&lng=-75.59162&radius=5000", "", nil, nil)
	if strings.Contains(string(res.Body), "+573001234567") || strings.Contains(string(res.Body), "contactPhone") {
		t.Fatalf("las listas no llevan celulares: %s", res.Body)
	}

	// Se puede quitar.
	var cleared app.Pet
	h.must(http.StatusOK, http.MethodPut, path, owner.Token, map[string]string{"phone": ""}, &cleared)
	if cleared.ContactPhone != nil {
		t.Fatal("debe poder quitarse")
	}
}

func TestContactPhoneDisappearsWhenTheCaseCloses(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	number := map[string]string{"phone": "3001234567"}

	home := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPut, "/v1/pets/"+home.ID+"/contact", owner.Token, number, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+home.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	if n := h.count(`SELECT count(*) FROM pets WHERE id = $1 AND contact_phone IS NULL`, home.ID); n != 1 {
		t.Fatal("al volver a casa el celular se borra")
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPut, "/v1/pets/"+home.ID+"/contact", owner.Token, number)

	removed := h.report(owner, lostReport("Luna", laureles, nil))
	h.must(http.StatusOK, http.MethodPut, "/v1/pets/"+removed.ID+"/contact", owner.Token, number, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+removed.ID, owner.Token, nil, nil)
	if n := h.count(`SELECT count(*) FROM pets WHERE id = $1 AND contact_phone IS NULL`, removed.ID); n != 1 {
		t.Fatal("al eliminar la publicación el celular se borra")
	}
}

func TestContactPhoneIsDeletedWithTheAccount(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPut, "/v1/pets/"+pet.ID+"/contact", owner.Token, map[string]string{"phone": "3001234567"}, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me", owner.Token, nil, nil)
	if n := h.count(`SELECT count(*) FROM pets WHERE id = $1 AND contact_phone IS NULL`, pet.ID); n != 1 {
		t.Fatal("al eliminar la cuenta el celular se borra")
	}
}
