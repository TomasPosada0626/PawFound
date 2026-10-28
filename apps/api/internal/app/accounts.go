package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
)

// Reglas de la verificación por SMS (mockBackend.ts).
const (
	ResendCooldown  = 45 * time.Second
	CodeTTL         = 10 * time.Minute
	MaxCodeAttempts = 5
	LockDuration    = 5 * time.Minute
	resetTTL        = 30 * time.Minute
)

// RegisterInput es el formulario de registro.
type RegisterInput struct {
	Name        string `json:"name"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Password    string `json:"password"`
	Lang        string `json:"lang"`
	AcceptTerms bool   `json:"acceptTerms"`
	ConfirmAge  bool   `json:"confirmAge"`
}

// Register crea la cuenta, envía el código SMS y abre la sesión (sin insignia azul todavía).
func (a *App) Register(ctx context.Context, in RegisterInput) (Session, error) {
	name := domain.Clean(in.Name, 80)
	email := strings.ToLower(strings.TrimSpace(in.Email))
	phone := domain.NormalizeColombianMobile(in.Phone)
	switch {
	case len([]rune(name)) < 2:
		return Session{}, invalid("name")
	case !domain.ValidEmail(email):
		return Session{}, invalid("email")
	case phone == "":
		return Session{}, newErr(http.StatusUnprocessableEntity, "invalid_phone", nil)
	case domain.PasswordIssue(in.Password) != "":
		return Session{}, newErr(http.StatusUnprocessableEntity, "invalid_input", map[string]any{"field": "password", "issue": domain.PasswordIssue(in.Password)})
	case !in.AcceptTerms || !in.ConfirmAge:
		return Session{}, invalid("acceptTerms")
	}
	lang := in.Lang
	if !domain.Langs[lang] {
		lang = "es"
	}
	if a.phoneTaken(ctx, phone, "") {
		return Session{}, newErr(http.StatusConflict, "phone_taken", nil)
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return Session{}, err
	}
	userID := domain.NewID("u")
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		username, err := a.uniqueUsername(ctx, tx, email)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO users (id, name, username, email, password_hash, phone, lang, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, userID, name, username, email, hash, phone, lang, a.now()); err != nil {
			if isUniqueViolation(err) {
				return newErr(http.StatusConflict, "email_taken", nil)
			}
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO consents (user_id, kind, granted, at) VALUES ($1, 'terms', true, $2)`, userID, a.now())
		return err
	})
	if err != nil {
		return Session{}, err
	}
	if err := a.issueCode(ctx, userID, phone); err != nil {
		// Sin código enviado no hay forma de verificar: se deshace la cuenta para que la
		// persona pueda volver a intentarlo con el mismo correo.
		_, _ = a.DB.Exec(context.WithoutCancel(ctx), `DELETE FROM users WHERE id = $1`, userID)
		return Session{}, err
	}
	return a.newSession(ctx, userID)
}

func (a *App) uniqueUsername(ctx context.Context, tx pgx.Tx, email string) (string, error) {
	base := domain.UsernameBase(email)
	candidate := base
	for attempt := 0; attempt < 20; attempt++ {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`, candidate).Scan(&taken); err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s%d", base[:min(len(base), 14)], 10+rand.IntN(990)) //nolint:gosec // no es un secreto
	}
	return domain.NewID("pf")[:19], nil
}

func (a *App) phoneTaken(ctx context.Context, phone, exceptUserID string) bool {
	var taken bool
	_ = a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE phone = $1 AND phone_verified AND id <> $2)`, phone, exceptUserID).Scan(&taken)
	return taken
}

