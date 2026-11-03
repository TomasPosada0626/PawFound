package httpapi

import (
	"context"
	"testing"
	"time"
)

func TestMatchesAppearAsTheLifeCircleGrows(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	family := h.user("Familia", true)
	finder := h.user("Quien encontró", true)
	// Se perdió hace un momento: el círculo mide 250 m (más el margen de 500 m).
	h.report(family, lostReport("Max", laureles, map[string]any{"lastSeenAt": h.clock.Now()}))
	// La encuentran ~1,5 km al norte: todavía fuera del círculo, así que al publicar no hay coincidencia.
	north := map[string]float64{"latitude": 6.2582, "longitude": -75.5916}
	found := foundReport(north)
	found["sex"] = "male"
	h.clock.Advance(time.Minute)
	foundPet := h.report(finder, found)
	matches := func() int {
		return h.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND pet_id = $2 AND kind = 'possible_match'`, family.ID, foundPet.ID)
	}
	if n := matches(); n != 0 {
		t.Fatalf("al publicar estaba fuera del círculo: %d avisos", n)
	}
	if _, err := h.app.RunAlertJob(ctx); err != nil {
		t.Fatal(err)
	}
	if n := matches(); n != 0 {
		t.Fatal("con el círculo pequeño todavía no coincide")
	}
	// A los 30 minutos el círculo llega a 2 km: la familia recibe la coincidencia, una sola vez.
	h.clock.Advance(30 * time.Minute)
	for i := 0; i < 2; i++ {
		if _, err := h.app.RunAlertJob(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if n := matches(); n != 1 {
		t.Fatalf("la familia debía recibir la coincidencia una vez: %d", n)
	}
	// A quien encontró no se le repite nada desde la tarea: el aviso es para la familia.
	if n := h.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND kind = 'possible_match'`, finder.ID); n != 0 {
		t.Fatalf("avisos a quien encontró = %d", n)
	}
}
