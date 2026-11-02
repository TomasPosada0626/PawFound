package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

// ShelterInput: un refugio se verifica con su nombre y su NIT.
type ShelterInput struct {
	Name string `json:"name"`
	NIT  string `json:"nit"`
}

// Shelter es un refugio verificado, tal como lo ve el panel.
type Shelter struct {
	UserID      string    `db:"id"`
	Name        string    `db:"name"`
	Username    string    `db:"username"`
	Email       string    `db:"email"`
	ShelterName string    `db:"shelter_name"`
	NIT         string    `db:"shelter_nit"`
	RequestedAt time.Time `db:"shelter_requested_at"`
}

// errNITTaken: el NIT ya verificó a otra cuenta. El código coincide con ErrorCode de la app.
var errNITTaken = newErr(http.StatusConflict, "nit_taken", nil)

// VerifyShelter verifica la cuenta como refugio al instante si el NIT tiene un dígito de
// verificación correcto según la DIAN y no lo usa otra cuenta. Moderación puede quitar la
// verificación desde el panel; una vez quitada, la cuenta no puede volver a verificarse sola.
func (a *App) VerifyShelter(ctx context.Context, ac Actor, in ShelterInput) error {
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
	tag, err := a.DB.Exec(ctx, `UPDATE users SET shelter_name = $2, shelter_nit = $3, shelter_status = 'verified', shelter_requested_at = $4
		WHERE id = $1 AND shelter_status IS DISTINCT FROM 'rejected'`, ac.ID, name, nit, a.now())
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return errNITTaken
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotAllowed // moderación le quitó la verificación
	}
	return nil
}

// Shelters lista los refugios verificados, del más reciente al más antiguo.
func (a *App) Shelters(ctx context.Context) ([]Shelter, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, name, username, email, shelter_name, shelter_nit, shelter_requested_at FROM users
		WHERE shelter_status = 'verified' ORDER BY shelter_requested_at DESC`)
	return pgx.CollectRows(rows, pgx.RowToStructByName[Shelter])
}

// decideShelter quita o devuelve la verificación de un refugio y devuelve su nombre.
func decideShelter(ctx context.Context, tx pgx.Tx, userID string, verified bool) (string, error) {
	status := "rejected"
	if verified {
		status = "verified"
	}
	var name string
	err := tx.QueryRow(ctx, `UPDATE users SET shelter_status = $2 WHERE id = $1 AND shelter_name IS NOT NULL AND shelter_status <> $2
		RETURNING shelter_name`, userID, status).Scan(&name)
	return name, notFoundIfNoRows(err)
}
