package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/realtime"
)

// PawFamily: adopción responsable y 100 % gratuita. Quien pida dinero se reporta, moderación
// retira la publicación y puede suspender la cuenta.

// Adoption es una mascota en adopción.
type Adoption struct {
	ID          string      `json:"id"`
	Owner       UserSummary `json:"owner"`
	Name        string      `json:"name"`
	Species     string      `json:"species"`
	Breed       *string     `json:"breed,omitempty"`
	Sex         string      `json:"sex"`
	Age         string      `json:"age"`
	Size        string      `json:"size"`
	Color       *string     `json:"color,omitempty"`
	Description string      `json:"description"`
	Vaccinated  bool        `json:"vaccinated"`
	Sterilized  bool        `json:"sterilized"`
	Photos      []string    `json:"photos"`
	Location    geo.Point   `json:"location"`
	Zone        string      `json:"zone"`
	Status      string      `json:"status"`
	CreatedAt   time.Time   `json:"createdAt"`
	AdoptedAt   *time.Time  `json:"adoptedAt,omitempty"`
	// Address solo llega a quien publicó y a quien fue aceptado para adoptar.
	Address *string `json:"address,omitempty"`
	// Pending: solicitudes por responder, solo para quien publicó.
	Pending int `json:"pending,omitempty"`
	// MyApplication: estado de la solicitud de quien mira, si se postuló.
	MyApplication *string `json:"myApplication,omitempty"`
}

type adoptionRow struct {
	ID                string     `db:"id"`
	OwnerID           string     `db:"owner_id"`
	Name              string     `db:"name"`
	Species           string     `db:"species"`
	Breed             *string    `db:"breed"`
	Sex               string     `db:"sex"`
	Age               string     `db:"age"`
	Size              string     `db:"size"`
	Color             *string    `db:"color"`
	Description       string     `db:"description"`
	Vaccinated        bool       `db:"vaccinated"`
	Sterilized        bool       `db:"sterilized"`
	Photos            []string   `db:"photos"`
	Lat               float64    `db:"lat"`
	Lng               float64    `db:"lng"`
	Zone              string     `db:"zone"`
	Address           *string    `db:"address"`
	Status            string     `db:"status"`
	ModerationRemoved bool       `db:"moderation_removed"`
	CreatedAt         time.Time  `db:"created_at"`
	AdoptedAt         *time.Time `db:"adopted_at"`
}

const adoptionCols = `id, owner_id, name, species, breed, sex, age, size, color, description, vaccinated, sterilized,
	photos, lat, lng, zone, address, status, moderation_removed, created_at, adopted_at`

// AdoptionInput es el formulario para dar en adopción.
type AdoptionInput struct {
	Name        string    `json:"name"`
	Species     string    `json:"species"`
	Breed       string    `json:"breed"`
	Sex         string    `json:"sex"`
	Age         string    `json:"age"`
	Size        string    `json:"size"`
	Color       string    `json:"color"`
	Description string    `json:"description"`
	Vaccinated  bool      `json:"vaccinated"`
	Sterilized  bool      `json:"sterilized"`
	Photos      []string  `json:"photos"`
	Location    geo.Point `json:"location"`
	Zone        string    `json:"zone"`
	Address     string    `json:"address"`
}

// ApplicationInput es el informe corto para adoptar.
type ApplicationInput struct {
	FullName     string `json:"fullName"`
	Household    int    `json:"household"`
	Neighborhood string `json:"neighborhood"`
	City         string `json:"city"`
	HadPets      bool   `json:"hadPets"`
	PetsCount    int    `json:"petsCount"`
	Reason       string `json:"reason"`
}

// Application es una solicitud, tal como la ve quien publicó o quien se postuló.
type Application struct {
	ID           string      `json:"id"`
	AdoptionID   string      `json:"adoptionId"`
	Applicant    UserSummary `json:"applicant"`
	FullName     string      `json:"fullName"`
	Household    int         `json:"household"`
	Neighborhood string      `json:"neighborhood"`
	City         string      `json:"city"`
	HadPets      bool        `json:"hadPets"`
	PetsCount    int         `json:"petsCount"`
	Reason       string      `json:"reason"`
	Status       string      `json:"status"`
	ThreadID     *string     `json:"threadId,omitempty"`
	CreatedAt    time.Time   `json:"createdAt"`
	// Adoption acompaña a las solicitudes propias, para mostrarlas sin otra consulta.
	Adoption *Adoption `json:"adoption,omitempty"`
}

