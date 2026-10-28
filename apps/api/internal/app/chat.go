package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/realtime"
)

type threadRow struct {
	ID             string    `db:"id"`
	Kind           string    `db:"kind"`
	PetID          *string   `db:"pet_id"`
	Archived       bool      `db:"archived"`
	ClosedBy       *string   `db:"closed_by"`
	ReadAt         time.Time `db:"read_at"`
	Muted          bool      `db:"muted"`
	MemberArchived bool      `db:"member_archived"`
	Unread         int       `db:"unread"`
}

// Threads lista los chats de la cuenta con miembros, último mensaje y no leídos.
func (a *App) Threads(ctx context.Context, ac Actor) ([]Thread, error) {
	rows, _ := a.DB.Query(ctx, `SELECT t.id, t.kind, t.pet_id, t.archived, t.closed_by, tm.read_at, tm.muted, tm.archived AS member_archived,
			(SELECT count(*) FROM messages m WHERE m.thread_id = t.id AND m.removed_at IS NULL
				AND m.author_id IS DISTINCT FROM $1 AND m.at > tm.read_at)::int AS unread
		FROM thread_members tm JOIN threads t ON t.id = tm.thread_id WHERE tm.user_id = $1`, ac.ID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[threadRow])
	if err != nil {
		return nil, err
	}
	return a.toThreads(ctx, ac.ID, list)
}

func (a *App) toThreads(ctx context.Context, viewerID string, list []threadRow) ([]Thread, error) {
	ids := make([]string, len(list))
	for i, t := range list {
		ids[i] = t.ID
	}
	members := map[string][]string{}
	mr, _ := a.DB.Query(ctx, `SELECT thread_id, user_id FROM thread_members WHERE thread_id = ANY($1) ORDER BY joined_at`, ids)
	pairs, err := pgx.CollectRows(mr, pgx.RowToStructByPos[struct{ Thread, User string }])
	if err != nil {
		return nil, err
	}
	var userIDs []string
	for _, p := range pairs {
		members[p.Thread] = append(members[p.Thread], p.User)
		userIDs = append(userIDs, p.User)
	}
	users, err := a.summaries(ctx, dedupe(userIDs))
	if err != nil {
		return nil, err
	}
	lastRows, _ := a.DB.Query(ctx, `SELECT DISTINCT ON (m.thread_id) `+messageCols+` FROM messages m LEFT JOIN media p ON p.id = m.photo_id
		WHERE m.thread_id = ANY($1) AND m.removed_at IS NULL ORDER BY m.thread_id, m.at DESC`, ids)
	lastList, err := pgx.CollectRows(lastRows, pgx.RowToStructByName[messageRow])
	if err != nil {
		return nil, err
	}
	last := map[string]Message{}
	for _, m := range lastList {
		last[m.ThreadID] = a.toMessage(m)
	}
	out := make([]Thread, 0, len(list))
	for _, t := range list {
		th := Thread{
			ID: t.ID, Kind: t.Kind, PetID: t.PetID, MemberIDs: members[t.ID], Archived: t.Archived, Unread: t.Unread,
			ReadAt: map[string]string{viewerID: t.ReadAt.UTC().Format(time.RFC3339Nano)}, MutedBy: []string{}, ArchivedBy: []string{},
			ClosedBy: t.ClosedBy,
		}
		if t.MemberArchived {
			th.ArchivedBy = []string{viewerID}
		}
		if t.Muted {
			th.MutedBy = []string{viewerID}
		}
		for _, id := range members[t.ID] {
			if u, ok := users[id]; ok {
				th.Members = append(th.Members, u)
			}
		}
		if m, ok := last[t.ID]; ok {
			th.LastMessage = &m
		}
		out = append(out, th)
	}
	return out, nil
}

// Thread devuelve un chat si la cuenta es miembro.
func (a *App) Thread(ctx context.Context, ac Actor, threadID string) (Thread, error) {
	rows, _ := a.DB.Query(ctx, `SELECT t.id, t.kind, t.pet_id, t.archived, t.closed_by, tm.read_at, tm.muted, tm.archived AS member_archived, 0 AS unread
		FROM thread_members tm JOIN threads t ON t.id = tm.thread_id WHERE tm.user_id = $1 AND t.id = $2`, ac.ID, threadID)
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[threadRow])
	if errors.Is(err, pgx.ErrNoRows) {
		return Thread{}, ErrNotAllowed
	}
	if err != nil {
		return Thread{}, err
	}
	list, err := a.toThreads(ctx, ac.ID, []threadRow{row})
	if err != nil {
		return Thread{}, err
	}
	return list[0], nil
}

