package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Actividad de la app para el panel (/admin/activity): solo conteos agregados, ningún dato
// personal. La métrica principal del MVP es la tasa de reencuentro a 14 días (issue #9).

// Activity resume el uso de la app.
type Activity struct {
	Users          int
	UsersNew7      int
	UsersVerified  int
	ActiveLost     int
	ActiveFound    int
	Reports7       int
	Reunited       int
	Reunited30     int
	Eligible14     int
	Reunited14     int
	Alerts24       int
	Alerts7        int
	Messages7      int
	ActiveChats7   int
	StoryUpdates   int
	OpenReports    int
	AvgResolutionH *float64
	Days           []ActivityDay
	MaxDay         int
}

// ActivityDay es un día del gráfico.
type ActivityDay struct {
	Day      time.Time
	Reports  int
	Reunions int
}

// ReunionRate14 es el porcentaje de perdidas reencontradas en 14 días o menos, contando solo
// casos con al menos 14 días o ya cerrados (igual que impactStats en la app). -1 sin datos.
func (a Activity) ReunionRate14() int {
	if a.Eligible14 == 0 {
		return -1
	}
	return a.Reunited14 * 100 / a.Eligible14
}

// VerifiedPct de cuentas con correo verificado.
func (a Activity) VerifiedPct() int {
	if a.Users == 0 {
		return 0
	}
	return a.UsersVerified * 100 / a.Users
}

// AppActivity calcula la actividad con la hora actual de la App.
func (a *App) AppActivity(ctx context.Context) (Activity, error) {
	now := a.now()
	day, week, month := now.Add(-24*time.Hour), now.Add(-7*24*time.Hour), now.Add(-30*24*time.Hour)
	var s Activity
	err := a.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM users),
		(SELECT count(*) FROM users WHERE created_at > $2),
		(SELECT count(*) FROM users WHERE email_verified),
		(SELECT count(*) FROM pets WHERE state = 'active' AND kind = 'lost' AND NOT moderation_removed),
		(SELECT count(*) FROM pets WHERE state = 'active' AND kind = 'found' AND NOT moderation_removed),
		(SELECT count(*) FROM pets WHERE created_at > $2),
		(SELECT count(*) FROM pets WHERE state = 'reunited'),
		(SELECT count(*) FROM pets WHERE state = 'reunited' AND reunited_at > $3),
		(SELECT count(*) FROM pets WHERE kind = 'lost' AND NOT moderation_removed AND (state = 'reunited' OR created_at <= $4::timestamptz - interval '14 days')),
		(SELECT count(*) FROM pets WHERE kind = 'lost' AND NOT moderation_removed AND state = 'reunited' AND reunited_at - created_at <= interval '14 days'),
		(SELECT count(*) FROM notifications WHERE kind IN ('angel_alert', 'life_circle') AND at > $1),
		(SELECT count(*) FROM notifications WHERE kind IN ('angel_alert', 'life_circle') AND at > $2),
		(SELECT count(*) FROM messages WHERE kind = 'text' AND at > $2),
		(SELECT count(DISTINCT thread_id) FROM messages WHERE kind = 'text' AND at > $2),
		(SELECT count(*) FROM stories WHERE removed_at IS NULL),
		(SELECT count(*) FROM reports WHERE status = 'open'),
		(SELECT (avg(extract(epoch FROM resolved_at - created_at)) / 3600)::float8 FROM reports WHERE resolved_at > $3)`,
		day, week, month, now).Scan(&s.Users, &s.UsersNew7, &s.UsersVerified, &s.ActiveLost, &s.ActiveFound, &s.Reports7, &s.Reunited,
		&s.Reunited30, &s.Eligible14, &s.Reunited14, &s.Alerts24, &s.Alerts7, &s.Messages7, &s.ActiveChats7, &s.StoryUpdates,
		&s.OpenReports, &s.AvgResolutionH)
	if err != nil {
		return s, err
	}
	rows, _ := a.DB.Query(ctx, `SELECT d::date,
			(SELECT count(*) FROM pets WHERE created_at >= d AND created_at < d + interval '1 day'),
			(SELECT count(*) FROM pets WHERE reunited_at >= d AND reunited_at < d + interval '1 day')
		FROM generate_series(date_trunc('day', $1::timestamptz) - interval '13 days', date_trunc('day', $1::timestamptz), interval '1 day') d
		ORDER BY d`, now)
	s.Days, err = pgx.CollectRows(rows, pgx.RowToStructByPos[ActivityDay])
	for _, d := range s.Days {
		s.MaxDay = max(s.MaxDay, d.Reports, d.Reunions)
	}
	return s, err
}
