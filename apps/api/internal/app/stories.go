package app

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
)

// Historias de casos dentro de PawFound (decisión de producto del 2026-10-28): parecidas a las
// de Instagram, pero no vencen a las 24 horas. Cada caso activo tiene su historia (sus fotos y
// las actualizaciones de la familia); desaparece cuando la familia quita las actualizaciones o
// cuando el caso se cierra (reencuentro o retiro).

// MaxStoryItems por caso, para que la historia siga siendo breve.
const MaxStoryItems = 20

// StoryItem es una actualización de la familia: foto, texto o ambos.
type StoryItem struct {
	ID        string    `json:"id"`
	PetID     string    `json:"petId"`
	AuthorID  string    `json:"authorId"`
	Photo     *string   `json:"photo,omitempty"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

// Story es la historia de un caso para la fila de historias.
type Story struct {
	Pet       Pet         `json:"pet"`
	Items     []StoryItem `json:"items"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

// StoryFeed devuelve las historias de los casos activos cerca de un punto, las más recientes primero.
func (a *App) StoryFeed(ctx context.Context, viewerID string, center geo.Point, radius int) ([]Story, error) {
	if radius <= 0 || radius > 30_000 {
		radius = 10_000
	}
	pets, err := a.Nearby(ctx, viewerID, NearbyQuery{Center: center, Radius: radius, Limit: 60})
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(pets))
	for i, p := range pets {
		ids[i] = p.ID
	}
	items, err := a.storyItems(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]Story, 0, len(pets))
	for _, p := range pets {
		s := Story{Pet: p, Items: items[p.ID], UpdatedAt: p.CreatedAt}
		if s.Items == nil {
			s.Items = []StoryItem{}
		}
		if p.LastSeenAt.After(s.UpdatedAt) {
			s.UpdatedAt = p.LastSeenAt
		}
		for _, it := range s.Items {
			if it.CreatedAt.After(s.UpdatedAt) {
				s.UpdatedAt = it.CreatedAt
			}
		}
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (a *App) storyItems(ctx context.Context, petIDs []string) (map[string][]StoryItem, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, pet_id, coalesce(author_id, ''), photo_id, body, created_at FROM stories
		WHERE pet_id = ANY($1) AND removed_at IS NULL ORDER BY created_at`, petIDs)
	out := map[string][]StoryItem{}
	var it StoryItem
	var photo *string
	_, err := pgx.ForEachRow(rows, []any{&it.ID, &it.PetID, &it.AuthorID, &photo, &it.Text, &it.CreatedAt}, func() error {
		item := it
		if photo != nil {
			item.Photo = ptr(a.mediaURL(*photo))
		}
		out[it.PetID] = append(out[it.PetID], item)
		return nil
	})
	return out, err
}

// StoryInput es una actualización nueva.
type StoryInput struct {
	Text    string `json:"text"`
	PhotoID string `json:"photoId"`
}

// AddStory agrega una actualización a la historia del caso. Solo la familia, con el caso activo.
func (a *App) AddStory(ctx context.Context, ac Actor, petID string, in StoryInput) (StoryItem, error) {
	if err := requireVerified(ac); err != nil {
		return StoryItem{}, err
	}
	row, err := a.petRow(ctx, petID)
	if err != nil {
		return StoryItem{}, err
	}
	if deref(row.OwnerID) != ac.ID || row.State != "active" || row.ModerationRemoved {
		return StoryItem{}, ErrNotAllowed
	}
	text := domain.Clean(in.Text, 140)
	photoID := mediaIDFromRef(in.PhotoID)
	if text == "" && photoID == "" {
		return StoryItem{}, invalid("text")
	}
	var count int
	if err := a.DB.QueryRow(ctx, `SELECT count(*) FROM stories WHERE pet_id = $1 AND removed_at IS NULL`, petID).Scan(&count); err != nil {
		return StoryItem{}, err
	}
	if count >= MaxStoryItems {
		return StoryItem{}, newErr(http.StatusUnprocessableEntity, "story_full", map[string]any{"count": MaxStoryItems})
	}
	var photo *string
	if photoID != "" {
		if _, err := a.ownMedia(ctx, ac.ID, "story", []string{photoID}); err != nil {
			return StoryItem{}, err
		}
		photo = &photoID
	}
	item := StoryItem{ID: domain.NewID("sto"), PetID: petID, AuthorID: ac.ID, Text: text, CreatedAt: a.now()}
	if _, err := a.DB.Exec(ctx, `INSERT INTO stories (id, pet_id, author_id, photo_id, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		item.ID, petID, ac.ID, photo, text, item.CreatedAt); err != nil {
		return StoryItem{}, err
	}
	if photo != nil {
		item.Photo = ptr(a.mediaURL(*photo))
	}
	return item, nil
}

// RemoveStory quita una actualización (su autor o la familia del caso).
func (a *App) RemoveStory(ctx context.Context, ac Actor, storyID string) error {
	var author, owner *string
	err := a.DB.QueryRow(ctx, `SELECT s.author_id, p.owner_id FROM stories s JOIN pets p ON p.id = s.pet_id WHERE s.id = $1 AND s.removed_at IS NULL`,
		storyID).Scan(&author, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if deref(author) != ac.ID && deref(owner) != ac.ID {
		return ErrNotAllowed
	}
	_, err = a.DB.Exec(ctx, `UPDATE stories SET removed_at = $2 WHERE id = $1`, storyID, a.now())
	return err
}
