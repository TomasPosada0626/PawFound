package app

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
)

// moderatorMailGap: entre un correo a moderación y el siguiente pasa al menos este tiempo; los
// reportes que llegan mientras tanto van juntos en el próximo.
const moderatorMailGap = 30 * time.Minute

// moderatorRecipient es una cuenta de moderación que recibe los avisos.
type moderatorRecipient struct {
	Email string `db:"email"`
	Name  string `db:"name"`
	Lang  string `db:"lang"`
}

// NotifyModerators avisa por correo a moderación y administración cuando hay reportes nuevos: un
// solo correo con cuántos son, y como mucho uno cada moderatorMailGap. Devuelve cuántos reportes
// avisó.
func (a *App) NotifyModerators(ctx context.Context) (int, error) {
	now := a.now()
	// Marcar y leer en una sola sentencia: dos pasadas a la vez no avisan dos veces lo mismo.
	rows, _ := a.DB.Query(ctx, `UPDATE reports SET notified_at = $1
		WHERE status = 'open' AND notified_at IS NULL
		AND NOT EXISTS (SELECT 1 FROM reports WHERE notified_at > $2)
		RETURNING reason`, now, now.Add(-moderatorMailGap))
	reasons, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(reasons) == 0 {
		return 0, err
	}
	urgent := false
	for _, r := range reasons {
		urgent = urgent || r == "scam" || r == "money"
	}
	list, _ := a.DB.Query(ctx, `SELECT email, name, lang FROM users
		WHERE role IN ('moderator', 'admin') AND email_verified AND suspended_at IS NULL`)
	people, err := pgx.CollectRows(list, pgx.RowToStructByName[moderatorRecipient])
	if err != nil {
		return 0, err
	}
	link := strings.TrimRight(a.APIBaseURL, "/") + "/admin/reports"
	for _, p := range people {
		if err := a.Mailer.SendNotice(ctx, p.Email, p.Name, providers.ModerationNotice(len(reasons), urgent, link, p.Lang)); err != nil {
			a.Log.Warn("correo a moderación", "err", err)
		}
	}
	return len(reasons), nil
}

// reported avisa a moderación en segundo plano después de guardar un reporte.
func (a *App) reported() {
	a.background(func(ctx context.Context) {
		if _, err := a.NotifyModerators(ctx); err != nil {
			a.Log.Error("avisar a moderación", "err", err)
		}
	})
}
