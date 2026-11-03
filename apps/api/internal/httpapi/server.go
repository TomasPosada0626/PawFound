// Package httpapi expone la API REST v1 (packages/contracts/openapi.yaml) sobre internal/app.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/ratelimit"
)

// Server arma el router.
type Server struct {
	App *app.App
	Log *slog.Logger
	// ClientIPHeader, si se define, es la cabecera que pone el proxy de confianza con la IP
	// real (p. ej. CF-Connecting-IP de Cloudflare). Sin ella se usa la IP de la conexión:
	// X-Forwarded-For se puede falsificar.
	ClientIPHeader string
	// Admin es el panel de moderación, montado en /admin.
	Admin http.Handler

	limits map[string]ratelimit.Allower
}

const maxJSONBody = 1 << 20

// Handler devuelve el router completo.
func (s *Server) Handler() http.Handler {
	s.limits = map[string]ratelimit.Allower{
		"login":    s.App.NewLimiter("login", 10, time.Minute),
		"email":    s.App.NewLimiter("email", 5, time.Minute),
		"register": s.App.NewLimiter("register", 10, time.Hour),
		"reset":    s.App.NewLimiter("reset", 5, time.Hour),
		"oauth":    s.App.NewLimiter("oauth", 20, time.Minute),
		"refresh":  s.App.NewLimiter("refresh", 60, time.Minute),
		"verify":   s.App.NewLimiter("verify", 20, time.Minute),
		"search":   s.App.NewLimiter("search", 30, time.Minute),
		"follow":   s.App.NewLimiter("follow", 60, time.Hour),
	}
	r := chi.NewRouter()
	reportPanics := sentryhttp.New(sentryhttp.Options{Repanic: true}).Handle
	r.Use(middleware.RequestID, s.logRequests, middleware.Recoverer, reportPanics, securityHeaders)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root := func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"name": "PawFound API", "status": "ok"})
	}
	r.Get("/", root)
	r.Head("/", root)
	r.Get("/ready", s.ready)
	if s.Admin != nil {
		r.Mount("/admin", s.Admin)
	}

	r.Route("/v1", func(r chi.Router) {
		// El WebSocket vive fuera del timeout de 30 s: es una conexión larga.
		r.Get("/ws", s.App.Hub.Handler(func(ctx context.Context, token string) (string, error) {
			actor, err := s.App.Authenticate(ctx, token)
			return actor.ID, err
		}))
		// Subir una foto con datos móviles puede tardar más que el resto: 2 minutos.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(2*time.Minute), s.requireAuth)
			r.Post("/media", s.upload)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(30 * time.Second))
			s.routes(r)
		})
	})
	return r
}

