package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

// AdoptionUpdate es una novedad de la nueva familia: una foto y unas palabras de cómo está.
type AdoptionUpdate struct {
	ID         string    `json:"id"`
	AdoptionID string    `json:"adoptionId"`
	AuthorID   string    `json:"authorId"`
	Photo      *string   `json:"photo,omitempty"`
	Body       string    `json:"body"`
	At         time.Time `json:"at"`
}

// AdoptionUpdateInput: la foto (opcional) y el texto (opcional), pero no los dos vacíos.
type AdoptionUpdateInput struct {
	Photo string `json:"photo"`
	Body  string `json:"body"`
}

// ShelterSummary acompaña el perfil público de un refugio verificado: lo que tiene en adopción y
// cuántas adopciones logró en PawFamily.
type ShelterSummary struct {
	Name      string `json:"name"`
	Available int    `json:"available"`
	Adopted   int    `json:"adopted"`
}

// RunAdoptionTasks vence las solicitudes sin respuesta y le recuerda a la nueva familia contar cómo
// está la mascota a los 7 y 30 días de adoptarla.
func (a *App) RunAdoptionTasks(ctx context.Context) (expired, followups int, err error) {
	now := a.now()
	rows, _ := a.DB.Query(ctx, `UPDATE adoption_applications p SET status = 'expired', decided_at = $1
		FROM adoptions d WHERE d.id = p.adoption_id AND p.status = 'pending' AND p.created_at <= $2
		RETURNING p.applicant_id, d.name`, now, now.Add(-domain.ApplicationExpiry))
	type expiredRow struct {
		ApplicantID string `db:"applicant_id"`
		Name        string `db:"name"`
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[expiredRow])
	if err != nil {
		return 0, 0, err
	}
	for _, e := range list {
		a.pushAdoption(ctx, e.ApplicantID, "application_expired", e.Name, "/pawfamily/solicitudes")
	}

	rows, _ = a.DB.Query(ctx, `SELECT d.id, d.name, d.adopted_at, d.followup_days, p.applicant_id
		FROM adoptions d JOIN adoption_applications p ON p.adoption_id = d.id AND p.status = 'accepted'
		WHERE d.status = 'adopted' AND d.adopted_at IS NOT NULL AND NOT d.moderation_removed`)
	type adoptedRow struct {
		ID           string    `db:"id"`
		Name         string    `db:"name"`
		AdoptedAt    time.Time `db:"adopted_at"`
		FollowupDays int       `db:"followup_days"`
		ApplicantID  string    `db:"applicant_id"`
	}
	adopted, err := pgx.CollectRows(rows, pgx.RowToStructByName[adoptedRow])
	if err != nil {
		return len(list), 0, err
	}
	for _, d := range adopted {
		due := domain.FollowupDue(now.Sub(d.AdoptedAt))
		if due <= d.FollowupDays {
			continue
		}
		tag, err := a.DB.Exec(ctx, `UPDATE adoptions SET followup_days = $2 WHERE id = $1 AND followup_days < $2`, d.ID, due)
		if err != nil {
			return len(list), followups, err
		}
		if tag.RowsAffected() == 1 {
			a.pushAdoption(ctx, d.ApplicantID, "adoption_followup", d.Name, "/pawfamily/"+d.ID)
			followups++
		}
	}
	return len(list), followups, nil
}

