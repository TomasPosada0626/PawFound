// Package jobs corre las tareas periódicas del servidor: la Alerta Ángel que crece con el
// círculo de vida y la limpieza de datos vencidos.
//
// Con varias instancias de la API, un advisory lock de PostgreSQL garantiza que solo una
// corra cada pasada (el índice único de notificaciones protege igual contra duplicados).
package jobs

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

const lockKey = 721_105_2027

// Run repite Tick cada `interval` hasta que se cancele el contexto.
func Run(ctx context.Context, a *app.App, interval time.Duration, log *slog.Logger) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := Tick(ctx, a); err != nil && ctx.Err() == nil {
			log.Error("tareas periódicas", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Tick hace una pasada si consigue el lock; si otra instancia lo tiene, no hace nada.
func Tick(ctx context.Context, a *app.App) error {
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", lockKey).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return nil
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", lockKey) }()
	if _, err := a.RunAlertJob(ctx); err != nil {
		return err
	}
	// Cuentas de ADMIN_EMAILS ya verificadas (por si ADMIN_EMAILS se agregó después).
	if _, err := a.PromoteAdmins(ctx, ""); err != nil {
		return err
	}
	if err := Cleanup(ctx, a); err != nil {
		return err
	}
	// Si al arrancar no se pudieron cargar las veterinarias, se reintenta en cada ronda.
	_, _, err = a.EnsurePlaces(ctx, os.Getenv("OVERPASS_URL"))
	return err
}

// Cleanup borra lo que ya no sirve: sesiones y enlaces vencidos, códigos de verificación viejos y fotos
// subidas que nunca se usaron (24 h de gracia).
func Cleanup(ctx context.Context, a *app.App) error {
	now := a.Now()
	stmts := []struct {
		sql string
		arg time.Time
	}{
		{`DELETE FROM refresh_tokens WHERE expires_at < $1 OR revoked_at < $1::timestamptz - interval '7 days'`, now},
		{`DELETE FROM admin_sessions WHERE expires_at < $1`, now},
		{`DELETE FROM password_resets WHERE expires_at < $1`, now},
		{`DELETE FROM email_verifications WHERE sent_at < $1::timestamptz - interval '1 day'`, now},
	}
	for _, s := range stmts {
		if _, err := a.DB.Exec(ctx, s.sql, s.arg); err != nil {
			return err
		}
	}
	// Fotos subidas que nunca se usaron: de chat sin enviar y de perfil que no se guardaron.
	rows, err := a.DB.Query(ctx, `DELETE FROM media m WHERE m.created_at < $1::timestamptz - interval '1 day'
		AND ((m.purpose = 'chat' AND m.thread_id IS NULL)
		  OR (m.purpose = 'avatar' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.photo_id = m.id)))
		RETURNING storage_key`, now)
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	rows.Close()
	if remover, ok := a.Media.(interface {
		Remove(context.Context, string) error
	}); ok {
		for _, key := range keys {
			_ = remover.Remove(ctx, key)
		}
	}
	return rows.Err()
}
