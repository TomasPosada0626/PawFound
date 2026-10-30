package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

// Moderación (issue #42, docs/legal/moderacion-y-ugc.md). No hay bloqueos entre personas ni
// ocultamiento automático por volumen de reportes: una persona del equipo revisa con
// contexto y decide. Cada decisión queda en moderation_actions (solo inserción).

// UserBrief es lo que el equipo de moderación ve de una cuenta.
type UserBrief struct {
	ID          string     `db:"id"`
	Name        string     `db:"name"`
	Username    string     `db:"username"`
	Email       string     `db:"email"`
	Role        string     `db:"role"`
	Verified    bool       `db:"email_verified"`
	CreatedAt   time.Time  `db:"created_at"`
	MutedUntil  *time.Time `db:"muted_until"`
	SuspendedAt *time.Time `db:"suspended_at"`
	Warnings    int        `db:"warnings"`
	PhotoID     *string    `db:"photo_id"`
}

const briefCols = `id, name, username, email, role, email_verified, created_at, muted_until, suspended_at, warnings, photo_id`

// QueueItem es un reporte de la cola.
type QueueItem struct {
	ID             string     `db:"id"`
	TargetKind     string     `db:"target_kind"`
	Reason         string     `db:"reason"`
	Note           *string    `db:"note"`
	Status         string     `db:"status"`
	CreatedAt      time.Time  `db:"created_at"`
	ResolvedAt     *time.Time `db:"resolved_at"`
	ReporterID     *string    `db:"reporter_id"`
	ReporterName   *string    `db:"reporter_name"`
	ReportedID     *string    `db:"reported_user_id"`
	ReportedName   *string    `db:"reported_name"`
	PetID          *string    `db:"pet_id"`
	ThreadID       *string    `db:"thread_id"`
	MessageID      *string    `db:"message_id"`
	ReportsAgainst int        `db:"reports_against"`
}

// Automatic: lo abrió el sistema (p. ej., foto repetida), no una persona.
func (q QueueItem) Automatic() bool { return q.ReporterID == nil }

// QueueStats resume la cola para la portada del panel.
type QueueStats struct {
	Open       int
	OldestOpen *time.Time
	Resolved24 int
	Muted      int
	Suspended  int
}