// AdoptionQuery: lista cerca de un punto, con distancia elegida y filtros opcionales. No se filtra
// por raza: muchas mascotas son criollas y no tienen una raza concreta.
type AdoptionQuery struct {
	Center                        geo.Point
	Radius                        int
	City, Species, Size, Age, Sex string
	Limit                         int
}

var (
	errAdoptionTerms  = newErr(http.StatusForbidden, "adoption_terms", nil)
	errAlreadyApplied = newErr(http.StatusConflict, "already_applied", nil)
)

const (
	adoptionDefaultRadius = 10_000
	adoptionMaxRadius     = 200_000
	adoptionMaxPerDay     = 10
	applicationMaxPerDay  = 20
	applicationReasonMin  = 20
	applicationReasonMax  = 600
)

// AcceptAdoptionTerms registra que la cuenta aceptó las políticas de PawFamily.
func (a *App) AcceptAdoptionTerms(ctx context.Context, ac Actor) error {
	return a.withTx(ctx, func(tx pgx.Tx) error {
		return recordConsent(ctx, tx, ac.ID, "adoption_terms", true, a.now())
	})
}

func (a *App) acceptedAdoptionTerms(ctx context.Context, userID string) (bool, error) {
	var ok bool
	err := a.DB.QueryRow(ctx, `SELECT coalesce((SELECT granted FROM consents WHERE user_id = $1 AND kind = 'adoption_terms'
		ORDER BY at DESC, id DESC LIMIT 1), false)`, userID).Scan(&ok)
	return ok, err
}

// requireAdoptionTerms: publicar o postularse exige cuenta verificada y las políticas aceptadas.
func (a *App) requireAdoptionTerms(ctx context.Context, ac Actor) error {
	if err := requireVerified(ac); err != nil {
		return err
	}
	ok, err := a.acceptedAdoptionTerms(ctx, ac.ID)
	if err != nil {
		return err
	}
	if !ok {
		return errAdoptionTerms
	}
	return nil
}

func (in AdoptionInput) validate() error {
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
	case domain.Clean(in.Description, domain.DescriptionMax) == "" || len([]rune(in.Description)) > domain.DescriptionMax:
		return invalid("description")
	case len(in.Photos) == 0 || len(in.Photos) > domain.MaxPhotos:
		return invalid("photos")
	case !validPoint(in.Location):
		return invalid("location")
	case domain.Clean(in.Zone, 80) == "":
		return invalid("zone")
	case len([]rune(in.Address)) > 120:
		return invalid("address")
	}
	return nil
}

