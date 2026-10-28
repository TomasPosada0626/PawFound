package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(url, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func read(t *testing.T, conn *websocket.Conn) Event {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, raw, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var e Event
	_ = json.Unmarshal(raw, &e)
	return e
}

func TestHubDeliversOnlyToAuthenticatedUser(t *testing.T) {
	hub := NewHub()
	auth := func(_ context.Context, token string) (string, error) {
		if token == "good" {
			return "u_1", nil
		}
		return "", errors.New("no")
	}
	server := httptest.NewServer(hub.Handler(auth))
	defer server.Close()

	conn := dial(t, server.URL)
	defer func() { _ = conn.CloseNow() }()
	ctx := context.Background()
	_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","token":"good"}`))
	if e := read(t, conn); e.Type != "ready" {
		t.Fatalf("primer evento = %+v", e)
	}
	deadline := time.Now().Add(2 * time.Second)
	for hub.Connected("u_1") != 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	hub.Publish([]string{"u_2"}, Event{Type: "message", Data: "ajeno"})
	hub.Publish([]string{"u_1"}, Event{Type: "message", Data: "hola"})
	if e := read(t, conn); e.Type != "message" || e.Data != "hola" {
		t.Fatalf("evento = %+v", e)
	}
	_ = conn.Close(websocket.StatusNormalClosure, "")
	deadline = time.Now().Add(2 * time.Second)
	for hub.Connected("u_1") != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.Connected("u_1") != 0 {
		t.Fatal("la conexión cerrada debe salir del hub")
	}

	for _, hello := range []string{`{"type":"auth","token":"bad"}`, `no-json`} {
		bad := dial(t, server.URL)
		_ = bad.Write(ctx, websocket.MessageText, []byte(hello))
		readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_, _, err := bad.Read(readCtx)
		cancel()
		if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
			t.Fatalf("%s: err = %v", hello, err)
		}
		_ = bad.CloseNow()
	}
}

func TestPublishNeverBlocks(t *testing.T) {
	hub := NewHub()
	ch := hub.subscribe("u_1")
	for i := 0; i < buffer+10; i++ {
		hub.Publish([]string{"u_1"}, Event{Type: "x"})
	}
	if len(ch) != buffer {
		t.Fatalf("buffer = %d", len(ch))
	}
	hub.unsubscribe("u_1", ch)
	hub.unsubscribe("u_1", ch) // idempotente
	if hub.Connected("u_1") != 0 {
		t.Fatal("unsubscribe")
	}
}