// ModerationQueue lista reportes por estado ("open", "actioned", "dismissed"), los más viejos primero.
func (a *App) ModerationQueue(ctx context.Context, status string, limit int) ([]QueueItem, error) {
	if status != "actioned" && status != "dismissed" {
		status = "open"
	}
	order := "r.created_at ASC"
	if status != "open" {
		order = "r.resolved_at DESC"
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, _ := a.DB.Query(ctx, `SELECT r.id, r.target_kind, r.reason, r.note, r.status, r.created_at, r.resolved_at, r.reporter_id,
			rep.name AS reporter_name, r.reported_user_id, tgt.name AS reported_name, r.pet_id, r.thread_id, r.message_id,
			(SELECT count(*) FROM reports x WHERE x.reported_user_id = r.reported_user_id AND x.status = 'open')::int AS reports_against
		FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users tgt ON tgt.id = r.reported_user_id
		WHERE r.status = $1 ORDER BY `+order+` LIMIT $2`, status, limit)
	return pgx.CollectRows(rows, pgx.RowToStructByName[QueueItem])
}

// ModerationStats para la portada.
func (a *App) ModerationStats(ctx context.Context) (QueueStats, error) {
	var s QueueStats
	err := a.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM reports WHERE status = 'open'),
		(SELECT min(created_at) FROM reports WHERE status = 'open'),
		(SELECT count(*) FROM reports WHERE status <> 'open' AND resolved_at > $1),
		(SELECT count(*) FROM users WHERE muted_until > $2),
		(SELECT count(*) FROM users WHERE suspended_at IS NOT NULL)`, a.now().Add(-24*time.Hour), a.now()).
		Scan(&s.Open, &s.OldestOpen, &s.Resolved24, &s.Muted, &s.Suspended)
	return s, err
}

// ActionEntry es una fila de la bitácora.
type ActionEntry struct {
	ID            int64     `db:"id"`
	ModeratorName *string   `db:"moderator_name"`
	Action        string    `db:"action"`
	TargetUserID  *string   `db:"target_user_id"`
	TargetName    *string   `db:"target_name"`
	PetID         *string   `db:"pet_id"`
	MessageID     *string   `db:"message_id"`
	ReportID      *string   `db:"report_id"`
	Hours         *int      `db:"hours"`
	Note          string    `db:"note"`
	At            time.Time `db:"at"`
}

// ReportDetail es todo lo que se necesita para decidir.
type ReportDetail struct {
	Item     QueueItem
	Reported *UserBrief
	Message  *Message
	Context  []Message
	Pet      *Pet
	History  []ActionEntry
	Suggest  string
}

// ModerationReport arma el detalle de un reporte con contexto: el mensaje reportado y los
// que lo rodean, la publicación, y el historial de sanciones de la persona reportada.
func (a *App) ModerationReport(ctx context.Context, id string) (ReportDetail, error) {
	rows, _ := a.DB.Query(ctx, `SELECT r.id, r.target_kind, r.reason, r.note, r.status, r.created_at, r.resolved_at, r.reporter_id,
			rep.name AS reporter_name, r.reported_user_id, tgt.name AS reported_name, r.pet_id, r.thread_id, r.message_id,
			(SELECT count(*) FROM reports x WHERE x.reported_user_id = r.reported_user_id AND x.status = 'open')::int AS reports_against
		FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users tgt ON tgt.id = r.reported_user_id WHERE r.id = $1`, id)
	item, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[QueueItem])
	if err != nil {
		return ReportDetail{}, notFoundIfNoRows(err)
	}
	d := ReportDetail{Item: item}
	if item.ReportedID != nil {
		if u, err := a.UserBrief(ctx, *item.ReportedID); err == nil {
			d.Reported = &u
		}
		if d.History, err = a.ModerationLog(ctx, *item.ReportedID, 50); err != nil {
			return d, err
		}
	}
	if item.MessageID != nil {
		// Incluye mensajes ya retirados: moderación necesita ver lo que pasó.
		if m, err := a.messageAny(ctx, *item.MessageID); err == nil {
			d.Message = &m
			cr, _ := a.DB.Query(ctx, `SELECT * FROM (
				(SELECT `+messageCols+` FROM messages m LEFT JOIN media p ON p.id = m.photo_id WHERE m.thread_id = $1 AND m.at < $2 ORDER BY m.at DESC LIMIT 5)
				UNION ALL
				(SELECT `+messageCols+` FROM messages m LEFT JOIN media p ON p.id = m.photo_id WHERE m.thread_id = $1 AND m.at >= $2 ORDER BY m.at LIMIT 6)
			) x ORDER BY at`, m.ThreadID, m.At)
			list, err := pgx.CollectRows(cr, pgx.RowToStructByName[messageRow])
			if err != nil {
				return d, err
			}
			for _, r := range list {
				d.Context = append(d.Context, a.toMessage(r))
			}
		}
	}
	if item.PetID != nil {
		if row, err := a.petRow(ctx, *item.PetID); err == nil {
			if p, err := a.toPet(ctx, row, ""); err == nil {
				d.Pet = &p
			}
		}
	}
	d.Suggest = SuggestSanction(d.Reported, d.History)
	return d, nil
}

func (a *App) messageAny(ctx context.Context, id string) (Message, error) { return a.message(ctx, id) }

// SuggestSanction propone el siguiente escalón: aviso → 24 h → 7 días → suspensión. Es una
// sugerencia: la persona del equipo decide según la gravedad (una estafa puede ir directo).
func SuggestSanction(u *UserBrief, history []ActionEntry) string {
	if u == nil {
		return "dismiss"
	}
	mutes := map[int]bool{}
	for _, h := range history {
		if h.Action == "mute" && h.Hours != nil {
			mutes[*h.Hours] = true
		}
	}
	switch {
	case u.SuspendedAt != nil:
		return "none"
	case u.Warnings == 0:
		return "warn"
	case !mutes[24]:
		return "mute24"
	case !mutes[168]:
		return "mute168"
	default:
		return "suspend"
	}
}

// UserBrief trae una cuenta para el panel.
func (a *App) UserBrief(ctx context.Context, id string) (UserBrief, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+briefCols+` FROM users WHERE id = $1`, id)
	u, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[UserBrief])
	return u, notFoundIfNoRows(err)
}

// FindUsers busca por usuario, correo o nombre (máx. 20).
func (a *App) FindUsers(ctx context.Context, q string) ([]UserBrief, error) {
	q = domain.Clean(q, 80)
	if q == "" {
		return []UserBrief{}, nil
	}
	rows, _ := a.DB.Query(ctx, `SELECT `+briefCols+` FROM users WHERE username ILIKE $1 OR email ILIKE $1 OR name ILIKE $1 ORDER BY created_at DESC LIMIT 20`,
		"%"+escapeLike(q)+"%")
	return pgx.CollectRows(rows, pgx.RowToStructByName[UserBrief])
}

func escapeLike(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '%' || r == '_' || r == '\\' {
			out = append(out, '\\')
		}
		out = append(out, r)
	}
	return string(out)
}

// ModerationLog es la bitácora; con userID, solo la de esa cuenta.
func (a *App) ModerationLog(ctx context.Context, userID string, limit int) ([]ActionEntry, error) {
	rows, _ := a.DB.Query(ctx, `SELECT l.id, m.name AS moderator_name, l.action, l.target_user_id, t.name AS target_name, l.pet_id, l.message_id,
			l.report_id, l.hours, l.note, l.at
		FROM moderation_actions l LEFT JOIN users m ON m.id = l.moderator_id LEFT JOIN users t ON t.id = l.target_user_id
		WHERE $1 = '' OR l.target_user_id = $1 ORDER BY l.at DESC, l.id DESC LIMIT $2`, userID, limit)
	return pgx.CollectRows(rows, pgx.RowToStructByName[ActionEntry])
}

// ModerationInput es una decisión del equipo.
type ModerationInput struct {
	Action    string
	ReportID  string
	UserID    string
	PetID     string
	MessageID string
	Hours     int
	Note      string
}

// Acciones del panel.
var moderationActions = map[string]bool{
	"dismiss": true, "warn": true, "mute": true, "unmute": true, "remove_message": true, "restore_message": true,
	"remove_pet": true, "restore_pet": true, "suspend": true, "unsuspend": true, "remove_photo": true,
}

// Moderate aplica una decisión, la registra y resuelve el reporte asociado.
func (a *App) Moderate(ctx context.Context, mod Actor, in ModerationInput) error {
	if !mod.IsModerator() {
		return ErrNotAllowed
	}
	if !moderationActions[in.Action] {
		return invalid("action")
	}
	note := domain.Clean(in.Note, 500)
	if in.Action == "suspend" && note == "" {
		return invalid("note") // una suspensión siempre lleva su motivo
	}
	if in.Action == "mute" && in.Hours != 24 && in.Hours != 168 {
		return invalid("hours")
	}
	now := a.now()
	if in.ReportID != "" {
		var reported, petID, messageID *string
		if err := a.DB.QueryRow(ctx, `SELECT reported_user_id, pet_id, message_id FROM reports WHERE id = $1`, in.ReportID).
			Scan(&reported, &petID, &messageID); err != nil {
			return notFoundIfNoRows(err)
		}
		if in.UserID == "" {
			in.UserID = deref(reported)
		}
		if in.PetID == "" {
			in.PetID = deref(petID)
		}
		if in.MessageID == "" {
			in.MessageID = deref(messageID)
		}
	}
	// La bitácora siempre dice a quién afectó la decisión.
	if in.UserID == "" && in.MessageID != "" {
		_ = a.DB.QueryRow(ctx, `SELECT coalesce(author_id, '') FROM messages WHERE id = $1`, in.MessageID).Scan(&in.UserID)
	}
	if in.UserID == "" && in.PetID != "" {
		_ = a.DB.QueryRow(ctx, `SELECT coalesce(owner_id, '') FROM pets WHERE id = $1`, in.PetID).Scan(&in.UserID)
	}
	if in.UserID != "" {
		target, err := a.UserBrief(ctx, in.UserID)
		if err != nil {
			return err
		}
		// Nadie se sanciona a sí mismo, y solo un admin puede sancionar al equipo.
		if target.ID == mod.ID || (target.Role != "user" && mod.Role != "admin") {
			if in.Action != "dismiss" {
				return ErrNotAllowed
			}
		}
	}
	var removedPhoto string
	err := a.withTx(ctx, func(tx pgx.Tx) error {
		var err error
		switch in.Action {
		case "remove_photo":
			// La foto vuelve al avatar; el archivo se borra después de guardar la decisión.
			err = tx.QueryRow(ctx, `UPDATE users u SET photo_id = NULL FROM (SELECT id, photo_id FROM users WHERE id = $1 FOR UPDATE) old
				WHERE u.id = old.id AND old.photo_id IS NOT NULL RETURNING old.photo_id`, in.UserID).Scan(&removedPhoto)
			err = notFoundIfNoRows(err)
		case "warn":
			_, err = tx.Exec(ctx, `UPDATE users SET warnings = warnings + 1 WHERE id = $1`, in.UserID)
		case "mute":
			_, err = tx.Exec(ctx, `UPDATE users SET muted_until = $2 WHERE id = $1`, in.UserID, now.Add(time.Duration(in.Hours)*time.Hour))
		case "unmute":
			_, err = tx.Exec(ctx, `UPDATE users SET muted_until = NULL WHERE id = $1`, in.UserID)
		case "suspend":
			if _, err = tx.Exec(ctx, `UPDATE users SET suspended_at = $2 WHERE id = $1`, in.UserID, now); err == nil {
				_, err = tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, $2) WHERE user_id = $1`, in.UserID, now)
			}
		case "unsuspend":
			_, err = tx.Exec(ctx, `UPDATE users SET suspended_at = NULL WHERE id = $1`, in.UserID)
		case "remove_message", "restore_message":
			var removed *time.Time
			if in.Action == "remove_message" {
				removed = &now
			}
			var tag pgconnTag
			tag, err = tx.Exec(ctx, `UPDATE messages SET removed_at = $2 WHERE id = $1`, in.MessageID, removed)
			if err == nil && tag.RowsAffected() == 0 {
				err = ErrNotFound
			}
		case "remove_pet", "restore_pet":
			sql := `UPDATE pets SET moderation_removed = true, state = CASE WHEN state = 'active' THEN 'archived' ELSE state END WHERE id = $1`
			if in.Action == "restore_pet" {
				sql = `UPDATE pets SET moderation_removed = false WHERE id = $1`
			}
			var tag pgconnTag
			tag, err = tx.Exec(ctx, sql, in.PetID)
			if err == nil && tag.RowsAffected() == 0 {
				err = ErrNotFound
			}
			if err == nil && in.Action == "remove_pet" {
				_, err = hideCaseLocations(ctx, tx, in.PetID, now)
			}
		}
		if err != nil {
			return err
		}
		var hours *int
		if in.Action == "mute" {
			hours = &in.Hours
		}
		if _, err := tx.Exec(ctx, `INSERT INTO moderation_actions (moderator_id, action, target_user_id, pet_id, message_id, report_id, hours, note, at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, mod.ID, in.Action, optional(in.UserID), optional(in.PetID), optional(in.MessageID),
			optional(in.ReportID), hours, note, now); err != nil {
			return err
		}
		if in.ReportID != "" {
			status := "actioned"
			if in.Action == "dismiss" {
				status = "dismissed"
			}
			_, err = tx.Exec(ctx, `UPDATE reports SET status = $2, resolved_at = $3, resolved_by = $4 WHERE id = $1`, in.ReportID, status, now, mod.ID)
		}
		return err
	})
	if err == nil && removedPhoto != "" {
		a.deleteMedia(ctx, removedPhoto)
	}
	return err
}

// GrantRole da o quita el rol de moderación (comando de administración, no hay pantalla).
func (a *App) GrantRole(ctx context.Context, email, role string) error {
	if role != "user" && role != "moderator" && role != "admin" {
		return errors.New("rol inválido: user, moderator o admin")
	}
	tag, err := a.DB.Exec(ctx, `UPDATE users SET role = $2 WHERE lower(email) = lower($1)`, email, role)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return newErr(http.StatusNotFound, "not_found", nil)
	}
	return nil
}

// PromoteAdmins da el rol de administrador a las cuentas de ADMIN_EMAILS que ya verificaron su
// correo (con userID, solo a esa cuenta). Exigir el correo verificado impide que alguien se
// registre con una de esas direcciones sin ser su dueño y se quede con el panel.
func (a *App) PromoteAdmins(ctx context.Context, userID string) (int64, error) {
	if len(a.AdminEmails) == 0 {
		return 0, nil
	}
	tag, err := a.DB.Exec(ctx, `UPDATE users SET role = 'admin'
		WHERE lower(email) = ANY($1) AND email_verified AND role <> 'admin' AND ($2 = '' OR id = $2)`, a.AdminEmails, userID)
	return tag.RowsAffected(), err
}

// PlacesCount dice cuántas veterinarias hay cargadas.
func (a *App) PlacesCount(ctx context.Context) (int, error) {
	var n int
	err := a.DB.QueryRow(ctx, `SELECT count(*) FROM places`).Scan(&n)
	return n, err
}
