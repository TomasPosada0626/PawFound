package app

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/realtime"
)

// Person es una cuenta en una búsqueda o en la lista de seguidores propia.
type Person struct {
	UserSummary
	Username string `json:"username"`
}

// Network es la red de la propia cuenta. Nadie más puede verla: los perfiles solo muestran el número.
type Network struct {
	Requests  []Person `json:"requests"`
	Followers []Person `json:"followers"`
	Following []Person `json:"following"`
	Sent      []Person `json:"sent"`
}

// Códigos de error propios de los seguidores. Coinciden con ErrorCode de la app.
var (
	errFollowRequired = newErr(http.StatusForbidden, "follow_required", nil)
	errFollowWait     = newErr(http.StatusConflict, "follow_wait", nil)
	usernameSearchRE  = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
)

// scanPeople lee filas con (id, name, username, avatar, photo_id, email_verified, created_at, lang).
func (a *App) scanPeople(rows pgx.Rows) ([]Person, error) {
	out := []Person{}
	var p Person
	var name string
	var photo *string
	_, err := pgx.ForEachRow(rows, []any{&p.ID, &name, &p.Username, &p.Avatar, &photo, &p.Verified, &p.CreatedAt, &p.Lang}, func() error {
		item := p
		item.ShortName = shortName(name)
		if photo != nil {
			item.PhotoURL = ptr(a.mediaURL(*photo))
		}
		out = append(out, item)
		return nil
	})
	return out, err
}

// SearchUsers busca por el comienzo del nombre de usuario. El @ es opcional: se quita si viene.
func (a *App) SearchUsers(ctx context.Context, ac Actor, query string) ([]Person, error) {
	q := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(query), "@"))
	if !usernameSearchRE.MatchString(q) {
		return []Person{}, nil
	}
	// El guion bajo es comodín en LIKE y puede ser parte de un nombre de usuario.
	rows, _ := a.DB.Query(ctx, `SELECT id, name, username, avatar, photo_id, email_verified, created_at, lang FROM users
		WHERE username LIKE $1 AND id <> $2 AND suspended_at IS NULL
		ORDER BY username = $3 DESC, length(username), username LIMIT 20`,
		strings.ReplaceAll(q, "_", `\_`)+"%", ac.ID, q)
	return a.scanPeople(rows)
}

// MyNetwork devuelve las solicitudes, los seguidores y a quién sigue la propia cuenta.
func (a *App) MyNetwork(ctx context.Context, ac Actor) (Network, error) {
	list := func(column, match, status string) ([]Person, error) {
		rows, _ := a.DB.Query(ctx, `SELECT u.id, u.name, u.username, u.avatar, u.photo_id, u.email_verified, u.created_at, u.lang
			FROM follows f JOIN users u ON u.id = f.`+column+`
			WHERE f.`+match+` = $1 AND f.status = $2 ORDER BY f.updated_at DESC`, ac.ID, status)
		return a.scanPeople(rows)
	}
	var n Network
	var err error
	if n.Requests, err = list("follower_id", "followed_id", "pending"); err != nil {
		return n, err
	}
	if n.Followers, err = list("follower_id", "followed_id", "accepted"); err != nil {
		return n, err
	}
	if n.Following, err = list("followed_id", "follower_id", "accepted"); err != nil {
		return n, err
	}
	n.Sent, err = list("followed_id", "follower_id", "pending")
	return n, err
}

// Follow envía una solicitud para seguir a otra cuenta. Quien fue rechazado o eliminado espera
// domain.FollowRetryWait antes de volver a pedirlo, para que nadie insista.
func (a *App) Follow(ctx context.Context, ac Actor, targetID string) (string, error) {
	if err := requireVerified(ac); err != nil {
		return "", err
	}
	if targetID == ac.ID {
		return "", ErrNotAllowed
	}
	if _, err := a.loadUser(ctx, a.DB, targetID); err != nil {
		return "", err
	}
	now := a.now()
	var status string
	var updatedAt time.Time
	err := a.DB.QueryRow(ctx, `SELECT status, updated_at FROM follows WHERE follower_id = $1 AND followed_id = $2`, ac.ID, targetID).Scan(&status, &updatedAt)
	switch {
	case err == nil && status != "declined":
		return status, nil
	case err == nil && now.Sub(updatedAt) < domain.FollowRetryWait:
		return "", errFollowWait
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return "", err
	}
	if _, err := a.DB.Exec(ctx, `INSERT INTO follows (follower_id, followed_id, status, created_at, updated_at) VALUES ($1, $2, 'pending', $3, $3)
		ON CONFLICT (follower_id, followed_id) DO UPDATE SET status = 'pending', created_at = $3, updated_at = $3`, ac.ID, targetID, now); err != nil {
		return "", err
	}
	a.background(func(ctx context.Context) {
		a.pushFollow(ctx, targetID, "follow_request", ac.ShortName(), "/seguidores")
	})
	return "pending", nil
}

// Unfollow deja de seguir o cancela la solicitud propia. Un "me gusta" exige seguir, así que se
// va con el seguimiento. El rechazo no se borra: conserva la espera para volver a pedirlo.
func (a *App) Unfollow(ctx context.Context, ac Actor, targetID string) error {
	return a.endFollow(ctx, ac.ID, targetID, `DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2 AND status <> 'declined'`)
}

