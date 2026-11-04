package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestModerationHearsAboutNewReports(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	mod := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, mod.ID)
	target := h.user("Persona Reportada", true)
	first := h.user("Primera", true)
	second := h.user("Segunda", true)
	report := func(u user) {
		t.Helper()
		h.must(http.StatusNoContent, http.MethodPost, "/v1/users/"+target.ID+"/report", u.Token, map[string]string{"reason": "scam"}, nil)
	}
	toMod := func() []string {
		var out []string
		for _, n := range h.mailer.notices {
			if strings.HasPrefix(n, mod.ID+"@") {
				out = append(out, n)
			}
		}
		return out
	}

	// El primer reporte avisa al instante.
	report(first)
	if got := toMod(); len(got) != 1 || !strings.Contains(got[0], "Reportes nuevos") || !strings.Contains(got[0], "(1)") {
		t.Fatalf("aviso a moderación = %v", got)
	}
	// Los que llegan enseguida esperan y van juntos en el siguiente correo.
	report(second)
	if got := toMod(); len(got) != 1 {
		t.Fatalf("antes de media hora = %v", got)
	}
	if n, err := h.app.NotifyModerators(ctx); err != nil || n != 0 {
		t.Fatalf("todavía no = %d %v", n, err)
	}
	h.clock.Advance(31 * time.Minute)
	if n, err := h.app.NotifyModerators(ctx); err != nil || n != 1 {
		t.Fatalf("siguiente tanda = %d %v", n, err)
	}
	if got := toMod(); len(got) != 2 {
		t.Fatalf("avisos = %v", got)
	}
	// Sin reportes nuevos no se manda nada.
	h.clock.Advance(31 * time.Minute)
	if n, err := h.app.NotifyModerators(ctx); err != nil || n != 0 {
		t.Fatalf("sin reportes nuevos = %d %v", n, err)
	}
}
