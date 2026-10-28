package app

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/realtime"
)

// Canales de Android, iguales a los de la app (src/services/pushNotifications.ts).
const (
	channelAngel   = "angel-alerts"
	channelUpdates = "case-updates"
)

var alertKinds = map[string]bool{"angel_alert": true, "life_circle": true}

// notify crea notificaciones en la bandeja y las entrega en vivo y por push. Nunca falla la
// operación que la originó: un aviso perdido se registra en el log.
func (a *App) notify(ctx context.Context, userIDs []string, kind, petID string, ownedPetID *string) {
	if len(userIDs) == 0 {
		return
	}
	now := a.now()
	var created []Notification
	for _, id := range dedupe(userIDs) {
		n := Notification{ID: domain.NewID("n"), UserID: id, Kind: kind, PetID: petID, OwnedPetID: ownedPetID, At: now}
		tag, err := a.DB.Exec(ctx, `INSERT INTO notifications (id, user_id, kind, pet_id, owned_pet_id, at) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT DO NOTHING`, n.ID, n.UserID, n.Kind, n.PetID, n.OwnedPetID, n.At)
		if err != nil {
			a.Log.Error("crear notificación", "kind", kind, "err", err)
			continue
		}
		if tag.RowsAffected() == 1 {
			created = append(created, n)
		}
	}
	a.deliver(ctx, created)
}

func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := ids[:0:0]
	for _, id := range ids {
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// deliver publica por WebSocket y envía push a los dispositivos registrados, en el idioma de
// cada persona. Respeta "push" desactivado y el modo descanso (llega sin sonar).
func (a *App) deliver(ctx context.Context, list []Notification) {
	if len(list) == 0 {
		return
	}
	names := map[string]string{}
	var messages []providers.PushMessage
	for _, n := range list {
		a.Hub.Publish([]string{n.UserID}, realtime.Event{Type: "notification", Data: n})
		if _, ok := names[n.PetID]; !ok {
			var name *string
			_ = a.DB.QueryRow(ctx, `SELECT name FROM pets WHERE id = $1`, n.PetID).Scan(&name)
			names[n.PetID] = deref(name)
		}
		prefs, _, err := a.prefs(ctx, n.UserID)
		if err != nil || !prefs.Push {
			continue
		}
		var lang string
		_ = a.DB.QueryRow(ctx, `SELECT lang FROM users WHERE id = $1`, n.UserID).Scan(&lang)
		name := names[n.PetID]
		if n.OwnedPetID != nil {
			// "¿Es Rocky?": el nombre es el de la mascota propia, no el del reporte encontrado.
			_ = a.DB.QueryRow(ctx, `SELECT name FROM owned_pets WHERE id = $1`, *n.OwnedPetID).Scan(&name)
		}
		title, body := pushText(n.Kind, lang, name)
		channel := channelUpdates
		if alertKinds[n.Kind] {
			channel = channelAngel
		}
		for _, token := range a.deviceTokens(ctx, n.UserID) {
			messages = append(messages, providers.PushMessage{
				Token: token, Title: title, Body: body, URL: notificationURL(n),
				Channel: channel, Silent: domain.IsQuietTime(prefs, a.now()),
			})
		}
	}
	if len(messages) > 0 {
		if err := a.Push.Send(ctx, messages); err != nil {
			a.Log.Error("enviar push", "count", len(messages), "err", err)
			return
		}
		ids := make([]string, len(list))
		for i, n := range list {
			ids[i] = n.ID
		}
		_, _ = a.DB.Exec(ctx, `UPDATE notifications SET pushed = true WHERE id = ANY($1)`, ids)
	}
}

func (a *App) deviceTokens(ctx context.Context, userID string) []string {
	rows, _ := a.DB.Query(ctx, `SELECT token FROM devices WHERE user_id = $1`, userID)
	tokens, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil
	}
	return tokens
}

// notificationURL replica src/features/notifications.ts: las alertas abren su pantalla.
func notificationURL(n Notification) string {
	if alertKinds[n.Kind] {
		return "/alerta/angel/" + n.PetID
	}
	return "/pet/" + n.PetID
}

