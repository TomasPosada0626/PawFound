package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"math/big"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/testdb"
)

// Coordenadas de Medellín usadas en las pruebas (como el seed de la app).
var (
	laureles = map[string]float64{"latitude": 6.2447, "longitude": -75.5916}
	estadio  = map[string]float64{"latitude": 6.2530, "longitude": -75.5900} // ~0,9 km de Laureles
	belen    = map[string]float64{"latitude": 6.2310, "longitude": -75.6030} // ~2 km
	envigado = map[string]float64{"latitude": 6.1800, "longitude": -75.5850} // ~7,2 km
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type fakePush struct {
	mu   sync.Mutex
	sent []providers.PushMessage
}

func (p *fakePush) Send(_ context.Context, m []providers.PushMessage) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sent = append(p.sent, m...)
	return nil
}

func (p *fakePush) all() []providers.PushMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]providers.PushMessage(nil), p.sent...)
}

type fakeMailer struct {
	links []string
	codes map[string]string
}

func (m *fakeMailer) SendVerificationCode(_ context.Context, email, _, code, _ string) error {
	if m.codes == nil {
		m.codes = map[string]string{}
	}
	m.codes[email] = code
	return nil
}

func (m *fakeMailer) SendPasswordReset(_ context.Context, _ string, link string) error {
	m.links = append(m.links, link)
	return nil
}

type upperTranslator struct{}

func (upperTranslator) Translate(_ context.Context, text, _, to string) (string, error) {
	return "[" + to + "] " + text, nil
}

type harness struct {
	t      *testing.T
	app    *app.App
	srv    *httptest.Server
	clock  *clock
	push   *fakePush
	mailer *fakeMailer
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	pool := testdb.Pool(t)
	c := &clock{t: time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC)}
	tokens, err := auth.NewTokens(strings.Repeat("k", 32), 365*24*time.Hour, c.Now)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := &harness{t: t, clock: c, push: &fakePush{}, mailer: &fakeMailer{}}
	h.app = &app.App{
		DB: pool, Tokens: tokens, Codes: auth.NewCodeHasher("pruebas"),
		Push: h.push, Mailer: h.mailer, Media: media.LocalStore{Dir: t.TempDir()}, Log: log, Now: c.Now, SendMailInline: true,
		APIBaseURL: "http://api.test", WebBaseURL: "https://pawfound.test", FixedCode: "123456", Translator: upperTranslator{},
	}
	h.app.Init()
	server := &Server{App: h.app, Log: log}
	h.srv = httptest.NewServer(server.Handler())
	t.Cleanup(h.srv.Close)
	return h
}

type user struct {
	ID    string
	Token string
	Name  string
}

