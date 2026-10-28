// Package admin es el panel web de moderación (issue #42).
//
// Se sirve desde la misma API en /admin, renderizado en el servidor y sin JavaScript: cada
// decisión es un formulario con token CSRF. La sesión es una cookie HttpOnly, SameSite=Strict
// y Secure fuera de desarrollo, guardada como hash en admin_sessions. Solo entran cuentas con
// rol moderator o admin (se otorga con `api grant-role`). El panel no carga nada de terceros:
// ni fuentes, ni scripts, ni analítica.
package admin

import (
	"context"
	"crypto/subtle"
	"embed"
	"errors"
	"html/template"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/ratelimit"
)

//go:embed templates/*.html static/*
var assets embed.FS

const (
	cookieName = "pf_admin"
	sessionTTL = 8 * time.Hour
)

// Panel es el handler montado en /admin.
type Panel struct {
	App          *app.App
	Log          *slog.Logger
	SecureCookie bool

	pages  map[string]*template.Template
	logins *ratelimit.Limiter
}

// Handler arma las rutas del panel.
func (p *Panel) Handler() http.Handler {
	p.pages = parsePages()
	p.logins = ratelimit.New(5, time.Minute, p.App.Now)
	static, _ := fs.Sub(assets, "static")

	r := chi.NewRouter()
	r.Use(adminHeaders)
	r.Handle("/static/*", http.StripPrefix("/admin/static/", http.FileServer(http.FS(static))))
	r.Get("/login", p.loginForm)
	r.Post("/login", p.login)
	r.Group(func(r chi.Router) {
		r.Use(p.requireSession)
		r.Post("/logout", p.logout)
		r.Get("/", p.dashboard)
		r.Get("/reports", p.reports)
		r.Get("/reports/{id}", p.report)
		r.Post("/reports/{id}", p.act)
		r.Get("/users", p.users)
		r.Get("/users/{id}", p.user)
		r.Post("/users/{id}", p.act)
		r.Get("/log", p.log)
		r.Get("/media/{id}", p.media)
	})
	return r
}

func adminHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// --- Plantillas -----------------------------------------------------------------

var reasonLabels = map[string]string{
	"spam": "Spam", "rude": "Groserías o acoso", "scam": "Estafa o fraude",
	"inappropriate": "Contenido inapropiado", "other": "Otro motivo",
}

var targetLabels = map[string]string{"user": "Persona", "message": "Mensaje", "pet": "Publicación"}

var actionLabels = map[string]string{
	"dismiss": "Descartó el reporte", "warn": "Envió un aviso", "mute": "Restringió los mensajes",
	"unmute": "Levantó la restricción", "remove_message": "Retiró un mensaje", "restore_message": "Restauró un mensaje",
	"remove_pet": "Retiró una publicación", "restore_pet": "Restauró una publicación", "suspend": "Suspendió la cuenta",
	"unsuspend": "Reactivó la cuenta",
}

var suggestLabels = map[string]string{
	"warn": "Enviar un aviso", "mute24": "Restringir 24 horas", "mute168": "Restringir 7 días",
	"suspend": "Suspender la cuenta", "dismiss": "Revisar y decidir", "none": "La cuenta ya está suspendida",
}

