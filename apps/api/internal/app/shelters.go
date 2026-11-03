package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
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

// ShelterResult: cómo quedó la solicitud ("verified" o "pending", en revisión).
type ShelterResult struct {
	Status       string  `json:"status"`
	OfficialName *string `json:"officialName,omitempty"`
}

// Shelter es un refugio verificado o en revisión, tal como lo ve el panel.
type Shelter struct {
	UserID       string     `db:"id"`
	Name         string     `db:"name"`
	Username     string     `db:"username"`
	Email        string     `db:"email"`
	ShelterName  string     `db:"shelter_name"`
	NIT          string     `db:"shelter_nit"`
	Status       string     `db:"shelter_status"`
	OfficialName *string    `db:"shelter_official_name"`
	Check        *string    `db:"shelter_check"`
	CheckedAt    *time.Time `db:"shelter_checked_at"`
	RequestedAt  time.Time  `db:"shelter_requested_at"`
}

// CheckText explica en el panel el resultado de la última revisión en el RUES.
func (s Shelter) CheckText() string {
	switch deref(s.Check) {
	case domain.CheckOK:
		return "En el RUES: entidad sin ánimo de lucro activa y el nombre coincide."
	case domain.CheckNotFound:
		return "No aparece en el RUES (puede ser reciente: se reintenta cada semana)."
	case domain.CheckNotNonprofit:
		return "En el RUES es una empresa, no una fundación, asociación o corporación."
	case domain.CheckNameMismatch:
		return "El nombre no coincide con la razón social del RUES."
	case domain.CheckDigitDiffers:
		return "El dígito de verificación no coincide con el del RUES."
	case domain.CheckUnavailable:
		return "El RUES no respondió: se reintenta cada hora."
	case domain.CheckInactive:
		return "En el RUES la matrícula ya no está activa (cancelada o en liquidación)."
	case domain.CheckManual:
		return "Aprobado a mano en el panel."
	}
	return "Sin revisión en el RUES."
}

// errNITTaken: el NIT ya verificó a otra cuenta. errNITInactive: el RUES lo muestra cancelado o en
// liquidación. Los códigos coinciden con ErrorCode de la app.
var (
	errNITTaken    = newErr(http.StatusConflict, "nit_taken", nil)
	errNITInactive = newErr(http.StatusUnprocessableEntity, "nit_inactive", nil)
)

// lookupShelter consulta el NIT (sin dígito) en el RUES. Sin registro configurado, como si no respondiera.
func (a *App) lookupShelter(ctx context.Context, base string) (*domain.RegistryEntry, error) {
	if a.Registry == nil {
		return nil, errors.New("sin registro de empresas configurado")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	rec, err := a.Registry.LookupNIT(ctx, base)
	if err != nil || rec == nil {
		return nil, err
	}
	return &domain.RegistryEntry{Name: rec.Name, CheckDigit: rec.CheckDigit, Status: rec.Status, LegalForm: rec.LegalForm}, nil
}

// splitNIT separa "900123456-8" en base y dígito.
func splitNIT(nit string) (string, string) {
	base, dv, _ := strings.Cut(nit, "-")
	return base, dv
}

// VerifyShelter revisa el refugio en el RUES (Confecámaras): con una fundación, asociación o
// corporación activa y el nombre que coincide queda verificado al instante; si no aparece, es una
// empresa o el nombre no coincide, queda en revisión para el panel; si la matrícula está cancelada
// o en liquidación, se rechaza. Moderación puede quitar la verificación; una vez quitada, la cuenta
// no puede volver a verificarse sola.
func (a *App) VerifyShelter(ctx context.Context, ac Actor, in ShelterInput) (ShelterResult, error) {
	if err := requireVerified(ac); err != nil {
		return ShelterResult{}, err
	}
	name := domain.Clean(in.Name, 80)
	if name == "" {
		return ShelterResult{}, invalid("name")
	}
	nit, ok := domain.NormalizeNIT(in.NIT)
	if !ok {
		return ShelterResult{}, invalid("nit")
	}
	var current *string
	if err := a.DB.QueryRow(ctx, `SELECT shelter_status FROM users WHERE id = $1`, ac.ID).Scan(&current); err != nil {
		return ShelterResult{}, err
	}
	if deref(current) == "rejected" {
		return ShelterResult{}, ErrNotAllowed // moderación le quitó la verificación
	}
	base, dv := splitNIT(nit)
	entry, err := a.lookupShelter(ctx, base)
	status, reason := domain.ShelterDecision(name, dv, entry)
	if err != nil {
		a.Log.Warn("consultar el RUES", "err", err)
		status, reason = domain.ShelterPending, domain.CheckUnavailable
	}
	if status == domain.ShelterInactive {
		return ShelterResult{}, errNITInactive
	}
	var official *string
	if entry != nil && entry.Name != "" {
		official = &entry.Name
	}
	now := a.now()
	tag, err := a.DB.Exec(ctx, `UPDATE users SET shelter_name = $2, shelter_nit = $3, shelter_status = $4, shelter_requested_at = $5,
		shelter_official_name = $6, shelter_check = $7, shelter_checked_at = $5
		WHERE id = $1 AND shelter_status IS DISTINCT FROM 'rejected'`, ac.ID, name, nit, status, now, official, reason)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ShelterResult{}, errNITTaken
	}
	if err != nil {
		return ShelterResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return ShelterResult{}, ErrNotAllowed
	}
	return ShelterResult{Status: status, OfficialName: official}, nil
}

