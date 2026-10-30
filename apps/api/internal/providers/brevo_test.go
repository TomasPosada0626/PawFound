package providers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBrevoMailer(t *testing.T) {
	ctx := context.Background()
	if err := (BrevoMailer{}).SendVerificationCode(ctx, "a@b.co", "", "1", "es"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("sin clave = %v", err)
	}
	var got map[string]any
	var key string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key = r.Header.Get("api-key")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	m := BrevoMailer{APIKey: "k", From: "pawfound@x.co", Endpoint: server.URL}
	if err := m.SendVerificationCode(ctx, "ana@x.co", "Ana María", "123456", "es"); err != nil {
		t.Fatal(err)
	}
	if key != "k" || !strings.Contains(got["subject"].(string), "123456") || !strings.Contains(got["textContent"].(string), "123456") {
		t.Fatalf("petición = %v (clave %q)", got, key)
	}
	if to := got["to"].([]any)[0].(map[string]any)["email"]; to != "ana@x.co" {
		t.Fatalf("destinatario = %v", to)
	}
	if err := m.SendVerificationCode(ctx, "ana@x.co\r\nBcc: x@y.co", "", "1", "es"); !errors.Is(err, errHeaderInjection) {
		t.Fatalf("dirección inválida = %v", err)
	}
	if err := m.SendPasswordReset(ctx, "ana@x.co", "https://x/reset"); err != nil {
		t.Fatal(err)
	}

	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"unauthorized","message":"Key not found"}`))
	}))
	defer failing.Close()
	if err := (BrevoMailer{APIKey: "k", From: "p@x.co", Endpoint: failing.URL}).SendVerificationCode(ctx, "a@b.co", "", "1", "en"); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("error de Brevo = %v", err)
	}
	if err := (BrevoMailer{APIKey: "k", From: "p@x.co", Endpoint: "http://127.0.0.1:1"}).SendVerificationCode(ctx, "a@b.co", "", "1", "es"); err == nil {
		t.Fatal("error de red ignorado")
	}
}
