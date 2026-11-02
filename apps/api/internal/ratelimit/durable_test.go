package ratelimit_test

import (
	"context"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/ratelimit"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/testdb"
)

func TestDurableSurvivesARestart(t *testing.T) {
	pool := testdb.Pool(t)
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	first := ratelimit.NewDurable(pool, "login", 2, time.Minute, clock)
	for range 2 {
		if ok, _ := first.Allow("ana@x.co"); !ok {
			t.Fatal("dentro del límite debe pasar")
		}
	}
	// Un límite nuevo sobre la misma base es lo que pasa al reiniciar el servidor.
	restarted := ratelimit.NewDurable(pool, "login", 2, time.Minute, clock)
	ok, wait := restarted.Allow("ana@x.co")
	if ok || wait <= 0 || wait > time.Minute {
		t.Fatalf("tras reiniciar debe seguir bloqueado: %v %v", ok, wait)
	}
	// Otra clave y otro alcance no se afectan.
	if ok, _ := restarted.Allow("otra@x.co"); !ok {
		t.Fatal("otra clave no está limitada")
	}
	if ok, _ := ratelimit.NewDurable(pool, "reset", 2, time.Minute, clock).Allow("ana@x.co"); !ok {
		t.Fatal("otro alcance no está limitado")
	}
	// Vencida la ventana vuelve a pasar.
	now = now.Add(61 * time.Second)
	if ok, _ := restarted.Allow("ana@x.co"); !ok {
		t.Fatal("vencida la ventana debe pasar")
	}
	restarted.Reset("ana@x.co")
	var left int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM rate_limit_hits WHERE scope = 'login'`).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 1 {
		t.Fatalf("tras Reset deben quedar solo los de la otra clave: %d", left)
	}
}

func TestDurableNeverStoresTheKey(t *testing.T) {
	pool := testdb.Pool(t)
	ratelimit.NewDurable(pool, "email", 5, time.Minute, nil).Allow("ana@x.co")
	var plain int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM rate_limit_hits WHERE position('ana@x.co'::bytea in key_hash) > 0`).Scan(&plain); err != nil {
		t.Fatal(err)
	}
	if plain != 0 {
		t.Fatal("no debe guardar el correo")
	}
}

func TestDurableKeepsLimitingWithoutTheDatabase(t *testing.T) {
	pool := testdb.Pool(t)
	limiter := ratelimit.NewDurable(pool, "login", 2, time.Minute, nil)
	// Una tabla caída hace fallar las consultas de este límite: debe contar en memoria.
	if _, err := pool.Exec(context.Background(), `ALTER TABLE rate_limit_hits RENAME TO rate_limit_hits_off`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `ALTER TABLE rate_limit_hits_off RENAME TO rate_limit_hits`)
	})
	limiter.Allow("x")
	limiter.Allow("x")
	if ok, _ := limiter.Allow("x"); ok {
		t.Fatal("sin base de datos el límite no puede quedar desactivado")
	}
}
