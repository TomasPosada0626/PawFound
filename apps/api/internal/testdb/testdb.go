// Package testdb da a las pruebas de integración una base PostGIS real y aislada.
//
// Cada paquete de pruebas crea su propia base (los paquetes corren en paralelo) a partir de
// TEST_DATABASE_URL, aplica las migraciones y vacía las tablas antes de cada prueba. Sin
// TEST_DATABASE_URL las pruebas de integración se saltan (CI siempre la define).
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/db"
)

var (
	once    sync.Once
	shared  *pgxpool.Pool
	initErr error
)

// Pool devuelve el pool de la base del paquete, con todas las tablas vacías.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL no está definida: se salta la prueba de integración")
	}
	once.Do(func() { shared, initErr = create(base) })
	if initErr != nil {
		t.Fatalf("preparar base de pruebas: %v", initErr)
	}
	if err := truncate(context.Background(), shared); err != nil {
		t.Fatalf("vaciar tablas: %v", err)
	}
	return shared
}

func create(base string) (*pgxpool.Pool, error) {
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		return nil, err
	}
	defer func() { _ = admin.Close(ctx) }()
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	name := "pawfound_test_" + hex.EncodeToString(suffix)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		return nil, err
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	u.Path = "/" + name
	pool, err := db.Open(ctx, u.String())
	if err != nil {
		return nil, err
	}
	if _, err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func truncate(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'spatial_ref_sys')`)
	if err != nil {
		return err
	}
	tables, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	if len(tables) == 0 {
		return nil
	}
	quoted := make([]string, len(tables))
	for i, name := range tables {
		quoted[i] = pgx.Identifier{name}.Sanitize()
	}
	_, err = pool.Exec(ctx, fmt.Sprintf("TRUNCATE %s RESTART IDENTITY CASCADE", strings.Join(quoted, ", ")))
	return err
}