// CreateAdoption publica una mascota en adopción.
func (a *App) CreateAdoption(ctx context.Context, ac Actor, in AdoptionInput) (Adoption, error) {
	if err := a.requireAdoptionTerms(ctx, ac); err != nil {
		return Adoption{}, err
	}
	if err := in.validate(); err != nil {
		return Adoption{}, err
	}
	now := a.now()
	var today int
	if err := a.DB.QueryRow(ctx, `SELECT count(*) FROM adoptions WHERE owner_id = $1 AND created_at > $2`, ac.ID, now.Add(-24*time.Hour)).Scan(&today); err != nil {
		return Adoption{}, err
	}
	if today >= adoptionMaxPerDay {
		return Adoption{}, rateLimited(time.Time{})
	}
	photos, err := a.ownMedia(ctx, ac.ID, "adoption", in.Photos)
	if err != nil {
		return Adoption{}, err
	}
	zone := domain.Clean(in.Zone, 80)
	id := domain.NewID("ad")
	approx := geo.Approximate(in.Location)
	if _, err := a.DB.Exec(ctx, `INSERT INTO adoptions (id, owner_id, name, species, breed, sex, age, size, color, description,
			vaccinated, sterilized, photos, lat, lng, zone, city_key, address, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		id, ac.ID, domain.Clean(in.Name, 40), in.Species, optional(domain.Clean(in.Breed, 60)), in.Sex, in.Age, in.Size,
		optional(domain.Clean(in.Color, 60)), domain.Clean(in.Description, domain.DescriptionMax), in.Vaccinated, in.Sterilized,
		photos, approx.Lat, approx.Lng, zone, optional(domain.CityKey(domain.CityFromZone(zone))), optional(domain.Clean(in.Address, 120)), now); err != nil {
		return Adoption{}, err
	}
	return a.GetAdoption(ctx, ac.ID, id)
}

func (a *App) adoptionRow(ctx context.Context, id string) (adoptionRow, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+adoptionCols+` FROM adoptions WHERE id = $1`, id)
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[adoptionRow])
	return row, notFoundIfNoRows(err)
}

// visible: lo retirado por moderación o por quien publicó solo lo ve esa persona.
func (r adoptionRow) visibleTo(viewerID string) bool {
	return r.OwnerID == viewerID || (!r.ModerationRemoved && r.Status != "withdrawn")
}

// toAdoptions arma la vista de cada publicación según quién mira.
func (a *App) toAdoptions(ctx context.Context, rows []adoptionRow, viewerID string) ([]Adoption, error) {
	out := make([]Adoption, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]string, len(rows))
	owners := make([]string, len(rows))
	for i, r := range rows {
		ids[i], owners[i] = r.ID, r.OwnerID
	}
	users, err := a.summaries(ctx, dedupe(owners))
	if err != nil {
		return nil, err
	}
	mine := map[string]string{}
	if viewerID != "" {
		ar, _ := a.DB.Query(ctx, `SELECT adoption_id, status FROM adoption_applications WHERE applicant_id = $1 AND adoption_id = ANY($2)`, viewerID, ids)
		var adoptionID, status string
		if _, err := pgx.ForEachRow(ar, []any{&adoptionID, &status}, func() error {
			mine[adoptionID] = status
			return nil
		}); err != nil {
			return nil, err
		}
	}
	pending := map[string]int{}
	pr, _ := a.DB.Query(ctx, `SELECT a.id, count(p.id) FROM adoptions a JOIN adoption_applications p ON p.adoption_id = a.id AND p.status = 'pending'
		WHERE a.id = ANY($1) AND a.owner_id = $2 GROUP BY a.id`, ids, viewerID)
	var adoptionID string
	var count int
	if _, err := pgx.ForEachRow(pr, []any{&adoptionID, &count}, func() error {
		pending[adoptionID] = count
		return nil
	}); err != nil {
		return nil, err
	}
	for _, r := range rows {
		ad := Adoption{
			ID: r.ID, Owner: users[r.OwnerID], Name: r.Name, Species: r.Species, Breed: r.Breed, Sex: r.Sex, Age: r.Age,
			Size: r.Size, Color: r.Color, Description: r.Description, Vaccinated: r.Vaccinated, Sterilized: r.Sterilized,
			Photos: a.mediaURLs(r.Photos), Location: geo.Point{Lat: r.Lat, Lng: r.Lng}, Zone: r.Zone, Status: r.Status,
			CreatedAt: r.CreatedAt, AdoptedAt: r.AdoptedAt, Pending: pending[r.ID],
		}
		if status, ok := mine[r.ID]; ok {
			ad.MyApplication = ptr(status)
		}
		if r.OwnerID == viewerID || mine[r.ID] == "accepted" {
			ad.Address = r.Address
		}
		out = append(out, ad)
	}
	return out, nil
}

// GetAdoption devuelve una publicación.
func (a *App) GetAdoption(ctx context.Context, viewerID, id string) (Adoption, error) {
	row, err := a.adoptionRow(ctx, id)
	if err != nil {
		return Adoption{}, err
	}
	if !row.visibleTo(viewerID) {
		return Adoption{}, ErrNotFound
	}
	list, err := a.toAdoptions(ctx, []adoptionRow{row}, viewerID)
	if err != nil {
		return Adoption{}, err
	}
	return list[0], nil
}

// SearchAdoptions lista las mascotas disponibles o en proceso, de la más cercana a la más lejana.
// Con ciudad se busca en toda la ciudad; sin ella, dentro de la distancia elegida.
func (a *App) SearchAdoptions(ctx context.Context, viewerID string, q AdoptionQuery) ([]Adoption, error) {
	if !validPoint(q.Center) {
		return nil, invalid("location")
	}
	if q.Radius <= 0 {
		q.Radius = adoptionDefaultRadius
	}
	q.Radius = min(q.Radius, adoptionMaxRadius)
	if q.Limit <= 0 || q.Limit > 100 {
		q.Limit = 50
	}
	city := domain.CityKey(q.City)
	rows, _ := a.DB.Query(ctx, `SELECT `+adoptionCols+` FROM adoptions
		WHERE status IN ('available', 'in_process') AND NOT moderation_removed
		  AND ($4 = '' OR city_key = $4)
		  AND ($4 <> '' OR ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3))
		  AND ($5 = '' OR species = $5) AND ($6 = '' OR size = $6) AND ($7 = '' OR age = $7) AND ($8 = '' OR sex = $8)
		ORDER BY status = 'in_process', location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography LIMIT $9`,
		q.Center.Lat, q.Center.Lng, q.Radius, city, q.Species, q.Size, q.Age, q.Sex, q.Limit)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[adoptionRow])
	if err != nil {
		return nil, err
	}
	return a.toAdoptions(ctx, list, viewerID)
}

// MyAdoptions: lo publicado por la cuenta, con las solicitudes por responder.
func (a *App) MyAdoptions(ctx context.Context, ac Actor) ([]Adoption, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+adoptionCols+` FROM adoptions WHERE owner_id = $1 AND status <> 'withdrawn'
		ORDER BY created_at DESC`, ac.ID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[adoptionRow])
	if err != nil {
		return nil, err
	}
	return a.toAdoptions(ctx, list, ac.ID)
}

// ownAdoption carga una publicación y comprueba que sea de la cuenta.
func (a *App) ownAdoption(ctx context.Context, ac Actor, id string) (adoptionRow, error) {
	row, err := a.adoptionRow(ctx, id)
	if err != nil {
		return row, err
	}
	if row.OwnerID != ac.ID {
		return row, ErrNotAllowed
	}
	return row, nil
}

// MarkAdopted cierra la publicación: la mascota ya tiene hogar. Las solicitudes sin responder se
// rechazan con un aviso amable.
func (a *App) MarkAdopted(ctx context.Context, ac Actor, id string) error {
	return a.closeAdoption(ctx, ac, id, "adopted")
}

// WithdrawAdoption quita la publicación. Las solicitudes sin responder se rechazan.
func (a *App) WithdrawAdoption(ctx context.Context, ac Actor, id string) error {
	return a.closeAdoption(ctx, ac, id, "withdrawn")
}

func (a *App) closeAdoption(ctx context.Context, ac Actor, id, status string) error {
	row, err := a.ownAdoption(ctx, ac, id)
	if err != nil {
		return err
	}
	if row.Status == "adopted" || row.Status == "withdrawn" {
		return ErrNotAllowed
	}
	now := a.now()
	var declined, adopters []string
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		var adoptedAt *time.Time
		if status == "adopted" {
			adoptedAt = &now
		}
		if _, err := tx.Exec(ctx, `UPDATE adoptions SET status = $2, adopted_at = $3 WHERE id = $1`, id, status, adoptedAt); err != nil {
			return err
		}
		rows, _ := tx.Query(ctx, `UPDATE adoption_applications SET status = 'declined', decided_at = $2
			WHERE adoption_id = $1 AND status = 'pending' RETURNING applicant_id`, id, now)
		if declined, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if status == "adopted" {
			rows, _ := tx.Query(ctx, `SELECT applicant_id FROM adoption_applications WHERE adoption_id = $1 AND status = 'accepted'`, id)
			adopters, err = pgx.CollectRows(rows, pgx.RowTo[string])
		}
		return err
	})
	if err != nil {
		return err
	}
	a.background(func(ctx context.Context) {
		for _, userID := range declined {
			a.pushAdoption(ctx, userID, "application_closed", row.Name, "/pawfamily/solicitudes")
		}
		for _, userID := range adopters {
			a.pushAdoption(ctx, userID, "adoption_completed", row.Name, "/profile")
		}
	})
	return nil
}

func (in ApplicationInput) validate() error {
	reason := len([]rune(strings.TrimSpace(in.Reason)))
	switch {
	case domain.Clean(in.FullName, 80) == "":
		return invalid("fullName")
	case in.Household < 1 || in.Household > 20:
		return invalid("household")
	case domain.Clean(in.Neighborhood, 80) == "":
		return invalid("neighborhood")
	case domain.Clean(in.City, 60) == "":
		return invalid("city")
	case in.PetsCount < 0 || in.PetsCount > 50 || (!in.HadPets && in.PetsCount != 0):
		return invalid("petsCount")
	case reason < applicationReasonMin || reason > applicationReasonMax:
		return invalid("reason")
	}
	return nil
}

// Apply envía la solicitud para adoptar. Le llega a quien publicó por la app y por correo.
func (a *App) Apply(ctx context.Context, ac Actor, adoptionID string, in ApplicationInput) (Application, error) {
	if err := a.requireAdoptionTerms(ctx, ac); err != nil {
		return Application{}, err
	}
	if err := in.validate(); err != nil {
		return Application{}, err
	}
	row, err := a.adoptionRow(ctx, adoptionID)
	if err != nil || !row.visibleTo(ac.ID) {
		return Application{}, ErrNotFound
	}
	if row.OwnerID == ac.ID || row.Status == "adopted" || row.Status == "withdrawn" {
		return Application{}, ErrNotAllowed
	}
	now := a.now()
	var today int
	if err := a.DB.QueryRow(ctx, `SELECT count(*) FROM adoption_applications WHERE applicant_id = $1 AND created_at > $2`, ac.ID, now.Add(-24*time.Hour)).Scan(&today); err != nil {
		return Application{}, err
	}
	if today >= applicationMaxPerDay {
		return Application{}, rateLimited(time.Time{})
	}
	id := domain.NewID("ap")
	tag, err := a.DB.Exec(ctx, `INSERT INTO adoption_applications (id, adoption_id, applicant_id, full_name, household, neighborhood,
			city, had_pets, pets_count, reason, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (adoption_id, applicant_id) DO NOTHING`,
		id, adoptionID, ac.ID, domain.Clean(in.FullName, 80), in.Household, domain.Clean(in.Neighborhood, 80),
		domain.Clean(in.City, 60), in.HadPets, in.PetsCount, domain.Clean(in.Reason, applicationReasonMax), now)
	if err != nil {
		return Application{}, err
	}
	if tag.RowsAffected() == 0 {
		return Application{}, errAlreadyApplied
	}
	a.background(func(ctx context.Context) {
		a.pushAdoption(ctx, row.OwnerID, "application_new", row.Name, "/pawfamily/mias")
		a.mailNewApplication(ctx, row.OwnerID, row.Name)
	})
	return a.application(ctx, ac.ID, id)
}

const applicationCols = `id, adoption_id, applicant_id, full_name, household, neighborhood, city, had_pets, pets_count,
	reason, status, thread_id, created_at`

type applicationRow struct {
	ID           string    `db:"id"`
	AdoptionID   string    `db:"adoption_id"`
	ApplicantID  string    `db:"applicant_id"`
	FullName     string    `db:"full_name"`
	Household    int       `db:"household"`
	Neighborhood string    `db:"neighborhood"`
	City         string    `db:"city"`
	HadPets      bool      `db:"had_pets"`
	PetsCount    int       `db:"pets_count"`
	Reason       string    `db:"reason"`
	Status       string    `db:"status"`
	ThreadID     *string   `db:"thread_id"`
	CreatedAt    time.Time `db:"created_at"`
}

func (a *App) toApplications(ctx context.Context, rows []applicationRow) ([]Application, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ApplicantID
	}
	users, err := a.summaries(ctx, dedupe(ids))
	if err != nil {
		return nil, err
	}
	out := make([]Application, 0, len(rows))
	for _, r := range rows {
		out = append(out, Application{
			ID: r.ID, AdoptionID: r.AdoptionID, Applicant: users[r.ApplicantID], FullName: r.FullName, Household: r.Household,
			Neighborhood: r.Neighborhood, City: r.City, HadPets: r.HadPets, PetsCount: r.PetsCount, Reason: r.Reason,
			Status: r.Status, ThreadID: r.ThreadID, CreatedAt: r.CreatedAt,
		})
	}
	return out, nil
}

// application devuelve una solicitud propia con su publicación.
func (a *App) application(ctx context.Context, viewerID, id string) (Application, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+applicationCols+` FROM adoption_applications WHERE id = $1`, id)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[applicationRow])
	if err != nil || len(list) == 0 {
		return Application{}, notFoundIfNoRows(errors.Join(err, pgx.ErrNoRows))
	}
	apps, err := a.toApplications(ctx, list)
	if err != nil {
		return Application{}, err
	}
	ad, err := a.GetAdoption(ctx, viewerID, list[0].AdoptionID)
	if err == nil {
		apps[0].Adoption = &ad
	}
	return apps[0], nil
}

// AdoptionApplications: las solicitudes de una publicación, solo para quien publicó.
func (a *App) AdoptionApplications(ctx context.Context, ac Actor, adoptionID string) ([]Application, error) {
	if _, err := a.ownAdoption(ctx, ac, adoptionID); err != nil {
		return nil, err
	}
	rows, _ := a.DB.Query(ctx, `SELECT `+applicationCols+` FROM adoption_applications WHERE adoption_id = $1
		ORDER BY status = 'pending' DESC, created_at`, adoptionID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[applicationRow])
	if err != nil {
		return nil, err
	}
	return a.toApplications(ctx, list)
}

// MyApplications: las solicitudes que envió la cuenta, cada una con su publicación.
func (a *App) MyApplications(ctx context.Context, ac Actor) ([]Application, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+applicationCols+` FROM adoption_applications WHERE applicant_id = $1 ORDER BY created_at DESC`, ac.ID)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[applicationRow])
	if err != nil {
		return nil, err
	}
	out, err := a.toApplications(ctx, list)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if ad, err := a.GetAdoption(ctx, ac.ID, out[i].AdoptionID); err == nil {
			out[i].Adoption = &ad
		}
	}
	return out, nil
}

// decidable carga una solicitud pendiente de una publicación propia.
func (a *App) decidable(ctx context.Context, ac Actor, applicationID string) (applicationRow, adoptionRow, error) {
	rows, _ := a.DB.Query(ctx, `SELECT `+applicationCols+` FROM adoption_applications WHERE id = $1`, applicationID)
	app, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[applicationRow])
	if err != nil {
		return app, adoptionRow{}, notFoundIfNoRows(err)
	}
	ad, err := a.ownAdoption(ctx, ac, app.AdoptionID)
	if err != nil {
		return app, ad, err
	}
	if app.Status != "pending" || ad.Status == "adopted" || ad.Status == "withdrawn" {
		return app, ad, ErrNotAllowed
	}
	return app, ad, nil
}

// AcceptApplication acepta una solicitud: la mascota queda "en proceso" y se abre un chat directo
// entre las dos personas para coordinar. Devuelve el chat.
func (a *App) AcceptApplication(ctx context.Context, ac Actor, applicationID string) (string, error) {
	app, ad, err := a.decidable(ctx, ac, applicationID)
	if err != nil {
		return "", err
	}
	now := a.now()
	var threadID string
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		// Si ya tienen un chat directo abierto, se reutiliza.
		err := tx.QueryRow(ctx, `SELECT t.id FROM threads t
			JOIN thread_members x ON x.thread_id = t.id AND x.user_id = $1
			JOIN thread_members y ON y.thread_id = t.id AND y.user_id = $2
			WHERE t.kind = 'dm' AND NOT t.archived LIMIT 1`, ac.ID, app.ApplicantID).Scan(&threadID)
		if errors.Is(err, pgx.ErrNoRows) {
			threadID = domain.NewID("dm")
			if _, err := tx.Exec(ctx, `INSERT INTO threads (id, kind, created_at) VALUES ($1, 'dm', $2)`, threadID, now); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO thread_members (thread_id, user_id, read_at, joined_at) VALUES ($1, $2, $4, $4), ($1, $3, $4, $4)`,
				threadID, ac.ID, app.ApplicantID, now); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if err := insertSystemMessage(ctx, tx, threadID, ac, "adoption_accepted", now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE adoption_applications SET status = 'accepted', decided_at = $2, thread_id = $3 WHERE id = $1`,
			applicationID, now, threadID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE adoptions SET status = 'in_process' WHERE id = $1 AND status = 'available'`, ad.ID)
		return err
	})
	if err != nil {
		return "", err
	}
	if m, err := a.lastMessage(ctx, threadID); err == nil {
		a.publishMessage(ctx, m)
	}
	a.background(func(ctx context.Context) {
		a.pushAdoption(ctx, app.ApplicantID, "application_accepted", ad.Name, "/chat/"+threadID)
	})
	return threadID, nil
}