// AcceptFollower acepta una solicitud recibida.
func (a *App) AcceptFollower(ctx context.Context, ac Actor, followerID string) error {
	tag, err := a.DB.Exec(ctx, `UPDATE follows SET status = 'accepted', updated_at = $3
		WHERE follower_id = $1 AND followed_id = $2 AND status = 'pending'`, followerID, ac.ID, a.now())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	a.background(func(ctx context.Context) {
		a.pushFollow(ctx, followerID, "follow_accepted", ac.ShortName(), "/user/"+ac.ID)
	})
	return nil
}

// RemoveFollower rechaza una solicitud o elimina a un seguidor. No le avisa a la otra persona.
func (a *App) RemoveFollower(ctx context.Context, ac Actor, followerID string) error {
	return a.endFollow(ctx, followerID, ac.ID, `UPDATE follows SET status = 'declined', updated_at = $3
		WHERE follower_id = $1 AND followed_id = $2 AND status <> 'declined'`, a.now())
}

// endFollow termina la relación y quita el "me gusta" que dependía de ella, todo o nada.
func (a *App) endFollow(ctx context.Context, followerID, followedID, sql string, extra ...any) error {
	return a.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, sql, append([]any{followerID, followedID}, extra...)...)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		_, err = tx.Exec(ctx, `DELETE FROM profile_likes WHERE liker_id = $1 AND target_id = $2`, followerID, followedID)
		return err
	})
}

// isFollowing dice si la cuenta sigue a otra con la solicitud aceptada.
func (a *App) isFollowing(ctx context.Context, followerID, followedID string) (bool, error) {
	var ok bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2 AND status = 'accepted')`,
		followerID, followedID).Scan(&ok)
	return ok, err
}

// notifyFollowers avisa a quienes siguen a la familia. Un aviso por caso: friend_lost no llega a
// quien ya recibió la Alerta Ángel de ese caso, y skip son quienes ya reciben otro aviso del cierre.
func (a *App) notifyFollowers(ctx context.Context, row petRow, kind string, skip []string) error {
	if skip == nil {
		skip = []string{}
	}
	rows, _ := a.DB.Query(ctx, `SELECT f.follower_id FROM follows f JOIN users u ON u.id = f.follower_id
		WHERE f.followed_id = $1 AND f.status = 'accepted' AND u.suspended_at IS NULL
		  AND coalesce((u.notification_prefs->>'friendAlerts')::boolean, true)
		  AND NOT (f.follower_id = ANY($2))
		  AND ($4 <> 'friend_lost' OR NOT EXISTS (SELECT 1 FROM notifications n
			WHERE n.user_id = f.follower_id AND n.pet_id = $3 AND n.kind IN ('angel_alert', 'life_circle')))`,
		deref(row.OwnerID), skip, row.ID, kind)
	audience, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	a.notify(ctx, audience, kind, row.ID, nil)
	return nil
}

// followTexts: las solicitudes no pertenecen a un caso, por eso no pasan por la bandeja de
// notificaciones; la solicitud queda en la lista de seguidores.
var followTexts = map[string]map[string][2]string{
	"es": {
		"follow_request":  {"Nueva solicitud", "{name} quiere seguirte en PawFound"},
		"follow_accepted": {"Solicitud aceptada", "{name} aceptó tu solicitud. Te avisaremos si su mascota se pierde."},
	},
	"en": {
		"follow_request":  {"New request", "{name} wants to follow you on PawFound"},
		"follow_accepted": {"Request accepted", "{name} accepted your request. We'll let you know if their pet goes missing."},
	},
}

// pushFollow actualiza la lista en vivo y avisa al celular de la otra persona.
func (a *App) pushFollow(ctx context.Context, userID, kind, fromName, url string) {
	a.Hub.Publish([]string{userID}, realtime.Event{Type: "follow", Data: kind})
	person, ok := a.recipients(ctx, []string{userID})[userID]
	if !ok || !person.Prefs.Push || !person.Prefs.FriendAlerts {
		return
	}
	lang := person.Lang
	if _, ok := followTexts[lang]; !ok {
		lang = "es"
	}
	text := followTexts[lang][kind]
	messages := make([]providers.PushMessage, 0, len(person.Tokens))
	for _, token := range person.Tokens {
		messages = append(messages, providers.PushMessage{
			Token: token, Title: text[0], Body: strings.ReplaceAll(text[1], "{name}", fromName), URL: url,
			Channel: channelUpdates, Silent: domain.IsQuietTime(person.Prefs, a.now()),
		})
	}
	if len(messages) > 0 {
		if err := a.Push.Send(ctx, messages); err != nil {
			a.Log.Error("enviar push de seguidores", "err", err)
		}
	}
}

// rating calcula la calificación vigente de una cuenta y cuántas calificaciones reales tiene.
// Los casos retirados no cuentan, para que no se puedan inflar publicando y borrando.
func (a *App) rating(ctx context.Context, userID string) ([]int, int, error) {
	rows, _ := a.DB.Query(ctx, `SELECT h.stars, count(*) OVER () FROM pet_helpers h JOIN pets p ON p.id = h.pet_id
		WHERE h.user_id = $1 AND h.stars IS NOT NULL AND NOT p.moderation_removed AND p.withdrawn_at IS NULL
		ORDER BY h.rated_at DESC, h.pet_id LIMIT $2`, userID, domain.RatingWindow)
	stars := []int{}
	total := 0
	var value int
	_, err := pgx.ForEachRow(rows, []any{&value, &total}, func() error {
		stars = append(stars, value)
		return nil
	})
	return stars, total, err
}
