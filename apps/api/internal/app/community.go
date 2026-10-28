package app

import (
	"context"
	"errors"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
)

// ProfilePet es una mascota propia tal como se muestra en el perfil público.
type ProfilePet struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Species string  `json:"species"`
	Photo   *string `json:"photo,omitempty"`
}

// PublicProfile: ningún perfil es oculto. Días en PawFound, insignias, mascotas y "me gusta".
type PublicProfile struct {
	User       PublicUser             `json:"user"`
	MemberDays int                    `json:"memberDays"`
	Likes      int                    `json:"likes"`
	LikedByMe  bool                   `json:"likedByMe"`
	Badges     []domain.BadgeProgress `json:"badges"`
	Pets       []ProfilePet           `json:"pets"`
	Reported   int                    `json:"reported"`
	Found      int                    `json:"found"`
}

// Profile arma el perfil público de una cuenta.
func (a *App) Profile(ctx context.Context, viewerID, userID string) (PublicProfile, error) {
	u, err := a.loadUser(ctx, a.DB, userID)
	if err != nil {
		return PublicProfile{}, err
	}
	facts, err := a.badgeFacts(ctx, userID, u.PhoneVerified)
	if err != nil {
		return PublicProfile{}, err
	}
	p := PublicProfile{User: publicOf(u), MemberDays: domain.MemberDays(u.CreatedAt, a.now()), Badges: domain.Badges(facts), Pets: []ProfilePet{}}
	if err := a.DB.QueryRow(ctx, `SELECT count(*), coalesce(bool_or(liker_id = $2), false) FROM profile_likes WHERE target_id = $1`,
		userID, viewerID).Scan(&p.Likes, &p.LikedByMe); err != nil {
		return PublicProfile{}, err
	}
	if err := a.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE kind = 'lost'), count(*) FILTER (WHERE kind = 'found')
		FROM pets WHERE owner_id = $1 AND NOT moderation_removed`, userID).Scan(&p.Reported, &p.Found); err != nil {
		return PublicProfile{}, err
	}
	rows, _ := a.DB.Query(ctx, `SELECT id, name, species, photos FROM owned_pets WHERE owner_id = $1 ORDER BY created_at`, userID)
	var pet ProfilePet
	var photos []string
	_, err = pgx.ForEachRow(rows, []any{&pet.ID, &pet.Name, &pet.Species, &photos}, func() error {
		item := pet
		if len(photos) > 0 {
			item.Photo = ptr(a.mediaURL(photos[0]))
		}
		p.Pets = append(p.Pets, item)
		return nil
	})
	return p, err
}

// badgeFacts cuenta los hechos reales de cada insignia (selectors.ts → badgeFacts). Los
// reportes retirados por moderación no cuentan.
func (a *App) badgeFacts(ctx context.Context, userID string, verified bool) (map[string]int, error) {
	f := map[string]int{}
	if verified {
		f["verified"] = 1
	}
	var reporter, rescuer, eyes, angel, reunion, spreader, community int
	err := a.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM pets WHERE owner_id = $1 AND NOT moderation_removed),
		(SELECT count(*) FROM pets WHERE owner_id = $1 AND kind = 'found' AND NOT moderation_removed),
		(SELECT count(*) FROM sightings s JOIN pets p ON p.id = s.pet_id WHERE s.author_id = $1 AND p.owner_id IS DISTINCT FROM $1 AND NOT p.moderation_removed),
		(SELECT count(*) FROM pet_helpers h JOIN pets p ON p.id = h.pet_id WHERE h.user_id = $1 AND NOT p.moderation_removed),
		(SELECT count(*) FROM pets WHERE owner_id = $1 AND state = 'reunited' AND NOT moderation_removed),
		(SELECT count(*) FROM pet_shares WHERE user_id = $1),
		(SELECT count(*) FROM thread_members tm JOIN threads t ON t.id = tm.thread_id WHERE tm.user_id = $1 AND t.kind = 'group'
			AND NOT EXISTS (SELECT 1 FROM pets p WHERE p.group_id = t.id AND p.owner_id = $1))`, userID).
		Scan(&reporter, &rescuer, &eyes, &angel, &reunion, &spreader, &community)
	f["reporter"], f["rescuer"], f["eyes"], f["paw_angel"], f["reunion"], f["spreader"], f["community"] = reporter, rescuer, eyes, angel, reunion, spreader, community
	return f, err
}