// JoinGroup suma a la cuenta al grupo del caso ("Encontremos a…").
func (a *App) JoinGroup(ctx context.Context, ac Actor, petID string) (string, error) {
	if err := requireVerified(ac); err != nil {
		return "", err
	}
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return "", err
	}
	var archived, member bool
	if err := a.DB.QueryRow(ctx, `SELECT archived, EXISTS (SELECT 1 FROM thread_members WHERE thread_id = $1 AND user_id = $2) FROM threads WHERE id = $1`,
		row.GroupID, ac.ID).Scan(&archived, &member); err != nil {
		return "", notFoundIfNoRows(err)
	}
	if member {
		return row.GroupID, nil
	}
	if archived {
		return "", ErrNotAllowed
	}
	now := a.now()
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO thread_members (thread_id, user_id, read_at, joined_at) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
			row.GroupID, ac.ID, now); err != nil {
			return err
		}
		return insertSystemMessage(ctx, tx, row.GroupID, ac, "joined", now)
	})
	return row.GroupID, err
}

// OpenDirect abre (o reutiliza) el mensaje directo con la familia del caso. Respeta "quién
// puede escribirme".
func (a *App) OpenDirect(ctx context.Context, ac Actor, petID string) (string, error) {
	if err := requireVerified(ac); err != nil {
		return "", err
	}
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return "", err
	}
	other := deref(row.OwnerID)
	if other == "" {
		return "", ErrNotFound
	}
	if other == ac.ID {
		return "", ErrNotAllowed
	}
	_, who, err := a.prefs(ctx, other)
	if err != nil {
		return "", err
	}
	if who == "nobody" || (who == "verified" && !ac.Verified) {
		return "", newErr(http.StatusForbidden, "cannot_message", nil)
	}
	var existing string
	err = a.DB.QueryRow(ctx, `SELECT t.id FROM threads t
		JOIN thread_members a ON a.thread_id = t.id AND a.user_id = $1
		JOIN thread_members b ON b.thread_id = t.id AND b.user_id = $2
		WHERE t.kind = 'dm' AND NOT t.archived LIMIT 1`, ac.ID, other).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	id, now := domain.NewID("dm"), a.now()
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO threads (id, kind, pet_id, created_at) VALUES ($1, 'dm', $2, $3)`, id, petID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO thread_members (thread_id, user_id, read_at, joined_at) VALUES ($1, $2, $4, $4), ($1, $3, $4, $4)`,
			id, ac.ID, other, now)
		return err
	})
	return id, err
}

type messageRow struct {
	ID              string    `db:"id"`
	ThreadID        string    `db:"thread_id"`
	AuthorID        *string   `db:"author_id"`
	AuthorShortName string    `db:"author_short_name"`
	Kind            string    `db:"kind"`
	Body            string    `db:"body"`
	Lang            *string   `db:"lang"`
	Translations    []byte    `db:"translations"`
	PhotoID         *string   `db:"photo_id"`
	PhotoWidth      *int      `db:"photo_width"`
	PhotoHeight     *int      `db:"photo_height"`
	At              time.Time `db:"at"`
	LocationKind    *string   `db:"location_kind"`
	LocationLat     *float64  `db:"location_lat"`
	LocationLng     *float64  `db:"location_lng"`
	LocationLabel   *string   `db:"location_label"`
	LocationAddress *string   `db:"location_address"`
	PlaceID         *string   `db:"place_id"`
	LocationHidden  bool      `db:"location_hidden"`
}

const messageCols = `m.id, m.thread_id, m.author_id, m.author_short_name, m.kind, m.body, m.lang, m.translations, m.photo_id,
	p.width AS photo_width, p.height AS photo_height, m.at, m.location_kind, m.location_lat, m.location_lng, m.location_label,
	m.location_address, m.place_id, m.location_hidden_at IS NOT NULL AS location_hidden`

