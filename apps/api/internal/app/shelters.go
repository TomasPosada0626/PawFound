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

// ShelterResult: cómo quedó la solicitud ("verified", o "pending" si el RUES no respondió).
type ShelterResult struct {
	Status       string  `json:"status"`
	OfficialName *string `json:"officialName,omitempty"`
}

// Shelter es un refugio verificado, con la verificación quitada o esperando al RUES, tal como lo ve el panel.
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
	case domain.CheckNotNonprofit:
		return "En el RUES ya figura como empresa, no como fundación, asociación o corporación."
	case domain.CheckNameMismatch:
		return "El nombre ya no coincide con la razón social del RUES."
	case domain.CheckDigitDiffers:
		return "El dígito de verificación ya no coincide con el del RUES."
	case domain.CheckNotFound:
		return "Ya no aparece en el RUES."
	case domain.CheckUnavailable:
		return "El RUES no respondió: se reintenta cada hora."
	case domain.CheckManual:
		return "Verificación devuelta en el panel."
	}
	return "Sin revisión en el RUES."
}

// errNITTaken: el NIT ya verificó a otra cuenta. shelterRefusals: por qué el RUES no confirma el
// refugio. Los códigos coinciden con ErrorCode de la app.
var (
	errNITTaken     = newErr(http.StatusConflict, "nit_taken", nil)
	shelterRefusals = map[string]*Error{
		domain.CheckNotFound:     newErr(http.StatusUnprocessableEntity, "nit_not_found", nil),
		domain.CheckNotNonprofit: newErr(http.StatusUnprocessableEntity, "nit_not_nonprofit", nil),
		domain.CheckNameMismatch: newErr(http.StatusUnprocessableEntity, "shelter_name_mismatch", nil),
		domain.CheckDigitDiffers: newErr(http.StatusUnprocessableEntity, "nit_dv_mismatch", nil),
		domain.CheckInactive:     newErr(http.StatusUnprocessableEntity, "nit_inactive", nil),
	}
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

// officialName es la razón social del RUES, si la hay.
func officialName(e *domain.RegistryEntry) *string {
	if e == nil || e.Name == "" {
		return nil
	}
	return &e.Name
}

// VerifyShelter revisa el refugio en el RUES (Confecámaras) y decide solo, sin revisión a mano: con
// una fundación, asociación o corporación activa, el mismo dígito y el nombre que coincide queda
// verificado al instante; si no, la solicitud se rechaza diciendo por qué y no se guarda. Si el
// RUES no responde, queda esperando y se reintenta cada hora. Moderación puede quitar la
// verificación; una vez quitada, la cuenta no puede volver a verificarse sola.
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
	status, reason := domain.ShelterVerified, domain.CheckShelter(name, dv, entry)
	if err != nil {
		if deref(current) == domain.ShelterVerified {
			// Un refugio verificado no la pierde por cambiar sus datos mientras el RUES no responde.
			return ShelterResult{}, providerUnavailable("rues")
		}
		a.Log.Warn("consultar el RUES", "err", err)
		status, reason = domain.ShelterPending, domain.CheckUnavailable
	} else if refusal, refused := shelterRefusals[reason]; refused {
		return ShelterResult{}, refusal
	}
	official := officialName(entry)
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

// Shelters lista los refugios verificados, los que esperan al RUES y los que tienen la verificación
// quitada, del más reciente al más antiguo.
func (a *App) Shelters(ctx context.Context) ([]Shelter, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, name, username, email, shelter_name, shelter_nit, shelter_status, shelter_official_name,
		shelter_check, shelter_checked_at, shelter_requested_at FROM users
		WHERE shelter_status IN ('pending', 'verified', 'rejected') ORDER BY shelter_requested_at DESC`)
	return pgx.CollectRows(rows, pgx.RowToStructByName[Shelter])
}

// decideShelter quita o devuelve la verificación de un refugio y devuelve su nombre. Una
// verificación devuelta queda anotada: la revisión mensual ya no la cambia salvo que la matrícula se cancele.
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

// RunShelterChecks reintenta cada hora las solicitudes que esperan porque el RUES no respondió:
// quedan verificadas o se rechazan, y se avisa. Cada mes vuelve a revisar los verificados: si la
// matrícula se canceló o entró en liquidación, pierden la verificación solos. Pocos por pasada,
// para no saturar datos.gov.co.
func (a *App) RunShelterChecks(ctx context.Context) (verified, lost int, err error) {
	now := a.now()
	rows, _ := a.DB.Query(ctx, `SELECT id, shelter_name, shelter_nit, shelter_status, shelter_check FROM users
		WHERE shelter_name IS NOT NULL AND shelter_nit IS NOT NULL AND (
			(shelter_status = 'pending' AND coalesce(shelter_checked_at, '-infinity') < $1)
			OR (shelter_status = 'verified' AND coalesce(shelter_checked_at, '-infinity') < $2))
		ORDER BY shelter_checked_at NULLS FIRST LIMIT 20`, now.Add(-time.Hour), now.Add(-30*24*time.Hour))
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
		reason := domain.CheckShelter(s.Name, dv, entry)
		official := officialName(entry)
		switch {
		case s.Status == domain.ShelterPending && reason == domain.CheckOK:
			_, err := a.DB.Exec(ctx, `UPDATE users SET shelter_status = 'verified', shelter_check = $2, shelter_checked_at = $3,
				shelter_official_name = $4 WHERE id = $1 AND shelter_status = 'pending'`, s.ID, reason, now, official)
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				// Otra cuenta ya verificó ese NIT mientras esperaba.
				if err := a.refuseShelter(ctx, s, domain.CheckNITTaken, now, official); err != nil {
					return verified, lost, err
				}
				continue
			}
			if err != nil {
				return verified, lost, err
			}
			a.pushAdoption(ctx, s.ID, "shelter_verified", s.Name, "/pawfamily/refugio")
			verified++
		case s.Status == domain.ShelterPending:
			if err := a.refuseShelter(ctx, s, reason, now, official); err != nil {
				return verified, lost, err
			}
		case reason == domain.CheckInactive:
			// La matrícula se canceló o entró en liquidación: deja de verse como verificado.
			if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_status = NULL, shelter_check = $2, shelter_checked_at = $3,
				shelter_official_name = coalesce($4, shelter_official_name) WHERE id = $1`, s.ID, reason, now, official); err != nil {
				return verified, lost, err
			}
			a.pushAdoption(ctx, s.ID, "shelter_lost", s.Name, "/pawfamily/refugio")
			lost++
		default:
			// Sigue verificado. Una verificación devuelta conserva su motivo; las demás guardan el nuevo.
			if deref(s.Check) == domain.CheckManual {
				reason = domain.CheckManual
			}
			if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_check = $2, shelter_checked_at = $3,
				shelter_official_name = coalesce($4, shelter_official_name) WHERE id = $1`, s.ID, reason, now, official); err != nil {
				return verified, lost, err
			}
		}
	}
	return verified, lost, nil
}

// refuseShelter descarta una solicitud que esperaba al RUES y no se pudo confirmar, y avisa: al
// volver a intentarlo, la app dice por qué.
func (a *App) refuseShelter(ctx context.Context, s shelterRecheck, reason string, now time.Time, official *string) error {
	if _, err := a.DB.Exec(ctx, `UPDATE users SET shelter_status = NULL, shelter_check = $2, shelter_checked_at = $3,
		shelter_official_name = $4 WHERE id = $1 AND shelter_status = 'pending'`, s.ID, reason, now, official); err != nil {
		return err
	}
	a.pushAdoption(ctx, s.ID, "shelter_not_verified", s.Name, "/pawfamily/refugio")
	return nil
}
