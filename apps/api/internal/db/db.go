// Package db abre el pool de PostgreSQL y aplica las migraciones versionadas.
//
// Las migraciones son archivos SQL embebidos en el binario (migrations/NNNN_nombre.sql) y se
// aplican en orden, cada una en su propia transacción, bajo un advisory lock para que dos
// instancias de la API no migren a la vez. Nunca se edita una migración ya publicada: los
// cambios van en un archivo nuevo, revisado por PR (docs/ARCHITECTURE.md).
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// migrationLock es una clave arbitraria y fija para pg_advisory_xact_lock.
const migrationLock = 721_105_2026

// Open crea el pool y verifica la conexión.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL inválida: %w", err)
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("no se pudo conectar a la base de datos: %w", err)
	}
	return pool, nil
}

// Migrate aplica las migraciones pendientes y devuelve cuántas aplicó.
func Migrate(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	names, err := migrationNames()
	if err != nil {
		return 0, err
	}
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		return 0, err
	}
	applied := 0
	for _, name := range names {
		done, err := applyOne(ctx, pool, name)
		if err != nil {
			return applied, fmt.Errorf("migración %s: %w", name, err)
		}
		if done {
			applied++
		}
	}
	return applied, nil
}

func migrationNames() ([]string, error) {
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func applyOne(ctx context.Context, pool *pgxpool.Pool, name string) (bool, error) {
	version := strings.TrimSuffix(name, ".sql")
	sql, err := migrationFiles.ReadFile("migrations/" + name)
	if err != nil {
		return false, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLock); err != nil {
		return false, err
	}
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)", version).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	if _, err := tx.Exec(ctx, string(sql)); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", version); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// Tx ejecuta fn dentro de una transacción; hace rollback si fn devuelve error.
func Tx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