func (a *App) toMessage(r messageRow) Message {
	m := Message{
		ID: r.ID, ThreadID: r.ThreadID, AuthorID: deref(r.AuthorID), AuthorShortName: r.AuthorShortName, Text: r.Body,
		At: r.At, Kind: r.Kind, Lang: r.Lang,
	}
	if m.AuthorID == "" {
		m.AuthorID = "deleted"
	}
	if len(r.Translations) > 2 {
		_ = json.Unmarshal(r.Translations, &m.Translations)
	}
	if r.PhotoID != nil && r.PhotoWidth != nil && r.PhotoHeight != nil {
		m.Photo = &Photo{URL: a.mediaURL(*r.PhotoID), Width: *r.PhotoWidth, Height: *r.PhotoHeight}
	}
	if r.LocationKind != nil {
		loc := &MessageLocation{
			Kind: *r.LocationKind, Label: deref(r.LocationLabel), Address: deref(r.LocationAddress), PlaceID: deref(r.PlaceID),
			Hidden: r.LocationHidden,
		}
		if !r.LocationHidden && r.LocationLat != nil && r.LocationLng != nil {
			loc.Location = &geo.Point{Lat: *r.LocationLat, Lng: *r.LocationLng}
		}
		m.Location = loc
	}
	return m
}

// Messages de un chat, en orden cronológico. `before` pagina hacia atrás.
func (a *App) Messages(ctx context.Context, ac Actor, threadID string, before time.Time, limit int) ([]Message, error) {
	if !a.isMember(ctx, threadID, ac.ID) {
		return nil, ErrNotAllowed
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if before.IsZero() {
		before = a.now().Add(time.Hour)
	}
	rows, _ := a.DB.Query(ctx, `SELECT * FROM (SELECT `+messageCols+` FROM messages m LEFT JOIN media p ON p.id = m.photo_id
		WHERE m.thread_id = $1 AND m.removed_at IS NULL AND m.at < $2 ORDER BY m.at DESC LIMIT $3) x ORDER BY at`, threadID, before, limit)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[messageRow])
	if err != nil {
		return nil, err
	}
	out := make([]Message, len(list))
	for i, r := range list {
		out[i] = a.toMessage(r)
	}
	return out, nil
}

