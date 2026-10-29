package jobs

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/testdb"
)

func TestTickRunsAlertsAndCleanup(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC)
	tokens, _ := auth.NewTokens(strings.Repeat("k", 32), time.Hour, func() time.Time { return now })
	store := media.LocalStore{Dir: t.TempDir()}
	a := &app.App{DB: pool, Tokens: tokens, Media: store, Now: func() time.Time { return now }, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	a.Init()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO users (id, name, username, email) VALUES ('u1', 'Familia', 'u1', 'u1@x.co'), ('u2', 'Vecina', 'u2', 'u2@x.co')`)
	exec(`INSERT INTO alert_zones (user_id, lat, lng, zone) VALUES ('u2', 6.2310, -75.6030, 'Belén')`)
	// Perdida hace 3 h: el círculo de perro tranquilo mide ~1,2 km y todavía no llega a Belén (~2 km).
	exec(`INSERT INTO pets (id, kind, species, sex, age, size, description, last_seen_at, lat, lng, zone, owner_id, owner_short_name, group_id)
		VALUES ('p1', 'lost', 'dog', 'male', 'adult', 'medium', '', $1, 6.2447, -75.5916, 'Laureles', 'u1', 'Familia', 'g1')`, now.Add(-3*time.Hour))
	exec(`INSERT INTO refresh_tokens (id, user_id, family, token_hash, expires_at) VALUES ('rt1', 'u1', 'f', 'x', $1)`, now.Add(-time.Hour))
	exec(`INSERT INTO phone_verifications (user_id, phone, code_hash, sent_at) VALUES ('u1', '+57', 'x', $1)`, now.Add(-48*time.Hour))
	_ = store.Put(ctx, "med_old.jpg", []byte("x"))
	exec(`INSERT INTO media (id, owner_id, purpose, content_type, width, height, bytes, phash, storage_key, created_at)
		VALUES ('med_old', 'u1', 'chat', 'image/jpeg', 1, 1, 1, 0, 'med_old.jpg', $1)`, now.Add(-48*time.Hour))

	if err := Tick(ctx, a); err != nil {
		t.Fatal(err)
	}
	count := func(sql string) int {
		var n int
		_ = pool.QueryRow(ctx, sql).Scan(&n)
		return n
	}
	if count(`SELECT count(*) FROM notifications`) != 0 {
		t.Fatal("el círculo aún no llega a la vecina")
	}
	if count(`SELECT count(*) FROM refresh_tokens`) != 0 || count(`SELECT count(*) FROM phone_verifications`) != 0 || count(`SELECT count(*) FROM media`) != 0 {
		t.Fatal("la limpieza no borró lo vencido")
	}
	if _, err := store.Open(ctx, "med_old.jpg"); err == nil {
		t.Fatal("el archivo de la foto sin usar sigue en disco")
	}

	// Con el círculo más grande, la vecina recibe la alerta en la siguiente pasada.
	now = now.Add(20 * time.Hour)
	if err := Tick(ctx, a); err != nil {
		t.Fatal(err)
	}
	if count(`SELECT count(*) FROM notifications WHERE user_id = 'u2' AND kind = 'life_circle'`) != 1 {
		t.Fatal("la alerta debía llegar")
	}

	// Si otra instancia tiene el lock, la pasada no hace nada.
	conn, _ := pool.Acquire(ctx)
	defer conn.Release()
	_, _ = conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockKey)
	exec(`INSERT INTO refresh_tokens (id, user_id, family, token_hash, expires_at) VALUES ('rt2', 'u1', 'f', 'y', $1)`, now.Add(-time.Hour))
	if err := Tick(ctx, a); err != nil {
		t.Fatal(err)
	}
	if count(`SELECT count(*) FROM refresh_tokens`) != 1 {
		t.Fatal("corrió sin el lock")
	}
	_, _ = conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockKey)

	// Run se detiene al cancelar el contexto.
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { Run(runCtx, a, time.Hour, a.Log); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run no se detuvo")
	}
}
