package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeS3 guarda objetos en memoria y anota los encabezados de la última petición.
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte
	last    http.Header
	fail    bool
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.last = r.Header.Clone()
	if f.fail {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodPut:
		body, _ := io.ReadAll(r.Body)
		f.objects[r.URL.Path] = body
	case http.MethodGet:
		body, ok := f.objects[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write(body)
	case http.MethodDelete:
		if _, ok := f.objects[r.URL.Path]; !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		delete(f.objects, r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}
}

func newFakeS3(t *testing.T) (*fakeS3, S3Store) {
	t.Helper()
	fake := &fakeS3{objects: map[string][]byte{}}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	store := S3Store{
		Endpoint: srv.URL + "/", Bucket: "fotos", AccessKey: "AKTEST", SecretKey: "secreto",
		Client: srv.Client(), Now: func() time.Time { return time.Date(2026, 10, 28, 15, 4, 5, 0, time.UTC) },
	}
	return fake, store
}

var authPattern = regexp.MustCompile(`^AWS4-HMAC-SHA256 Credential=AKTEST/20261028/auto/s3/aws4_request, ` +
	`SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`)

func TestS3StoreRoundTripAndSignature(t *testing.T) {
	fake, store := newFakeS3(t)
	ctx := context.Background()
	data := []byte("jpeg de prueba")

	if err := store.Put(ctx, "med_1.jpg", data); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if got := fake.last.Get("x-amz-content-sha256"); got != hex.EncodeToString(sum[:]) {
		t.Fatalf("la subida firma el contenido: %q", got)
	}
	if fake.last.Get("x-amz-date") != "20261028T150405Z" || fake.last.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("encabezados = %v", fake.last)
	}
	if !authPattern.MatchString(fake.last.Get("Authorization")) {
		t.Fatalf("firma = %q", fake.last.Get("Authorization"))
	}
	if string(fake.objects["/fotos/med_1.jpg"]) != string(data) {
		t.Fatal("el objeto va en /<bucket>/<clave>")
	}

	r, err := store.Open(ctx, "med_1.jpg")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(r)
	_ = r.Close()
	if string(got) != string(data) || fake.last.Get("x-amz-content-sha256") != unsignedPayload {
		t.Fatalf("lectura = %q, hash = %q", got, fake.last.Get("x-amz-content-sha256"))
	}

	if err := store.Remove(ctx, "med_1.jpg"); err != nil {
		t.Fatal(err)
	}
	// Borrar lo que ya no está no es un error (una limpieza repetida no debe fallar).
	if err := store.Remove(ctx, "med_1.jpg"); err != nil {
		t.Fatalf("borrar dos veces: %v", err)
	}
	if _, err := store.Open(ctx, "med_1.jpg"); err == nil {
		t.Fatal("leer lo borrado debe fallar")
	}
}

func TestS3StoreSignatureDependsOnSecretAndPayload(t *testing.T) {
	fake, store := newFakeS3(t)
	ctx := context.Background()
	signature := func(s S3Store, data string) string {
		t.Helper()
		if err := s.Put(ctx, "med_firma.jpg", []byte(data)); err != nil {
			t.Fatal(err)
		}
		auth := fake.last.Get("Authorization")
		return auth[strings.LastIndex(auth, "=")+1:]
	}
	first := signature(store, "a")
	if again := signature(store, "a"); again != first {
		t.Fatal("la misma petición en el mismo instante firma igual")
	}
	if signature(store, "b") == first {
		t.Fatal("otro contenido cambia la firma")
	}
	other := store
	other.SecretKey = "otro"
	if signature(other, "a") == first {
		t.Fatal("otra clave secreta cambia la firma")
	}
	other = store
	other.Region = "us-east-1"
	if signature(other, "a") == first || !strings.Contains(fake.last.Get("Authorization"), "/us-east-1/s3/") {
		t.Fatal("la región entra en el alcance de la firma")
	}
}

func TestS3StoreErrors(t *testing.T) {
	fake, store := newFakeS3(t)
	ctx := context.Background()
	fake.fail = true
	if err := store.Put(ctx, "med_2.jpg", []byte("x")); err == nil {
		t.Fatal("un 500 al subir es error")
	}
	if _, err := store.Open(ctx, "med_2.jpg"); err == nil {
		t.Fatal("un 500 al leer es error")
	}
	if err := store.Remove(ctx, "med_2.jpg"); err == nil {
		t.Fatal("un 500 al borrar es error")
	}
	for _, key := range []string{"../secreto", "a/b.jpg", ""} {
		if err := store.Put(ctx, key, []byte("x")); err == nil {
			t.Errorf("clave %q aceptada", key)
		}
	}
	bad := store
	bad.Endpoint = "no es una url"
	if err := bad.Put(ctx, "med_3.jpg", []byte("x")); err == nil {
		t.Fatal("endpoint inválido")
	}
	if _, err := bad.Open(ctx, "med_3.jpg"); err == nil {
		t.Fatal("endpoint inválido al leer")
	}
	if err := bad.Remove(ctx, "med_3.jpg"); err == nil {
		t.Fatal("endpoint inválido al borrar")
	}
	down := store
	down.Endpoint = "http://127.0.0.1:1"
	down.Client = &http.Client{Timeout: 2 * time.Second}
	if err := down.Put(ctx, "med_4.jpg", []byte("x")); err == nil {
		t.Fatal("sin conexión al subir")
	}
}

func TestR2Defaults(t *testing.T) {
	s := R2("cuenta123", "pawfound", "ak", "sk")
	if s.Endpoint != "https://cuenta123.r2.cloudflarestorage.com" || s.Region != "auto" || s.Bucket != "pawfound" {
		t.Fatalf("R2 = %+v", s)
	}
	// Sin región ni reloj propios usa "auto" y la hora real.
	fake, store := newFakeS3(t)
	store.Region, store.Now = "", nil
	if err := store.Put(context.Background(), "med_5.jpg", []byte("x")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(fake.last.Get("Authorization"), "/auto/s3/aws4_request") {
		t.Fatalf("región por defecto: %q", fake.last.Get("Authorization"))
	}
}
