package app

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
)

// ReportInput es el formulario de reporte (NewReportInput en la app). Photos son ids de
// media ya subidos con POST /v1/media.
type ReportInput struct {
	Kind              string    `json:"kind"`
	Name              string    `json:"name"`
	Species           string    `json:"species"`
	Breed             string    `json:"breed"`
	Sex               string    `json:"sex"`
	Age               string    `json:"age"`
	Size              string    `json:"size"`
	Color             string    `json:"color"`
	Collar            string    `json:"collar"`
	Marks             string    `json:"marks"`
	Description       string    `json:"description"`
	Photos            []string  `json:"photos"`
	TraumaticEvent    bool      `json:"traumaticEvent"`
	ShyOrIndoor       bool      `json:"shyOrIndoor"`
	LastSeenAt        time.Time `json:"lastSeenAt"`
	Location          geo.Point `json:"location"`
	Zone              string    `json:"zone"`
	FoundSearchRadius int       `json:"foundSearchRadius"`
	Reward            bool      `json:"reward"`
	FoundCondition    string    `json:"foundCondition"`
	FoundCustody      string    `json:"foundCustody"`
	OwnedPetID        string    `json:"ownedPetId"`
}

func validPoint(p geo.Point) bool {
	return p.Lat >= -90 && p.Lat <= 90 && p.Lng >= -180 && p.Lng <= 180 && !(p.Lat == 0 && p.Lng == 0)
}

// validMoment: no en el futuro (5 min de tolerancia de reloj) ni de hace más de 90 días.
func (a *App) validMoment(t time.Time) bool {
	now := a.now()
	return !t.IsZero() && !t.After(now.Add(5*time.Minute)) && now.Sub(t) <= 90*24*time.Hour
}

func (in ReportInput) validate(a *App) error {
	switch {
	case !domain.CaseKinds[in.Kind]:
		return invalid("kind")
	case !domain.Species[in.Species]:
		return invalid("species")
	case !domain.Sexes[in.Sex]:
		return invalid("sex")
	case !domain.Ages[in.Age]:
		return invalid("age")
	case !domain.Sizes[in.Size]:
		return invalid("size")
	case !a.validMoment(in.LastSeenAt):
		return invalid("lastSeenAt")
	case !validPoint(in.Location):
		return invalid("location")
	case domain.Clean(in.Zone, 80) == "":
		return invalid("zone")
	case len([]rune(in.Description)) > domain.DescriptionMax:
		return invalid("description")
	case len(in.Photos) > domain.MaxPhotos:
		return invalid("photos")
	case in.Kind == "lost" && domain.Clean(in.Name, 40) == "":
		return invalid("name")
	case in.Kind == "found" && in.FoundCondition != "" && !domain.Conditions[in.FoundCondition]:
		return invalid("foundCondition")
	case in.Kind == "found" && in.FoundCustody != "" && !domain.Custodies[in.FoundCustody]:
		return invalid("foundCustody")
	}
	return nil
}