// Shelters lista los refugios en revisión (primero) y los verificados, del más reciente al más antiguo.
func (a *App) Shelters(ctx context.Context) ([]Shelter, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, name, username, email, shelter_name, shelter_nit, shelter_status, shelter_official_name,
		shelter_check, shelter_checked_at, shelter_requested_at FROM users
		WHERE shelter_status IN ('pending', 'verified') ORDER BY shelter_status = 'verified', shelter_requested_at DESC`)
	return pgx.CollectRows(rows, pgx.RowToStructByName[Shelter])
}

// decideShelter aprueba, quita o devuelve la verificación de un refugio y devuelve su nombre. Una
// aprobación a mano queda anotada: la revisión mensual ya no la cambia salvo que la matrícula se cancele.
func decideShelter(ctx context.Context, tx pgx.Tx, userID string, verified bool) (string, error) {
	status := "rejected"
	if verified {
		status = "verified"
	}
	var name string
	err := tx.QueryRow(ctx, `UPDATE users SET shelter_status = $2,
		shelter_check = CASE WHEN $2 = 'verified' THEN 'manual' ELSE shelter_check END
		WHERE id = $1 AND shelter_name IS NOT NULL AND shelter_status <> $2
		RETURNING shelter_name`, userID, status).Scan(&name)
	return name, notFoundIfNoRows(err)
}

// shelterRecheck es un refugio al que le toca revisión en el RUES.
type shelterRecheck struct {
	ID     string  `db:"id"`
	Name   string  `db:"shelter_name"`
	NIT    string  `db:"shelter_nit"`
	Status string  `db:"shelter_status"`
	Check  *string `db:"shelter_check"`
}

// RunShelterChecks reintenta los refugios en revisión porque el RUES no respondió (cada hora) o
// porque no aparecían (cada semana: el RUES se actualiza cada mes), y vuelve a revisar cada mes los
// verificados: si la matrícula se canceló, pierden la verificación y quedan en revisión. Pocos por
// pasada, para no saturar datos.gov.co.
func (a *App) RunShelterChecks(ctx context.Context) (verified, lost int, err error) {
	now := a.now()
	rows, _ := a.DB.Query(ctx, `SELECT id, shelter_name, shelter_nit, shelter_status, shelter_check FROM users
		WHERE shelter_name IS NOT NULL AND shelter_nit IS NOT NULL AND (
			(shelter_status = 'pending' AND shelter_check = 'unavailable' AND coalesce(shelter_checked_at, '-infinity') < $1)
			OR (shelter_status = 'pending' AND shelter_check = 'not_found' AND coalesce(shelter_checked_at, '-infinity') < $2)
			OR (shelter_status = 'verified' AND coalesce(shelter_checked_at, '-infinity') < $3))
		ORDER BY shelter_checked_at NULLS FIRST LIMIT 20`, now.Add(-time.Hour), now.Add(-7*24*time.Hour), now.Add(-30*24*time.Hour))
	due, err := pgx.CollectRows(rows, pgx.RowToStructByName[shelterRecheck])
	if err != nil {
		return 0, 0, err
	}
	for _, s := range due {
		base, dv := splitNIT(s.NIT)
		entry, lookupErr := a.lookupShelter(ctx, base)
		if lookupErr != nil {
			// El RUES no respondió: se vuelve a intentar más tarde.
			if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_checked_at = $2 WHERE id = $1`, s.ID, now); err != nil {
				return verified, lost, err
			}
			continue
		}
		status, reason := domain.ShelterDecision(s.Name, dv, entry)
		var official *string
		if entry != nil && entry.Name != "" {
			official = &entry.Name
		}
		switch {
		case s.Status == "verified" && status == domain.ShelterInactive:
			// La matrícula se canceló: deja de verse como verificado y queda para el panel.
			if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_status = 'pending', shelter_check = 'inactive', shelter_checked_at = $2,
				shelter_official_name = coalesce($3, shelter_official_name) WHERE id = $1`, s.ID, now, official); err != nil {
				return verified, lost, err
			}
			a.pushAdoption(ctx, s.ID, "shelter_review", s.Name, "/pawfamily/refugio")
			lost++
		case s.Status == "pending" && status == domain.ShelterVerified:
			_, err := a.DB.Exec(ctx, `UPDATE users SET shelter_status = 'verified', shelter_check = $2, shelter_checked_at = $3,
				shelter_official_name = $4 WHERE id = $1 AND shelter_status = 'pending'`, s.ID, reason, now, official)
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				// Otra cuenta ya verificó ese NIT: sigue en revisión.
				if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_checked_at = $2 WHERE id = $1`, s.ID, now); err != nil {
					return verified, lost, err
				}
				continue
			}
			if err != nil {
				return verified, lost, err
			}
			a.pushAdoption(ctx, s.ID, "shelter_verified", s.Name, "/pawfamily/refugio")
			verified++
		default:
			// Sin cambio de estado. Un verificado a mano conserva su motivo; los demás guardan el nuevo.
			if s.Status == "verified" && deref(s.Check) == domain.CheckManual {
				reason = domain.CheckManual
			}
			if s.Status == "pending" && status == domain.ShelterInactive {
				reason = domain.CheckInactive
			}
			if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_check = $2, shelter_checked_at = $3,
				shelter_official_name = coalesce($4, shelter_official_name) WHERE id = $1`, s.ID, reason, now, official); err != nil {
				return verified, lost, err
			}
		}
	}
	return verified, lost, nil
}
