package admin

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/auth"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/media"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/testdb"
)

type env struct {
	t      *testing.T
	app    *app.App
	srv    *httptest.Server
	client *http.Client
}

func setup(t *testing.T) *env {
	t.Helper()
	pool := testdb.Pool(t)
	now := func() time.Time { return time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC) }
	tokens, _ := auth.NewTokens(strings.Repeat("k", 32), time.Hour, now)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := &app.App{
		DB: pool, Tokens: tokens, Codes: auth.NewCodeHasher("x"), SMS: providers.LogSMS{Log: log}, Media: media.LocalStore{Dir: t.TempDir()},
		Log: log, Now: now, APIBaseURL: "http://api.test",
	}
	a.Init()
	panel := &Panel{App: a, Log: log}
	r := chi.NewRouter()
	r.Mount("/admin", panel.Handler())
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &env{t: t, app: a, srv: srv, client: &http.Client{Jar: jar}}
}

func (e *env) account(id, name, role string) {
	e.t.Helper()
	hash, _ := auth.HashPassword("Moderar2026")
	if _, err := e.app.DB.Exec(context.Background(), `INSERT INTO users (id, name, username, email, password_hash, phone, phone_verified, role, created_at)
		VALUES ($1, $2, $1, $1 || '@pawfound.test', $3, '+57' || $1, true, $4, now() - interval '12 days')`, id, name, hash, role); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) get(path string) (int, string) {
	e.t.Helper()
	res, err := e.client.Get(e.srv.URL + path)
	if err != nil {
		e.t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body)
}

func (e *env) post(path string, form url.Values) (int, string, string) {
	e.t.Helper()
	res, err := e.client.PostForm(e.srv.URL+path, form)
	if err != nil {
		e.t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body), res.Request.URL.String()
}

var csrfRE = regexp.MustCompile(`name="csrf" value="([^"]+)"`)

func csrf(t *testing.T, html string) string {
	t.Helper()
	m := csrfRE.FindStringSubmatch(html)
	if m == nil {
		t.Fatal("la página no trae token CSRF")
	}
	return m[1]
}

func TestLoginRequiresModeratorRole(t *testing.T) {
	e := setup(t)
	e.account("u_comun", "Persona Común", "user")
	e.account("u_mod", "Moderadora Ana", "moderator")
	if status, body := e.get("/admin/"); status != http.StatusOK || !strings.Contains(body, "Panel de moderación") {
		t.Fatalf("sin sesión debe llevar al login: %d", status)
	}
	res, _ := e.client.Get(e.srv.URL + "/admin/login")
	if csp := res.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") || !strings.Contains(csp, "form-action 'self'") {
		t.Fatalf("CSP = %q", csp)
	}
	_ = res.Body.Close()
	for _, creds := range [][2]string{{"u_comun@pawfound.test", "Moderar2026"}, {"u_mod@pawfound.test", "otra"}, {"nadie@pawfound.test", "x"}} {
		status, body, _ := e.post("/admin/login", url.Values{"email": {creds[0]}, "password": {creds[1]}})
		if status != http.StatusUnauthorized || !strings.Contains(body, "no tiene acceso") {
			t.Fatalf("%s: %d", creds[0], status)
		}
	}
	status, body, landed := e.post("/admin/login", url.Values{"email": {"u_mod@pawfound.test"}, "password": {"Moderar2026"}})
	if status != http.StatusOK || !strings.HasSuffix(landed, "/admin/") || !strings.Contains(body, "Moderadora Ana") {
		t.Fatalf("login: %d %s", status, landed)
	}
	// El login del panel no deja sesiones de la app abiertas.
	var open int
	_ = e.app.DB.QueryRow(context.Background(), `SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NULL`).Scan(&open)
	if open != 0 {
		t.Fatalf("refresh tokens abiertos = %d", open)
	}
	// Sin CSRF, ningún POST pasa.
	if status, _, _ := e.post("/admin/logout", url.Values{}); status != http.StatusForbidden {
		t.Fatalf("logout sin CSRF = %d", status)
	}
	if _, body, landed := e.post("/admin/logout", url.Values{"csrf": {csrf(t, body)}}); !strings.HasSuffix(landed, "/admin/login") || !strings.Contains(body, "Entrar") {
		t.Fatalf("logout: %s", landed)
	}
	if status, body := e.get("/admin/log"); status != http.StatusOK || !strings.Contains(body, `name="password"`) {
		t.Fatal("tras salir, la sesión no sirve")
	}
}

