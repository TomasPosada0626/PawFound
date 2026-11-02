package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/jobs"
)

// Con la app cerrada o el celular quieto no llegan puntos nuevos: la alerta debe llegar igual,
// por push, con el último punto conocido.
func TestAngelAlertReachesPhoneWithoutRecentLocation(t *testing.T) {
	h := newHarness(t)
	neighbor := h.user("Vecina", true)
	h.alertZone(neighbor, laureles, "Laureles")
	h.device(neighbor)

	h.clock.Advance(5 * 24 * time.Hour)
	owner := h.user("Familia", true)
	h.report(owner, lostReport("Max", laureles, nil))
	if got := kinds(h.notifications(neighbor)); got != "angel_alert" {
		t.Fatalf("alerta = %q", got)
	}
	if got := h.pushesTo(neighbor); len(got) != 1 {
		t.Fatalf("push = %+v", got)
	}
}

func TestOldAlertLocationIsNotUsedAndGetsDeleted(t *testing.T) {
	h := newHarness(t)
	neighbor := h.user("Vecina", true)
	h.alertZone(neighbor, laureles, "Laureles")
	h.clock.Advance(31 * 24 * time.Hour)

	owner := h.user("Familia", true)
	h.report(owner, lostReport("Max", laureles, nil))
	if got := kinds(h.notifications(neighbor)); got != "" {
		t.Fatalf("no debe avisar por un lugar tan viejo: %q", got)
	}
	if err := jobs.Cleanup(context.Background(), h.app); err != nil {
		t.Fatal(err)
	}
	if n := h.count(`SELECT count(*) FROM alert_zones WHERE user_id = $1`, neighbor.ID); n != 0 {
		t.Fatal("la ubicación vencida debe borrarse")
	}
}

func TestAlertLocationLastsWhileASessionIsOpen(t *testing.T) {
	h := newHarness(t)
	const email, password = "valen@pawfound.app", "Patitas2026"
	var first, second app.Session
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody(email, "valen_a"), &first)
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": email, "password": password}, &second)
	userID := first.Me.User.ID
	h.must(http.StatusOK, http.MethodPut, "/v1/me/alert-zone", first.AccessToken, map[string]any{"location": laureles, "zone": "Laureles"}, nil)

	// Cerrar una de las dos sesiones no apaga las alertas del otro celular.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/logout", "", map[string]string{"refreshToken": first.RefreshToken}, nil)
	if n := h.count(`SELECT count(*) FROM alert_zones WHERE user_id = $1`, userID); n != 1 {
		t.Fatal("con otra sesión abierta la ubicación se conserva")
	}

	// Con la última cerrada ya no hay a quién avisar: se borra y queda registrado.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/logout", "", map[string]string{"refreshToken": second.RefreshToken}, nil)
	if n := h.count(`SELECT count(*) FROM alert_zones WHERE user_id = $1`, userID); n != 0 {
		t.Fatal("sin sesiones abiertas la ubicación se borra")
	}
	if n := h.count(`SELECT count(*) FROM consents WHERE user_id = $1 AND kind = 'location' AND NOT granted`, userID); n != 1 {
		t.Fatal("el retiro debe quedar registrado")
	}

	// Un token que no existe no falla: cerrar sesión es idempotente.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/auth/logout", "", map[string]string{"refreshToken": "no-existe"}, nil)
}
