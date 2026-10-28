// Package domain contiene las reglas de negocio puras de PawFound, sin base de datos ni HTTP.
//
// Cada regla tiene su gemela en apps/mobile/src/domain (el modo demostración aplica las
// mismas): cuando cambia una, cambian las dos. Las que tienen vectores compartidos en
// packages/contracts/fixtures se validan contra el mismo archivo en ambos lados.
package domain

import (
	"crypto/rand"
	"encoding/base32"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var idEncoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

// NewID genera un identificador opaco con prefijo legible ("pet_…", "u_…"), 96 bits aleatorios.
func NewID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + idEncoding.EncodeToString(b)
}

// Bogota es la zona horaria de la operación (Colombia no usa horario de verano).
var Bogota = time.FixedZone("COT", -5*3600)

// Enumeraciones del contrato.
var (
	Species     = set("dog", "cat", "other")
	Sexes       = set("male", "female", "unknown")
	Ages        = set("puppy", "young", "adult", "senior", "unknown")
	Sizes       = set("small", "medium", "large")
	CaseKinds   = set("lost", "found")
	Conditions  = set("good", "scared", "injured", "needs_vet")
	Custodies   = set("with_me", "vet", "shelter", "left_there")
	Langs       = set("es", "en")
	Avatars     = set("dog", "cat", "fox", "panda", "bunny", "bear")
	Titles      = set("animal_lover", "rescuer", "neighbor", "volunteer", "foster")
	WhoMessage  = set("everyone", "verified", "nobody")
	Reasons     = set("spam", "rude", "scam", "inappropriate", "other")
	Platforms   = set("android", "ios")
	FoundRadius = map[int]bool{400: true, 1000: true, 2000: true, 5000: true}
)

func set(values ...string) map[string]bool {
	m := make(map[string]bool, len(values))
	for _, v := range values {
		m[v] = true
	}
	return m
}

var (
	emailRE    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
	usernameRE = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
	nonDigitRE = regexp.MustCompile(`[\s\-().]`)
	mobileRE   = regexp.MustCompile(`^3\d{9}$`)
)

// ValidEmail replica la validación de la app (validation.ts).
func ValidEmail(email string) bool {
	email = strings.TrimSpace(email)
	return len(email) <= 254 && emailRE.MatchString(email)
}

// NormalizeColombianMobile lleva un celular colombiano a E.164 (+573XXXXXXXXX) o devuelve "".
func NormalizeColombianMobile(input string) string {
	digits := strings.TrimPrefix(nonDigitRE.ReplaceAllString(input, ""), "+")
	national := digits
	if strings.HasPrefix(digits, "57") && len(digits) == 12 {
		national = digits[2:]
	}
	if !mobileRE.MatchString(national) {
		return ""
	}
	return "+57" + national
}

// PasswordMinLength coincide con la app.
const PasswordMinLength = 8

// PasswordIssue devuelve el primer problema de la contraseña o "" si es aceptable.
func PasswordIssue(password string) string {
	if utf8.RuneCountInString(password) < PasswordMinLength {
		return "too_short"
	}
	if len(password) > 256 {
		return "too_long"
	}
	// Contraseña segura: mayúscula, minúscula y número (igual que validation.ts en la app).
	hasUpper, hasLower, hasDigit := false, false, false
	for _, r := range password {
		hasUpper = hasUpper || unicode.IsUpper(r)
		hasLower = hasLower || unicode.IsLower(r)
		hasDigit = hasDigit || unicode.IsDigit(r)
	}
	switch {
	case !hasUpper:
		return "needs_upper"
	case !hasLower:
		return "needs_lower"
	case !hasDigit:
		return "needs_number"
	}
	return ""
}

// NormalizeUsername quita "@", pasa a minúsculas y valida; "" si no es válido.
func NormalizeUsername(raw string) string {
	u := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(raw), "@"))
	if !usernameRE.MatchString(u) {
		return ""
	}
	return u
}

// HasSurname exige nombre y al menos un apellido (dos palabras de 2 letras o más).
func HasSurname(name string) bool {
	words := 0
	for _, w := range strings.Fields(name) {
		if utf8.RuneCountInString(w) >= 2 {
			words++
		}
	}
	return words >= 2
}

// UsernameBase deriva la base de un usuario a partir del correo, como la app.
func UsernameBase(email string) string {
	local, _, _ := strings.Cut(strings.ToLower(email), "@")
	var b strings.Builder
	for _, r := range local {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		}
	}
	base := b.String()
	if len(base) < 3 {
		base = "pawfriend"
	}
	if len(base) > 16 {
		base = base[:16]
	}
	return base
}

// ShortName muestra "Nombre I." y nunca el nombre completo (privacy.ts).
func ShortName(full string) string {
	parts := strings.Fields(full)
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return parts[0]
	default:
		first, _ := utf8.DecodeRuneInString(parts[1])
		return parts[0] + " " + string(unicode.ToUpper(first)) + "."
	}
}

// Clean recorta espacios y limita la longitud en caracteres.
func Clean(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	return string([]rune(s)[:maxRunes])
}

// Fold pasa a minúsculas y quita tildes (para comparar razas y colores).
func Fold(s string) string {
	r := strings.NewReplacer("á", "a", "à", "a", "ä", "a", "é", "e", "è", "e", "ë", "e", "í", "i", "ì", "i", "ï", "i",
		"ó", "o", "ò", "o", "ö", "o", "ú", "u", "ù", "u", "ü", "u", "ñ", "n")
	return r.Replace(strings.ToLower(strings.TrimSpace(s)))
}

// MemberDays son los días completos desde que se creó la cuenta.
func MemberDays(createdAt, now time.Time) int {
	d := int(now.Sub(createdAt).Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}

// DailyReportLimit es el límite antispam de PRODUCT.md: 2 publicaciones por cuenta por día.
const DailyReportLimit = 2

// PublishAllowance aplica una ventana móvil de 24 h. Devuelve si puede publicar y, si no,
// desde cuándo podrá hacerlo.
func PublishAllowance(publishedAt []time.Time, now time.Time) (bool, time.Time) {
	var recent []time.Time
	for _, t := range publishedAt {
		if now.Sub(t) < 24*time.Hour {
			recent = append(recent, t)
		}
	}
	if len(recent) < DailyReportLimit {
		return true, time.Time{}
	}
	// El cupo se libera cuando sale de la ventana la `limit`-ésima publicación más reciente.
	sort.Slice(recent, func(i, j int) bool { return recent[i].Before(recent[j]) })
	return false, recent[len(recent)-DailyReportLimit].Add(24 * time.Hour)
}