func (a *App) isMember(ctx context.Context, threadID, userID string) bool {
	var ok bool
	_ = a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM thread_members WHERE thread_id = $1 AND user_id = $2)`, threadID, userID).Scan(&ok)
	return ok
}

// SendInput es un mensaje nuevo: texto, foto o ambos, o una ubicación.
type SendInput struct {
	Text     string         `json:"text"`
	Lang     string         `json:"lang"`
	PhotoID  string         `json:"photoId"`
	Location *LocationInput `json:"location"`
}

// LocationInput es una ubicación para compartir. En "place" solo cuenta PlaceID: el nombre y
// las coordenadas salen de la tabla de veterinarias, no de lo que envíe la app.
type LocationInput struct {
	Kind     string     `json:"kind"`
	Location *geo.Point `json:"location"`
	Label    string     `json:"label"`
	PlaceID  string     `json:"placeId"`
}

// sharedLocation es la ubicación ya validada que se guarda con el mensaje.
type sharedLocation struct {
	kind, label, address string
	lat, lng             float64
	placeID              *string
}

// resolveLocation valida la ubicación: la de una persona solo se comparte en mensajes directos.
func (a *App) resolveLocation(ctx context.Context, threadKind string, in *LocationInput) (*sharedLocation, error) {
	if in == nil {
		return nil, nil
	}
	if !domain.LocationKinds[in.Kind] {
		return nil, invalid("location")
	}
	if in.Kind == "place" {
		var loc sharedLocation
		var address *string
		err := a.DB.QueryRow(ctx, `SELECT id, name, lat, lng, address FROM places WHERE id = $1`, in.PlaceID).
			Scan(&loc.placeID, &loc.label, &loc.lat, &loc.lng, &address)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, invalid("placeId")
		}
		loc.kind, loc.address = "place", deref(address)
		return &loc, err
	}
	if threadKind != "dm" {
		return nil, ErrNotAllowed
	}
	if in.Location == nil || !validPoint(*in.Location) {
		return nil, invalid("location")
	}
	label := ""
	if in.Kind == "meeting" {
		label = domain.Clean(in.Label, domain.LocationLabelMax)
	}
	return &sharedLocation{kind: in.Kind, label: label, lat: in.Location.Lat, lng: in.Location.Lng}, nil
}

// SendMessage aplica las reglas de convivencia: cuenta verificada, miembro del chat, chat no
// archivado, sin restricción de moderación vigente y máximo 12 mensajes por minuto.
func (a *App) SendMessage(ctx context.Context, ac Actor, threadID string, in SendInput) (Message, error) {
	if err := requireVerified(ac); err != nil {
		return Message{}, err
	}
	var archived bool
	var threadKind string
	err := a.DB.QueryRow(ctx, `SELECT t.archived, t.kind FROM threads t JOIN thread_members tm ON tm.thread_id = t.id AND tm.user_id = $2
		WHERE t.id = $1`, threadID, ac.ID).Scan(&archived, &threadKind)
	if errors.Is(err, pgx.ErrNoRows) || archived {
		return Message{}, ErrNotAllowed
	}
	if err != nil {
		return Message{}, err
	}
	body := domain.Clean(in.Text, domain.MessageMax)
	photoID := mediaIDFromRef(in.PhotoID)
	location, err := a.resolveLocation(ctx, threadKind, in.Location)
	if err != nil {
		return Message{}, err
	}
	if location != nil {
		photoID = "" // una ubicación va sola; el texto es opcional
	}
	if body == "" && photoID == "" && location == nil {
		return Message{}, invalid("text")
	}
	now := a.now()
	if ac.MutedUntil != nil && ac.MutedUntil.After(now) {
		return Message{}, newErr(http.StatusForbidden, "muted", map[string]any{"until": ac.MutedUntil.UTC().Format(time.RFC3339)})
	}
	var recent int
	if err := a.DB.QueryRow(ctx, `SELECT count(*) FROM messages WHERE author_id = $1 AND kind IN ('text', 'location') AND at > $2`, ac.ID, now.Add(-time.Minute)).Scan(&recent); err != nil {
		return Message{}, err
	}
	if recent >= domain.MessagesPerMinute {
		return Message{}, rateLimited(time.Time{})
	}
	lang := in.Lang
	if !domain.Langs[lang] {
		lang = ac.Lang
	}
	translations := a.translate(ctx, threadID, body, lang)
	rawTranslations, _ := json.Marshal(translations)
	msgID := domain.NewID("m")
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		var photo *string
		if photoID != "" {
			// La foto debe ser de quien envía, subida para chat y todavía sin usar en otro chat.
			tag, err := tx.Exec(ctx, `UPDATE media SET thread_id = $3 WHERE id = $1 AND owner_id = $2 AND purpose = 'chat' AND thread_id IS NULL`,
				photoID, ac.ID, threadID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() != 1 {
				return invalid("photoId")
			}
			photo = &photoID
		}
		if location != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO messages (id, thread_id, author_id, author_short_name, kind, body, lang, translations, at,
				location_kind, location_lat, location_lng, location_label, location_address, place_id)
				VALUES ($1, $2, $3, $4, 'location', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, msgID, threadID, ac.ID, ac.ShortName(), body,
				lang, rawTranslations, now, location.kind, location.lat, location.lng, optional(location.label), optional(location.address),
				location.placeID); err != nil {
				return err
			}
		} else if _, err := tx.Exec(ctx, `INSERT INTO messages (id, thread_id, author_id, author_short_name, kind, body, lang, translations, photo_id, at)
			VALUES ($1, $2, $3, $4, 'text', $5, $6, $7, $8, $9)`, msgID, threadID, ac.ID, ac.ShortName(), body, lang, rawTranslations, photo, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE thread_members SET read_at = $3 WHERE thread_id = $1 AND user_id = $2`, threadID, ac.ID, now)
		return err
	})
	if err != nil {
		return Message{}, err
	}
	message, err := a.message(ctx, msgID)
	if err != nil {
		return Message{}, err
	}
	a.publishMessage(ctx, message)
	a.pushMessage(ctx, ac, message)
	return message, nil
}

func (a *App) message(ctx context.Context, id string) (Message, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+messageCols+` FROM messages m LEFT JOIN media p ON p.id = m.photo_id WHERE m.id = $1`, id)
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[messageRow])
	if err != nil {
		return Message{}, notFoundIfNoRows(err)
	}
	return a.toMessage(row), nil
}

// translate traduce una vez hacia cada idioma de los miembros, no por cada lector. Sin
// proveedor no hay traducciones (nunca se inventan).
func (a *App) translate(ctx context.Context, threadID, body, from string) map[string]string {
	out := map[string]string{}
	if a.Translator == nil || body == "" {
		return out
	}
	rows, _ := a.DB.Query(ctx, `SELECT DISTINCT u.lang FROM thread_members tm JOIN users u ON u.id = tm.user_id WHERE tm.thread_id = $1 AND u.lang <> $2`, threadID, from)
	langs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return out
	}
	for _, to := range langs {
		if text, err := a.Translator.Translate(ctx, body, from, to); err == nil && text != "" {
			out[to] = text
		}
	}
	return out
}