// adopter es la cuenta cuya solicitud quedó aceptada en una adopción ya concretada.
func (a *App) adopter(ctx context.Context, adoptionID string) (string, error) {
	var id string
	err := a.DB.QueryRow(ctx, `SELECT p.applicant_id FROM adoption_applications p JOIN adoptions d ON d.id = p.adoption_id
		WHERE p.adoption_id = $1 AND p.status = 'accepted' AND d.status = 'adopted'`, adoptionID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// AddAdoptionUpdate: solo quien adoptó cuenta cómo está la mascota. Le avisa a quien la dio.
func (a *App) AddAdoptionUpdate(ctx context.Context, ac Actor, adoptionID string, in AdoptionUpdateInput) (AdoptionUpdate, error) {
	row, err := a.adoptionRow(ctx, adoptionID)
	if err != nil {
		return AdoptionUpdate{}, err
	}
	adopter, err := a.adopter(ctx, adoptionID)
	if err != nil {
		return AdoptionUpdate{}, err
	}
	if adopter == "" || adopter != ac.ID {
		return AdoptionUpdate{}, ErrNotAllowed
	}
	body := domain.Clean(in.Body, domain.AdoptionUpdateMax)
	var photoID *string
	if strings.TrimSpace(in.Photo) != "" {
		ids, err := a.ownMedia(ctx, ac.ID, "adoption", []string{in.Photo})
		if err != nil {
			return AdoptionUpdate{}, err
		}
		photoID = &ids[0]
	}
	if body == "" && photoID == nil {
		return AdoptionUpdate{}, invalid("body")
	}
	u := AdoptionUpdate{ID: domain.NewID("upd"), AdoptionID: adoptionID, AuthorID: ac.ID, Body: body, At: a.now()}
	if _, err := a.DB.Exec(ctx, `INSERT INTO adoption_updates (id, adoption_id, author_id, photo_id, body, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, u.ID, adoptionID, ac.ID, photoID, body, u.At); err != nil {
		return AdoptionUpdate{}, err
	}
	if photoID != nil {
		u.Photo = ptr(a.mediaURL(*photoID))
	}
	a.background(func(ctx context.Context) {
		a.pushAdoption(ctx, row.OwnerID, "adoption_update", row.Name, "/pawfamily/"+adoptionID)
	})
	return u, nil
}

// AdoptionUpdates: las novedades de una adopción, para quien la dio y quien adoptó.
func (a *App) AdoptionUpdates(ctx context.Context, ac Actor, adoptionID string) ([]AdoptionUpdate, error) {
	row, err := a.adoptionRow(ctx, adoptionID)
	if err != nil {
		return nil, err
	}
	adopter, err := a.adopter(ctx, adoptionID)
	if err != nil {
		return nil, err
	}
	if ac.ID != row.OwnerID && ac.ID != adopter {
		return nil, ErrNotAllowed
	}
	rows, _ := a.DB.Query(ctx, `SELECT id, author_id, photo_id, body, created_at FROM adoption_updates
		WHERE adoption_id = $1 ORDER BY created_at DESC LIMIT 50`, adoptionID)
	out := []AdoptionUpdate{}
	var u AdoptionUpdate
	var photo *string
	_, err = pgx.ForEachRow(rows, []any{&u.ID, &u.AuthorID, &photo, &u.Body, &u.At}, func() error {
		item := u
		item.AdoptionID = adoptionID
		if photo != nil {
			item.Photo = ptr(a.mediaURL(*photo))
		}
		out = append(out, item)
		return nil
	})
	return out, err
}

// shelterSummary: solo para refugios verificados.
func (a *App) shelterSummary(ctx context.Context, userID string) (*ShelterSummary, error) {
	var s ShelterSummary
	err := a.DB.QueryRow(ctx, `SELECT u.shelter_name,
		(SELECT count(*) FROM adoptions d WHERE d.owner_id = u.id AND d.status IN ('available', 'in_process') AND NOT d.moderation_removed),
		(SELECT count(*) FROM adoptions d WHERE d.owner_id = u.id AND d.status = 'adopted' AND NOT d.moderation_removed)
		FROM users u WHERE u.id = $1 AND u.shelter_status = 'verified' AND u.shelter_name IS NOT NULL`, userID).
		Scan(&s.Name, &s.Available, &s.Adopted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// UserAdoptions: lo que una cuenta tiene hoy en adopción (para su perfil público).
func (a *App) UserAdoptions(ctx context.Context, viewerID, userID string) ([]Adoption, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+adoptionCols+` FROM adoptions
		WHERE owner_id = $1 AND status IN ('available', 'in_process') AND NOT moderation_removed
		ORDER BY status = 'in_process', created_at DESC LIMIT 50`, userID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[adoptionRow])
	if err != nil {
		return nil, err
	}
	return a.toAdoptions(ctx, list, viewerID)
}