// CreateReport publica un reporte, crea su grupo de caso y avisa a quien corresponde.
func (a *App) CreateReport(ctx context.Context, ac Actor, in ReportInput) (Pet, error) {
	if err := requireVerified(ac); err != nil {
		return Pet{}, err
	}
	if err := in.validate(a); err != nil {
		return Pet{}, err
	}
	allowed, retry, err := a.allowance(ctx, ac.ID)
	if err != nil {
		return Pet{}, err
	}
	if !allowed {
		return Pet{}, rateLimited(retry)
	}
	photos, err := a.ownMedia(ctx, ac.ID, "pet", in.Photos)
	if err != nil {
		return Pet{}, err
	}
	approx := geo.Approximate(in.Location)
	lost := in.Kind == "lost"
	var radius *int
	if !lost && domain.FoundRadius[in.FoundSearchRadius] {
		radius = ptr(in.FoundSearchRadius)
	}
	var condition, custody *string
	if !lost {
		condition, custody = optional(in.FoundCondition), optional(in.FoundCustody)
	}
	petID, groupID, now := domain.NewID("pet"), domain.NewID("grp"), a.now()
	var ownedPetID *string
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if in.OwnedPetID != "" {
			tag, err := tx.Exec(ctx, `UPDATE owned_pets SET last_case_id = $3 WHERE id = $1 AND owner_id = $2`, in.OwnedPetID, ac.ID, petID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 1 {
				ownedPetID = &in.OwnedPetID
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO pets (id, kind, name, species, breed, sex, age, size, color, collar, marks, description,
			photos, traumatic_event, shy_or_indoor, last_seen_at, lat, lng, zone, found_search_radius, reward, found_condition,
			found_custody, owner_id, owner_short_name, owned_pet_id, group_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
			petID, in.Kind, optional(domain.Clean(in.Name, 40)), in.Species, optional(domain.Clean(in.Breed, 60)), in.Sex, in.Age, in.Size,
			optional(domain.Clean(in.Color, 60)), optional(domain.Clean(in.Collar, 80)), optional(domain.Clean(in.Marks, 200)),
			domain.Clean(in.Description, domain.DescriptionMax), photos, lost && in.TraumaticEvent, in.ShyOrIndoor, in.LastSeenAt.UTC(),
			approx.Lat, approx.Lng, domain.Clean(in.Zone, 80), radius, lost && in.Reward, condition, custody, ac.ID, ac.ShortName(),
			ownedPetID, groupID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO threads (id, kind, pet_id, created_at) VALUES ($1, 'group', $2, $3)`, groupID, petID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO thread_members (thread_id, user_id, read_at, joined_at) VALUES ($1, $2, $3, $3)`, groupID, ac.ID, now); err != nil {
			return err
		}
		return insertSystemMessage(ctx, tx, groupID, ac, "created", now)
	})
	if err != nil {
		return Pet{}, err
	}
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return Pet{}, err
	}
	a.afterReport(ctx, row)
	return a.toPet(ctx, row, ac.ID)
}

// afterReport hace los avisos que no deben tumbar la publicación si fallan.
func (a *App) afterReport(ctx context.Context, row petRow) {
	steps := []func() error{
		func() error { return a.notifyPossibleMatches(ctx, row) },
		func() error { return a.flagDuplicatePhotos(ctx, row) },
	}
	if row.Kind == "lost" {
		// Alerta Ángel: los celulares dentro del círculo de vida inicial (issue #45).
		steps = append(steps, func() error { _, err := a.alertAudience(ctx, row, "angel_alert"); return err })
	} else {
		steps = append(steps, func() error { return a.notifyOwnedMatches(ctx, row) })
	}
	for _, step := range steps {
		if err := step(); err != nil {
			a.Log.Error("aviso posterior al reporte falló", "pet", row.ID, "err", err)
		}
	}
}