// Login con correo y contraseña. El mismo error para correo inexistente y contraseña
// incorrecta, y el mismo tiempo de respuesta: no revela si la cuenta existe.
func (a *App) Login(ctx context.Context, email, password string) (Session, error) {
	var userID, hash string
	var suspended *time.Time
	err := a.DB.QueryRow(ctx, `SELECT id, coalesce(password_hash, ''), suspended_at FROM users WHERE lower(email) = lower($1)`,
		strings.TrimSpace(email)).Scan(&userID, &hash, &suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		auth.CheckPassword("", password)
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !auth.CheckPassword(hash, password) {
		return Session{}, ErrInvalidCredentials
	}
	if suspended != nil {
		return Session{}, ErrSuspended
	}
	session, err := a.newSession(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	if !session.Me.User.PhoneVerified && session.Me.User.Phone != nil {
		if err := a.issueCode(ctx, userID, *session.Me.User.Phone); err != nil {
			return Session{}, err
		}
		session.NeedsVerification = true
	}
	return session, nil
}

// LoginWithProvider verifica el ID token de Google o Apple. Facebook necesita su propia
// verificación de servidor y queda pendiente de configurar.
func (a *App) LoginWithProvider(ctx context.Context, provider, idToken, lang string) (Session, error) {
	var p *auth.OIDCProvider
	switch provider {
	case "google":
		p = a.Google
	case "apple":
		p = a.Apple
	case "facebook":
		return Session{}, providerUnavailable("facebook")
	default:
		return Session{}, invalid("provider")
	}
	if !p.Enabled() {
		return Session{}, providerUnavailable(provider)
	}
	identity, err := p.Verify(ctx, idToken)
	if err != nil {
		return Session{}, ErrInvalidCredentials
	}
	userID, err := a.userForIdentity(ctx, identity, lang)
	if err != nil {
		return Session{}, err
	}
	session, err := a.newSession(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	session.NeedsPhone = !session.Me.User.PhoneVerified
	return session, nil
}

func (a *App) userForIdentity(ctx context.Context, id auth.Identity, lang string) (string, error) {
	var userID string
	err := a.DB.QueryRow(ctx, `SELECT user_id FROM oauth_identities WHERE provider = $1 AND subject = $2`, id.Provider, id.Subject).Scan(&userID)
	if err == nil {
		return userID, a.ensureNotSuspended(ctx, userID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	email := strings.ToLower(strings.TrimSpace(id.Email))
	if email == "" || !id.EmailVerified {
		// Sin correo verificado no se puede enlazar ni crear con seguridad.
		return "", ErrInvalidCredentials
	}
	if !domain.Langs[lang] {
		lang = "es"
	}
	err = a.withTx(ctx, func(tx pgx.Tx) error {
		// Correo verificado por el proveedor que ya existe: se enlaza a esa cuenta.
		err := tx.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			userID = domain.NewID("u")
			name := domain.Clean(id.Name, 80)
			if len([]rune(name)) < 2 {
				name = strings.Split(email, "@")[0]
			}
			username, err := a.uniqueUsername(ctx, tx, email)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO users (id, name, username, email, lang, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
				userID, name, username, email, lang, a.now()); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO oauth_identities (provider, subject, user_id) VALUES ($1, $2, $3)`, id.Provider, id.Subject, userID)
		return err
	})
	if err != nil {
		return "", err
	}
	return userID, a.ensureNotSuspended(ctx, userID)
}

func (a *App) ensureNotSuspended(ctx context.Context, userID string) error {
	_, err := a.LoadActor(ctx, userID)
	return err
}

// newSession emite un token de acceso y un refresh token de una familia nueva.
func (a *App) newSession(ctx context.Context, userID string) (Session, error) {
	refresh, err := a.storeRefresh(ctx, userID, domain.NewID("fam"))
	if err != nil {
		return Session{}, err
	}
	return a.sessionWith(ctx, userID, refresh)
}

func (a *App) sessionWith(ctx context.Context, userID, refresh string) (Session, error) {
	access, err := a.Tokens.IssueAccess(userID)
	if err != nil {
		return Session{}, err
	}
	me, err := a.Me(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	return Session{AccessToken: access, RefreshToken: refresh, ExpiresIn: int(a.Tokens.AccessTTL().Seconds()), Me: me}, nil
}

func (a *App) storeRefresh(ctx context.Context, userID, family string) (string, error) {
	token := auth.RandomToken()
	_, err := a.DB.Exec(ctx, `INSERT INTO refresh_tokens (id, user_id, family, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		domain.NewID("rt"), userID, family, auth.HashToken(token), a.now(), a.now().Add(a.RefreshTTL))
	return token, err
}

// Refresh rota el refresh token. Usar uno ya rotado revoca toda su familia: alguien más lo
// tiene (robo de sesión) y ambas copias dejan de servir.
func (a *App) Refresh(ctx context.Context, token string) (Session, error) {
	var id, userID, family string
	var expires time.Time
	var revoked *time.Time
	err := a.DB.QueryRow(ctx, `SELECT id, user_id, family, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
		auth.HashToken(token)).Scan(&id, &userID, &family, &expires, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrUnauthorized
	}
	if err != nil {
		return Session{}, err
	}
	if revoked != nil {
		_, _ = a.DB.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, $2) WHERE family = $1`, family, a.now())
		a.Log.Warn("reuso de refresh token: familia revocada", "user", userID)
		return Session{}, ErrUnauthorized
	}
	if a.now().After(expires) {
		return Session{}, ErrUnauthorized
	}
	if err := a.ensureNotSuspended(ctx, userID); err != nil {
		return Session{}, err
	}
	tag, err := a.DB.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, id, a.now())
	if err != nil {
		return Session{}, err
	}
	if tag.RowsAffected() == 0 { // otra petición lo rotó al mismo tiempo
		return Session{}, ErrUnauthorized
	}
	next, err := a.storeRefresh(ctx, userID, family)
	if err != nil {
		return Session{}, err
	}
	return a.sessionWith(ctx, userID, next)
}

// Logout revoca la familia del refresh token (cierra esa sesión en ese dispositivo).
func (a *App) Logout(ctx context.Context, token string) error {
	_, err := a.DB.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, $2)
		WHERE family = (SELECT family FROM refresh_tokens WHERE token_hash = $1)`, auth.HashToken(token), a.now())
	return err
}

// --- Verificación del celular ---------------------------------------------

func (a *App) issueCode(ctx context.Context, userID, phone string) error {
	if ok, _ := a.smsLimiter.Allow(phone); !ok {
		return rateLimited(time.Time{})
	}
	code := auth.SMSCode()
	if a.FixedSMSCode != "" {
		code = a.FixedSMSCode
	}
	// Se conserva el contador de intentos y el bloqueo: reenviar no reinicia el castigo.
	if _, err := a.DB.Exec(ctx, `INSERT INTO phone_verifications (user_id, phone, code_hash, sent_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, code_hash = EXCLUDED.code_hash, sent_at = EXCLUDED.sent_at,
		attempts = CASE WHEN phone_verifications.phone = EXCLUDED.phone THEN phone_verifications.attempts ELSE 0 END`,
		userID, phone, a.Codes.Hash(phone, code), a.now()); err != nil {
		return err
	}
	if err := a.SMS.SendCode(ctx, phone, code); err != nil {
		if errors.Is(err, providers.ErrDisabled) {
			return providerUnavailable("sms")
		}
		return err
	}
	return nil
}

// StartPhoneVerification es el paso "agrega y verifica tu número" (login social o cambio de número).
func (a *App) StartPhoneVerification(ctx context.Context, ac Actor, raw string) error {
	phone := domain.NormalizeColombianMobile(raw)
	if phone == "" {
		return newErr(http.StatusUnprocessableEntity, "invalid_phone", nil)
	}
	if a.phoneTaken(ctx, phone, ac.ID) {
		return newErr(http.StatusConflict, "phone_taken", nil)
	}
	if _, err := a.DB.Exec(ctx, `UPDATE users SET phone = $2, phone_verified = false WHERE id = $1`, ac.ID, phone); err != nil {
		return err
	}
	return a.issueCode(ctx, ac.ID, phone)
}

type verification struct {
	Phone       string     `db:"phone"`
	CodeHash    []byte     `db:"code_hash"`
	SentAt      time.Time  `db:"sent_at"`
	Attempts    int        `db:"attempts"`
	LockedUntil *time.Time `db:"locked_until"`
}

func (a *App) verification(ctx context.Context, userID string) (verification, error) {
	rows, _ := a.DB.Query(ctx, `SELECT phone, code_hash, sent_at, attempts, locked_until FROM phone_verifications WHERE user_id = $1`, userID)
	v, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[verification])
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotAllowed
	}
	return v, err
}

// ResendCode respeta la espera de 45 s entre envíos.
func (a *App) ResendCode(ctx context.Context, ac Actor) (int, error) {
	v, err := a.verification(ctx, ac.ID)
	if err != nil {
		return 0, err
	}
	if wait := ResendCooldown - a.now().Sub(v.SentAt); wait > 0 {
		return int(wait.Seconds() + 0.999), newErr(http.StatusTooManyRequests, "rate_limited", map[string]any{"seconds": int(wait.Seconds() + 0.999)})
	}
	return int(ResendCooldown.Seconds()), a.issueCode(ctx, ac.ID, v.Phone)
}

// VerifyCode confirma el celular y otorga la insignia azul. 5 intentos fallidos bloquean 5 minutos.
func (a *App) VerifyCode(ctx context.Context, ac Actor, code string) error {
	v, err := a.verification(ctx, ac.ID)
	if err != nil {
		return err
	}
	now := a.now()
	if v.LockedUntil != nil && v.LockedUntil.After(now) {
		minutes := int(v.LockedUntil.Sub(now).Minutes() + 0.999)
		return newErr(http.StatusTooManyRequests, "locked", map[string]any{"minutes": minutes})
	}
	if now.Sub(v.SentAt) > CodeTTL {
		return newErr(http.StatusGone, "expired", nil)
	}
	if !a.Codes.Equal(v.CodeHash, v.Phone, strings.TrimSpace(code)) {
		attempts := v.Attempts + 1
		if attempts >= MaxCodeAttempts {
			_, err := a.DB.Exec(ctx, `UPDATE phone_verifications SET attempts = 0, locked_until = $2 WHERE user_id = $1`, ac.ID, now.Add(LockDuration))
			if err != nil {
				return err
			}
			return newErr(http.StatusTooManyRequests, "locked", map[string]any{"minutes": int(LockDuration.Minutes())})
		}
		if _, err := a.DB.Exec(ctx, `UPDATE phone_verifications SET attempts = $2 WHERE user_id = $1`, ac.ID, attempts); err != nil {
			return err
		}
		return newErr(http.StatusUnprocessableEntity, "wrong_code", map[string]any{"count": MaxCodeAttempts - attempts})
	}
	return a.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET phone = $2, phone_verified = true WHERE id = $1`, ac.ID, v.Phone); err != nil {
			if isUniqueViolation(err) {
				return newErr(http.StatusConflict, "phone_taken", nil)
			}
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM phone_verifications WHERE user_id = $1`, ac.ID)
		return err
	})
}

// RequestPasswordReset responde igual exista o no la cuenta (sin enumeración de correos).
func (a *App) RequestPasswordReset(ctx context.Context, email string) error {
	var userID string
	err := a.DB.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = lower($1) AND password_hash IS NOT NULL AND suspended_at IS NULL`,
		strings.TrimSpace(email)).Scan(&userID)
	if err != nil {
		return nil //nolint:nilerr // misma respuesta para correos desconocidos
	}
	token := auth.RandomToken()
	if _, err := a.DB.Exec(ctx, `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		auth.HashToken(token), userID, a.now().Add(resetTTL)); err != nil {
		return err
	}
	if a.Mailer == nil {
		a.Log.Warn("restablecimiento solicitado sin proveedor de correo configurado")
		return nil
	}
	return a.Mailer.SendPasswordReset(ctx, email, strings.TrimRight(a.WebBaseURL, "/")+"/restablecer?token="+token)
}

// ResetPassword usa el enlace (una sola vez) y cierra todas las sesiones abiertas.
func (a *App) ResetPassword(ctx context.Context, token, password string) error {
	if issue := domain.PasswordIssue(password); issue != "" {
		return newErr(http.StatusUnprocessableEntity, "invalid_input", map[string]any{"field": "password", "issue": issue})
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	return a.withTx(ctx, func(tx pgx.Tx) error {
		var userID string
		err := tx.QueryRow(ctx, `UPDATE password_resets SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING user_id`,
			auth.HashToken(token), a.now()).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return newErr(http.StatusGone, "expired", nil)
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, userID, hash); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, $2) WHERE user_id = $1`, userID, a.now())
		return err
	})
}

// --- Cuenta propia ---------------------------------------------------------

func (a *App) loadUser(ctx context.Context, q querier, userID string) (User, error) {
	rows, _ := q.Query(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, userID)
	u, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByName[User])
	return u, notFoundIfNoRows(err)
}

// Me devuelve la cuenta con preferencias, zona de alertas y cupo de publicación.
func (a *App) Me(ctx context.Context, userID string) (Me, error) {
	u, err := a.loadUser(ctx, a.DB, userID)
	if err != nil {
		return Me{}, err
	}
	prefs, who, err := a.prefs(ctx, userID)
	if err != nil {
		return Me{}, err
	}
	me := Me{User: u, NotificationPrefs: prefs, PrivacyPrefs: PrivacyPrefs{WhoCanMessage: who}}
	var zone AlertZone
	err = a.DB.QueryRow(ctx, `SELECT lat, lng, zone FROM alert_zones WHERE user_id = $1`, userID).Scan(&zone.Location.Lat, &zone.Location.Lng, &zone.Zone)
	if err == nil {
		me.AlertZone = &zone
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Me{}, err
	}
	allowed, retry, err := a.allowance(ctx, userID)
	if err != nil {
		return Me{}, err
	}
	me.Allowance = Allowance{Allowed: allowed}
	if !allowed {
		me.Allowance.RetryAt = &retry
	}
	return me, nil
}

func (a *App) prefs(ctx context.Context, userID string) (domain.NotificationPrefs, string, error) {
	var raw []byte
	var who string
	if err := a.DB.QueryRow(ctx, `SELECT notification_prefs, who_can_message FROM users WHERE id = $1`, userID).Scan(&raw, &who); err != nil {
		return domain.NotificationPrefs{}, "", notFoundIfNoRows(err)
	}
	prefs := domain.DefaultNotificationPrefs()
	_ = json.Unmarshal(raw, &prefs) // lo guardado pisa los valores por defecto
	return prefs, who, nil
}

func (a *App) allowance(ctx context.Context, userID string) (bool, time.Time, error) {
	rows, _ := a.DB.Query(ctx, `SELECT created_at FROM pets WHERE owner_id = $1 AND created_at > $2`, userID, a.now().Add(-24*time.Hour))
	times, err := pgx.CollectRows(rows, pgx.RowTo[time.Time])
	if err != nil {
		return false, time.Time{}, err
	}
	allowed, retry := domain.PublishAllowance(times, a.now())
	return allowed, retry, nil
}

// ProfilePatch son los campos editables del perfil.
type ProfilePatch struct {
	Name         *string `json:"name"`
	Username     *string `json:"username"`
	Avatar       *string `json:"avatar"`
	Title        *string `json:"title"`
	Bio          *string `json:"bio"`
	City         *string `json:"city"`
	Neighborhood *string `json:"neighborhood"`
}

// UpdateProfile valida y guarda los cambios del perfil.
func (a *App) UpdateProfile(ctx context.Context, ac Actor, p ProfilePatch) (Me, error) {
	sets := []string{}
	args := []any{ac.ID}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if p.Name != nil {
		name := domain.Clean(*p.Name, 80)
		if len([]rune(name)) < 2 {
			return Me{}, invalid("name")
		}
		add("name", name)
	}
	if p.Username != nil {
		u := domain.NormalizeUsername(*p.Username)
		if u == "" {
			return Me{}, newErr(http.StatusUnprocessableEntity, "invalid_username", nil)
		}
		add("username", u)
	}
	if p.Avatar != nil {
		if !domain.Avatars[*p.Avatar] {
			return Me{}, invalid("avatar")
		}
		add("avatar", *p.Avatar)
	}
	if p.Title != nil {
		if !domain.Titles[*p.Title] {
			return Me{}, invalid("title")
		}
		add("title", *p.Title)
	}
	if p.Bio != nil {
		add("bio", domain.Clean(*p.Bio, domain.BioMax))
	}
	if p.City != nil {
		city := domain.Clean(*p.City, 60)
		if city == "" {
			return Me{}, invalid("city")
		}
		add("city", city)
	}
	if p.Neighborhood != nil {
		add("neighborhood", optional(domain.Clean(*p.Neighborhood, 60)))
	}
	if len(sets) > 0 {
		if _, err := a.DB.Exec(ctx, `UPDATE users SET `+strings.Join(sets, ", ")+` WHERE id = $1`, args...); err != nil {
			if isUniqueViolation(err) {
				return Me{}, newErr(http.StatusConflict, "username_taken", nil)
			}
			return Me{}, err
		}
	}
	return a.Me(ctx, ac.ID)
}

// SetLanguage: los chats llegan traducidos a este idioma.
func (a *App) SetLanguage(ctx context.Context, ac Actor, lang string) error {
	if !domain.Langs[lang] {
		return invalid("lang")
	}
	_, err := a.DB.Exec(ctx, `UPDATE users SET lang = $2 WHERE id = $1`, ac.ID, lang)
	return err
}

// UpdateNotificationPrefs mezcla el cambio con lo guardado.
func (a *App) UpdateNotificationPrefs(ctx context.Context, ac Actor, patch json.RawMessage) (domain.NotificationPrefs, error) {
	prefs, _, err := a.prefs(ctx, ac.ID)
	if err != nil {
		return prefs, err
	}
	if err := json.Unmarshal(patch, &prefs); err != nil {
		return prefs, invalid("notificationPrefs")
	}
	if !domain.ValidClock(prefs.QuietFrom) || !domain.ValidClock(prefs.QuietTo) {
		return prefs, invalid("quietHours")
	}
	raw, _ := json.Marshal(prefs)
	_, err = a.DB.Exec(ctx, `UPDATE users SET notification_prefs = $2 WHERE id = $1`, ac.ID, raw)
	return prefs, err
}

// UpdatePrivacy: quién puede escribir por mensaje directo.
func (a *App) UpdatePrivacy(ctx context.Context, ac Actor, p PrivacyPrefs) error {
	if !domain.WhoMessage[p.WhoCanMessage] {
		return invalid("whoCanMessage")
	}
	_, err := a.DB.Exec(ctx, `UPDATE users SET who_can_message = $2 WHERE id = $1`, ac.ID, p.WhoCanMessage)
	return err
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (a *App) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
