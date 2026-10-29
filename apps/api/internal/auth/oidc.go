package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Identity es lo que la API toma de un ID token verificado.
type Identity struct {
	Provider      string
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// OIDCProvider verifica ID tokens firmados por Google o Apple contra sus llaves públicas
// (JWKS). Solo acepta RS256, el emisor esperado y una de las audiencias configuradas (los
// client IDs de la app). Sin client IDs configurados, el proveedor queda desactivado.
type OIDCProvider struct {
	Name      string
	Issuers   []string
	JWKSURL   string
	Audiences []string
	Client    *http.Client
	Now       func() time.Time

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

// GoogleProvider y AppleProvider con sus emisores y llaves públicas oficiales.
func GoogleProvider(audiences []string) *OIDCProvider {
	return &OIDCProvider{
		Name: "google", Issuers: []string{"https://accounts.google.com", "accounts.google.com"},
		JWKSURL: "https://www.googleapis.com/oauth2/v3/certs", Audiences: audiences,
	}
}

// AppleProvider para "Iniciar sesión con Apple" (iOS, más adelante).
func AppleProvider(audiences []string) *OIDCProvider {
	return &OIDCProvider{
		Name: "apple", Issuers: []string{"https://appleid.apple.com"},
		JWKSURL: "https://appleid.apple.com/auth/keys", Audiences: audiences,
	}
}

// ErrProviderDisabled: el proveedor no tiene client IDs configurados.
var ErrProviderDisabled = errors.New("proveedor no configurado")

// Enabled indica si hay client IDs configurados.
func (p *OIDCProvider) Enabled() bool { return p != nil && len(p.Audiences) > 0 }

// Verify valida el ID token y devuelve la identidad.
func (p *OIDCProvider) Verify(ctx context.Context, idToken string) (Identity, error) {
	if !p.Enabled() {
		return Identity{}, ErrProviderDisabled
	}
	now := time.Now
	if p.Now != nil {
		now = p.Now
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(idToken, claims, func(tok *jwt.Token) (any, error) {
		kid, _ := tok.Header["kid"].(string)
		return p.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithExpirationRequired(), jwt.WithTimeFunc(now), jwt.WithLeeway(time.Minute))
	if err != nil {
		return Identity{}, ErrInvalidToken
	}
	iss, _ := claims.GetIssuer()
	if !contains(p.Issuers, iss) {
		return Identity{}, ErrInvalidToken
	}
	aud, _ := claims.GetAudience()
	if !anyIn(aud, p.Audiences) {
		return Identity{}, ErrInvalidToken
	}
	sub, _ := claims.GetSubject()
	if sub == "" {
		return Identity{}, ErrInvalidToken
	}
	id := Identity{Provider: p.Name, Subject: sub}
	id.Email, _ = claims["email"].(string)
	id.Name, _ = claims["name"].(string)
	switch v := claims["email_verified"].(type) {
	case bool:
		id.EmailVerified = v
	case string: // Apple lo envía como texto.
		id.EmailVerified = v == "true"
	}
	return id, nil
}

func (p *OIDCProvider) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if k, ok := p.keys[kid]; ok && time.Since(p.fetched) < time.Hour {
		return k, nil
	}
	// Llave desconocida o caché vieja: se refresca (los proveedores rotan llaves), con un
	// mínimo de 1 minuto entre descargas para que un kid inventado no fuerce peticiones.
	if time.Since(p.fetched) > time.Minute || p.keys == nil {
		keys, err := fetchJWKS(ctx, p.client(), p.JWKSURL)
		if err != nil {
			return nil, err
		}
		p.keys, p.fetched = keys, time.Now()
	}
	if k, ok := p.keys[kid]; ok {
		return k, nil
	}
	return nil, ErrInvalidToken
}

func (p *OIDCProvider) client() *http.Client {
	if p.Client != nil {
		return p.Client
	}
	return &http.Client{Timeout: 5 * time.Second}
}

type jwks struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func fetchJWKS(ctx context.Context, client *http.Client, url string) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS respondió %d", res.StatusCode)
	}
	var set jwks
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<20)).Decode(&set); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	return keys, nil
}

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

func anyIn(values, allowed []string) bool {
	for _, v := range values {
		if contains(allowed, v) {
			return true
		}
	}
	return false
}