// ToggleLike da o quita un "me gusta" de perfil: solo cuentas verificadas, uno por persona
// y nunca a uno mismo, para que el contador refleje confianza real.
func (a *App) ToggleLike(ctx context.Context, ac Actor, targetID string) (bool, int, error) {
	if err := requireVerified(ac); err != nil {
		return false, 0, err
	}
	if targetID == ac.ID {
		return false, 0, ErrNotAllowed
	}
	if _, err := a.loadUser(ctx, a.DB, targetID); err != nil {
		return false, 0, err
	}
	tag, err := a.DB.Exec(ctx, `DELETE FROM profile_likes WHERE target_id = $1 AND liker_id = $2`, targetID, ac.ID)
	if err != nil {
		return false, 0, err
	}
	liked := tag.RowsAffected() == 0
	if liked {
		if _, err := a.DB.Exec(ctx, `INSERT INTO profile_likes (target_id, liker_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, targetID, ac.ID, a.now()); err != nil {
			return false, 0, err
		}
	}
	var count int
	err = a.DB.QueryRow(ctx, `SELECT count(*) FROM profile_likes WHERE target_id = $1`, targetID).Scan(&count)
	return liked, count, err
}

// UserReportInput: reportar a una persona (spam, groserías, estafa…). No hay bloqueos.
type UserReportInput struct {
	Reason    string `json:"reason"`
	ThreadID  string `json:"threadId"`
	MessageID string `json:"messageId"`
	Note      string `json:"note"`
}

// ReportUser deja el reporte en la cola de moderación con el mensaje como contexto. Reportar
// dos veces lo mismo no duplica.
func (a *App) ReportUser(ctx context.Context, ac Actor, targetID string, in UserReportInput) error {
	if targetID == ac.ID {
		return ErrNotAllowed
	}
	if !domain.Reasons[in.Reason] {
		return invalid("reason")
	}
	if _, err := a.loadUser(ctx, a.DB, targetID); err != nil {
		return err
	}
	kind := "user"
	var threadID, messageID *string
	if in.MessageID != "" {
		// El mensaje debe ser de la persona reportada y de un chat donde quien reporta está.
		var ok bool
		if err := a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM messages m JOIN thread_members tm ON tm.thread_id = m.thread_id AND tm.user_id = $3
			WHERE m.id = $1 AND m.author_id = $2)`, in.MessageID, targetID, ac.ID).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrNotAllowed
		}
		kind, messageID = "message", &in.MessageID
		_ = a.DB.QueryRow(ctx, `SELECT thread_id FROM messages WHERE id = $1`, in.MessageID).Scan(&threadID)
	}
	_, err := a.DB.Exec(ctx, `INSERT INTO reports (id, reporter_id, target_kind, reported_user_id, thread_id, message_id, reason, note, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`, domain.NewID("rep"), ac.ID, kind, targetID, threadID, messageID,
		in.Reason, optional(domain.Clean(in.Note, domain.ReportNoteMax)), a.now())
	return err
}

// ReportPet reporta una publicación (fraude, contenido inapropiado).
func (a *App) ReportPet(ctx context.Context, ac Actor, petID string, in UserReportInput) error {
	if in.Reason == "" {
		in.Reason = "other"
	}
	if !domain.Reasons[in.Reason] {
		return invalid("reason")
	}
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return err
	}
	if deref(row.OwnerID) == ac.ID {
		return ErrNotAllowed
	}
	_, err = a.DB.Exec(ctx, `INSERT INTO reports (id, reporter_id, target_kind, reported_user_id, pet_id, reason, note, created_at)
		VALUES ($1, $2, 'pet', $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`, domain.NewID("rep"), ac.ID, row.OwnerID, petID, in.Reason,
		optional(domain.Clean(in.Note, domain.ReportNoteMax)), a.now())
	return err
}

// --- Mis mascotas -----------------------------------------------------------

// OwnedPetInput es el formulario de "Mis mascotas".
type OwnedPetInput struct {
	Name        string   `json:"name"`
	Species     string   `json:"species"`
	Breed       string   `json:"breed"`
	Sex         string   `json:"sex"`
	Age         string   `json:"age"`
	Size        string   `json:"size"`
	Color       string   `json:"color"`
	Collar      string   `json:"collar"`
	Marks       string   `json:"marks"`
	Description string   `json:"description"`
	Photos      []string `json:"photos"`
	ShyOrIndoor bool     `json:"shyOrIndoor"`
}

func (in OwnedPetInput) validate() error {
	switch {
	case domain.Clean(in.Name, 40) == "":
		return invalid("name")
	case !domain.Species[in.Species]:
		return invalid("species")
	case !domain.Sexes[in.Sex]:
		return invalid("sex")
	case !domain.Ages[in.Age]:
		return invalid("age")
	case !domain.Sizes[in.Size]:
		return invalid("size")
	case len(in.Photos) > domain.MaxPhotos:
		return invalid("photos")
	case len([]rune(in.Description)) > domain.DescriptionMax:
		return invalid("description")
	}
	return nil
}

// OwnedPets lista los perfiles propios.
func (a *App) OwnedPets(ctx context.Context, ac Actor) ([]OwnedPet, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+ownedCols+` FROM owned_pets WHERE owner_id = $1 ORDER BY created_at`, ac.ID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[OwnedPet])
	for i := range list {
		list[i].Photos = a.mediaURLs(list[i].Photos)
	}
	return list, err
}

