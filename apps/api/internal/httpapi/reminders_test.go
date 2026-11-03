package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestCaseRemindersAndIdleArchive(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	owner := h.user("Familia", true)
	witness := h.user("Vecina", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	day := 24 * time.Hour
	run := func() (int, int) {
		t.Helper()
		reminded, archived, err := h.app.RunCaseReminders(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return reminded, archived
	}
	reminders := func(kind string) int {
		return h.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND pet_id = $2 AND kind = $3`, owner.ID, pet.ID, kind)
	}

	// Antes de 3 días no se pregunta nada; a los 3, una vez, aunque la tarea corra de nuevo.
	h.clock.Advance(2 * day)
	if r, _ := run(); r != 0 {
		t.Fatal("antes de 3 días no hay recordatorio")
	}
	h.clock.Advance(day)
	run()
	run()
	if n := reminders("case_reminder"); n != 1 {
		t.Fatalf("recordatorio de los 3 días = %d", n)
	}
	// Quien no abrió la app en días recibe solo el más reciente que toca (14), no los que faltaban.
	h.clock.Advance(12 * day)
	run()
	if n := reminders("case_reminder"); n != 2 {
		t.Fatalf("a los 15 días debía llegar uno solo más = %d", n)
	}
	h.clock.Advance(10 * day)
	run()
	if n := reminders("case_reminder"); n != 2 {
		t.Fatal("después de los 14 días no hay más recordatorios")
	}

	// A los 53 días sin novedades se avisa que el caso se archivará en 7.
	h.clock.Advance(28 * day) // día 53
	run()
	if n := reminders("archive_warning"); n != 1 {
		t.Fatalf("aviso de archivo = %d", n)
	}
	// Una novedad (un avistamiento) reinicia la cuenta: a los 60 días no se archiva.
	h.clock.Advance(3 * day) // día 56
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", witness.Token, map[string]any{
		"at": h.clock.Now(), "location": belen, "zone": "Belén",
	}, nil)
	h.clock.Advance(5 * day) // día 61, 5 días después de la novedad
	if _, archived := run(); archived != 0 {
		t.Fatal("con una novedad reciente no se archiva")
	}
	// 53 días después de la novedad: nuevo aviso; 7 días después, se archiva.
	h.clock.Advance(48 * day)
	run()
	if n := reminders("archive_warning"); n != 2 {
		t.Fatalf("segundo aviso de archivo = %d", n)
	}
	h.clock.Advance(3 * day)
	if _, archived := run(); archived != 0 {
		t.Fatal("se archiva solo 7 días después del aviso")
	}
	h.clock.Advance(4 * day)
	if _, archived := run(); archived != 1 {
		t.Fatal("debía archivarse")
	}
	var after app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, owner.Token, nil, &after)
	if after.State != "archived" {
		t.Fatalf("estado = %s", after.State)
	}
	if n := reminders("case_archived"); n != 1 {
		t.Fatalf("aviso de caso archivado = %d", n)
	}
	if n := h.count(`SELECT count(*) FROM threads WHERE id = $1 AND archived`, pet.GroupID); n != 1 {
		t.Fatal("el grupo del caso se cierra")
	}
	// Un caso archivado ya no recibe nada más.
	h.clock.Advance(30 * day)
	if r, a := run(); r != 0 || a != 0 {
		t.Fatal("un caso archivado no recibe más avisos")
	}
}