func (a *App) memberIDs(ctx context.Context, threadID string) []string {
	rows, _ := a.DB.Query(ctx, `SELECT user_id FROM thread_members WHERE thread_id = $1`, threadID)
	ids, _ := pgx.CollectRows(rows, pgx.RowTo[string])
	return ids
}

func (a *App) publishMessage(ctx context.Context, m Message) {
	a.Hub.Publish(a.memberIDs(ctx, m.ThreadID), realtime.Event{Type: "message", Data: m})
}

// pushMessage avisa por push a los demás miembros que no silenciaron el chat, según sus
// preferencias de mensajes directos o de grupos.
func (a *App) pushMessage(ctx context.Context, from Actor, m Message) {
	var kind string
	if err := a.DB.QueryRow(ctx, `SELECT kind FROM threads WHERE id = $1`, m.ThreadID).Scan(&kind); err != nil {
		return
	}
	rows, _ := a.DB.Query(ctx, `SELECT user_id FROM thread_members WHERE thread_id = $1 AND user_id <> $2 AND NOT muted`, m.ThreadID, from.ID)
	recipients, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}
	var messages []providers.PushMessage
	for _, id := range recipients {
		prefs, _, err := a.prefs(ctx, id)
		if err != nil || !prefs.Push || (kind == "dm" && !prefs.DirectMessages) || (kind == "group" && !prefs.Groups) {
			continue
		}
		var lang string
		_ = a.DB.QueryRow(ctx, `SELECT lang FROM users WHERE id = $1`, id).Scan(&lang)
		body := m.Text
		if t, ok := m.Translations[lang]; ok {
			body = t
		}
		switch {
		case m.Location != nil && m.Location.Kind == "place":
			// Nunca coordenadas en el aviso: solo el nombre de la veterinaria.
			body = "📍 " + m.Location.Label
		case m.Location != nil:
			body = map[bool]string{true: "📍 Ubicación", false: "📍 Location"}[lang != "en"]
		case body == "":
			body = map[bool]string{true: "📷 Foto", false: "📷 Photo"}[lang != "en"]
		}
		if r := []rune(body); len(r) > 120 {
			body = string(r[:119]) + "…"
		}
		for _, token := range a.deviceTokens(ctx, id) {
			messages = append(messages, providers.PushMessage{
				Token: token, Title: from.ShortName(), Body: body,
				URL: "/chat/" + m.ThreadID, Channel: channelUpdates, Silent: domain.IsQuietTime(prefs, a.now()),
			})
		}
	}
	if len(messages) > 0 {
		if err := a.Push.Send(ctx, messages); err != nil {
			a.Log.Error("push de mensaje", "err", err)
		}
	}
}

// MarkThreadRead mueve la marca de lectura al último mensaje.
func (a *App) MarkThreadRead(ctx context.Context, ac Actor, threadID string) error {
	_, err := a.DB.Exec(ctx, `UPDATE thread_members SET read_at = greatest(read_at, coalesce((SELECT max(at) FROM messages WHERE thread_id = $1), read_at))
		WHERE thread_id = $1 AND user_id = $2`, threadID, ac.ID)
	return err
}

// ToggleMute silencia o reactiva un chat para la cuenta.
func (a *App) ToggleMute(ctx context.Context, ac Actor, threadID string) (bool, error) {
	var muted bool
	err := a.DB.QueryRow(ctx, `UPDATE thread_members SET muted = NOT muted WHERE thread_id = $1 AND user_id = $2 RETURNING muted`, threadID, ac.ID).Scan(&muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotAllowed
	}
	return muted, err
}

