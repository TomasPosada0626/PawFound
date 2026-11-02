package app

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/ratelimit"
)

const (
	backgroundTimeout = time.Minute
	// alertsActiveFor: tras esto el círculo de vida ya llegó a su tope y no hay alertas nuevas.
	alertsActiveFor   = 45 * time.Minute
	adminCodeTTL      = 10 * time.Minute
	adminCodeAttempts = 5
)

// background hace lo que no debe demorar la respuesta (notificaciones, avisos a otras personas).
// Sobrevive a que la petición termine y main espera a que acabe antes de apagar el servidor.
func (a *App) background(fn func(ctx context.Context)) {
	if a.Inline {
		fn(context.Background())
		return
	}
	a.bg.Add(1)
	go func() {
		defer a.bg.Done()
		defer func() {
			if r := recover(); r != nil {
				a.Log.Error("tarea en segundo plano", "panic", r)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), backgroundTimeout)
		defer cancel()
		fn(ctx)
	}()
}

// WaitBackground espera las tareas en curso, hasta que venza ctx.
func (a *App) WaitBackground(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		a.bg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// NewLimiter crea un límite que sobrevive a los reinicios (en memoria si no hay base de datos).
func (a *App) NewLimiter(scope string, limit int, window time.Duration) ratelimit.Allower {
	if a.DB == nil {
		return ratelimit.New(limit, window, a.Now)
	}
	return ratelimit.NewDurable(a.DB, scope, limit, window, a.Now)
}

// ClientIP es la IP real: la cabecera del proxy de confianza si es válida o, si no, la conexión.
func ClientIP(r *http.Request, trustedHeader string) string {
	if trustedHeader != "" {
		if v := strings.TrimSpace(r.Header.Get(trustedHeader)); v != "" && net.ParseIP(v) != nil {
			return v
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// touchAlerts avisa a las tareas periódicas que hay un círculo creciendo o alguien en movimiento.
func (a *App) touchAlerts() { a.alertsActive.Store(a.Now().Unix()) }

// AlertsDue dice si vale la pena revisar las alertas ya. Sin actividad reciente la revisión puede
// esperar y la base de datos descansa: Neon cobra por el tiempo que pasa despierta.
func (a *App) AlertsDue(now time.Time) bool {
	last := a.alertsActive.Load()
	return last != 0 && now.Sub(time.Unix(last, 0)) <= alertsActiveFor
}

// RemoveStored borra una foto y su miniatura del almacenamiento.
func (a *App) RemoveStored(ctx context.Context, key string) error {
	remover, ok := a.Media.(interface {
		Remove(context.Context, string) error
	})
	if !ok {
		return nil
	}
	_ = remover.Remove(ctx, media.ThumbKey(key))
	return remover.Remove(ctx, key)
}

// StartAdminChallenge es el segundo factor del panel: envía un código al correo de la cuenta y
// devuelve el token que lo acompaña. La contraseña sola no abre el panel.
func (a *App) StartAdminChallenge(ctx context.Context, userID string) (string, error) {
	if a.Mailer == nil {
		return "", providerUnavailable("email")
	}
	var email, name, lang string
	if err := a.DB.QueryRow(ctx, `SELECT email, name, lang FROM users WHERE id = $1`, userID).Scan(&email, &name, &lang); err != nil {
		return "", notFoundIfNoRows(err)
	}
	code := auth.SMSCode()
	if a.FixedCode != "" {
		code = a.FixedCode
	}
	token := auth.RandomToken()
	if _, err := a.DB.Exec(ctx, `INSERT INTO admin_login_challenges (token_hash, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		auth.HashToken(token), userID, a.Codes.Hash(token, code), a.now().Add(adminCodeTTL)); err != nil {
		return "", err
	}
	if err := a.Mailer.SendVerificationCode(ctx, email, name, code, lang); err != nil {
		a.Log.Error("no se pudo enviar el código del panel", "err", err)
		return "", providerUnavailable("email")
	}
	return token, nil
}

// FinishAdminChallenge valida el código y devuelve la cuenta. Sirve una sola vez y se invalida al
// quinto intento fallido.
func (a *App) FinishAdminChallenge(ctx context.Context, token, code string) (string, error) {
	var userID string
	var matched bool
	err := a.withTx(ctx, func(tx pgx.Tx) error {
		var stored []byte
		var attempts int
		hash := auth.HashToken(token)
		err := tx.QueryRow(ctx, `SELECT user_id, code_hash, attempts FROM admin_login_challenges WHERE token_hash = $1 AND expires_at > $2 FOR UPDATE`,
			hash, a.now()).Scan(&userID, &stored, &attempts)
		if err != nil {
			return notFoundIfNoRows(err)
		}
		matched = a.Codes.Equal(stored, token, code)
		if matched || attempts+1 >= adminCodeAttempts {
			_, err = tx.Exec(ctx, `DELETE FROM admin_login_challenges WHERE token_hash = $1`, hash)
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE admin_login_challenges SET attempts = attempts + 1 WHERE token_hash = $1`, hash)
		return err
	})
	if err != nil {
		return "", ErrNotAllowed
	}
	if !matched {
		return "", ErrNotAllowed
	}
	return userID, nil
}
