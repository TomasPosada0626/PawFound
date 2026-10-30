package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestR2AcceptsAccountIDOrS3URL(t *testing.T) {
	want := "https://abc123.r2.cloudflarestorage.com"
	for _, account := range []string{
		"abc123",
		" abc123 ",
		"https://abc123.r2.cloudflarestorage.com",
		"https://abc123.r2.cloudflarestorage.com/pawfound",
		"abc123.r2.cloudflarestorage.com",
	} {
		s := R2(account, " /pawfound/ ", "ak", "sk")
		if s.Endpoint != want || s.Bucket != "pawfound" || s.Region != "auto" {
			t.Errorf("R2(%q) = %s / %s", account, s.Endpoint, s.Bucket)
		}
	}
}

// R2 responde con un XML que dice el motivo; el error lo incluye para el log.
func TestS3ErrorsIncludeStorageCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`))
	}))
	defer srv.Close()
	store := S3Store{Endpoint: srv.URL, Bucket: "fotos", AccessKey: "ak", SecretKey: "sk", Client: srv.Client()}
	ctx := context.Background()
	if err := store.Put(ctx, "med_1.jpg", []byte("x")); err == nil || !strings.Contains(err.Error(), "403 al subir: AccessDenied (Access Denied)") {
		t.Fatalf("subir: %v", err)
	}
	if _, err := store.Open(ctx, "med_1.jpg"); err == nil || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("leer: %v", err)
	}
	if err := store.Remove(ctx, "med_1.jpg"); err == nil || !strings.Contains(err.Error(), "al borrar: AccessDenied") {
		t.Fatalf("borrar: %v", err)
	}
	if err := store.Check(ctx); err == nil || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("revisión al arrancar: %v", err)
	}
}

func TestS3ErrorWithoutXMLKeepsStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "upstream", http.StatusBadGateway)
	}))
	defer srv.Close()
	store := S3Store{Endpoint: srv.URL, Bucket: "fotos", Client: srv.Client()}
	if err := store.Put(context.Background(), "med_1.jpg", []byte("x")); err == nil || err.Error() != "almacenamiento respondió 502 al subir" {
		t.Fatalf("subir: %v", err)
	}
}

func TestS3CheckUploadsAndRemoves(t *testing.T) {
	var methods []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	store := S3Store{Endpoint: srv.URL, Bucket: "fotos", AccessKey: "ak", SecretKey: "sk", Client: srv.Client()}
	if err := store.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if strings.Join(methods, ",") != "PUT /fotos/"+checkKey+",DELETE /fotos/"+checkKey {
		t.Fatalf("peticiones = %v", methods)
	}
}