// CloseDirect cierra un mensaje directo para las dos personas: ya nadie escribe ahí (si
// quieren volver a hablar, abren otro desde el caso). Los grupos no se cierran.
func (a *App) CloseDirect(ctx context.Context, ac Actor, threadID string) error {
	var kind string
	var archived bool
	err := a.DB.QueryRow(ctx, `SELECT t.kind, t.archived FROM threads t JOIN thread_members tm ON tm.thread_id = t.id AND tm.user_id = $2
		WHERE t.id = $1`, threadID, ac.ID).Scan(&kind, &archived)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && kind != "dm") {
		return ErrNotAllowed
	}
	if err != nil || archived {
		return err
	}
	now := a.now()
	var hidden []string
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE threads SET archived = true, closed_by = $2 WHERE id = $1`, threadID, ac.ID); err != nil {
			return err
		}
		if hidden, err = hideLocations(ctx, tx, `thread_id = $1`, threadID, now); err != nil {
			return err
		}
		return insertSystemMessage(ctx, tx, threadID, ac, "closed", now)
	})
	if err == nil {
		a.publishMessages(ctx, hidden)
		if m, err := a.lastMessage(ctx, threadID); err == nil {
			a.publishMessage(ctx, m)
		}
	}
	return err
}

// hideLocations deja de mostrar las ubicaciones de personas (actual y punto de encuentro) de
// los mensajes que cumplen el filtro y borra sus coordenadas. Las veterinarias siguen visibles:
// son lugares públicos. Devuelve los mensajes cambiados para avisar en tiempo real.
func hideLocations(ctx context.Context, tx pgx.Tx, filter string, arg any, now time.Time) ([]string, error) {
	rows, _ := tx.Query(ctx, `UPDATE messages SET location_lat = NULL, location_lng = NULL, location_hidden_at = $2
		WHERE `+filter+` AND kind = 'location' AND location_kind IN ('current', 'meeting') AND location_hidden_at IS NULL
		RETURNING id`, arg, now)
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// hideCaseLocations: al cerrar un caso (reencuentro, retiro o moderación) dejan de verse las
// ubicaciones compartidas en los mensajes directos de ese caso.
func hideCaseLocations(ctx context.Context, tx pgx.Tx, petID string, now time.Time) ([]string, error) {
	return hideLocations(ctx, tx, `thread_id IN (SELECT id FROM threads WHERE kind = 'dm' AND pet_id = $1)`, petID, now)
}

// publishMessages reenvía en tiempo real mensajes que cambiaron (por ejemplo, una ubicación que
// dejó de verse) para que cada chat abierto se actualice.
func (a *App) publishMessages(ctx context.Context, ids []string) {
	for _, id := range ids {
		if m, err := a.message(ctx, id); err == nil {
			a.publishMessage(ctx, m)
		}
	}
}

// StopSharingLocation: quien compartió una ubicación la deja de mostrar cuando quiera. Las
// coordenadas se borran y el mensaje queda como "ya no visible".
func (a *App) StopSharingLocation(ctx context.Context, ac Actor, messageID string) (Message, error) {
	var author *string
	var kind string
	err := a.DB.QueryRow(ctx, `SELECT author_id, kind FROM messages WHERE id = $1 AND removed_at IS NULL`, messageID).Scan(&author, &kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, err
	}
	if deref(author) != ac.ID || kind != "location" {
		return Message{}, ErrNotAllowed
	}
	if _, err := a.DB.Exec(ctx, `UPDATE messages SET location_lat = NULL, location_lng = NULL, location_hidden_at = $2
		WHERE id = $1 AND location_hidden_at IS NULL`, messageID, a.now()); err != nil {
		return Message{}, err
	}
	m, err := a.message(ctx, messageID)
	if err == nil {
		a.publishMessage(ctx, m)
	}
	return m, err
}

func (a *App) lastMessage(ctx context.Context, threadID string) (Message, error) {
	var id string
	if err := a.DB.QueryRow(ctx, `SELECT id FROM messages WHERE thread_id = $1 ORDER BY at DESC LIMIT 1`, threadID).Scan(&id); err != nil {
		return Message{}, notFoundIfNoRows(err)
	}
	return a.message(ctx, id)
}

// ToggleArchive archiva o desarchiva un chat solo en la lista de quien lo pide.
func (a *App) ToggleArchive(ctx context.Context, ac Actor, threadID string) (bool, error) {
	var archived bool
	err := a.DB.QueryRow(ctx, `UPDATE thread_members SET archived = NOT archived WHERE thread_id = $1 AND user_id = $2 RETURNING archived`,
		threadID, ac.ID).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotAllowed
	}
	return archived, err
}

// LeaveThread elimina el chat de la lista de quien lo pide. Los mensajes siguen ahí para las
// demás personas; de un grupo se puede volver a entrar desde el caso.
func (a *App) LeaveThread(ctx context.Context, ac Actor, threadID string) error {
	tag, err := a.DB.Exec(ctx, `DELETE FROM thread_members WHERE thread_id = $1 AND user_id = $2`, threadID, ac.ID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotAllowed
	}
	return err
}