var funcs = template.FuncMap{
	"reason":  func(s string) string { return label(reasonLabels, s) },
	"target":  func(s string) string { return label(targetLabels, s) },
	"action":  func(s string) string { return label(actionLabels, s) },
	"suggest": func(s string) string { return label(suggestLabels, s) },
	"date": func(t time.Time) string {
		return t.In(domain.Bogota).Format("02/01/2006 15:04")
	},
	"ago": func(t time.Time) string { return ago(time.Since(t)) },
	"deref": func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	},
	"deref_int": func(n *int) int {
		if n == nil {
			return 0
		}
		return *n
	},
	"deref_time": func(t *time.Time) time.Time {
		if t == nil {
			return time.Time{}
		}
		return *t
	},
	"decide": func(d app.ReportDetail, csrf string) decideView {
		v := decideView{
			Suggest: d.Suggest, HasMessage: d.Message != nil, HasPet: d.Pet != nil, IsReport: true, CSRF: csrf,
			Action: "/admin/reports/" + d.Item.ID,
		}
		if d.Reported != nil {
			v.Muted = d.Reported.MutedUntil != nil && d.Reported.MutedUntil.After(time.Now())
			v.Suspended = d.Reported.SuspendedAt != nil
		}
		return v
	},
	"days": func(t time.Time) int { return domain.MemberDays(t, time.Now()) },
	"active": func(t *time.Time) bool {
		return t != nil && t.After(time.Now())
	},
	"mediaPath": func(u string) string {
		if i := strings.LastIndex(u, "/v1/media/"); i >= 0 {
			return "/admin/media/" + u[i+len("/v1/media/"):]
		}
		return ""
	},
}

// decideView alimenta el formulario de decisión (templates/actions.html).
type decideView struct {
	Suggest    string
	HasMessage bool
	HasPet     bool
	IsReport   bool
	Muted      bool
	Suspended  bool
	CSRF       string
	Action     string
}

func label(m map[string]string, key string) string {
	if v, ok := m[key]; ok {
		return v
	}
	return key
}

func ago(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "hace un momento"
	case d < time.Hour:
		return "hace " + strconv.Itoa(int(d.Minutes())) + " min"
	case d < 48*time.Hour:
		return "hace " + strconv.Itoa(int(d.Hours())) + " h"
	default:
		return "hace " + strconv.Itoa(int(d.Hours()/24)) + " días"
	}
}

func parsePages() map[string]*template.Template {
	pages := map[string]*template.Template{}
	for _, name := range []string{"login", "dashboard", "reports", "report", "users", "user", "log"} {
		pages[name] = template.Must(template.New("layout.html").Funcs(funcs).ParseFS(assets, "templates/layout.html", "templates/actions.html", "templates/"+name+".html"))
	}
	return pages
}

type view struct {
	Title     string
	Section   string
	Moderator *app.Actor
	CSRF      string
	Flash     string
	Error     string
	Data      any
}

func (p *Panel) render(w http.ResponseWriter, r *http.Request, status int, page string, v view) {
	if s, ok := sessionFrom(r); ok {
		v.Moderator, v.CSRF = &s.actor, s.csrf
	}
	if v.Flash == "" {
		v.Flash = r.URL.Query().Get("ok")
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := p.pages[page].ExecuteTemplate(w, "layout.html", v); err != nil {
		p.Log.Error("render del panel", "page", page, "err", err)
	}
}

// --- Sesión ---------------------------------------------------------------------

type session struct {
	actor app.Actor
	csrf  string
}

type sessionKey struct{}

func sessionFrom(r *http.Request) (session, bool) {
	s, ok := r.Context().Value(sessionKey{}).(session)
	return s, ok
}

func (p *Panel) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s, err := p.loadSession(r)
		if err != nil {
			http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
			return
		}
		if r.Method == http.MethodPost && subtle.ConstantTimeCompare([]byte(r.PostFormValue("csrf")), []byte(s.csrf)) != 1 {
			http.Error(w, "Token CSRF inválido. Recarga la página.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, s)))
	})
}

func (p *Panel) loadSession(r *http.Request) (session, error) {
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" {
		return session{}, errors.New("sin sesión")
	}
	var userID, csrf string
	var expires time.Time
	err = p.App.DB.QueryRow(r.Context(), `SELECT user_id, csrf, expires_at FROM admin_sessions WHERE id_hash = $1`, auth.HashToken(c.Value)).
		Scan(&userID, &csrf, &expires)
	if err != nil || p.App.Now().After(expires) {
		return session{}, errors.New("sesión vencida")
	}
	actor, err := p.App.LoadActor(r.Context(), userID)
	if err != nil || !actor.IsModerator() {
		return session{}, errors.New("sin permiso")
	}
	return session{actor: actor, csrf: csrf}, nil
}