var pushTexts = map[string]map[string][2]string{
	"es": {
		"angel_alert":    {"🚨 Alerta Ángel", "Una mascota se perdió cerca de ti: {name}. Ayuda a encontrarla."},
		"life_circle":    {"🚨 Alerta Ángel: la búsqueda llegó a tu zona", "La zona de búsqueda de {name} creció y ya cubre tu barrio. Ayuda a encontrarla."},
		"sighting":       {"Nuevo avistamiento", "Alguien vio a {name}"},
		"case_closed":    {"Reporte cerrado: ¡final feliz!", "{name} ya está en casa"},
		"possible_match": {"Posible coincidencia", "Un reporte nuevo podría ser {name}"},
		"owned_match":    {"¿Es {name}?", "Alguien encontró una mascota parecida a {name} cerca de tu zona. Revisa las fotos."},
		"thanked":        {"¡Una familia te agradeció!", "La familia de {name} dice que fuiste clave en el reencuentro. Ganaste «Ángel de patas»."},
	},
	"en": {
		"angel_alert":    {"🚨 Angel Alert", "A pet went missing near you: {name}. Help find them."},
		"life_circle":    {"🚨 Angel Alert: the search reached your area", "{name}'s search area grew and now covers your neighborhood. Help find them."},
		"sighting":       {"New sighting", "Someone saw {name}"},
		"case_closed":    {"Case closed: happy ending!", "{name} is back home"},
		"possible_match": {"Possible match", "A new report could be {name}"},
		"owned_match":    {"Is it {name}?", "Someone found a pet that looks like {name} near your area. Check the photos."},
		"thanked":        {"A family thanked you!", "{name}'s family says you were key to the reunion. You earned “Paw angel”."},
	},
}

var unnamed = map[string]string{"es": "Sin nombre", "en": "No name"}

func pushText(kind, lang, name string) (string, string) {
	if _, ok := pushTexts[lang]; !ok {
		lang = "es"
	}
	if name == "" {
		name = unnamed[lang]
	}
	t, ok := pushTexts[lang][kind]
	if !ok {
		t = [2]string{"PawFound", "{name}"}
	}
	return strings.ReplaceAll(t[0], "{name}", name), strings.ReplaceAll(t[1], "{name}", name)
}

// alertAudience envía la Alerta Ángel a las zonas que quedaron dentro del círculo de vida:
// una sola por persona y caso, máximo 5 por persona al día, solo con alertas activadas
// (alerts.ts). El índice único de notifications evita duplicados aunque dos jobs corran a la vez.
func (a *App) alertAudience(ctx context.Context, row petRow, kind string) (int, error) {
	if row.Kind != "lost" || row.State != "active" || row.ModerationRemoved {
		return 0, nil
	}
	now := a.now()
	radius := domain.CurrentRadius(row.domainCase(), now)
	rows, _ := a.DB.Query(ctx, `
		SELECT z.user_id FROM alert_zones z JOIN users u ON u.id = z.user_id
		WHERE z.user_id IS DISTINCT FROM $1 AND u.suspended_at IS NULL
		  AND coalesce((u.notification_prefs->>'angelAlerts')::boolean, true)
		  AND ST_DWithin(z.location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
		  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = z.user_id AND n.pet_id = $5 AND n.kind IN ('angel_alert', 'life_circle'))
		  AND (SELECT count(*) FROM notifications n WHERE n.user_id = z.user_id AND n.kind IN ('angel_alert', 'life_circle') AND n.at > $6) < $7`,
		deref(row.OwnerID), row.Lat, row.Lng, radius, row.ID, now.Add(-24*time.Hour), domain.MaxAlertsPerDay)
	audience, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	a.notify(ctx, audience, kind, row.ID, nil)
	return len(audience), nil
}

// RunAlertJob es el job periódico: a medida que el círculo de vida crece, la Alerta Ángel
// llega a los celulares que van quedando dentro. Caso por caso, para que lo recién avisado
// cuente para el límite diario del siguiente. Devuelve cuántas alertas envió.
func (a *App) RunAlertJob(ctx context.Context) (int, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+petCols+` FROM pets WHERE kind = 'lost' AND state = 'active' AND NOT moderation_removed ORDER BY created_at`)
	pets, err := pgx.CollectRows(rows, pgx.RowToStructByName[petRow])
	if err != nil {
		return 0, err
	}
	total := 0
	for _, p := range pets {
		n, err := a.alertAudience(ctx, p, "life_circle")
		if err != nil {
			return total, err
		}
		total += n
	}
	return total, nil
}

