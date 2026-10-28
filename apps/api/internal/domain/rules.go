package domain

import (
	"strconv"
	"strings"
	"time"
)

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
		LifeCircle: true, AngelAlerts: true, QuietFrom: "22:00", QuietTo: "07:00", Push: true, Email: true,
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

// Límites de la comunidad (mockBackend.ts).
const (
	MessageMax        = 1000
	MessagesPerMinute = 12
	MaxHelpers        = 5
	MaxOwnedPets      = 10
	MaxPhotos         = 5
	DescriptionMax    = 500
	BioMax            = 150
	ReportNoteMax     = 300
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
	{"eyes", "help", []int{1, 5, 20}},
	{"paw_angel", "reunions", []int{1, 3, 10}},
	{"reunion", "reunions", []int{1}},
	{"spreader", "community", []int{1, 10, 50}},
	{"community", "community", []int{3, 10, 25}},
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
