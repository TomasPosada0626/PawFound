// Package app implementa las reglas de negocio de PawFound sobre PostgreSQL/PostGIS.
//
// Es la versión de servidor de apps/mobile/src/services/mockBackend.ts: mismas reglas, mismos
// códigos de error, mismos límites. Los handlers HTTP (internal/httpapi) y el panel de
// moderación (internal/admin) solo traducen peticiones a estos métodos.
package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/ratelimit"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/realtime"
)

// App agrupa la base de datos y los proveedores.
type App struct {
	DB         *pgxpool.Pool
	Tokens     *auth.Tokens
	Codes      auth.CodeHasher
	Google     *auth.OIDCProvider
	Apple      *auth.OIDCProvider
	Push       providers.Push
	Translator providers.Translator
	Mailer     providers.Mailer
	Media      media.Store
	Hub        *realtime.Hub
	Log        *slog.Logger
	Now        func() time.Time

	// APIBaseURL arma las URLs absolutas de las fotos ("https://api.pawfound.app").
	APIBaseURL string
	// WebBaseURL arma los enlaces que se comparten ("https://pawfound.app").
	WebBaseURL string
	// RefreshTTL es la vida de un refresh token sin usar.
	RefreshTTL time.Duration
	// FixedCode solo en desarrollo: código de verificación fijo para probar la app en local.
	FixedCode string

	codeLimiter   *ratelimit.Limiter
	uploadLimiter *ratelimit.Limiter
}

// Init completa los valores por defecto. Se llama una vez al armar la App.
func (a *App) Init() {
	if a.Now == nil {
		a.Now = time.Now
	}
	if a.Log == nil {
		a.Log = slog.Default()
	}
	if a.RefreshTTL == 0 {
		a.RefreshTTL = 30 * 24 * time.Hour
	}
	if a.Hub == nil {
		a.Hub = realtime.NewHub()
	}
	if a.Push == nil {
		a.Push = providers.LogPush{Log: a.Log}
	}
	// Antiabuso: máximo 5 códigos de verificación por correo por hora.
	a.codeLimiter = ratelimit.New(5, time.Hour, a.Now)
	a.uploadLimiter = ratelimit.New(40, time.Hour, a.Now)
}

func (a *App) now() time.Time { return a.Now().UTC().Truncate(time.Microsecond) }

// Error es un error de negocio con código traducible por la app (nunca un texto armado).
type Error struct {
	Code   string         `json:"code"`
	Status int            `json:"-"`
	Params map[string]any `json:"params,omitempty"`
}

func (e *Error) Error() string { return e.Code }

func newErr(status int, code string, params map[string]any) *Error {
	return &Error{Code: code, Status: status, Params: params}
}

// Errores frecuentes. Los códigos coinciden con ErrorCode de apps/mobile/src/services/backendTypes.ts.
var (
	ErrUnauthorized       = newErr(http.StatusUnauthorized, "unauthorized", nil)
	ErrNotAllowed         = newErr(http.StatusForbidden, "not_allowed", nil)
	ErrNotFound           = newErr(http.StatusNotFound, "not_found", nil)
	ErrInvalidCredentials = newErr(http.StatusUnauthorized, "invalid_credentials", nil)
	ErrSuspended          = newErr(http.StatusForbidden, "suspended", nil)
)

func invalid(field string) *Error {
	return newErr(http.StatusUnprocessableEntity, "invalid_input", map[string]any{"field": field})
}

func rateLimited(retryAt time.Time) *Error {
	params := map[string]any{}
	if !retryAt.IsZero() {
		params["retryAt"] = retryAt.UTC().Format(time.RFC3339)
	}
	return newErr(http.StatusTooManyRequests, "rate_limited", params)
}

func providerUnavailable(name string) *Error {
	return newErr(http.StatusServiceUnavailable, "provider_unavailable", map[string]any{"provider": name})
}

// AsError convierte cualquier error en uno de negocio (los internos quedan como 500).
func AsError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return newErr(http.StatusInternalServerError, "unknown", nil)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func notFoundIfNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// Actor es la cuenta que hace la petición, cargada una vez por el middleware.
type Actor struct {
	ID          string     `db:"id"`
	Name        string     `db:"name"`
	Verified    bool       `db:"email_verified"`
	Role        string     `db:"role"`
	Lang        string     `db:"lang"`
	MutedUntil  *time.Time `db:"muted_until"`
	SuspendedAt *time.Time `db:"suspended_at"`
}

// ShortName es como ven a esta cuenta las demás personas.
func (ac Actor) ShortName() string { return shortName(ac.Name) }

// IsModerator: moderadores y administradores entran al panel.
func (ac Actor) IsModerator() bool { return ac.Role == "moderator" || ac.Role == "admin" }

// LoadActor trae la cuenta y rechaza las suspendidas.
func (a *App) LoadActor(ctx context.Context, userID string) (Actor, error) {
	rows, _ := a.DB.Query(ctx, `SELECT id, name, email_verified, role, lang, muted_until, suspended_at FROM users WHERE id = $1`, userID)
	actor, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[Actor])
	if errors.Is(err, pgx.ErrNoRows) {
		return Actor{}, ErrUnauthorized
	}
	if err != nil {
		return Actor{}, err
	}
	if actor.SuspendedAt != nil {
		return Actor{}, ErrSuspended
	}
	return actor, nil
}

// Authenticate valida un token de acceso y carga la cuenta.
func (a *App) Authenticate(ctx context.Context, token string) (Actor, error) {
	userID, err := a.Tokens.ParseAccess(token)
	if err != nil {
		return Actor{}, ErrUnauthorized
	}
	return a.LoadActor(ctx, userID)
}

// Las acciones de escritura comunitaria exigen celular verificado (insignia azul).
func requireVerified(ac Actor) error {
	if !ac.Verified {
		return ErrNotAllowed
	}
	return nil
}

func (a *App) mediaURL(id string) string {
	return strings.TrimRight(a.APIBaseURL, "/") + "/v1/media/" + id
}

func (a *App) mediaURLs(ids []string) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = a.mediaURL(id)
	}
	return out
}

// mediaIDFromRef acepta el id o la URL completa que devolvió la API.
func mediaIDFromRef(ref string) string {
	if i := strings.LastIndex(ref, "/v1/media/"); i >= 0 {
		return ref[i+len("/v1/media/"):]
	}
	return ref
}

type pgconnTag = pgconn.CommandTag

func ptr[T any](v T) *T { return &v }

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
