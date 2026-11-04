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
	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

const lockKey = 721_105_2027

// Run repite Tick cada `interval` hasta que se cancele el contexto.
func Run(ctx context.Context, a *app.App, interval time.Duration, log *slog.Logger) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var last time.Time
	for {
		if now := a.Now(); due(a, last, now) {
			if err := Tick(ctx, a); err != nil && ctx.Err() == nil {
				log.Error("tareas periódicas", "err", err)
			}
			last = now
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// idleInterval es la pausa entre pasadas cuando no hay actividad: con el servidor despierto todo el
// día, despertar la base cada 10 minutos gastaría casi toda la cuota mensual de Neon.
const idleInterval = time.Hour

// due dice si toca una pasada: al arrancar, con actividad reciente o tras la pausa.
func due(a *app.App, last, now time.Time) bool {
	return last.IsZero() || a.AlertsDue(now) || now.Sub(last) >= idleInterval
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
	if _, _, err := a.RunCaseReminders(ctx); err != nil {
		return err
	}
	if _, _, err := a.RunAdoptionTasks(ctx); err != nil {
		return err
	}
	if _, _, err := a.RunShelterChecks(ctx); err != nil {
		return err
	}
	// Reportes que llegaron mientras se esperaba entre un correo a moderación y otro.
	if _, err := a.NotifyModerators(ctx); err != nil {
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
		{`DELETE FROM alert_zones WHERE updated_at < $1`, now.Add(-domain.AlertLocationTTL)},
		{`DELETE FROM rate_limit_hits WHERE at < $1::timestamptz - interval '1 day'`, now},
		{`DELETE FROM admin_login_challenges WHERE expires_at < $1`, now},
	}
	for _, s := range stmts {
		if _, err := a.DB.Exec(ctx, s.sql, s.arg); err != nil {
			return err
		}
	}
	// Fotos subidas que nunca se usaron (o que ya nada usa): de chat sin enviar, y de perfil,
	// reportes, Mis mascotas, historias o PawFamily que no aparecen en ningún lado.
	rows, err := a.DB.Query(ctx, `DELETE FROM media m WHERE m.created_at < $1::timestamptz - interval '1 day'
		AND ((m.purpose = 'chat' AND m.thread_id IS NULL)
		  OR (m.purpose IN ('avatar', 'pet', 'owned', 'story', 'adoption')
		      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.photo_id = m.id)
		      AND NOT EXISTS (SELECT 1 FROM pets p WHERE m.id = ANY (p.photos))
		      AND NOT EXISTS (SELECT 1 FROM owned_pets o WHERE m.id = ANY (o.photos))
		      AND NOT EXISTS (SELECT 1 FROM adoptions d WHERE m.id = ANY (d.photos))
		      AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.photo_id = m.id)
		      AND NOT EXISTS (SELECT 1 FROM adoption_updates au WHERE au.photo_id = m.id)
		      AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.photo_id = m.id)))
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
	for _, key := range keys {
		_ = a.RemoveStored(ctx, key)
	}
	return rows.Err()
}
