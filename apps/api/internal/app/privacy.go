package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
)

// SetAlertZone guarda la zona aproximada (nunca el punto exacto) y deja constancia del
// consentimiento (issue #43). nil la borra y registra la revocación.
func (a *App) SetAlertZone(ctx context.Context, ac Actor, zone *AlertZone) error {
	now := a.now()
	return a.withTx(ctx, func(tx pgx.Tx) error {
		if zone == nil {
			if _, err := tx.Exec(ctx, `DELETE FROM alert_zones WHERE user_id = $1`, ac.ID); err != nil {
				return err
			}
		} else {
			name := domain.Clean(zone.Zone, 80)
			if !validPoint(zone.Location) || name == "" {
				return invalid("alertZone")
			}
			p := geo.Approximate(zone.Location)
			if _, err := tx.Exec(ctx, `INSERT INTO alert_zones (user_id, lat, lng, zone, updated_at) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, zone = EXCLUDED.zone, updated_at = EXCLUDED.updated_at`,
				ac.ID, p.Lat, p.Lng, name, now); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO consents (user_id, kind, granted, at) VALUES ($1, 'alert_zone', $2, $3)`, ac.ID, zone != nil, now)
		return err
	})
}

// RegisterDevice guarda el token push del celular (Expo o FCM). Un token pertenece a una sola
// cuenta: si alguien inicia sesión en un celular usado por otra persona, pasa a la nueva.
func (a *App) RegisterDevice(ctx context.Context, ac Actor, token, platform string) error {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 255 || strings.ContainsAny(token, " \n\t") {
		return invalid("token")
	}
	if !domain.Platforms[platform] {
		return invalid("platform")
	}
	now := a.now()
	return a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO devices (token, user_id, platform, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)
			ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = EXCLUDED.last_seen_at`,
			token, ac.ID, platform, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO consents (user_id, kind, granted, at) VALUES ($1, 'push', true, $2)`, ac.ID, now)
		return err
	})
}

// UnregisterDevice se llama al cerrar sesión o al desactivar el push.
func (a *App) UnregisterDevice(ctx context.Context, ac Actor, token string) error {
	_, err := a.DB.Exec(ctx, `DELETE FROM devices WHERE token = $1 AND user_id = $2`, token, ac.ID)
	return err
}

// Export es la portabilidad de datos (Ley 1581): todo lo que la cuenta generó.
type Export struct {
	ExportedAt time.Time      `json:"exportedAt"`
	Me         Me             `json:"me"`
	Reports    []Pet          `json:"reports"`
	Messages   []Message      `json:"messages"`
	OwnedPets  []OwnedPet     `json:"ownedPets"`
	Consents   []ConsentEntry `json:"consents"`
}

// ConsentEntry es una fila del historial de consentimientos.
type ConsentEntry struct {
	Kind    string    `json:"kind" db:"kind"`
	Granted bool      `json:"granted" db:"granted"`
	At      time.Time `json:"at" db:"at"`
}

// ExportData junta los datos de la cuenta.
func (a *App) ExportData(ctx context.Context, ac Actor) (Export, error) {
	me, err := a.Me(ctx, ac.ID)
	if err != nil {
		return Export{}, err
	}
	reports, err := a.MyPets(ctx, ac)
	if err != nil {
		return Export{}, err
	}
	owned, err := a.OwnedPets(ctx, ac)
	if err != nil {
		return Export{}, err
	}
	rows, _ := a.DB.Query(ctx, `SELECT `+messageCols+` FROM messages m LEFT JOIN media p ON p.id = m.photo_id WHERE m.author_id = $1 AND m.kind = 'text' ORDER BY m.at`, ac.ID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[messageRow])
	if err != nil {
		return Export{}, err
	}
	messages := make([]Message, len(list))
	for i, m := range list {
		messages[i] = a.toMessage(m)
	}
	cr, _ := a.DB.Query(ctx, `SELECT kind, granted, at FROM consents WHERE user_id = $1 ORDER BY at`, ac.ID)
	consents, err := pgx.CollectRows(cr, pgx.RowToStructByName[ConsentEntry])
	if err != nil {
		return Export{}, err
	}
	return Export{ExportedAt: a.now(), Me: me, Reports: reports, Messages: messages, OwnedPets: owned, Consents: consents}, nil
}

// DeleteAccount es el derecho al olvido: borra perfil, mensajes escritos, chats directos,
// mascotas propias, zona y fotos de chat. Los reportes activos se archivan (no se borran: son
// parte de casos con más personas) y quedan sin autor.
func (a *App) DeleteAccount(ctx context.Context, ac Actor) error {
	var keys []string
	err := a.withTx(ctx, func(tx pgx.Tx) error {
		stmts := []string{
			`UPDATE pets SET state = 'archived' WHERE owner_id = $1 AND state = 'active'`,
			`UPDATE threads SET archived = true WHERE id IN (SELECT group_id FROM pets WHERE owner_id = $1)`,
			`DELETE FROM messages WHERE author_id = $1 AND kind = 'text'`,
			`UPDATE messages SET author_id = NULL, author_short_name = '' WHERE author_id = $1`,
			`DELETE FROM threads WHERE kind = 'dm' AND id IN (SELECT thread_id FROM thread_members WHERE user_id = $1)`,
		}
		for _, sql := range stmts {
			if _, err := tx.Exec(ctx, sql, ac.ID); err != nil {
				return err
			}
		}
		rows, _ := tx.Query(ctx, `DELETE FROM media WHERE owner_id = $1 AND purpose IN ('chat', 'owned') RETURNING storage_key`, ac.ID)
		var err error
		keys, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, ac.ID)
		return err
	})
	if err != nil {
		return err
	}
	for _, key := range keys {
		if remover, ok := a.Media.(interface {
			Remove(context.Context, string) error
		}); ok {
			_ = remover.Remove(ctx, key)
		}
	}
	return nil
}

// UploadedMedia es la respuesta de una subida.
type UploadedMedia struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// Upload procesa una foto (sin EXIF ni GPS) y la guarda. Las de reportes y chats exigen
// cuenta verificada, como publicar.
func (a *App) Upload(ctx context.Context, ac Actor, purpose string, raw []byte) (UploadedMedia, error) {
	switch purpose {
	case "pet", "chat":
		if err := requireVerified(ac); err != nil {
			return UploadedMedia{}, err
		}
	case "owned":
	default:
		return UploadedMedia{}, invalid("purpose")
	}
	if ok, _ := a.uploadLimiter.Allow(ac.ID); !ok {
		return UploadedMedia{}, rateLimited(time.Time{})
	}
	processed, err := media.Process(raw)
	if errors.Is(err, media.ErrNotImage) {
		return UploadedMedia{}, newErr(http.StatusUnprocessableEntity, "invalid_image", nil)
	}
	if err != nil {
		return UploadedMedia{}, err
	}
	id := domain.NewID("med")
	key := id + ".jpg"
	if err := a.Media.Put(ctx, key, processed.Data); err != nil {
		return UploadedMedia{}, err
	}
	if _, err := a.DB.Exec(ctx, `INSERT INTO media (id, owner_id, purpose, content_type, width, height, bytes, phash, storage_key, created_at)
		VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7, $8, $9)`, id, ac.ID, purpose, processed.Width, processed.Height,
		len(processed.Data), processed.PHash, key, a.now()); err != nil {
		return UploadedMedia{}, err
	}
	return UploadedMedia{ID: id, URL: a.mediaURL(id), Width: processed.Width, Height: processed.Height}, nil
}

// OpenMedia devuelve la foto si quien la pide puede verla: las de reportes y "Mis mascotas"
// son públicas (están en perfiles y casos públicos); las de chat solo para miembros del chat.
func (a *App) OpenMedia(ctx context.Context, viewerID, id string) (io.ReadCloser, string, bool, error) {
	var purpose, key, contentType string
	var owner, threadID *string
	err := a.DB.QueryRow(ctx, `SELECT purpose, storage_key, content_type, owner_id, thread_id FROM media WHERE id = $1`, id).
		Scan(&purpose, &key, &contentType, &owner, &threadID)
	if err != nil {
		return nil, "", false, notFoundIfNoRows(err)
	}
	private := purpose == "chat"
	if private {
		allowed := viewerID != "" && (deref(owner) == viewerID || (threadID != nil && a.isMember(ctx, *threadID, viewerID)))
		if !allowed {
			return nil, "", true, ErrNotFound
		}
	}
	f, err := a.Media.Open(ctx, key)
	return f, contentType, private, err
}
