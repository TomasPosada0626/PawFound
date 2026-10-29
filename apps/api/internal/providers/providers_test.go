package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLogProvidersNeverLeakFullEmail(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	ctx := context.Background()
	if err := (LogMailer{Log: log}).SendVerificationCode(ctx, "valentina.arango@gmail.com", "123456", "es"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "valentina.arango") || !strings.Contains(buf.String(), "gmail.com") || !strings.Contains(buf.String(), "123456") {
		t.Fatalf("log = %s", buf.String())
	}
	if domainOf("sin-arroba") != "?" {
		t.Fatal("domainOf")
	}
	if err := (LogPush{Log: log}).Send(ctx, []PushMessage{{Title: "t", URL: "/pet/1"}}); err != nil {
		t.Fatal(err)
	}
	if err := (LogMailer{Log: log}).SendPasswordReset(ctx, "a@b.co", "https://pawfound.app/reset?t=x"); err != nil {
		t.Fatal(err)
	}
}

// fakeSMTP responde como un servidor SMTP sin STARTTLS: PawFound debe negarse a enviar en
// texto plano (el código viajaría sin cifrar).
func fakeSMTP(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		r := bufio.NewReader(conn)
		_, _ = conn.Write([]byte("220 fake ESMTP\r\n"))
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			switch {
			case strings.HasPrefix(strings.ToUpper(line), "EHLO"):
				_, _ = conn.Write([]byte("250-fake\r\n250 AUTH PLAIN\r\n"))
			case strings.HasPrefix(strings.ToUpper(line), "QUIT"):
				_, _ = conn.Write([]byte("221 bye\r\n"))
				return
			default:
				_, _ = conn.Write([]byte("250 ok\r\n"))
			}
		}
	}()
	return ln.Addr().String()
}

func TestSMTPMailerSafety(t *testing.T) {
	ctx := context.Background()
	if err := (SMTPMailer{}).SendVerificationCode(ctx, "a@b.co", "1", "es"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("sin host = %v", err)
	}
	m := SMTPMailer{Host: "127.0.0.1", Port: "1", From: "pawfound@x.co", Timeout: time.Second}
	if err := m.SendVerificationCode(ctx, "a@b.co\r\nBcc: todos@x.co", "1", "es"); !errors.Is(err, errHeaderInjection) {
		t.Fatalf("inyección de cabeceras = %v", err)
	}
	if err := m.SendPasswordReset(ctx, "a@b.co", "https://x"); err == nil {
		t.Fatal("servidor caído")
	}
	host, port, _ := net.SplitHostPort(fakeSMTP(t))
	plain := SMTPMailer{Host: host, Port: port, From: "pawfound@x.co", Timeout: 2 * time.Second}
	if err := plain.SendVerificationCode(ctx, "a@b.co", "123456", "en"); err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("sin STARTTLS = %v", err)
	}
	if err := (SMTPMailer{Host: "127.0.0.1", Port: "465", From: "x@x.co", Timeout: time.Second}).SendVerificationCode(ctx, "a@b.co", "1", "fr"); err == nil {
		t.Fatal("TLS directo sin servidor")
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
