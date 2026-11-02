package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestFounderIsOnlyIdentifiedAndEarnsLikeEveryoneElse(t *testing.T) {
	h := newHarness(t)
	founder := h.user("Tomás Posada", true)
	fan := h.user("Ana Gómez", true)
	h.exec(`UPDATE users SET username = 'tomasposada26' WHERE id = $1`, founder.ID)
	ctx := context.Background()
	if err := h.app.SetFounder(ctx, "no-existe"); err == nil {
		t.Fatal("una cuenta inexistente debe fallar")
	}
	if err := h.app.SetFounder(ctx, " TomasPosada26 "); err != nil {
		t.Fatal(err)
	}

	var profile app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+founder.ID, "", nil, &profile)
	if !profile.User.Founder {
		t.Fatalf("debe identificarse como creador: %+v", profile.User)
	}
	// Nada inflado: sus me gusta e insignias son los reales.
	if profile.Likes != 0 {
		t.Fatalf("me gusta = %d", profile.Likes)
	}
	for _, b := range profile.Badges {
		if b.ID != "verified" && b.Tier != 0 {
			t.Fatalf("insignia sin haberla ganado: %+v", b)
		}
	}
	var liked struct {
		Likes int `json:"likes"`
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+founder.ID+"/like", fan.Token, nil, &liked)
	if liked.Likes != 1 {
		t.Fatalf("me gusta tras uno real = %d", liked.Likes)
	}

	var other app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+fan.ID, "", nil, &other)
	if other.User.Founder {
		t.Fatal("las demás cuentas no son creadoras")
	}
}

func TestResetTestDataOnlySimulatesUntilConfirmed(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	fan := h.user("Ana Gómez", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", fan.Token, nil, nil)
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", fan.Token, map[string]string{"text": "La vi", "lang": "es"}, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+owner.ID+"/like", fan.Token, nil, nil)
	h.alertZone(fan, laureles, "Laureles")
	if _, res := h.upload(owner, "owned", jpegBytes(1)); res.Status != http.StatusCreated {
		t.Fatalf("foto propia = %d", res.Status)
	}
	photo, res := h.upload(owner, "pet", jpegBytes(2))
	if res.Status != http.StatusCreated {
		t.Fatalf("foto = %d", res.Status)
	}
	ctx := context.Background()

	counts, err := h.app.ResetTestData(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if counts["pets"] != 1 || counts["threads"] < 1 || counts["profile_likes"] != 1 || counts["media"] != 1 {
		t.Fatalf("simulación = %+v", counts)
	}
	if n := h.count(`SELECT count(*) FROM pets`); n != 1 {
		t.Fatal("la simulación no debe borrar nada")
	}

	if _, err := h.app.ResetTestData(ctx, true); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"pets", "threads", "messages", "notifications", "profile_likes", "sightings"} {
		if n := h.count(`SELECT count(*) FROM ` + table); n != 0 {
			t.Fatalf("%s debe quedar vacía: %d", table, n)
		}
	}
	// Las cuentas siguen, con su sesión, sus alertas y sus fotos propias.
	if n := h.count(`SELECT count(*) FROM users`); n != 2 {
		t.Fatalf("cuentas = %d", n)
	}
	if n := h.count(`SELECT count(*) FROM alert_zones`); n != 1 {
		t.Fatal("la ubicación de las alertas se conserva")
	}
	if n := h.count(`SELECT count(*) FROM media WHERE purpose = 'owned'`); n != 1 {
		t.Fatal("las fotos de Mis mascotas se conservan")
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/me", owner.Token, nil, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/media/"+photo.ID, "", nil)

	var profile app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+owner.ID, "", nil, &profile)
	if profile.Likes != 0 || profile.Reported != 0 || profile.Found != 0 {
		t.Fatalf("el perfil debe quedar limpio: %+v", profile)
	}
	for _, b := range profile.Badges {
		if b.ID != "verified" && b.Tier != 0 {
			t.Fatalf("insignia ganada tras limpiar: %+v", b)
		}
	}
}

func TestOnlineCountIsPublicAndLive(t *testing.T) {
	h := newHarness(t)
	var online struct {
		Count int `json:"count"`
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/online", "", nil, &online)
	if online.Count != 0 {
		t.Fatalf("sin conexiones = %d", online.Count)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	dial := func(u user) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, "ws"+h.srv.URL[len("http"):]+"/v1/ws", nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.CloseNow() })
		_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","token":"`+u.Token+`"}`))
		return conn
	}
	// Espera un evento "online" con ese número.
	waitCount := func(conn *websocket.Conn, want float64) {
		t.Helper()
		for {
			_, raw, err := conn.Read(ctx)
			if err != nil {
				t.Fatalf("esperando %v conectados: %v", want, err)
			}
			var e map[string]any
			_ = json.Unmarshal(raw, &e)
			if e["type"] == "online" && e["data"] == want {
				return
			}
		}
	}

	ana := h.user("Ana Gómez", true)
	first := dial(ana)
	waitCount(first, 1)
	second := dial(ana) // La misma persona en otro celular cuenta una sola vez.
	waitCount(second, 1)

	carlos := h.user("Carlos Mejía", true)
	third := dial(carlos)
	waitCount(third, 2)
	waitCount(first, 2)
	h.must(http.StatusOK, http.MethodGet, "/v1/online", "", nil, &online)
	if online.Count != 2 {
		t.Fatalf("conectados = %d", online.Count)
	}

	_ = third.Close(websocket.StatusNormalClosure, "")
	waitCount(first, 1)
}
