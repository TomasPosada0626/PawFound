package domain

import (
	"strconv"
	"strings"
	"time"
)

// ConsentTextVersion es la versión de los textos de docs/legal/consentimientos.md que se guarda
// con cada consentimiento. Se sube cada vez que esos textos cambien.
const ConsentTextVersion = "0.2"

// NotificationPrefs replica el tipo de la app. Se guarda como JSON y se completa con los
// valores por defecto, así una preferencia nueva no rompe cuentas viejas.
type NotificationPrefs struct {
	LostNearby     bool   `json:"lostNearby"`
	FoundNearby    bool   `json:"foundNearby"`
	Comments       bool   `json:"comments"`
	DirectMessages bool   `json:"directMessages"`
	Groups         bool   `json:"groups"`
	LifeCircle     bool   `json:"lifeCircle"`
	AngelAlerts    bool   `json:"angelAlerts"`
	FriendAlerts   bool   `json:"friendAlerts"`
	QuietHours     bool   `json:"quietHours"`
	QuietFrom      string `json:"quietFrom"`
	QuietTo        string `json:"quietTo"`
	Push           bool   `json:"push"`
	Email          bool   `json:"email"`
	DailyDigest    bool   `json:"dailyDigest"`
}

// DefaultNotificationPrefs coincide con DEFAULT_NOTIFICATION_PREFS de la app.
func DefaultNotificationPrefs() NotificationPrefs {
	return NotificationPrefs{
		LostNearby: true, FoundNearby: true, Comments: true, DirectMessages: true, Groups: true,
		LifeCircle: true, AngelAlerts: true, FriendAlerts: true, QuietFrom: "22:00", QuietTo: "07:00", Push: true, Email: true,
	}
}

// ValidClock acepta "HH:MM" de 24 h.
func ValidClock(s string) bool {
	h, m, ok := strings.Cut(s, ":")
	if !ok || len(h) != 2 || len(m) != 2 {
		return false
	}
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	return err1 == nil && err2 == nil && hh >= 0 && hh < 24 && mm >= 0 && mm < 60
}

func minutesOf(hhmm string) int {
	h, m, _ := strings.Cut(hhmm, ":")
	hh, _ := strconv.Atoi(h)
	mm, _ := strconv.Atoi(m)
	return hh*60 + mm
}

// IsQuietTime: en modo descanso la notificación llega a la bandeja sin sonar. Soporta rangos
// nocturnos (22:00–07:00). La hora se evalúa en Colombia.
func IsQuietTime(p NotificationPrefs, now time.Time) bool {
	if !p.QuietHours {
		return false
	}
	from, to := minutesOf(p.QuietFrom), minutesOf(p.QuietTo)
	local := now.In(Bogota)
	current := local.Hour()*60 + local.Minute()
	switch {
	case from == to:
		return false
	case from < to:
		return current >= from && current < to
	default:
		return current >= from || current < to
	}
}

// MaxAlertsPerDay: nunca más de 5 Alertas Ángel por persona en 24 h (alerts.ts).
const MaxAlertsPerDay = 5

// AlertMinRadius: a menos de 250 m del reporte la alerta llega de inmediato, aunque el círculo
// de vida inicial sea menor (alerts.ts → ALERT_MIN_RADIUS).
const AlertMinRadius = 250

// AlertLocationTTL: una ubicación sin actualizar en 30 días deja de usarse y se borra. Es largo a
// propósito: con la app cerrada o el celular quieto no llegan puntos nuevos, y la alerta debe
// llegar igual con el último conocido. Al cerrar sesión se borra de inmediato.
const AlertLocationTTL = 30 * 24 * time.Hour

// Límites de la comunidad (mockBackend.ts).
const (
	MessageMax        = 1000
	MessagesPerMinute = 12
	// LocationLabelMax: nombre de un punto de encuentro ("Parque de Laureles").
	LocationLabelMax = 60
	MaxHelpers       = 5
	MaxOwnedPets     = 10
	MaxPhotos        = 5
	DescriptionMax   = 500
	BioMax           = 150
	ReportNoteMax    = 300
)

// BadgeRule y la tabla de insignias (badges.ts, issue #61).
type BadgeRule struct {
	ID         string
	Category   string
	Thresholds []int
}

// BadgeRules en orden de presentación. "reunion" tiene un solo nivel: perder a la mascota
// varias veces no se premia.
var BadgeRules = []BadgeRule{
	{"verified", "identity", []int{1}},
	{"reporter", "help", []int{1, 5, 10}},
	{"rescuer", "help", []int{1, 3, 10}},
	{"foster", "help", []int{1, 3, 10}},
	{"eyes", "help", []int{1, 5, 20}},
	{"quick", "help", []int{1, 5, 20}},
	{"paw_angel", "reunions", []int{1, 3, 10}},
	{"protector", "reunions", []int{1}},
	{"reunion", "reunions", []int{1}},
	{"spreader", "community", []int{1, 10, 50}},
	{"community", "community", []int{3, 10, 25}},
	{"popular", "community", []int{50, 100, 250, 500, 1000}},
}

// Calificación por ayudar en un caso. Toda cuenta empieza con RatingWindow calificaciones de 5
// estrellas y cada una real va reemplazando a una de ellas: una mala nota no hunde a quien recién
// empieza, y solo cuentan las RatingWindow más recientes.
const (
	RatingWindow = 20
	// RatingStart es lo que vale cada calificación que aún no se ha dado.
	RatingStart = 5
	// MaxFollowDeclines rechazos suspenden el envío de solicitudes a esa persona por FollowRetryWait.
	MaxFollowDeclines = 3
	FollowRetryWait   = 30 * 24 * time.Hour
)

func ratingSum(stars []int) int {
	n := min(len(stars), RatingWindow)
	sum := (RatingWindow - n) * RatingStart
	for _, s := range stars[:n] {
		sum += s
	}
	return sum
}

// Rating es el promedio vigente; stars van de la más reciente a la más antigua.
func Rating(stars []int) float64 {
	return float64(ratingSum(stars)) / RatingWindow
}

// IsAnimalProtector dice si hoy se tiene "Protector animal": 4,8 o más en las calificaciones reales,
// sin contar las 5 estrellas iniciales. Se gana y se pierde según suba o baje.
func IsAnimalProtector(stars []int) bool {
	n := min(len(stars), RatingWindow)
	sum := 0
	for _, s := range stars[:n] {
		sum += s
	}
	// sum/n >= 4,8, sin comparar decimales.
	return n > 0 && sum*5 >= n*24
}

// BadgeProgress es lo que devuelve la API por insignia.
type BadgeProgress struct {
	ID      string `json:"id"`
	Count   int    `json:"count"`
	Tier    int    `json:"tier"`
	MaxTier int    `json:"maxTier"`
	Next    *int   `json:"next"`
}

// Badges calcula el progreso a partir de los hechos contados (id → veces).
func Badges(facts map[string]int) []BadgeProgress {
	out := make([]BadgeProgress, 0, len(BadgeRules))
	for _, rule := range BadgeRules {
		count := max(0, facts[rule.ID])
		tier := 0
		for _, threshold := range rule.Thresholds {
			if count >= threshold {
				tier++
			}
		}
		p := BadgeProgress{ID: rule.ID, Count: count, Tier: tier, MaxTier: len(rule.Thresholds)}
		if tier < len(rule.Thresholds) {
			next := rule.Thresholds[tier]
			p.Next = &next
		}
		out = append(out, p)
	}
	return out
}