// DeclineApplication rechaza una solicitud con un aviso amable.
func (a *App) DeclineApplication(ctx context.Context, ac Actor, applicationID string) error {
	app, ad, err := a.decidable(ctx, ac, applicationID)
	if err != nil {
		return err
	}
	if _, err := a.DB.Exec(ctx, `UPDATE adoption_applications SET status = 'declined', decided_at = $2 WHERE id = $1`, applicationID, a.now()); err != nil {
		return err
	}
	a.background(func(ctx context.Context) {
		a.pushAdoption(ctx, app.ApplicantID, "application_declined", ad.Name, "/pawfamily/solicitudes")
	})
	return nil
}

// AdoptionReportInput: "pide dinero" es el motivo propio de PawFamily.
type AdoptionReportInput struct {
	Reason string `json:"reason"`
	Note   string `json:"note"`
}

var adoptionReportReasons = map[string]bool{"money": true, "scam": true, "inappropriate": true, "other": true}

// ReportAdoption manda la publicación a moderación. Si alguien pide dinero, moderación la retira y
// puede suspender la cuenta.
func (a *App) ReportAdoption(ctx context.Context, ac Actor, adoptionID string, in AdoptionReportInput) error {
	if in.Reason == "" {
		in.Reason = "other"
	}
	if !adoptionReportReasons[in.Reason] {
		return invalid("reason")
	}
	row, err := a.adoptionRow(ctx, adoptionID)
	if err != nil || !row.visibleTo(ac.ID) {
		return ErrNotFound
	}
	if row.OwnerID == ac.ID {
		return ErrNotAllowed
	}
	_, err = a.DB.Exec(ctx, `INSERT INTO reports (id, reporter_id, target_kind, reported_user_id, adoption_id, reason, note, created_at)
		VALUES ($1, $2, 'adoption', $3, $4, $5, $6, $7)`, domain.NewID("rep"), ac.ID, row.OwnerID, adoptionID, in.Reason,
		optional(domain.Clean(in.Note, domain.ReportNoteMax)), a.now())
	if err == nil {
		a.reported()
	}
	return err
}

