package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestPasswordHashing(t *testing.T) {
	hash, err := HashPassword("Patitas2026")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("formato = %q", hash)
	}
	if !CheckPassword(hash, "Patitas2026") || CheckPassword(hash, "patitas2026") {
		t.Fatal("verificación de contraseña")
	}
	other, _ := HashPassword("Patitas2026")
	if other == hash {
		t.Fatal("la sal debe cambiar el hash")
	}
	for _, bad := range []string{"", "$bcrypt$x", "$argon2id$v=19$m=x$a$b", "$argon2id$v=19$m=1,t=1,p=1$!!$!!", "$argon2id$v=19$m=1,t=1,p=1$YQ$"} {
		if CheckPassword(bad, "Patitas2026") {
			t.Errorf("hash inválido %q aceptado", bad)
		}
	}
}

func TestAccessTokens(t *testing.T) {
	if _, err := NewTokens("corto", time.Minute, nil); err == nil {
		t.Fatal("secreto corto aceptado")
	}
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	tokens, err := NewTokens(strings.Repeat("s", 32), 15*time.Minute, clock)
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessTTL() != 15*time.Minute {
		t.Fatal("ttl")
	}
	tok, _ := tokens.IssueAccess("u_1")
	if sub, err := tokens.ParseAccess(tok); err != nil || sub != "u_1" {
		t.Fatalf("ParseAccess = %q, %v", sub, err)
	}
	other, _ := NewTokens(strings.Repeat("x", 32), time.Minute, clock)
	if _, err := other.ParseAccess(tok); err == nil {
		t.Fatal("aceptó un token firmado con otro secreto")
	}
	none := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{"sub": "u_1", "iss": issuer, "aud": audience, "exp": now.Add(time.Hour).Unix()})
	unsigned, _ := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := tokens.ParseAccess(unsigned); err == nil {
		t.Fatal("aceptó alg=none")
	}
	later, _ := NewTokens(strings.Repeat("s", 32), time.Minute, func() time.Time { return now.Add(16 * time.Minute) })
	if _, err := later.ParseAccess(tok); err == nil {
		t.Fatal("aceptó un token vencido")
	}
}

func TestRandomAndCodes(t *testing.T) {
	if first, second := RandomToken(), RandomToken(); first == second || len(first) != 43 {
		t.Fatal("RandomToken")
	}
	if len(HashToken("a")) != 32 {
		t.Fatal("HashToken")
	}
	code := SMSCode()
	if len(code) != 6 || strings.Trim(code, "0123456789") != "" {
		t.Fatalf("SMSCode = %q", code)
	}
	h := NewCodeHasher("secreto")
	stored := h.Hash("+573001234567", "123456")
	if !h.Equal(stored, "+573001234567", "123456") || h.Equal(stored, "+573009999999", "123456") || h.Equal(stored, "+573001234567", "654321") {
		t.Fatal("CodeHasher")
	}
	if NewCodeHasher("otro").Equal(stored, "+573001234567", "123456") {
		t.Fatal("el hash depende del secreto del servidor")
	}
}

type fakeIDP struct {
	key    *rsa.PrivateKey
	server *httptest.Server
	hits   int
}

func newFakeIDP(t *testing.T) *fakeIDP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	idp := &fakeIDP{key: key}
	idp.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		idp.hits++
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{
			{
				"kid": "k1", "kty": "RSA", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
			},
			{"kid": "ec", "kty": "EC"},
		}})
	}))
	t.Cleanup(idp.server.Close)
	return idp
}

func (f *fakeIDP) sign(t *testing.T, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestOIDCVerify(t *testing.T) {
	idp := newFakeIDP(t)
	p := &OIDCProvider{Name: "google", Issuers: []string{"https://accounts.google.com"}, JWKSURL: idp.server.URL, Audiences: []string{"app-client"}}
	ctx := context.Background()
	exp := time.Now().Add(time.Hour).Unix()
	good := idp.sign(t, "k1", jwt.MapClaims{
		"iss": "https://accounts.google.com", "aud": "app-client", "sub": "123", "exp": exp,
		"email": "ana@gmail.com", "email_verified": true, "name": "Ana Gómez",
	})
	id, err := p.Verify(ctx, good)
	if err != nil || id.Subject != "123" || id.Email != "ana@gmail.com" || !id.EmailVerified || id.Name != "Ana Gómez" {
		t.Fatalf("Verify = %+v, %v", id, err)
	}
	// La segunda verificación usa la caché de llaves.
	if _, err := p.Verify(ctx, good); err != nil || idp.hits != 1 {
		t.Fatalf("caché de JWKS: hits=%d err=%v", idp.hits, err)
	}
	apple := idp.sign(t, "k1", jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "app-client", "sub": "9", "exp": exp, "email_verified": "true"})
	if id, _ := p.Verify(ctx, apple); !id.EmailVerified {
		t.Fatal("email_verified como texto (Apple)")
	}
	bad := map[string]string{
		"otra audiencia":  idp.sign(t, "k1", jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "otra", "sub": "1", "exp": exp}),
		"otro emisor":     idp.sign(t, "k1", jwt.MapClaims{"iss": "https://evil.example", "aud": "app-client", "sub": "1", "exp": exp}),
		"vencido":         idp.sign(t, "k1", jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "app-client", "sub": "1", "exp": time.Now().Add(-time.Hour).Unix()}),
		"sin sub":         idp.sign(t, "k1", jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "app-client", "exp": exp}),
		"kid desconocido": idp.sign(t, "zz", jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "app-client", "sub": "1", "exp": exp}),
		"basura":          "no.es.jwt",
	}
	for name, tok := range bad {
		if _, err := p.Verify(ctx, tok); err == nil {
			t.Errorf("%s: aceptado", name)
		}
	}
	if _, err := GoogleProvider(nil).Verify(ctx, good); err != ErrProviderDisabled {
		t.Fatalf("proveedor sin client IDs = %v", err)
	}
	if !AppleProvider([]string{"app.pawfound"}).Enabled() || GoogleProvider(nil).Enabled() {
		t.Fatal("Enabled")
	}
	broken := &OIDCProvider{Name: "x", Issuers: []string{"i"}, JWKSURL: "http://127.0.0.1:1", Audiences: []string{"a"}}
	if _, err := broken.Verify(ctx, good); err == nil {
		t.Fatal("JWKS inaccesible")
	}
}
