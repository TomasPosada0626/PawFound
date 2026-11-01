package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestWithdrawHidesPublicationForEveryone(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	helper := h.user("Carlos Mejía", true)

	// Perdida y activa: sale de todas partes y su grupo se cierra.
	lost := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+lost.ID+"/join", helper.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+lost.ID, owner.Token, nil, nil)
	for _, token := range []string{"", helper.Token, owner.Token} {
		h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/pets/"+lost.ID, token, nil)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+lost.GroupID+"/messages", helper.Token, map[string]string{"text": "hola"})
	if n := h.count(`SELECT count(*) FROM notifications WHERE pet_id = $1`, lost.ID); n != 0 {
		t.Fatalf("notificaciones de un caso eliminado = %d", n)
	}

	// Ya en casa: también se puede eliminar, y el reencuentro sigue contando.
	home := h.report(owner, lostReport("Luna", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+home.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+home.ID, owner.Token, nil, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/pets/"+home.ID, owner.Token, nil)
	if n := h.count(`SELECT count(*) FROM pets WHERE id = $1 AND state = 'reunited'`, home.ID); n != 1 {
		t.Fatal("eliminar no cambia que la mascota volvió a casa")
	}

	var mine []app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/me/pets", owner.Token, nil, &mine)
	if len(mine) != 0 {
		t.Fatalf("mis reportes = %d", len(mine))
	}
	// La exportación de datos lleva todo lo que se conserva.
	var export app.Export
	h.must(http.StatusOK, http.MethodGet, "/v1/me/export", owner.Token, nil, &export)
	if len(export.Reports) != 2 {
		t.Fatalf("reportes exportados = %d", len(export.Reports))
	}
}

func TestReportsReachEveryoneLive(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	viewer := h.user("Vecina", true)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.srv.URL, "http")+"/v1/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","token":"`+viewer.Token+`"}`))
	next := func(kind string) map[string]any {
		for {
			_, raw, err := conn.Read(ctx)
			if err != nil {
				t.Fatalf("esperando %s: %v", kind, err)
			}
			var e map[string]any
			_ = json.Unmarshal(raw, &e)
			if e["type"] == kind {
				data, _ := e["data"].(map[string]any)
				return data
			}
		}
	}
	next("ready")
	for h.app.Hub.Connected(viewer.ID) != 1 && ctx.Err() == nil {
		time.Sleep(10 * time.Millisecond)
	}

	lost := h.report(owner, lostReport("Max", laureles, nil))
	if data := next("pet"); data["id"] != lost.ID {
		t.Fatalf("reporte nuevo = %v", data)
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+lost.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	if data := next("pet_closed"); data["id"] != lost.ID || data["removed"] != false {
		t.Fatalf("reencuentro = %v", data)
	}

	other := h.report(owner, lostReport("Luna", laureles, nil))
	next("pet")
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+other.ID, owner.Token, nil, nil)
	if data := next("pet_closed"); data["id"] != other.ID || data["removed"] != true {
		t.Fatalf("publicación eliminada = %v", data)
	}
}