func (s *Server) routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Post("/auth/register", s.limited("register", s.register))
		r.Post("/auth/login", s.limited("login", s.login))
		r.Post("/auth/oauth", s.limited("oauth", s.oauth))
		r.Post("/auth/refresh", s.limited("refresh", s.refresh))
		r.Post("/auth/logout", s.logout)
		r.Post("/auth/password-reset", s.limited("reset", s.passwordReset))
		r.Post("/auth/password-reset/confirm", s.webCORS(s.limited("reset", s.passwordResetConfirm)))
		r.Options("/auth/password-reset/confirm", s.webCORS(nil))
	})

	// Lectura pública: el mapa, un caso y los perfiles se ven sin sesión (los enlaces
	// compartidos por WhatsApp abren el caso). Con sesión, se personaliza la respuesta.
	// Solo un número, y sin consultar la base: también lo ve quien explora sin cuenta.
	r.Get("/online", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]int{"count": s.App.Hub.Online()})
	})
	// "Nuestro impacto" de una ciudad: cifras de todos sus casos, también los cerrados.
	r.Get("/impact", func(w http.ResponseWriter, r *http.Request) {
		impact, err := s.App.CityImpact(r.Context(), r.URL.Query().Get("city"))
		respond(w, http.StatusOK, impact, err)
	})
	r.Group(func(r chi.Router) {
		r.Use(s.optionalAuth)
		r.Get("/pets", s.nearby)
		r.Get("/pets/{id}", s.getPet)
		r.Post("/pets/{id}/share", s.share)
		r.Get("/users/{id}", s.profile)
		r.Get("/adoptions", s.adoptions)
		r.Get("/adoptions/{id}", s.adoption)
		r.Get("/users/{id}/adoptions", s.userAdoptions)
		r.Get("/stories", s.stories)
		r.Get("/places", s.places)
		r.Get("/media/{id}", s.media)
	})

	r.Group(func(r chi.Router) {
		r.Use(s.requireAuth)
		r.Post("/auth/email/resend", s.limited("verify", s.resendCode))
		r.Post("/auth/email/verify", s.limited("verify", s.verifyCode))

		r.Get("/me", s.me)
		r.Patch("/me", s.updateProfile)
		r.Delete("/me", s.deleteAccount)
		r.Get("/me/export", s.export)
		r.Get("/me/network", s.myNetwork)
		r.Post("/me/adoption-terms", s.acceptAdoptionTerms)
		r.Post("/me/shelter", s.requestShelter)
		r.Get("/me/adoptions", s.myAdoptions)
		r.Get("/me/adoption-applications", s.myApplications)
		r.Post("/adoptions", s.createAdoption)
		r.Post("/adoptions/{id}/adopted", s.markAdopted)
		r.Delete("/adoptions/{id}", s.withdrawAdoption)
		r.Get("/adoptions/{id}/applications", s.adoptionApplications)
		r.Post("/adoptions/{id}/apply", s.apply)
		r.Post("/adoptions/{id}/report", s.reportAdoption)
		r.Get("/adoptions/{id}/updates", s.adoptionUpdates)
		r.Post("/adoptions/{id}/updates", s.addAdoptionUpdate)
		r.Post("/adoption-applications/{id}/accept", s.acceptApplication)
		r.Post("/adoption-applications/{id}/decline", s.declineApplication)
		r.Post("/me/followers/{id}/accept", s.acceptFollower)
		r.Delete("/me/followers/{id}", s.removeFollower)
		r.Put("/me/lang", s.setLang)
		r.Put("/me/notification-prefs", s.notificationPrefs)
		r.Put("/me/privacy", s.privacy)
		r.Put("/me/alert-zone", s.setAlertZone)
		r.Delete("/me/alert-zone", s.deleteAlertZone)
		// Alertas donde estés: el celular envía su último punto (la API lo aproxima a 250 m).
		r.Put("/me/location", s.setAlertZone)
		r.Delete("/me/location", s.deleteAlertZone)
		r.Post("/me/devices", s.registerDevice)
		r.Delete("/me/devices", s.unregisterDevice)
		r.Get("/me/pets", s.myPets)
		r.Get("/me/owned-pets", s.ownedPets)
		r.Post("/me/owned-pets", s.saveOwnedPet)
		r.Put("/me/owned-pets/{id}", s.saveOwnedPet)
		r.Delete("/me/owned-pets/{id}", s.deleteOwnedPet)
		r.Get("/me/owned-pets/{id}/matches", s.ownedMatches)
		r.Get("/me/notifications", s.notifications)
		r.Post("/me/notifications/read-all", s.readAllNotifications)
		r.Post("/me/notifications/{id}/read", s.readNotification)

		r.Post("/pets", s.createReport)
		r.Delete("/pets/{id}", s.withdraw)
		r.Post("/pets/{id}/sightings", s.addSighting)
		r.Post("/pets/{id}/reunite", s.reunite)
		r.Put("/pets/{id}/contact", s.setContactPhone)
		r.Post("/pets/{id}/report", s.reportPet)
		r.Get("/pets/{id}/helpers", s.helpers)
		r.Get("/pets/{id}/matches", s.matches)
		r.Post("/pets/{id}/join", s.joinGroup)
		r.Post("/pets/{id}/direct", s.openDirect)

		r.Get("/threads", s.threads)
		r.Get("/threads/{id}", s.thread)
		r.Get("/threads/{id}/messages", s.messages)
		r.Post("/threads/{id}/messages", s.sendMessage)
		r.Post("/threads/{id}/read", s.readThread)
		r.Post("/threads/{id}/mute", s.muteThread)
		r.Post("/threads/{id}/archive", s.archiveThread)
		r.Post("/threads/{id}/close", s.closeThread)
		r.Delete("/threads/{id}", s.leaveThread)
		r.Delete("/messages/{id}/location", s.stopSharingLocation)

		r.Get("/users/search", s.limited("search", s.searchUsers))
		r.Post("/users/{id}/follow", s.limited("follow", s.follow))
		r.Delete("/users/{id}/follow", s.unfollow)
		r.Post("/users/{id}/like", s.like)
		r.Post("/users/{id}/report", s.reportUser)
		r.Post("/pets/{id}/stories", s.addStory)
		r.Delete("/stories/{id}", s.removeStory)
		r.Post("/places/{id}/report", s.reportPlace)
	})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.App.DB.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Middleware --------------------------------------------------------------

