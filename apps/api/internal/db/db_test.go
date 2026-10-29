package db_test

import (
	"context"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/db"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/testdb"
)

func TestMigrateIsIdempotent(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	// testdb ya migró la base: una segunda pasada no debe aplicar nada.
	applied, err := db.Migrate(ctx, pool)
	if err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if applied != 0 {
		t.Fatalf("applied = %d, want 0", applied)
	}
	var postgis string
	if err := pool.QueryRow(ctx, "SELECT postgis_version()").Scan(&postgis); err != nil {
		t.Fatalf("PostGIS no está disponible: %v", err)
	}
}

func TestOneAngelAlertPerPersonAndCase(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	mustExec(t, pool.Exec, `INSERT INTO users (id, name, username, email) VALUES ('u1', 'Ana', 'ana', 'ana@x.co')`)
	mustExec(t, pool.Exec, `INSERT INTO pets (id, kind, species, sex, age, size, description, last_seen_at, lat, lng, zone, owner_short_name, group_id)
		VALUES ('p1', 'lost', 'dog', 'male', 'adult', 'medium', 'x', now(), 6.25, -75.58, 'Laureles', 'Ana', 'g1')`)
	mustExec(t, pool.Exec, `INSERT INTO notifications (id, user_id, kind, pet_id) VALUES ('n1', 'u1', 'angel_alert', 'p1')`)
	if _, err := pool.Exec(ctx, `INSERT INTO notifications (id, user_id, kind, pet_id) VALUES ('n2', 'u1', 'life_circle', 'p1')`); err == nil {
		t.Fatal("se permitió una segunda alerta para la misma persona y caso")
	}
	// Otros tipos de notificación sí se repiten.
	mustExec(t, pool.Exec, `INSERT INTO notifications (id, user_id, kind, pet_id) VALUES ('n3', 'u1', 'sighting', 'p1')`)
	mustExec(t, pool.Exec, `INSERT INTO notifications (id, user_id, kind, pet_id) VALUES ('n4', 'u1', 'sighting', 'p1')`)
}

func mustExec[T any](t *testing.T, exec func(context.Context, string, ...any) (T, error), sql string) {
	t.Helper()
	if _, err := exec(context.Background(), sql); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func TestOpenRejectsBadURLs(t *testing.T) {
	if _, err := db.Open(context.Background(), "no es una url ::"); err == nil {
		t.Fatal("URL inválida aceptada")
	}
	if _, err := db.Open(context.Background(), "postgres://x:y@127.0.0.1:1/nada?connect_timeout=1"); err == nil {
		t.Fatal("base inaccesible aceptada")
	}
}