// ownMedia valida que las fotos existan, sean de la cuenta y del propósito correcto.
func (a *App) ownMedia(ctx context.Context, ownerID, purpose string, refs []string) ([]string, error) {
	ids := make([]string, 0, len(refs))
	for _, ref := range refs {
		id := mediaIDFromRef(ref)
		var ok bool
		if err := a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM media WHERE id = $1 AND owner_id = $2 AND purpose = $3)`,
			id, ownerID, purpose).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			return nil, invalid("photos")
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// flagDuplicatePhotos: una foto casi idéntica a la de una publicación de otra cuenta es la
// señal típica de estafa ("tengo a tu perro, paga"). No oculta nada: abre un reporte para
// que moderación lo revise.
func (a *App) flagDuplicatePhotos(ctx context.Context, row petRow) error {
	for _, id := range row.Photos {
		var other string
		err := a.DB.QueryRow(ctx, `SELECT o.id FROM media m JOIN media o ON o.purpose = 'pet' AND o.owner_id IS DISTINCT FROM m.owner_id
			AND bit_count((o.phash # m.phash)::bit(64)) <= $2 WHERE m.id = $1 LIMIT 1`, id, media.NearDuplicate).Scan(&other)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		_, err = a.DB.Exec(ctx, `INSERT INTO reports (id, reporter_id, target_kind, reported_user_id, pet_id, reason, note, created_at)
			VALUES ($1, NULL, 'pet', $2, $3, 'scam', $4, $5)`, domain.NewID("rep"), row.OwnerID, row.ID,
			"Automático: una foto es casi idéntica a otra subida por una cuenta distinta ("+other+").", a.now())
		return err
	}
	return nil
}

func (a *App) petRow(ctx context.Context, id string) (petRow, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+petCols+` FROM pets WHERE id = $1`, id)
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[petRow])
	return row, notFoundIfNoRows(err)
}

// toPet arma la respuesta. La familia (dueña del caso) recibe además quién reportó cada
// avistamiento y a quién agradeció; el resto no.
func (a *App) toPet(ctx context.Context, row petRow, viewerID string) (Pet, error) {
	pets, err := a.toPets(ctx, []petRow{row}, viewerID)
	if err != nil {
		return Pet{}, err
	}
	pet := pets[0]
	owner, err := a.summaries(ctx, []string{pet.OwnerID})
	if err != nil {
		return Pet{}, err
	}
	if s, ok := owner[pet.OwnerID]; ok {
		pet.Owner = &s
	}
	return pet, nil
}

func (a *App) toPets(ctx context.Context, rows []petRow, viewerID string) ([]Pet, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	sightings, err := a.sightingsFor(ctx, ids)
	if err != nil {
		return nil, err
	}
	helpers := map[string][]string{}
	hr, _ := a.DB.Query(ctx, `SELECT pet_id, user_id FROM pet_helpers WHERE pet_id = ANY($1)`, ids)
	pairs, err := pgx.CollectRows(hr, pgx.RowToStructByPos[struct{ Pet, User string }])
	if err != nil {
		return nil, err
	}
	for _, p := range pairs {
		helpers[p.Pet] = append(helpers[p.Pet], p.User)
	}
	now := a.now()
	out := make([]Pet, len(rows))
	for i, r := range rows {
		isOwner := r.OwnerID != nil && *r.OwnerID == viewerID
		list := sightings[r.ID]
		if !isOwner {
			for j := range list {
				list[j].AuthorID = ""
			}
		}
		if list == nil {
			list = []Sighting{}
		}
		p := Pet{
			ID: r.ID, Kind: r.Kind, State: r.State, Name: r.Name, Species: r.Species, Breed: r.Breed, Sex: r.Sex, Age: r.Age,
			Size: r.Size, Color: r.Color, Collar: r.Collar, Marks: r.Marks, Description: r.Description, Photos: a.mediaURLs(r.Photos),
			TraumaticEvent: r.TraumaticEvent, ShyOrIndoor: r.ShyOrIndoor, LastSeenAt: r.LastSeenAt, Location: geo.Point{Lat: r.Lat, Lng: r.Lng},
			Zone: r.Zone, FoundSearchRadius: r.FoundSearchRadius, Reward: r.Reward, FoundCondition: r.FoundCondition,
			FoundCustody: r.FoundCustody, OwnerID: deref(r.OwnerID), OwnerShortName: r.OwnerShortName, CreatedAt: r.CreatedAt,
			ReunitedAt: r.ReunitedAt, Sightings: list, ShareCount: r.ShareCount, GroupID: r.GroupID,
			ModerationRemoved: r.ModerationRemoved, CurrentRadius: domain.CurrentRadius(r.domainCase(), now),
		}
		// "Ángel de patas" es público en el perfil de quien lo recibe, pero la lista por caso
		// solo la necesita la familia.
		if isOwner {
			p.HelperIDs = helpers[r.ID]
		}
		out[i] = p
	}
	return out, nil
}

func (a *App) sightingsFor(ctx context.Context, petIDs []string) (map[string][]Sighting, error) {
	rows, _ := a.DB.Query(ctx, `SELECT pet_id, id, at, lat, lng, zone, note, coalesce(author_id, ''), author_short_name
		FROM sightings WHERE pet_id = ANY($1) ORDER BY at DESC`, petIDs)
	out := map[string][]Sighting{}
	var petID string
	var s Sighting
	_, err := pgx.ForEachRow(rows, []any{&petID, &s.ID, &s.At, &s.Location.Lat, &s.Location.Lng, &s.Zone, &s.Note, &s.AuthorID, &s.AuthorShortName}, func() error {
		out[petID] = append(out[petID], s)
		return nil
	})
	return out, err
}

// GetPet devuelve un caso. Los retirados por moderación solo los ve su autor.
func (a *App) GetPet(ctx context.Context, viewerID, id string) (Pet, error) {
	row, err := a.petRow(ctx, id)
	if err != nil {
		return Pet{}, err
	}
	if row.ModerationRemoved && deref(row.OwnerID) != viewerID {
		return Pet{}, ErrNotFound
	}
	return a.toPet(ctx, row, viewerID)
}

// NearbyQuery filtra la búsqueda geoespacial (issue #34).
type NearbyQuery struct {
	Center  geo.Point
	Radius  int
	Kind    string
	Species string
	Limit   int
}

// Nearby busca casos activos dentro del radio, ordenados por cercanía.
func (a *App) Nearby(ctx context.Context, viewerID string, q NearbyQuery) ([]Pet, error) {
	if !validPoint(q.Center) {
		return nil, invalid("center")
	}
	if q.Radius <= 0 || q.Radius > 50_000 {
		q.Radius = 20_000
	}
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 200
	}
	if q.Kind != "" && !domain.CaseKinds[q.Kind] {
		return nil, invalid("kind")
	}
	if q.Species != "" && !domain.Species[q.Species] {
		return nil, invalid("species")
	}
	rows, _ := a.DB.Query(ctx, `SELECT `+petCols+` FROM pets
		WHERE state = 'active' AND NOT moderation_removed
		  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
		  AND ($4 = '' OR kind = $4) AND ($5 = '' OR species = $5)
		ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
		LIMIT $6`, q.Center.Lat, q.Center.Lng, q.Radius, q.Kind, q.Species, q.Limit)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[petRow])
	if err != nil {
		return nil, err
	}
	return a.toPets(ctx, list, viewerID)
}

// MyPets devuelve los reportes propios (cualquier estado).
func (a *App) MyPets(ctx context.Context, ac Actor) ([]Pet, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+petCols+` FROM pets WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100`, ac.ID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[petRow])
	if err != nil {
		return nil, err
	}
	return a.toPets(ctx, list, ac.ID)
}

// SightingInput es "La vi".
type SightingInput struct {
	At       time.Time `json:"at"`
	Location geo.Point `json:"location"`
	Zone     string    `json:"zone"`
	Note     string    `json:"note"`
}

// AddSighting registra un avistamiento. Solo uno más reciente mueve el último punto conocido
// (y reinicia el círculo de vida).
func (a *App) AddSighting(ctx context.Context, ac Actor, petID string, in SightingInput) (Pet, error) {
	if err := requireVerified(ac); err != nil {
		return Pet{}, err
	}
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return Pet{}, err
	}
	if row.State != "active" || row.ModerationRemoved {
		return Pet{}, ErrNotAllowed
	}
	if !a.validMoment(in.At) {
		return Pet{}, invalid("at")
	}
	if !validPoint(in.Location) {
		return Pet{}, invalid("location")
	}
	zone := domain.Clean(in.Zone, 80)
	if zone == "" {
		return Pet{}, invalid("zone")
	}
	approx, now := geo.Approximate(in.Location), a.now()
	var message Message
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO sightings (id, pet_id, author_id, author_short_name, at, lat, lng, zone, note, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, domain.NewID("s"), petID, ac.ID, ac.ShortName(), in.At.UTC(),
			approx.Lat, approx.Lng, zone, optional(domain.Clean(in.Note, 200)), now); err != nil {
			return err
		}
		if in.At.After(row.LastSeenAt) {
			if _, err := tx.Exec(ctx, `UPDATE pets SET last_seen_at = $2, lat = $3, lng = $4, zone = $5 WHERE id = $1`,
				petID, in.At.UTC(), approx.Lat, approx.Lng, zone); err != nil {
				return err
			}
		}
		message = Message{ID: domain.NewID("m"), ThreadID: row.GroupID, AuthorID: ac.ID, AuthorShortName: ac.ShortName(), Text: zone, At: now, Kind: "sighting"}
		_, err := tx.Exec(ctx, `INSERT INTO messages (id, thread_id, author_id, author_short_name, kind, body, at) VALUES ($1, $2, $3, $4, 'sighting', $5, $6)`,
			message.ID, message.ThreadID, ac.ID, message.AuthorShortName, zone, now)
		return err
	})
	if err != nil {
		return Pet{}, err
	}
	a.publishMessage(ctx, message)
	if owner := deref(row.OwnerID); owner != "" && owner != ac.ID {
		a.notify(ctx, []string{owner}, "sighting", petID, nil)
	}
	return a.GetPet(ctx, ac.ID, petID)
}

// HelperCandidate es alguien a quien la familia puede agradecer al cerrar el caso.
type HelperCandidate struct {
	UserID  string      `json:"userId"`
	User    UserSummary `json:"user"`
	Reasons []string    `json:"reasons"`
}

// HelperCandidates: quienes reportaron un avistamiento, escribieron en el grupo o le
// escribieron a la familia por mensaje directo sobre este caso (selectors.ts).
func (a *App) HelperCandidates(ctx context.Context, ac Actor, petID string) ([]HelperCandidate, error) {
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return nil, err
	}
	if deref(row.OwnerID) != ac.ID {
		return nil, ErrNotAllowed
	}
	return a.helperCandidates(ctx, row)
}

func (a *App) helperCandidates(ctx context.Context, row petRow) ([]HelperCandidate, error) {
	rows, _ := a.DB.Query(ctx, `
		SELECT author_id, 'sighting' FROM sightings WHERE pet_id = $1 AND author_id IS NOT NULL
		UNION SELECT author_id, CASE WHEN kind = 'sighting' THEN 'sighting' ELSE 'group' END FROM messages
			WHERE thread_id = $2 AND kind <> 'system' AND author_id IS NOT NULL AND removed_at IS NULL
		UNION SELECT m.author_id, 'direct' FROM messages m JOIN threads t ON t.id = m.thread_id
			WHERE t.kind = 'dm' AND t.pet_id = $1 AND m.kind = 'text' AND m.author_id IS NOT NULL
			  AND EXISTS (SELECT 1 FROM thread_members tm WHERE tm.thread_id = t.id AND tm.user_id = $3)`,
		row.ID, row.GroupID, deref(row.OwnerID))
	pairs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[struct{ User, Reason string }])
	if err != nil {
		return nil, err
	}
	reasons := map[string]map[string]bool{}
	var ids []string
	for _, p := range pairs {
		if p.User == deref(row.OwnerID) {
			continue
		}
		if reasons[p.User] == nil {
			reasons[p.User] = map[string]bool{}
			ids = append(ids, p.User)
		}
		reasons[p.User][p.Reason] = true
	}
	users, err := a.summaries(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := []HelperCandidate{}
	for _, id := range ids {
		u, ok := users[id]
		if !ok {
			continue
		}
		c := HelperCandidate{UserID: id, User: u}
		for _, r := range []string{"sighting", "group", "direct"} {
			if reasons[id][r] {
				c.Reasons = append(c.Reasons, r)
			}
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if len(out[i].Reasons) != len(out[j].Reasons) {
			return len(out[i].Reasons) > len(out[j].Reasons)
		}
		return out[i].User.ShortName < out[j].User.ShortName
	})
	return out, nil
}

// Reunite cierra el caso con un reencuentro. La familia puede agradecer hasta 5 personas que
// de verdad participaron (la insignia "Ángel de patas" no se puede regalar). Avisa también a
// quienes compartieron el caso, para que quiten el afiche o la historia de sus redes.
func (a *App) Reunite(ctx context.Context, ac Actor, petID string, helperIDs []string) (Pet, error) {
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return Pet{}, err
	}
	if deref(row.OwnerID) != ac.ID || row.State != "active" {
		return Pet{}, ErrNotAllowed
	}
	candidates, err := a.helperCandidates(ctx, row)
	if err != nil {
		return Pet{}, err
	}
	allowed := map[string]bool{}
	for _, c := range candidates {
		allowed[c.UserID] = true
	}
	var helpers []string
	seen := map[string]bool{}
	for _, id := range helperIDs {
		if allowed[id] && !seen[id] && len(helpers) < domain.MaxHelpers {
			helpers = append(helpers, id)
			seen[id] = true
		}
	}
	now := a.now()
	var closedFor, hidden []string
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE pets SET state = 'reunited', reunited_at = $2 WHERE id = $1`, petID, now); err != nil {
			return err
		}
		for _, id := range helpers {
			if _, err := tx.Exec(ctx, `INSERT INTO pet_helpers (pet_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, petID, id); err != nil {
				return err
			}
		}
		// Los chats del caso no se cierran solos: cada persona decide si archivarlos o eliminarlos.
		// Las historias del caso sí se quitan: ya no hay a quién buscar.
		if _, err := tx.Exec(ctx, `UPDATE stories SET removed_at = $2 WHERE pet_id = $1 AND removed_at IS NULL`, petID, now); err != nil {
			return err
		}
		if hidden, err = hideCaseLocations(ctx, tx, petID, now); err != nil {
			return err
		}
		if err := insertSystemMessage(ctx, tx, row.GroupID, ac, "reunited", now); err != nil {
			return err
		}
		recipients, _ := tx.Query(ctx, `SELECT user_id FROM thread_members WHERE thread_id = $1
			UNION SELECT user_id FROM pet_shares WHERE pet_id = $2`, row.GroupID, petID)
		ids, err := pgx.CollectRows(recipients, pgx.RowTo[string])
		for _, id := range ids {
			if id != ac.ID && !seen[id] {
				closedFor = append(closedFor, id)
			}
		}
		return err
	})
	if err != nil {
		return Pet{}, err
	}
	a.publishMessages(ctx, hidden)
	a.notify(ctx, helpers, "thanked", petID, nil)
	a.notify(ctx, closedFor, "case_closed", petID, nil)
	return a.GetPet(ctx, ac.ID, petID)
}

// Share cuenta una compartida; la insignia "Megáfono" cuenta casos distintos por cuenta.
func (a *App) Share(ctx context.Context, viewerID, petID string) error {
	tag, err := a.DB.Exec(ctx, `UPDATE pets SET share_count = share_count + 1 WHERE id = $1`, petID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if viewerID != "" {
		_, err = a.DB.Exec(ctx, `INSERT INTO pet_shares (pet_id, user_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, petID, viewerID, a.now())
	}
	return err
}

// Withdraw: la familia retira su reporte. Se archiva, no se borra (política de retención).
func (a *App) Withdraw(ctx context.Context, ac Actor, petID string) error {
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return err
	}
	if deref(row.OwnerID) != ac.ID {
		return ErrNotAllowed
	}
	if row.State != "active" {
		return nil
	}
	now := a.now()
	var hidden []string
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE pets SET state = 'archived' WHERE id = $1`, petID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE stories SET removed_at = $2 WHERE pet_id = $1 AND removed_at IS NULL`, petID, now); err != nil {
			return err
		}
		hidden, err = hideCaseLocations(ctx, tx, petID, now)
		return err
	})
	if err == nil {
		a.publishMessages(ctx, hidden)
	}
	return err
}