type actorKey struct{}

func actorFrom(r *http.Request) (app.Actor, bool) {
	a, ok := r.Context().Value(actorKey{}).(app.Actor)
	return a, ok
}

func viewerID(r *http.Request) string {
	a, _ := actorFrom(r)
	return a.ID
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearer(r)
		if token == "" {
			writeError(w, app.ErrUnauthorized)
			return
		}
		actor, err := s.App.Authenticate(r.Context(), token)
		if err != nil {
			writeError(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, actor)))
	})
}

func (s *Server) optionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token := bearer(r); token != "" {
			if actor, err := s.App.Authenticate(r.Context(), token); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), actorKey{}, actor))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) clientIP(r *http.Request) string { return app.ClientIP(r, s.ClientIPHeader) }

func (s *Server) limited(name string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ok, wait := s.limits[name].Allow(s.clientIP(r)); !ok {
			w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			writeError(w, &app.Error{Code: "rate_limited", Status: http.StatusTooManyRequests})
			return
		}
		h(w, r)
	}
}

// securityHeaders aplica a toda respuesta; el panel agrega su propia CSP.
// webCORS deja que la página /restablecer de la web (WebBaseURL) llame a este endpoint desde el
// navegador. Solo ese origen y solo aquí: el resto de la API no acepta peticiones de páginas web.
func (s *Server) webCORS(next http.HandlerFunc) http.HandlerFunc {
	allowed := strings.TrimRight(s.App.WebBaseURL, "/")
	return func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && origin == allowed {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
			h.Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions || next == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Resource-Policy", "same-site")
		// Detrás del proxy la conexión llega sin TLS: el proxy dice cómo entró.
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		if !strings.HasPrefix(r.URL.Path, "/admin") {
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		}
		next.ServeHTTP(w, r)
	})
}

// logRequests registra método, ruta (el patrón, sin ids ni query) y resultado. Nunca cuerpos
// ni cabeceras: ahí viajan tokens y datos personales.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		route := r.URL.Path
		if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
			route = rc.RoutePattern()
		}
		level := slog.LevelInfo
		if ww.Status() >= 500 {
			level = slog.LevelError
		}
		s.Log.LogAttrs(r.Context(), level, "http", slog.String("method", r.Method), slog.String("route", route),
			slog.Int("status", ww.Status()), slog.Duration("duration", time.Since(start)),
			slog.String("request_id", middleware.GetReqID(r.Context())))
	})
}

// --- JSON ---------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	e := app.AsError(err)
	if e.Status == http.StatusInternalServerError {
		slog.Error("error interno", "err", err)
		sentry.CaptureException(err)
	}
	writeJSON(w, e.Status, map[string]any{"error": e})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	body := http.MaxBytesReader(w, r.Body, maxJSONBody)
	if err := json.NewDecoder(body).Decode(v); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, &app.Error{Code: "invalid_input", Status: http.StatusBadRequest, Params: map[string]any{"field": "body"}})
		return false
	}
	return true
}

// respond escribe el resultado o el error de negocio.
func respond(w http.ResponseWriter, status int, v any, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	if v == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, status, v)
}
