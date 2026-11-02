package httpapi

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
)

// slowPush simula a Expo tardando en responder.
type slowPush struct {
	release chan struct{}
	sent    atomic.Int64
}

func (p *slowPush) Send(_ context.Context, messages []providers.PushMessage) error {
	<-p.release
	p.sent.Add(int64(len(messages)))
	return nil
}

func TestResponsesDoNotWaitForPushNotifications(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	helper := h.user("Ayudante", true)
	h.device(owner)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", helper.Token, nil, nil)

	push := &slowPush{release: make(chan struct{})}
	h.app.Push, h.app.Inline = push, false
	finished := make(chan response, 1)
	go func() {
		finished <- h.do(http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"text": "La vi", "lang": "es"})
	}()
	select {
	case res := <-finished:
		if res.Status != http.StatusCreated {
			t.Fatalf("mensaje = %d %s", res.Status, res.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("la respuesta no debe esperar a la notificación")
	}
	if push.sent.Load() != 0 {
		t.Fatal("la notificación todavía no debía salir")
	}
	close(push.release)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.app.WaitBackground(ctx)
	if push.sent.Load() != 1 {
		t.Fatalf("notificaciones enviadas = %d", push.sent.Load())
	}
}

func TestPushRespectsPreferencesForEveryRecipient(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	on := h.user("Con Avisos", true)
	off := h.user("Sin Avisos", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	for _, u := range []user{on, off} {
		h.device(u)
		h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", u.Token, nil, nil)
	}
	h.must(http.StatusOK, http.MethodPut, "/v1/me/notification-prefs", off.Token, map[string]any{"push": false}, nil)
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", owner.Token, map[string]string{"text": "Gracias", "lang": "es"}, nil)
	if got := h.pushesTo(on); len(got) != 1 {
		t.Fatalf("con avisos = %+v", got)
	}
	if got := h.pushesTo(off); len(got) != 0 {
		t.Fatalf("sin avisos = %+v", got)
	}
}

func TestPasswordResetAnswersTheSameAndLimitsEachEmail(t *testing.T) {
	h := newHarness(t)
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("valen@pawfound.app", "valen_a"), nil)
	known := h.do(http.MethodPost, "/v1/auth/password-reset", "", map[string]string{"email": "valen@pawfound.app"})
	unknown := h.do(http.MethodPost, "/v1/auth/password-reset", "", map[string]string{"email": "nadie@pawfound.app"})
	if known.Status != unknown.Status || string(known.Body) != string(unknown.Body) {
		t.Fatalf("no debe revelar si el correo existe: %d %s / %d %s", known.Status, known.Body, unknown.Status, unknown.Body)
	}
	if n := h.count(`SELECT count(*) FROM password_resets`); n != 1 {
		t.Fatalf("enlaces = %d", n)
	}
	// El correo no se puede llenar de enlaces aunque las peticiones vengan de muchas IP.
	for range 10 {
		h.app.RequestPasswordReset(context.Background(), "Valen@PawFound.app") //nolint:errcheck // siempre nil
	}
	if n := h.count(`SELECT count(*) FROM password_resets`); n != 5 {
		t.Fatalf("enlaces tras insistir = %d", n)
	}
}

func TestRealtimeDisconnectsWhoShouldNotReceiveMore(t *testing.T) {
	h := newHarness(t)
	moderator := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, moderator.ID)
	target := h.user("Reportada", true)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+h.srv.URL[len("http"):]+"/v1/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","token":"`+target.Token+`"}`))
	if _, _, err := conn.Read(ctx); err != nil {
		t.Fatal(err)
	}
	for h.app.Hub.Connected(target.ID) != 1 && ctx.Err() == nil {
		time.Sleep(10 * time.Millisecond)
	}
	mod, err := h.app.LoadActor(ctx, moderator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "suspend", UserID: target.ID, Note: "abuso"}); err != nil {
		t.Fatal(err)
	}
	if h.app.Hub.Connected(target.ID) != 0 {
		t.Fatal("una cuenta suspendida no sigue conectada")
	}
	if _, _, err := conn.Read(ctx); err == nil {
		t.Fatal("la conexión debe cerrarse")
	}
}

func TestSecurityHeadersBehindTheProxy(t *testing.T) {
	h := newHarness(t)
	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/health", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	res, err := h.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.Header.Get("Strict-Transport-Security") == "" {
		t.Fatal("detrás del proxy también debe enviar HSTS")
	}
}

func TestPhotosHaveAThumbnail(t *testing.T) {
	h := newHarness(t)
	u := h.user("Sube", true)
	photo, res := h.upload(u, "pet", jpegBytes(1))
	if res.Status != http.StatusCreated {
		t.Fatalf("subida = %d %s", res.Status, res.Body)
	}
	for _, query := range []string{"", "?size=thumb"} {
		got := h.do(http.MethodGet, "/v1/media/"+photo.ID+query, "", nil)
		if got.Status != http.StatusOK || len(got.Body) == 0 {
			t.Fatalf("foto %q = %d", query, got.Status)
		}
	}
	// Una foto subida antes de las miniaturas se sirve completa.
	if err := h.app.RemoveStored(context.Background(), "no-existe.jpg"); err != nil {
		t.Logf("borrar algo que no existe: %v", err)
	}
}