// PossibleMatches para la familia de un caso (lost ↔ found).
func (a *App) PossibleMatches(ctx context.Context, ac Actor, petID string) ([]Pet, error) {
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return nil, err
	}
	if deref(row.OwnerID) != ac.ID {
		return nil, ErrNotAllowed
	}
	matches, err := a.matchesFor(ctx, row)
	if err != nil {
		return nil, err
	}
	return a.toPets(ctx, matches, ac.ID)
}

// matchesFor busca candidatos del tipo opuesto a menos de 10 km y aplica la regla del dominio.
func (a *App) matchesFor(ctx context.Context, row petRow) ([]petRow, error) {
	opposite := "lost"
	if row.Kind == "lost" {
		opposite = "found"
	}
	rows, _ := a.DB.Query(ctx, `SELECT `+petCols+` FROM pets WHERE kind = $1 AND state = 'active' AND NOT moderation_removed
		AND id <> $2 AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 10000)`, opposite, row.ID, row.Lat, row.Lng)
	candidates, err := pgx.CollectRows(rows, pgx.RowToStructByName[petRow])
	if err != nil {
		return nil, err
	}
	byID := map[string]petRow{}
	cases := make([]domain.Case, len(candidates))
	for i, c := range candidates {
		byID[c.ID] = c
		cases[i] = c.domainCase()
	}
	var out []petRow
	for _, m := range domain.PossibleMatches(row.domainCase(), cases, a.now(), 5) {
		out = append(out, byID[m.Case.ID])
	}
	return out, nil
}