// adoptionTexts: los avisos de PawFamily no pertenecen a un caso, por eso no pasan por la bandeja
// de notificaciones; quedan en las listas de PawFamily.
var adoptionTexts = map[string]map[string][2]string{
	"es": {
		"application_new":      {"🏡 Nueva solicitud de adopción", "Alguien quiere adoptar a {name}. Revisa su solicitud en PawFamily."},
		"application_accepted": {"🎉 ¡Aceptaron tu solicitud!", "Puedes coordinar la adopción de {name} por el chat."},
		"application_declined": {"Solicitud de adopción", "Esta vez {name} irá a otro hogar. ¡Gracias por querer adoptar!"},
		"application_closed":   {"Solicitud de adopción", "{name} ya no está disponible. ¡Gracias por querer adoptar!"},
		"shelter_verified":     {"✅ Refugio verificado", "{name} ya aparece como refugio verificado en PawFamily."},
		"shelter_not_verified": {"Verificación de refugio", "No pudimos confirmar a {name} en el RUES. Abre PawFamily e inténtalo de nuevo: te diremos qué revisar."},
		"shelter_lost":         {"Verificación de refugio", "El RUES ya no muestra activa la matrícula de {name}, así que dejó de aparecer como refugio verificado."},
		"shelter_rejected":     {"Verificación de refugio", "Moderación quitó la verificación de {name}. Escríbenos si crees que es un error."},
		"adoption_completed":   {"🏡 ¡Bienvenido el nuevo integrante!", "{name} ya es parte de tu familia. Ganaste la insignia «Nuevo integrante»."},
		"application_expired":  {"Solicitud de adopción vencida", "Tu solicitud para adoptar a {name} venció sin respuesta. Hay más peluditos esperando un hogar en PawFamily."},
		"adoption_followup":    {"🐾 ¿Cómo está {name}?", "Cuéntale a quien te la dio cómo le va: comparte una foto en PawFamily."},
		"adoption_update":      {"📸 Novedades de {name}", "Su nueva familia compartió cómo está. Míralo en PawFamily."},
	},
	"en": {
		"application_new":      {"🏡 New adoption request", "Someone wants to adopt {name}. Check the request in PawFamily."},
		"application_accepted": {"🎉 Your request was accepted!", "You can arrange {name}'s adoption in the chat."},
		"application_declined": {"Adoption request", "This time {name} will go to another home. Thanks for wanting to adopt!"},
		"application_closed":   {"Adoption request", "{name} is no longer available. Thanks for wanting to adopt!"},
		"shelter_verified":     {"✅ Shelter verified", "{name} now shows as a verified shelter in PawFamily."},
		"shelter_not_verified": {"Shelter verification", "We couldn't confirm {name} in the RUES. Open PawFamily and try again: we'll tell you what to check."},
		"shelter_lost":         {"Shelter verification", "The RUES no longer shows {name}'s registration as active, so it no longer shows as a verified shelter."},
		"shelter_rejected":     {"Shelter verification", "Moderation removed {name}'s verification. Write to us if you think it's a mistake."},
		"adoption_completed":   {"🏡 Welcome, new family member!", "{name} is now part of your family. You earned the “New member” badge."},
		"application_expired":  {"Adoption request expired", "Your request to adopt {name} expired without an answer. More pets are waiting for a home in PawFamily."},
		"adoption_followup":    {"🐾 How is {name} doing?", "Tell the person who gave them to you how it is going: share a photo in PawFamily."},
		"adoption_update":      {"📸 News about {name}", "Their new family shared how they are doing. See it in PawFamily."},
	},
}

