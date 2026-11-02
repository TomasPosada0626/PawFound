package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

// ShelterInput: un refugio pide la verificación adicional con su nombre y su NIT.
type ShelterInput struct {
	Name string `json:"name"`
	NIT  string `json:"nit"`
}

// ShelterRequest es una solicitud por revisar en el panel.
type ShelterRequest struct {
	UserID      string    `db:"id"`
	Name        string    `db:"name"`
	Username    string    `db:"username"`
	Email       string    `db:"email"`
	ShelterName string    `db:"shelter_name"`
	NIT         string    `db:"shelter_nit"`
	RequestedAt time.Time `db:"shelter_requested_at"`
}

// RequestShelterVerification guarda la solicitud. El NIT se comprueba con su dígito de
// verificación; moderación confirma que el refugio exista antes de aprobarlo.
func (a *App) RequestShelterVerification(ctx context.Context, ac Actor, in ShelterInput) error {
	if err := requireVerified(ac); err != nil {
		return err
	}
	name := domain.Clean(in.Name, 80)
	if name == "" {
		return invalid("name")
	}
	nit, ok := domain.NormalizeNIT(in.NIT)
	if !ok {
		return invalid("nit")
	}
	tag, err := a.DB.Exec(ctx, `UPDATE users SET shelter_name = $2, shelter_nit = $3, shelter_status = 'pending', shelter_requested_at = $4
		WHERE id = $1 AND shelter_status IS DISTINCT FROM 'verified'`, ac.ID, name, nit, a.now())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotAllowed // ya es un refugio verificado
	}
	return nil
}

// PendingShelters lista las solicitudes por revisar, de la más antigua a la más nueva.
func (a *App) PendingShelters(ctx context.Context) ([]ShelterRequest, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, name, username, email, shelter_name, shelter_nit, shelter_requested_at FROM users
		WHERE shelter_status = 'pending' ORDER BY shelter_requested_at`)
	return pgx.CollectRows(rows, pgx.RowToStructByName[ShelterRequest])
}

// decideShelter aprueba o rechaza una solicitud pendiente y devuelve el nombre del refugio.
func decideShelter(ctx context.Context, tx pgx.Tx, userID string, verified bool) (string, error) {
	status := "rejected"
	if verified {
		status = "verified"
	}
	var name string
	err := tx.QueryRow(ctx, `UPDATE users SET shelter_status = $2 WHERE id = $1 AND shelter_status = 'pending' RETURNING shelter_name`,
		userID, status).Scan(&name)
	return name, notFoundIfNoRows(err)
}