func (a *App) notifyPossibleMatches(ctx context.Context, row petRow) error {
	matches, err := a.matchesFor(ctx, row)
	if err != nil {
		return err
	}
	var owners []string
	for _, m := range matches {
		if id := deref(m.OwnerID); id != "" && id != deref(row.OwnerID) {
			owners = append(owners, id)
		}
	}
	a.notify(ctx, owners, "possible_match", row.ID, nil)
	return nil
}

func insertSystemMessage(ctx context.Context, tx pgx.Tx, threadID string, ac Actor, body string, at time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO messages (id, thread_id, author_id, author_short_name, kind, body, at) VALUES ($1, $2, $3, $4, 'system', $5, $6)`,
		domain.NewID("m"), threadID, ac.ID, ac.ShortName(), body, at)
	return err
}

// summaries trae lo público mínimo de varias cuentas.
func (a *App) summaries(ctx context.Context, ids []string) (map[string]UserSummary, error) {
	out := map[string]UserSummary{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, _ := a.DB.Query(ctx, `SELECT id, name, avatar, email_verified, created_at, lang FROM users WHERE id = ANY($1)`, ids)
	var s UserSummary
	var name string
	_, err := pgx.ForEachRow(rows, []any{&s.ID, &name, &s.Avatar, &s.Verified, &s.CreatedAt, &s.Lang}, func() error {
		s.ShortName = shortName(name)
		out[s.ID] = s
		return nil
	})
	return out, err
}