func (p *Panel) loginForm(w http.ResponseWriter, r *http.Request) {
	p.render(w, r, http.StatusOK, "login", view{Title: "Entrar"})
}

func (p *Panel) login(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ok, _ := p.logins.Allow(ip); !ok {
		p.render(w, r, http.StatusTooManyRequests, "login", view{Title: "Entrar", Error: "Demasiados intentos. Espera un minuto."})
		return
	}
	email := strings.TrimSpace(r.PostFormValue("email"))
	session, err := p.App.Login(r.Context(), email, r.PostFormValue("password"))
	if err == nil {
		var actor app.Actor
		actor, err = p.App.LoadActor(r.Context(), session.Me.User.ID)
		if err == nil && !actor.IsModerator() {
			err = app.ErrNotAllowed
		}
		// El panel no usa los tokens de la app: se revoca la sesión recién creada.
		_ = p.App.Logout(r.Context(), session.RefreshToken)
	}
	if err != nil {
		// Mismo mensaje para cuenta inexistente, contraseña incorrecta o sin rol.
		p.render(w, r, http.StatusUnauthorized, "login", view{Title: "Entrar", Error: "Correo o contraseña incorrectos, o la cuenta no tiene acceso al panel."})
		return
	}
	token, csrf := auth.RandomToken(), auth.RandomToken()
	if _, err := p.App.DB.Exec(r.Context(), `INSERT INTO admin_sessions (id_hash, user_id, csrf, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		auth.HashToken(token), session.Me.User.ID, csrf, p.App.Now(), p.App.Now().Add(sessionTTL)); err != nil {
		http.Error(w, "No se pudo iniciar la sesión", http.StatusInternalServerError)
		return
	}
	// Secure solo se apaga en development (http://localhost); HttpOnly y SameSite=Strict siempre.
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/admin", HttpOnly: true, Secure: p.SecureCookie, //nolint:gosec // ver arriba
		SameSite: http.SameSiteStrictMode, MaxAge: int(sessionTTL.Seconds())})
	http.Redirect(w, r, "/admin/", http.StatusSeeOther)
}

func (p *Panel) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		_, _ = p.App.DB.Exec(r.Context(), `DELETE FROM admin_sessions WHERE id_hash = $1`, auth.HashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/admin", HttpOnly: true, Secure: p.SecureCookie, //nolint:gosec // igual que en login
		SameSite: http.SameSiteStrictMode, MaxAge: -1})
	http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
}

// --- Páginas --------------------------------------------------------------------

func (p *Panel) dashboard(w http.ResponseWriter, r *http.Request) {
	stats, err := p.App.ModerationStats(r.Context())
	if err != nil {
		p.fail(w, err)
		return
	}
	queue, err := p.App.ModerationQueue(r.Context(), "open", 8)
	if err != nil {
		p.fail(w, err)
		return
	}
	p.render(w, r, http.StatusOK, "dashboard", view{Title: "Resumen", Section: "dashboard", Data: map[string]any{"Stats": stats, "Queue": queue}})
}

func (p *Panel) reports(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status != "actioned" && status != "dismissed" {
		status = "open"
	}
	queue, err := p.App.ModerationQueue(r.Context(), status, 100)
	if err != nil {
		p.fail(w, err)
		return
	}
	p.render(w, r, http.StatusOK, "reports", view{Title: "Reportes", Section: "reports", Data: map[string]any{"Status": status, "Queue": queue}})
}

func (p *Panel) report(w http.ResponseWriter, r *http.Request) {
	detail, err := p.App.ModerationReport(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, app.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		p.fail(w, err)
		return
	}
	p.render(w, r, http.StatusOK, "report", view{Title: "Reporte", Section: "reports", Error: r.URL.Query().Get("error"), Data: detail})
}

func (p *Panel) users(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	found, err := p.App.FindUsers(r.Context(), q)
	if err != nil {
		p.fail(w, err)
		return
	}
	p.render(w, r, http.StatusOK, "users", view{Title: "Cuentas", Section: "users", Data: map[string]any{"Q": q, "Users": found}})
}

func (p *Panel) user(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	u, err := p.App.UserBrief(r.Context(), id)
	if errors.Is(err, app.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		p.fail(w, err)
		return
	}
	history, err := p.App.ModerationLog(r.Context(), id, 50)
	if err != nil {
		p.fail(w, err)
		return
	}
	s, _ := sessionFrom(r)
	decide := decideView{
		Suggest: app.SuggestSanction(&u, history), CSRF: s.csrf, Action: "/admin/users/" + u.ID,
		Muted: u.MutedUntil != nil && u.MutedUntil.After(p.App.Now()), Suspended: u.SuspendedAt != nil,
	}
	p.render(w, r, http.StatusOK, "user", view{
		Title: u.Name, Section: "users", Error: r.URL.Query().Get("error"),
		Data: map[string]any{"User": u, "History": history, "Decide": decide},
	})
}

func (p *Panel) log(w http.ResponseWriter, r *http.Request) {
	entries, err := p.App.ModerationLog(r.Context(), "", 200)
	if err != nil {
		p.fail(w, err)
		return
	}
	p.render(w, r, http.StatusOK, "log", view{Title: "Bitácora", Section: "log", Data: entries})
}

// act aplica una decisión desde la página de un reporte o de una cuenta.
func (p *Panel) act(w http.ResponseWriter, r *http.Request) {
	s, _ := sessionFrom(r)
	id := chi.URLParam(r, "id")
	in := app.ModerationInput{
		Action: r.PostFormValue("action"), Note: r.PostFormValue("note"),
		MessageID: r.PostFormValue("message_id"), PetID: r.PostFormValue("pet_id"),
	}
	back := "/admin/users/" + url.PathEscape(id)
	if strings.HasPrefix(r.URL.Path, "/admin/reports/") {
		in.ReportID, back = id, "/admin/reports/"+url.PathEscape(id)
	} else {
		in.UserID = id
	}
	switch in.Action {
	case "mute24":
		in.Action, in.Hours = "mute", 24
	case "mute168":
		in.Action, in.Hours = "mute", 168
	}
	if in.Action == "suspend" && r.PostFormValue("confirm") != "yes" {
		http.Redirect(w, r, back+"?error="+url.QueryEscape("Confirma la suspensión marcando la casilla."), http.StatusSeeOther)
		return
	}
	if err := p.App.Moderate(r.Context(), s.actor, in); err != nil {
		msg := "No se pudo aplicar la decisión."
		var e *app.Error
		if errors.As(err, &e) {
			switch e.Code {
			case "not_allowed":
				msg = "No tienes permiso para sancionar esta cuenta."
			case "invalid_input":
				msg = "Falta un dato: una suspensión siempre lleva su motivo."
			case "not_found":
				msg = "El contenido ya no existe."
			}
		} else {
			p.Log.Error("moderación", "err", err)
		}
		http.Redirect(w, r, back+"?error="+url.QueryEscape(msg), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, back+"?ok="+url.QueryEscape("Decisión registrada en la bitácora."), http.StatusSeeOther)
}

// media sirve cualquier foto al equipo (también las de chats, que la API solo da a sus miembros).
func (p *Panel) media(w http.ResponseWriter, r *http.Request) {
	var key, contentType string
	err := p.App.DB.QueryRow(r.Context(), `SELECT storage_key, content_type FROM media WHERE id = $1`, chi.URLParam(r, "id")).Scan(&key, &contentType)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		p.fail(w, err)
		return
	}
	f, err := p.App.Media.Open(r.Context(), key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = f.Close() }()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = io.Copy(w, f)
}

func (p *Panel) fail(w http.ResponseWriter, err error) {
	p.Log.Error("panel de moderación", "err", err)
	http.Error(w, "Algo salió mal. Intenta de nuevo.", http.StatusInternalServerError)
}