func TestReviewReportAndApplySanctions(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	e.account("u_mod", "Moderadora Ana", "moderator")
	e.account("u_fam", "Familia Pérez", "user")
	e.account("u_rudo", "Persona Grosera", "user")
	db := e.app.DB
	mustExec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	key := "med_chat.jpg"
	_ = e.app.Media.Put(ctx, key, []byte("\xff\xd8foto"))
	mustExec(`INSERT INTO pets (id, kind, name, species, sex, age, size, description, last_seen_at, lat, lng, zone, owner_id, owner_short_name, group_id)
		VALUES ('pet_1', 'lost', 'Max', 'dog', 'male', 'adult', 'medium', 'Collar rojo', now(), 6.24, -75.59, 'Laureles', 'u_fam', 'Familia P.', 'grp_1')`)
	mustExec(`INSERT INTO threads (id, kind, pet_id) VALUES ('grp_1', 'group', 'pet_1')`)
	mustExec(`INSERT INTO media (id, owner_id, purpose, content_type, width, height, bytes, phash, storage_key, thread_id) VALUES ('med_chat', 'u_rudo', 'chat', 'image/jpeg', 10, 10, 6, 0, $1, 'grp_1')`, key)
	mustExec(`INSERT INTO messages (id, thread_id, author_id, author_short_name, kind, body, at) VALUES ('m_0', 'grp_1', 'u_fam', 'Familia P.', 'text', '¿Alguien lo vio?', now() - interval '2 minutes')`)
	mustExec(`INSERT INTO messages (id, thread_id, author_id, author_short_name, kind, body, photo_id, at) VALUES ('m_1', 'grp_1', 'u_rudo', 'Persona G.', 'text', 'eres una idiota', 'med_chat', now())`)
	mustExec(`INSERT INTO reports (id, reporter_id, target_kind, reported_user_id, thread_id, message_id, reason, note) VALUES ('rep_1', 'u_fam', 'message', 'u_rudo', 'grp_1', 'm_1', 'rude', 'Me insultó')`)
	mustExec(`INSERT INTO reports (id, reporter_id, target_kind, reported_user_id, pet_id, reason) VALUES ('rep_2', NULL, 'pet', 'u_fam', 'pet_1', 'scam')`)

	_, body, _ := e.post("/admin/login", url.Values{"email": {"u_mod@pawfound.test"}, "password": {"Moderar2026"}})
	if !strings.Contains(body, "2</strong><span>reportes abiertos") || !strings.Contains(body, "Groserías o acoso") {
		t.Fatalf("resumen sin la cola: %s", body)
	}
	token := csrf(t, body)
	if _, body := e.get("/admin/reports"); !strings.Contains(body, "Persona Grosera") || !strings.Contains(body, "Sistema") {
		t.Fatal("lista de reportes")
	}
	status, body := e.get("/admin/reports/rep_1")
	if status != http.StatusOK || !strings.Contains(body, "eres una idiota") || !strings.Contains(body, "¿Alguien lo vio?") ||
		!strings.Contains(body, `src="/admin/media/med_chat"`) || !strings.Contains(body, "Me insultó") || !strings.Contains(body, "Sugerido según su historial: <strong>Enviar un aviso") {
		t.Fatalf("detalle: %d", status)
	}
	if status, _ := e.get("/admin/media/med_chat"); status != http.StatusOK {
		t.Fatalf("el equipo ve las fotos de chat = %d", status)
	}
	if status, _ := e.get("/admin/media/med_nada"); status != http.StatusNotFound {
		t.Fatal("foto inexistente")
	}
	if status, _ := e.get("/admin/reports/rep_nada"); status != http.StatusNotFound {
		t.Fatal("reporte inexistente")
	}
	if status, body := e.get("/admin/reports/rep_2"); status != http.StatusOK || !strings.Contains(body, "Collar rojo") || !strings.Contains(body, "abierto por el sistema") {
		t.Fatal("reporte de publicación")
	}

	// Aviso desde el reporte.
	_, body, landed := e.post("/admin/reports/rep_1", url.Values{"csrf": {token}, "action": {"warn"}, "note": {"primer aviso"}})
	if !strings.Contains(landed, "ok=") || !strings.Contains(body, "Decisión registrada") || !strings.Contains(body, "Resuelto") {
		t.Fatalf("aviso: %s", landed)
	}
	// Suspender exige confirmación y motivo.
	_, _, landed = e.post("/admin/users/u_rudo", url.Values{"csrf": {token}, "action": {"suspend"}, "note": {"reincide"}})
	if !strings.Contains(landed, "error=") {
		t.Fatal("suspensión sin confirmar")
	}
	_, body, _ = e.post("/admin/users/u_rudo", url.Values{"csrf": {token}, "action": {"suspend"}, "confirm": {"yes"}})
	if !strings.Contains(body, "una suspensión siempre lleva su motivo") {
		t.Fatal("suspensión sin motivo")
	}
	_, body, _ = e.post("/admin/users/u_rudo", url.Values{"csrf": {token}, "action": {"mute24"}})
	if !strings.Contains(body, "Restringida hasta") || !strings.Contains(body, "Restringir 7 días") {
		t.Fatalf("restricción: %s", body)
	}
	_, body, _ = e.post("/admin/users/u_rudo", url.Values{"csrf": {token}, "action": {"suspend"}, "confirm": {"yes"}, "note": {"reincide tras restricción"}})
	if !strings.Contains(body, "Suspendida") || !strings.Contains(body, "Reactivar la cuenta") {
		t.Fatal("suspensión")
	}
	if _, body, _ := e.post("/admin/users/u_mod", url.Values{"csrf": {token}, "action": {"warn"}}); !strings.Contains(body, "No tienes permiso") {
		t.Fatal("un moderador no se sanciona a sí mismo")
	}
	if _, body, _ := e.post("/admin/reports/rep_2", url.Values{"csrf": {token}, "action": {"dismiss"}}); !strings.Contains(body, "Decisión registrada") {
		t.Fatal("descartar")
	}

	if _, body := e.get("/admin/log"); strings.Count(body, "<tr>") != 5 || !strings.Contains(body, "reincide tras restricción") || !strings.Contains(body, "Moderadora Ana") {
		t.Fatalf("bitácora: %d filas", strings.Count(body, "<tr>"))
	}
	if _, body := e.get("/admin/users?q=Grosera"); !strings.Contains(body, "@u_rudo") {
		t.Fatal("búsqueda")
	}
	if _, body := e.get("/admin/users?q=zzz"); !strings.Contains(body, "Ninguna cuenta coincide") {
		t.Fatal("búsqueda vacía")
	}
	if status, _ := e.get("/admin/users/u_nadie"); status != http.StatusNotFound {
		t.Fatal("cuenta inexistente")
	}
	if _, body := e.get("/admin/reports?status=actioned"); !strings.Contains(body, "Persona Grosera") {
		t.Fatal("pestaña con sanción")
	}
	if _, body := e.get("/admin/reports?status=dismissed"); !strings.Contains(body, "Sistema") {
		t.Fatal("pestaña descartados")
	}
	if status, _ := e.get("/admin/static/admin.css"); status != http.StatusOK {
		t.Fatal("estilos")
	}
}

func TestLoginRateLimitAndHelpers(t *testing.T) {
	e := setup(t)
	for i := 0; i < 5; i++ {
		e.post("/admin/login", url.Values{"email": {"x@x.co"}, "password": {"x"}})
	}
	if status, body, _ := e.post("/admin/login", url.Values{"email": {"x@x.co"}, "password": {"x"}}); status != http.StatusTooManyRequests || !strings.Contains(body, "Demasiados intentos") {
		t.Fatalf("límite = %d", status)
	}
	for d, want := range map[time.Duration]string{time.Second: "hace un momento", 5 * time.Minute: "hace 5 min", 3 * time.Hour: "hace 3 h", 72 * time.Hour: "hace 3 días"} {
		if got := ago(d); got != want {
			t.Errorf("ago(%v) = %q", d, got)
		}
	}
	if label(reasonLabels, "nuevo") != "nuevo" || label(reasonLabels, "scam") != "Estafa o fraude" {
		t.Error("label")
	}
}
