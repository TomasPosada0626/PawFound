// Package auth reúne las primitivas de autenticación de la API: contraseñas (Argon2id),
// tokens de acceso (JWT HS256 de vida corta), refresh tokens opacos, códigos SMS y la
// verificación de ID tokens de Google y Apple (OIDC).
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/argon2"
)

// Parámetros Argon2id recomendados por OWASP (19 MiB, 2 iteraciones, 1 hilo).
const (
	argonMemory  = 19 * 1024
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// HashPassword devuelve el hash en formato PHC: $argon2id$v=19$m=…,t=…,p=…$sal$hash.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// dummyHash se compara cuando la cuenta no existe, para que el tiempo de respuesta no revele
// si un correo está registrado.
var dummyHash, _ = HashPassword("pawfound-dummy-password-1")

// CheckPassword compara en tiempo constante. Un hash vacío (cuenta solo OAuth) nunca coincide.
func CheckPassword(encoded, password string) bool {
	if encoded == "" {
		encoded = dummyHash
		password += "\x00"
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var memory uint32
	var iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	b64 := base64.RawStdEncoding
	salt, err1 := b64.DecodeString(parts[4])
	want, err2 := b64.DecodeString(parts[5])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want))) //nolint:gosec // len(want) es 32
	return subtle.ConstantTimeCompare(got, want) == 1
}

// Tokens firma y valida los tokens de acceso.
type Tokens struct {
	secret    []byte
	accessTTL time.Duration
	now       func() time.Time
}

const (
	issuer   = "pawfound-api"
	audience = "pawfound-app"
)

// ErrInvalidToken se devuelve para cualquier token inválido, vencido o manipulado.
var ErrInvalidToken = errors.New("token inválido")

// NewTokens exige un secreto de al menos 32 bytes.
func NewTokens(secret string, accessTTL time.Duration, now func() time.Time) (*Tokens, error) {
	if len(secret) < 32 {
		return nil, errors.New("JWT_SECRET debe tener al menos 32 caracteres")
	}
	if now == nil {
		now = time.Now
	}
	return &Tokens{secret: []byte(secret), accessTTL: accessTTL, now: now}, nil
}

// AccessTTL es la vida del token de acceso.
func (t *Tokens) AccessTTL() time.Duration { return t.accessTTL }

// IssueAccess firma un JWT para la cuenta.
func (t *Tokens) IssueAccess(userID string) (string, error) {
	now := t.now()
	claims := jwt.RegisteredClaims{
		Subject:   userID,
		Issuer:    issuer,
		Audience:  jwt.ClaimStrings{audience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(t.accessTTL)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
}

// ParseAccess valida firma, algoritmo, emisor, audiencia y vencimiento.
func (t *Tokens) ParseAccess(token string) (string, error) {
	claims := &jwt.RegisteredClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(issuer), jwt.WithAudience(audience),
		jwt.WithExpirationRequired(), jwt.WithTimeFunc(t.now))
	if err != nil || !parsed.Valid || claims.Subject == "" {
		return "", ErrInvalidToken
	}
	return claims.Subject, nil
}

// RandomToken genera un secreto opaco de 32 bytes en base64url.
func RandomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// HashToken guarda solo el hash de los refresh tokens y sesiones.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// SMSCode genera un código de 6 dígitos con crypto/rand.
func SMSCode() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
	return fmt.Sprintf("%06d", n.Int64())
}

// CodeHasher guarda los códigos SMS como HMAC: si la base se filtra, un código de 6 dígitos
// no se puede recuperar sin el secreto del servidor.
type CodeHasher struct{ key []byte }

// NewCodeHasher deriva su llave del secreto del servidor.
func NewCodeHasher(secret string) CodeHasher {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("pawfound/sms-code"))
	return CodeHasher{key: mac.Sum(nil)}
}

// Hash del código ligado al celular, para que no sirva con otro número.
func (h CodeHasher) Hash(phone, code string) []byte {
	mac := hmac.New(sha256.New, h.key)
	mac.Write([]byte(phone + ":" + code))
	return mac.Sum(nil)
}

// Equal compara en tiempo constante.
func (h CodeHasher) Equal(stored []byte, phone, code string) bool {
	return hmac.Equal(stored, h.Hash(phone, code))
}
