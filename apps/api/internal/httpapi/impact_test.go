package httpapi

import (
	"net/http"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestImpactCountsEveryCaseOfTheCity(t *testing.T) {
	h := newHarness(t)
	impact := func(city string) app.Impact {
		t.Helper()
		var out app.Impact
		h.must(http.StatusOK, http.MethodGet, "/v1/impact?city="+city, "", nil, &out)
		return out
	}
	report := func(zone string) app.Pet {
		t.Helper()
		return h.report(h.user("Familia", true), lostReport("Max", laureles, map[string]any{"zone": zone}))
	}

	// Con menos de 5 casos no se muestran cifras: engañarían.
	for i := 0; i < 4; i++ {
		report("Laureles, Medellín")
	}
	if got := impact("Medell%C3%ADn"); got.Enough || got.ActiveCases != 0 {
		t.Fatalf("con 4 casos = %+v", got)
	}

	// Cuentan también los casos cerrados, que el mapa ya no muestra.
	reunited := report("Belén, Medellín")
	owner := h.ownerToken(reunited)
	h.clock.Advance(3 * 24 * time.Hour)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+reunited.ID+"/reunite", owner, map[string]any{"helperIds": []string{}}, nil)
	// Otra ciudad, una zona sin ciudad y un caso eliminado no cuentan.
	report("El Centro, Bogotá")
	report("Laureles")
	removed := report("Laureles, Medellín")
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+removed.ID, h.ownerToken(removed), nil, nil)

	got := impact("Medell%C3%ADn")
	want := app.Impact{Enough: true, Reunited: 1, ReportsThisMonth: 5, ActiveCases: 4, ReunitedWithin14DaysPct: 100}
	if got != want {
		t.Fatalf("Medellín = %+v, quería %+v", got, want)
	}
	// Sin importar tildes ni mayúsculas.
	if again := impact("MEDELLIN"); again != want {
		t.Fatalf("MEDELLIN = %+v", again)
	}
	// Pasados 14 días, los casos que siguen abiertos bajan el porcentaje: 1 de 5.
	h.clock.Advance(15 * 24 * time.Hour)
	if got := impact("medellin"); got.ReunitedWithin14DaysPct != 20 {
		t.Fatalf("a los 15 días = %+v", got)
	}
	if got := impact("Bogot%C3%A1"); got.Enough {
		t.Fatalf("Bogotá con un caso = %+v", got)
	}
	if got := impact(""); got.Enough {
		t.Fatalf("sin ciudad = %+v", got)
	}
}