// SaveOwnedPet crea (id vacío) o actualiza un perfil propio. Máximo 10 por cuenta.
func (a *App) SaveOwnedPet(ctx context.Context, ac Actor, id string, in OwnedPetInput) (OwnedPet, error) {
	if err := in.validate(); err != nil {
		return OwnedPet{}, err
	}
	photos, err := a.ownMedia(ctx, ac.ID, "owned", in.Photos)
	if err != nil {
		return OwnedPet{}, err
	}
	args := []any{
		domain.Clean(in.Name, 40), in.Species, optional(domain.Clean(in.Breed, 60)), in.Sex, in.Age, in.Size,
		optional(domain.Clean(in.Color, 60)), optional(domain.Clean(in.Collar, 80)), optional(domain.Clean(in.Marks, 200)),
		domain.Clean(in.Description, domain.DescriptionMax), photos, in.ShyOrIndoor,
	}
	if id != "" {
		var owner string
		if err := a.DB.QueryRow(ctx, `SELECT owner_id FROM owned_pets WHERE id = $1`, id).Scan(&owner); err != nil {
			return OwnedPet{}, notFoundIfNoRows(err)
		}
		if owner != ac.ID {
			return OwnedPet{}, ErrNotAllowed
		}
		_, err := a.DB.Exec(ctx, `UPDATE owned_pets SET name = $2, species = $3, breed = $4, sex = $5, age = $6, size = $7, color = $8,
			collar = $9, marks = $10, description = $11, photos = $12, shy_or_indoor = $13 WHERE id = $1`, append([]any{id}, args...)...)
		if err != nil {
			return OwnedPet{}, err
		}
	} else {
		var count int
		if err := a.DB.QueryRow(ctx, `SELECT count(*) FROM owned_pets WHERE owner_id = $1`, ac.ID).Scan(&count); err != nil {
			return OwnedPet{}, err
		}
		if count >= domain.MaxOwnedPets {
			return OwnedPet{}, ErrNotAllowed
		}
		id = domain.NewID("own")
		_, err := a.DB.Exec(ctx, `INSERT INTO owned_pets (id, owner_id, name, species, breed, sex, age, size, color, collar, marks, description,
			photos, shy_or_indoor, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			append(append([]any{id, ac.ID}, args...), a.now())...)
		if err != nil {
			return OwnedPet{}, err
		}
	}
	rows, _ := a.DB.Query(ctx, `SELECT `+ownedCols+` FROM owned_pets WHERE id = $1`, id)
	pet, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[OwnedPet])
	pet.Photos = a.mediaURLs(pet.Photos)
	return pet, err
}

// DeleteOwnedPet borra un perfil propio (idempotente).
func (a *App) DeleteOwnedPet(ctx context.Context, ac Actor, id string) error {
	var owner string
	err := a.DB.QueryRow(ctx, `SELECT owner_id FROM owned_pets WHERE id = $1`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if owner != ac.ID {
		return ErrNotAllowed
	}
	_, err = a.DB.Exec(ctx, `DELETE FROM owned_pets WHERE id = $1`, id)
	return err
}

// OwnedMatch es un reporte de encontrada que se parece a una mascota propia.
type OwnedMatch struct {
	Pet      Pet     `json:"pet"`
	Distance float64 `json:"distance"`
	Score    float64 `json:"score"`
}

// OwnedMatches es la sección "¿La encontraron?" de cada mascota propia. Sin zona de alertas
// no hay con qué comparar la cercanía, y la app pide activarla.
func (a *App) OwnedMatches(ctx context.Context, ac Actor, ownedID string) ([]OwnedMatch, bool, error) {
	var c ownedCandidate
	err := a.DB.QueryRow(ctx, `SELECT o.id, o.owner_id, o.species, o.sex, o.size, o.breed, o.color FROM owned_pets o WHERE o.id = $1`, ownedID).
		Scan(&c.ID, &c.OwnerID, &c.Species, &c.Sex, &c.Size, &c.Breed, &c.Color)
	if err != nil {
		return nil, false, notFoundIfNoRows(err)
	}
	if c.OwnerID != ac.ID {
		return nil, false, ErrNotAllowed
	}
	err = a.DB.QueryRow(ctx, `SELECT lat, lng FROM alert_zones WHERE user_id = $1`, ac.ID).Scan(&c.Lat, &c.Lng)
	if errors.Is(err, pgx.ErrNoRows) {
		return []OwnedMatch{}, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	owned := c.domainPet()
	rows, _ := a.DB.Query(ctx, `SELECT `+petCols+` FROM pets WHERE kind = 'found' AND state = 'active' AND NOT moderation_removed
		AND species = $1 AND owner_id IS DISTINCT FROM $2 AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5)`,
		c.Species, ac.ID, c.Lat, c.Lng, domain.OwnedMatchRadius(c.Species))
	found, err := pgx.CollectRows(rows, pgx.RowToStructByName[petRow])
	if err != nil {
		return nil, false, err
	}
	type scored struct {
		row   petRow
		score float64
	}
	var hits []scored
	for _, f := range found {
		if score, ok := domain.MatchOwned(f.domainCase(), owned); ok {
			hits = append(hits, scored{f, score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	out := make([]OwnedMatch, 0, len(hits))
	for _, h := range hits {
		pet, err := a.toPet(ctx, h.row, ac.ID)
		if err != nil {
			return nil, false, err
		}
		out = append(out, OwnedMatch{Pet: pet, Score: h.score, Distance: geo.DistanceMeters(owned.Zone, pet.Location)})
	}
	return out, false, nil
}
