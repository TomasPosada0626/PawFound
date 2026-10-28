package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogProvidersNeverLeakFullPhone(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	ctx := context.Background()
	if err := (LogSMS{Log: log}).SendCode(ctx, "+573001234567", "123456"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "3001234567") || !strings.Contains(buf.String(), "…67") {
		t.Fatalf("log = %s", buf.String())
	}
	if suffix("1") != "**" {
		t.Fatal("suffix corto")
	}
	if err := (LogPush{Log: log}).Send(ctx, []PushMessage{{Title: "t", URL: "/pet/1"}}); err != nil {
		t.Fatal(err)
	}
	if err := (LogMailer{Log: log}).SendPasswordReset(ctx, "a@b.co", "https://pawfound.app/reset?t=x"); err != nil {
		t.Fatal(err)
	}
	if err := (DisabledSMS{}).SendCode(ctx, "", ""); !errors.Is(err, ErrDisabled) {
		t.Fatal("DisabledSMS")
	}
}

func TestExpoPushBatchesAndSilence(t *testing.T) {
	var batches [][]map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		raw, _ := io.ReadAll(r.Body)
		var batch []map[string]any
		_ = json.Unmarshal(raw, &batch)
		batches = append(batches, batch)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	msgs := make([]PushMessage, 150)
	for i := range msgs {
		msgs[i] = PushMessage{Token: "ExponentPushToken[x]", Title: "🚨", Body: "b", URL: "/alerta/angel/p1", Channel: "angel-alerts", Silent: i == 0}
	}
	p := ExpoPush{AccessToken: "tok", Endpoint: server.URL}
	if err := p.Send(context.Background(), msgs); err != nil {
		t.Fatal(err)
	}
	if len(batches) != 2 || len(batches[0]) != 100 || len(batches[1]) != 50 {
		t.Fatalf("lotes = %d", len(batches))
	}
	first, second := batches[0][0], batches[0][1]
	if first["sound"] != nil || first["priority"] != "normal" || second["sound"] != "default" {
		t.Fatalf("modo descanso: %+v / %+v", first, second)
	}
	if data, _ := first["data"].(map[string]any); data["url"] != "/alerta/angel/p1" {
		t.Fatalf("data = %+v", first["data"])
	}

	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) }))
	defer failing.Close()
	if err := (ExpoPush{Endpoint: failing.URL}).Send(context.Background(), msgs[:1]); err == nil {
		t.Fatal("error HTTP ignorado")
	}
	if err := (ExpoPush{Endpoint: "http://127.0.0.1:1"}).Send(context.Background(), msgs[:1]); err == nil {
		t.Fatal("error de red ignorado")
	}
}
