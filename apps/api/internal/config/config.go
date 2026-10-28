// Package config lee la configuración de la API desde variables de entorno (infra/.env.example).
//
// Falla al arrancar ante combinaciones peligrosas, en vez de descubrirlas en producción:
// sin JWT_SECRET, SMS de desarrollo o código SMS fijo fuera de desarrollo, etc.
package config

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Config es la configuración ya validada.
type Config struct {
	Env            string
	Port           string
	DatabaseURL    string
	JWTSecret      string
	AccessTTL      time.Duration
	APIBaseURL     string
	WebBaseURL     string
	MediaDir       string
	SMSProvider    string
	PushProvider   string
	ExpoToken      string
	GoogleClients  []string
	AppleClients   []string
	ClientIPHeader string
	FixedSMSCode   string
	MigrateOnStart bool
	JobsEnabled    bool
	JobsInterval   time.Duration
}

// Development indica el entorno local.
func (c Config) Development() bool { return c.Env == "development" }

// Load valida las variables. getenv suele ser os.Getenv.
func Load(getenv func(string) string) (Config, error) {
	get := func(key, def string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return def
	}
	c := Config{
		Env:            get("APP_ENV", "development"),
		Port:           get("PORT", "8080"),
		DatabaseURL:    get("DATABASE_URL", ""),
		JWTSecret:      get("JWT_SECRET", ""),
		APIBaseURL:     get("PUBLIC_API_URL", "http://localhost:8080"),
		WebBaseURL:     get("PUBLIC_WEB_URL", "https://pawfound.app"),
		MediaDir:       get("MEDIA_DIR", "./data/media"),
		SMSProvider:    get("SMS_PROVIDER", ""),
		PushProvider:   get("PUSH_PROVIDER", ""),
		ExpoToken:      get("EXPO_ACCESS_TOKEN", ""),
		GoogleClients:  list(get("GOOGLE_CLIENT_IDS", "")),
		AppleClients:   list(get("APPLE_CLIENT_IDS", "")),
		ClientIPHeader: get("CLIENT_IP_HEADER", ""),
		FixedSMSCode:   get("DEV_FIXED_SMS_CODE", ""),
	}
	var errs []error
	if c.Env != "development" && c.Env != "staging" && c.Env != "production" {
		errs = append(errs, fmt.Errorf("APP_ENV=%q: usa development, staging o production", c.Env))
	}
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("falta DATABASE_URL"))
	}
	if len(c.JWTSecret) < 32 {
		errs = append(errs, errors.New("JWT_SECRET debe tener al menos 32 caracteres (genera uno con: openssl rand -base64 48)"))
	}
	ttl, err := time.ParseDuration(get("ACCESS_TOKEN_TTL", "15m"))
	if err != nil || ttl < time.Minute || ttl > 24*time.Hour {
		errs = append(errs, errors.New("ACCESS_TOKEN_TTL debe estar entre 1m y 24h"))
	}
	c.AccessTTL = ttl
	interval, err := time.ParseDuration(get("JOBS_INTERVAL", "1m"))
	if err != nil || interval < 10*time.Second {
		errs = append(errs, errors.New("JOBS_INTERVAL debe ser al menos 10s"))
	}
	c.JobsInterval = interval
	c.MigrateOnStart, err = strconv.ParseBool(get("MIGRATE_ON_START", strconv.FormatBool(c.Development())))
	if err != nil {
		errs = append(errs, errors.New("MIGRATE_ON_START debe ser true o false"))
	}
	c.JobsEnabled, err = strconv.ParseBool(get("JOBS_ENABLED", "true"))
	if err != nil {
		errs = append(errs, errors.New("JOBS_ENABLED debe ser true o false"))
	}
	if c.SMSProvider == "" {
		c.SMSProvider = map[bool]string{true: "log", false: "none"}[c.Development()]
	}
	if c.PushProvider == "" {
		c.PushProvider = map[bool]string{true: "log", false: "none"}[c.Development()]
	}
	switch c.SMSProvider {
	case "log":
		if !c.Development() {
			errs = append(errs, errors.New("SMS_PROVIDER=log solo se permite en development: escribe los códigos en el log"))
		}
	case "none":
	default:
		errs = append(errs, fmt.Errorf("SMS_PROVIDER=%q no existe todavía: el proveedor se activa tras su evaluación de privacidad", c.SMSProvider))
	}
	switch c.PushProvider {
	case "log", "none", "expo":
	default:
		errs = append(errs, fmt.Errorf("PUSH_PROVIDER=%q: usa log, none o expo", c.PushProvider))
	}
	if c.FixedSMSCode != "" && !c.Development() {
		errs = append(errs, errors.New("DEV_FIXED_SMS_CODE solo se permite en development"))
	}
	if c.FixedSMSCode != "" && (len(c.FixedSMSCode) != 6 || strings.Trim(c.FixedSMSCode, "0123456789") != "") {
		errs = append(errs, errors.New("DEV_FIXED_SMS_CODE debe tener 6 dígitos"))
	}
	if !c.Development() && !strings.HasPrefix(c.APIBaseURL, "https://") {
		errs = append(errs, errors.New("PUBLIC_API_URL debe usar https fuera de development"))
	}
	return c, errors.Join(errs...)
}

func list(raw string) []string {
	var out []string
	for _, item := range strings.Split(raw, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}
