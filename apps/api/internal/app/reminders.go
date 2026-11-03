package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/realtime"
)

// caseActivity es un caso activo con la fecha de su última novedad: publicación, último
// avistamiento, historia o mensaje de una persona en el grupo.
type caseActivity struct {
	ID              string     `db:"id"`
	OwnerID         string     `db:"owner_id"`
	GroupID         string     `db:"group_id"`
	CreatedAt       time.Time  `db:"created_at"`
	RemindedDays    int        `db:"reminded_days"`
	ArchiveWarnedAt *time.Time `db:"archive_warned_at"`
	LastActivity    time.Time  `db:"last_activity"`
}

// RunCaseReminders le pregunta a la familia si su mascota ya apareció a los 3, 7 y 14 días, y
// archiva los casos sin novedades en 60 días, avisando una semana antes. Un caso abandonado ensucia
// el mapa y las cifras de impacto; uno archivado se puede volver a publicar desde Mis mascotas.
func (a *App) RunCaseReminders(ctx context.Context) (reminded, archived int, err error) {
	rows, _ := a.DB.Query(ctx, `SELECT p.id, p.owner_id, p.group_id, p.created_at, p.reminded_days, p.archive_warned_at,
		GREATEST(p.created_at, p.last_seen_at,
			coalesce((SELECT max(s.created_at) FROM stories s WHERE s.pet_id = p.id), p.created_at),
			coalesce((SELECT max(m.at) FROM messages m WHERE m.thread_id = p.group_id AND m.kind <> 'system'), p.created_at)
		) AS last_activity
		FROM pets p
		WHERE p.state = 'active' AND p.withdrawn_at IS NULL AND NOT p.moderation_removed AND p.owner_id IS NOT NULL
		ORDER BY p.created_at`)
	cases, err := pgx.CollectRows(rows, pgx.RowToStructByName[caseActivity])
	if err != nil {
		return 0, 0, err
	}
	now := a.now()
	for _, c := range cases {
		idle := now.Sub(c.LastActivity)
		warnedSinceActivity := c.ArchiveWarnedAt != nil && !c.ArchiveWarnedAt.Before(c.LastActivity)
		switch {
		case idle >= domain.ArchiveAfter && warnedSinceActivity && now.Sub(*c.ArchiveWarnedAt) >= domain.ArchiveWarning:
			if err := a.archiveIdleCase(ctx, c, now); err != nil {
				return reminded, archived, err
			}
			archived++
			continue
		case idle >= domain.ArchiveAfter-domain.ArchiveWarning && !warnedSinceActivity:
			tag, err := a.DB.Exec(ctx, `UPDATE pets SET archive_warned_at = $2 WHERE id = $1 AND state = 'active'`, c.ID, now)
			if err != nil {
				return reminded, archived, err
			}
			if tag.RowsAffected() == 1 {
				a.notify(ctx, []string{c.OwnerID}, "archive_warning", c.ID, nil)
			}
			continue
		}
		due := domain.ReminderDue(now.Sub(c.CreatedAt))
		if due <= c.RemindedDays {
			continue
		}
		// Solo el más reciente que toque: quien no abrió la app en días recibe uno, no tres.
		tag, err := a.DB.Exec(ctx, `UPDATE pets SET reminded_days = $2 WHERE id = $1 AND reminded_days < $2`, c.ID, due)
		if err != nil {
			return reminded, archived, err
		}
		if tag.RowsAffected() == 1 {
			a.notify(ctx, []string{c.OwnerID}, "case_reminder", c.ID, nil)
			reminded++
		}
	}
	return reminded, archived, nil
}

// archiveIdleCase cierra un caso sin novedades: deja de verse en el mapa, se cierran sus chats y
// se ocultan las ubicaciones compartidas, como al retirarlo, pero la familia lo sigue viendo.
func (a *App) archiveIdleCase(ctx context.Context, c caseActivity, now time.Time) error {
	var hidden []string
	err := a.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE pets SET state = 'archived', contact_phone = NULL WHERE id = $1 AND state = 'active'`, c.ID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		if err := closeCaseChats(ctx, tx, c.ID, c.GroupID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE stories SET removed_at = $2 WHERE pet_id = $1 AND removed_at IS NULL`, c.ID, now); err != nil {
			return err
		}
		hidden, err = hideCaseLocations(ctx, tx, c.ID, now)
		return err
	})
	if err != nil {
		return err
	}
	a.publishMessages(ctx, hidden)
	a.Hub.Broadcast(realtime.Event{Type: "pet_closed", Data: petClosedEvent{ID: c.ID, Archived: true, At: now}})
	a.notify(ctx, []string{c.OwnerID}, "case_archived", c.ID, nil)
	return nil
}