// user crea una cuenta directamente en la base (más rápido que el registro completo, que
// tiene su propia prueba) y le emite un token.
func (h *harness) user(name string, verified bool) user {
	h.t.Helper()
	id := domain.NewID("u")
	username := "t" + id[len(id)-12:]
	_, err := h.app.DB.Exec(context.Background(), `INSERT INTO users (id, name, username, email, phone, email_verified, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, id, name, username, id+"@pawfound.test", "+5730"+id[len(id)-8:], verified, h.clock.Now().Add(-40*24*time.Hour))
	if err != nil {
		h.t.Fatal(err)
	}
	token, _ := h.app.Tokens.IssueAccess(id)
	return user{ID: id, Token: token, Name: name}
}

type response struct {
	Status int
	Body   []byte
	Header http.Header
}

func (r response) decode(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decodificar %s: %v", r.Body, err)
	}
}

func (r response) code() string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(r.Body, &e)
	return e.Error.Code
}

func (h *harness) do(method, path, token string, body any) response {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := h.srv.Client().Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, _ := io.ReadAll(res.Body)
	return response{Status: res.StatusCode, Body: raw, Header: res.Header}
}

// must exige el estado y decodifica la respuesta.
func (h *harness) must(status int, method, path, token string, body, out any) response {
	h.t.Helper()
	res := h.do(method, path, token, body)
	if res.Status != status {
		h.t.Fatalf("%s %s = %d, want %d: %s", method, path, res.Status, status, res.Body)
	}
	if out != nil {
		res.decode(h.t, out)
	}
	return res
}

func (h *harness) expectError(status int, code, method, path, token string, body any) {
	h.t.Helper()
	res := h.do(method, path, token, body)
	if res.Status != status || res.code() != code {
		h.t.Fatalf("%s %s = %d %q, want %d %q: %s", method, path, res.Status, res.code(), status, code, res.Body)
	}
}

func jpegBytes(seed int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 320, 240))
	for y := 0; y < 240; y++ {
		for x := 0; x < 320; x++ {
			img.Set(x, y, color.RGBA{R: uint8((x * seed) % 256), G: uint8((y * (seed + 3)) % 256), B: uint8((x + y + seed*40) % 256), A: 255})
		}
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func (h *harness) upload(u user, purpose string, data []byte) (app.UploadedMedia, response) {
	h.t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("purpose", purpose)
	part, _ := w.CreateFormFile("file", "foto.jpg")
	_, _ = part.Write(data)
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, h.srv.URL+"/v1/media", &body)
	req.Header.Set("Authorization", "Bearer "+u.Token)
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := h.srv.Client().Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, _ := io.ReadAll(res.Body)
	var out app.UploadedMedia
	_ = json.Unmarshal(raw, &out)
	return out, response{Status: res.StatusCode, Body: raw, Header: res.Header}
}

func (h *harness) alertZone(u user, at map[string]float64, zone string) {
	h.t.Helper()
	h.must(http.StatusOK, http.MethodPut, "/v1/me/alert-zone", u.Token, map[string]any{"location": at, "zone": zone}, nil)
}

func (h *harness) device(u user) {
	h.t.Helper()
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/devices", u.Token, map[string]string{"token": "ExponentPushToken[" + u.ID + "]", "platform": "android"}, nil)
}

func lostReport(name string, at map[string]float64, extra map[string]any) map[string]any {
	r := map[string]any{
		"kind": "lost", "name": name, "species": "dog", "breed": "Criollo", "sex": "male", "age": "adult",
		"size": "medium", "color": "Negro con blanco", "description": "Collar rojo, muy amigable.", "photos": []string{},
		"traumaticEvent": false, "shyOrIndoor": false, "location": at, "zone": "Laureles", "reward": true,
	}
	for k, v := range extra {
		r[k] = v
	}
	return r
}

func (h *harness) report(u user, body map[string]any) app.Pet {
	h.t.Helper()
	if _, ok := body["lastSeenAt"]; !ok {
		body["lastSeenAt"] = h.clock.Now().Add(-10 * time.Minute)
	}
	var pet app.Pet
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets", u.Token, body, &pet)
	return pet
}

func (h *harness) notifications(u user) []app.Notification {
	h.t.Helper()
	var list []app.Notification
	h.must(http.StatusOK, http.MethodGet, "/v1/me/notifications", u.Token, nil, &list)
	return list
}

func kinds(list []app.Notification) string {
	out := make([]string, len(list))
	for i, n := range list {
		out[i] = n.Kind
	}
	return strings.Join(out, ",")
}

func (h *harness) pushesTo(u user) []providers.PushMessage {
	var out []providers.PushMessage
	for _, m := range h.push.all() {
		if m.Token == "ExponentPushToken["+u.ID+"]" {
			out = append(out, m)
		}
	}
	return out
}

func (h *harness) exec(sql string, args ...any) {
	h.t.Helper()
	if _, err := h.app.DB.Exec(context.Background(), sql, args...); err != nil {
		h.t.Fatalf("%s: %v", sql, err)
	}
}

func (h *harness) count(sql string, args ...any) int {
	h.t.Helper()
	var n int
	if err := h.app.DB.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		h.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

type testIDP struct {
	t   *testing.T
	key *rsa.PrivateKey
	url string
}

// newTestIDP levanta un proveedor OIDC falso (llaves JWKS propias) para Google o Apple.
func newTestIDP(t *testing.T) *testIDP {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k", "kty": "RSA",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(srv.Close)
	return &testIDP{t: t, key: key, url: srv.URL}
}

func (p *testIDP) provider(name string) *auth.OIDCProvider {
	return &auth.OIDCProvider{Name: name, Issuers: []string{"https://accounts.google.com"}, JWKSURL: p.url, Audiences: []string{"pawfound-android"}}
}

func (p *testIDP) token(sub, email string, verified bool) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss": "https://accounts.google.com", "aud": "pawfound-android",
		"sub": sub, "email": email, "email_verified": verified, "name": "Persona Prueba", "exp": time.Now().Add(time.Hour).Unix(),
	})
	tok.Header["kid"] = "k"
	s, _ := tok.SignedString(p.key)
	return s
}