// pushAdoption actualiza PawFamily en vivo y avisa al celular.
func (a *App) pushAdoption(ctx context.Context, userID, kind, petName, url string) {
	a.Hub.Publish([]string{userID}, realtime.Event{Type: "adoption", Data: kind})
	person, ok := a.recipients(ctx, []string{userID})[userID]
	if !ok || !person.Prefs.Push {
		return
	}
	lang := person.Lang
	if _, ok := adoptionTexts[lang]; !ok {
		lang = "es"
	}
	text := adoptionTexts[lang][kind]
	messages := make([]providers.PushMessage, 0, len(person.Tokens))
	for _, token := range person.Tokens {
		messages = append(messages, providers.PushMessage{
			Token: token, Title: text[0], Body: strings.ReplaceAll(text[1], "{name}", petName), URL: url,
			Channel: channelUpdates, Silent: domain.IsQuietTime(person.Prefs, a.now()),
		})
	}
	a.sendPush(ctx, messages, "enviar push de PawFamily")
}

// mailNewApplication avisa por correo a quien publicó, si no apagó los correos en Ajustes. Si falla,
// el aviso de la app ya llegó.
func (a *App) mailNewApplication(ctx context.Context, ownerID, petName string) {
	var email, name, lang string
	var rawPrefs []byte
	if err := a.DB.QueryRow(ctx, `SELECT email, name, lang, notification_prefs FROM users WHERE id = $1`, ownerID).Scan(&email, &name, &lang, &rawPrefs); err != nil {
		return
	}
	prefs := domain.DefaultNotificationPrefs()
	_ = json.Unmarshal(rawPrefs, &prefs)
	if !prefs.Email {
		return
	}
	notice := providers.AdoptionRequestNotice(petName, strings.TrimRight(a.WebBaseURL, "/"), lang)
	if err := a.Mailer.SendNotice(ctx, email, name, notice); err != nil {
		a.Log.Warn("correo de solicitud de adopción", "err", err)
	}
}
