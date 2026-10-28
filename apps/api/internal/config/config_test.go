package config

import (
	"strings"
	"testing"
	"time"
)

func env(values map[string]string) func(string) string {
	return func(k string) string { return values[k] }
}

func base() map[string]string {
	return map[string]string{"DATABASE_URL": "postgres://x", "JWT_SECRET": strings.Repeat("s", 32)}
}

func TestDevelopmentDefaults(t *testing.T) {
	c, err := Load(env(base()))
	if err != nil {
		t.Fatal(err)
	}
	if !c.Development() || c.SMTP.Port != "587" || c.PushProvider != "log" || !c.MigrateOnStart || !c.JobsEnabled ||
		c.AccessTTL != 15*time.Minute || c.JobsInterval != time.Minute || c.Port != "8080" {
		t.Fatalf("defaults = %+v", c)
	}
	v := base()
	v["GOOGLE_CLIENT_IDS"] = " a.apps.googleusercontent.com, ,b "
	v["DEV_FIXED_CODE"] = "123456"
	v["SMTP_HOST"], v["SMTP_FROM"] = "smtp-relay.brevo.com", "pawfound.app@gmail.com"
	c, err = Load(env(v))
	if err != nil || len(c.GoogleClients) != 2 || c.GoogleClients[1] != "b" || c.FixedCode != "123456" || c.SMTP.Host != "smtp-relay.brevo.com" {
		t.Fatalf("lista = %+v %v", c.GoogleClients, err)
	}
}

func TestProductionRejectsDangerousSettings(t *testing.T) {
	v := base()
	v["APP_ENV"] = "production"
	v["PUBLIC_API_URL"] = "https://api.pawfound.app"
	c, err := Load(env(v))
	if err != nil {
		t.Fatal(err)
	}
	if c.SMTP.Host != "" || c.PushProvider != "none" || c.MigrateOnStart {
		t.Fatalf("producción por defecto = %+v", c)
	}
	cases := map[string]map[string]string{
		"SMTP sin remitente": {"SMTP_HOST": "smtp-relay.brevo.com"},
		"DEV_FIXED_CODE":     {"DEV_FIXED_CODE": "123456"},
		"https":              {"PUBLIC_API_URL": "http://api.pawfound.app"},
	}
	for name, extra := range cases {
		vv := map[string]string{}
		for k, val := range v {
			vv[k] = val
		}
		for k, val := range extra {
			vv[k] = val
		}
		if _, err := Load(env(vv)); err == nil {
			t.Errorf("%s debía fallar", name)
		}
	}
}

func TestInvalidValues(t *testing.T) {
	for name, extra := range map[string]map[string]string{
		"sin base":    {"DATABASE_URL": ""},
		"secreto":     {"JWT_SECRET": "corto"},
		"entorno":     {"APP_ENV": "qa"},
		"ttl":         {"ACCESS_TOKEN_TTL": "48h"},
		"intervalo":   {"JOBS_INTERVAL": "1s"},
		"migrar":      {"MIGRATE_ON_START": "quizás"},
		"jobs":        {"JOBS_ENABLED": "x"},
		"push":        {"PUSH_PROVIDER": "pigeon"},
		"código fijo": {"DEV_FIXED_CODE": "12ab56"},
	} {
		v := base()
		for k, val := range extra {
			v[k] = val
		}
		if _, err := Load(env(v)); err == nil {
			t.Errorf("%s debía fallar", name)
		}
	}
}