// notifyOwnedMatches: un reporte de mascota encontrada que se parece a una de "Mis mascotas"
// le pregunta a su familia "¿es la tuya?" (domain.MatchOwned). Solo familias con zona de
// alertas (es la única ubicación que tenemos, con consentimiento) y con "encontradas cerca"
// activado; si la mascota ya tiene un reporte de pérdida activo, ese caso ya recibe la
// coincidencia normal.
func (a *App) notifyOwnedMatches(ctx context.Context, row petRow) error {
	matches, err := a.ownedMatchesForFound(ctx, row)
	if err != nil {
		return err
	}
	for _, m := range matches {
		id := m.ID
		a.notify(ctx, []string{m.OwnerID}, "owned_match", row.ID, &id)
	}
	return nil
}

type ownedCandidate struct {
	ID      string  `db:"id"`
	OwnerID string  `db:"owner_id"`
	Species string  `db:"species"`
	Sex     string  `db:"sex"`
	Size    string  `db:"size"`
	Breed   *string `db:"breed"`
	Color   *string `db:"color"`
	Lat     float64 `db:"lat"`
	Lng     float64 `db:"lng"`
	Prefs   []byte  `db:"notification_prefs"`
}

func (c ownedCandidate) domainPet() domain.OwnedPet {
	return domain.OwnedPet{
		ID: c.ID, OwnerID: c.OwnerID, Species: c.Species, Sex: c.Sex, Size: c.Size, Breed: deref(c.Breed),
		Color: deref(c.Color), Zone: geo.Point{Lat: c.Lat, Lng: c.Lng},
	}
}

func (a *App) ownedMatchesForFound(ctx context.Context, row petRow) ([]domain.OwnedPet, error) {
	rows, _ := a.DB.Query(ctx, `
		SELECT o.id, o.owner_id, o.species, o.sex, o.size, o.breed, o.color, z.lat, z.lng, u.notification_prefs
		FROM owned_pets o JOIN alert_zones z ON z.user_id = o.owner_id JOIN users u ON u.id = o.owner_id
		WHERE o.species = $1 AND o.owner_id IS DISTINCT FROM $2 AND u.suspended_at IS NULL
		  AND ST_DWithin(z.location, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5)
		  AND NOT EXISTS (SELECT 1 FROM pets p WHERE p.id = o.last_case_id AND p.state = 'active' AND p.kind = 'lost')`,
		row.Species, deref(row.OwnerID), row.Lat, row.Lng, domain.OwnedMatchRadius(row.Species))
	candidates, err := pgx.CollectRows(rows, pgx.RowToStructByName[ownedCandidate])
	if err != nil {
		return nil, err
	}
	found := row.domainCase()
	var out []domain.OwnedPet
	for _, c := range candidates {
		prefs := domain.DefaultNotificationPrefs()
		_ = json.Unmarshal(c.Prefs, &prefs)
		if !prefs.FoundNearby {
			continue
		}
		if _, ok := domain.MatchOwned(found, c.domainPet()); ok {
			out = append(out, c.domainPet())
		}
	}
	return out, nil
}

// Notifications de la cuenta, las más recientes primero.
func (a *App) Notifications(ctx context.Context, ac Actor) ([]Notification, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, user_id, kind, pet_id, owned_pet_id, at, read FROM notifications WHERE user_id = $1 ORDER BY at DESC LIMIT 100`, ac.ID)
	return pgx.CollectRows(rows, pgx.RowToStructByName[Notification])
}

// MarkNotificationRead marca una (solo propia).
func (a *App) MarkNotificationRead(ctx context.Context, ac Actor, id string) error {
	_, err := a.DB.Exec(ctx, `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`, id, ac.ID)
	return err
}

// MarkAllNotificationsRead marca toda la bandeja.
func (a *App) MarkAllNotificationsRead(ctx context.Context, ac Actor) error {
	_, err := a.DB.Exec(ctx, `UPDATE notifications SET read = true WHERE user_id = $1 AND NOT read`, ac.ID)
	return err
}
