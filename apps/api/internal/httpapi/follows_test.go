package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

// befriend deja a las dos cuentas siguiéndose: una pide y la otra acepta.
func (h *harness) befriend(follower, followed user) {
	h.t.Helper()
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+followed.ID+"/follow", follower.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/followers/"+follower.ID+"/accept", followed.Token, nil, nil)
}

func (h *harness) profile(u user, viewer string) app.PublicProfile {
	h.t.Helper()
	var p app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+u.ID, viewer, nil, &p)
	return p
}

func badgeOf(p app.PublicProfile, id string) (count, tier int) {
	for _, b := range p.Badges {
		if b.ID == id {
			return b.Count, b.Tier
		}
	}
	return -1, -1
}

// helpOn hace que helper participe en el caso, para que la familia pueda agradecerle.
func (h *harness) helpOn(pet app.Pet, helper user) {
	h.t.Helper()
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", helper.Token, nil, nil)
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"text": "Lo vi"}, nil)
}

func foundReport(at map[string]float64) map[string]any {
	return map[string]any{
		"kind": "found", "species": "dog", "sex": "female", "age": "adult", "size": "medium",
		"description": "", "photos": []string{}, "location": at, "zone": "Laureles", "foundSearchRadius": 2000,
	}
}

func TestSearchUsersByUsername(t *testing.T) {
	h := newHarness(t)
	me := h.user("Yo", true)
	ana := h.user("Ana Gómez", true)
	other := h.user("Ana Ruiz", true)
	gone := h.user("Suspendida", true)
	h.exec(`UPDATE users SET username = 'ana_gomez' WHERE id = $1`, ana.ID)
	h.exec(`UPDATE users SET username = 'anaxgomez' WHERE id = $1`, other.ID)
	h.exec(`UPDATE users SET username = 'ana_mala', suspended_at = now() WHERE id = $1`, gone.ID)
	h.exec(`UPDATE users SET username = 'ana_yo' WHERE id = $1`, me.ID)

	search := func(q string) []app.Person {
		var out []app.Person
		h.must(http.StatusOK, http.MethodGet, "/v1/users/search?q="+q, me.Token, nil, &out)
		return out
	}
	// Con o sin @, mayúsculas o espacios, encuentra lo mismo. El guion bajo no es comodín.
	for _, q := range []string{"ana_", "%40ana_", "ANA_", "%20ana_%20"} {
		got := search(q)
		if len(got) != 1 || got[0].ID != ana.ID || got[0].Username != "ana_gomez" || got[0].ShortName != "Ana G." {
			t.Fatalf("buscar %q = %+v", q, got)
		}
	}
	// Dos letras no alcanzan, y lo que no puede ser un usuario ni siquiera se busca.
	for _, q := range []string{"an", "ana%25", "a'b--"} {
		if got := search(q); len(got) != 0 {
			t.Fatalf("buscar %q = %+v", q, got)
		}
	}
	if got := search("ana"); len(got) != 2 {
		t.Fatalf("sin suspendidas ni la propia cuenta = %+v", got)
	}
	// Pide sesión y nunca devuelve datos de contacto.
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/users/search?q=ana", "", nil)
	res := h.must(http.StatusOK, http.MethodGet, "/v1/users/search?q=ana", me.Token, nil, nil)
	if strings.Contains(string(res.Body), "@pawfound.test") || strings.Contains(string(res.Body), "+5730") {
		t.Fatalf("filtra datos de contacto: %s", res.Body)
	}
}

func TestFollowIsMutualAndListsArePrivate(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	fan := h.user("Fan Uno", true)
	stranger := h.user("Otra Persona", true)
	newbie := h.user("Sin Verificar", false)
	h.device(ana)
	h.device(fan)

	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+ana.ID+"/follow", newbie.Token, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+ana.ID+"/follow", ana.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/users/u_nadie/follow", fan.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/me/followers/"+fan.ID+"/accept", ana.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodDelete, "/v1/me/followers/"+fan.ID, ana.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodDelete, "/v1/users/"+ana.ID+"/follow", fan.Token, nil)

	var sent map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, &sent)
	if sent["status"] != "pending" {
		t.Fatalf("solicitud = %v", sent)
	}
	// Repetirla no envía otro aviso.
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, &sent)
	if got := h.pushesTo(ana); len(got) != 1 || got[0].URL != "/seguidores" || !strings.Contains(got[0].Body, "Fan U.") {
		t.Fatalf("aviso de solicitud = %+v", got)
	}
	// Mientras no acepte nadie cuenta como seguidor.
	if p := h.profile(ana, fan.Token); p.Followers != 0 || p.FollowStatus != "pending" {
		t.Fatalf("perfil con solicitud = %+v", p)
	}
	var network app.Network
	h.must(http.StatusOK, http.MethodGet, "/v1/me/network", ana.Token, nil, &network)
	if len(network.Requests) != 1 || network.Requests[0].ID != fan.ID || len(network.Followers) != 0 {
		t.Fatalf("red de Ana = %+v", network)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/me/network", fan.Token, nil, &network)
	if len(network.Sent) != 1 || network.Sent[0].ID != ana.ID || len(network.Following) != 0 {
		t.Fatalf("red de Fan = %+v", network)
	}

	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/followers/"+fan.ID+"/accept", ana.Token, nil, nil)
	if got := h.pushesTo(fan); len(got) != 1 || got[0].URL != "/user/"+ana.ID {
		t.Fatalf("aviso de aceptada = %+v", got)
	}
	// Al aceptar se siguen las dos.
	for _, pair := range [][2]user{{ana, fan}, {fan, ana}} {
		var mine app.Network
		h.must(http.StatusOK, http.MethodGet, "/v1/me/network", pair[0].Token, nil, &mine)
		if len(mine.Followers) != 1 || mine.Followers[0].ID != pair[1].ID || len(mine.Following) != 1 || mine.Following[0].ID != pair[1].ID || len(mine.Requests)+len(mine.Sent) != 0 {
			t.Fatalf("red tras aceptar = %+v", mine)
		}
		if p := h.profile(pair[1], pair[0].Token); p.FollowStatus != "accepted" {
			t.Fatalf("estado tras aceptar = %+v", p)
		}
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, &sent)
	if sent["status"] != "accepted" {
		t.Fatalf("ya la sigue = %v", sent)
	}
	// Cualquiera ve los números, nadie ve las listas: solo existe /me/network.
	if p := h.profile(ana, stranger.Token); p.Followers != 1 || p.Following != 1 || p.FollowStatus != "none" {
		t.Fatalf("perfil para terceros = %+v", p)
	}
	res := h.must(http.StatusOK, http.MethodGet, "/v1/users/"+ana.ID, stranger.Token, nil, nil)
	if strings.Contains(string(res.Body), fan.ID) {
		t.Fatalf("el perfil revela quién la sigue: %s", res.Body)
	}
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/me/network", "", nil)

	// Si los dos se piden seguir, no hace falta que nadie acepte.
	other := h.user("Tercera Persona", true)
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+stranger.ID+"/follow", other.Token, nil, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+other.ID+"/follow", stranger.Token, nil, &sent)
	if sent["status"] != "accepted" {
		t.Fatalf("solicitudes cruzadas = %v", sent)
	}
	if p := h.profile(other, stranger.Token); p.Followers != 1 || p.Following != 1 {
		t.Fatalf("tras solicitudes cruzadas = %+v", p)
	}

	// Dejar de seguir es de un solo lado: la otra persona sigue siguiendo.
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, nil)
	if p := h.profile(ana, fan.Token); p.Followers != 0 || p.Following != 1 || p.FollowStatus != "none" || p.Mutual {
		t.Fatalf("tras dejar de seguir = %+v", p)
	}
	if p := h.profile(fan, ana.Token); p.Followers != 1 || p.Following != 0 || p.FollowStatus != "accepted" || p.Mutual {
		t.Fatalf("la otra persona sigue siguiendo = %+v", p)
	}
	// Eliminar a un seguidor tampoco cambia a quién sigue la cuenta.
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/followers/"+stranger.ID, other.Token, nil, nil)
	if p := h.profile(other, stranger.Token); p.Followers != 0 || p.Following != 1 || p.FollowStatus != "none" {
		t.Fatalf("tras eliminar = %+v", p)
	}
	// Tras eliminar a alguien puede volver a pedirlo sin esperar, y hace falta que lo acepten:
	// no basta con que la otra persona lo siga.
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+other.ID+"/follow", stranger.Token, nil, &sent)
	if sent["status"] != "pending" {
		t.Fatalf("volver a pedir = %v", sent)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/followers/"+stranger.ID+"/accept", other.Token, nil, nil)
	if p := h.profile(other, stranger.Token); p.Followers != 1 || p.Following != 1 || !p.Mutual {
		t.Fatalf("al aceptar se siguen de nuevo = %+v", p)
	}
}

func TestLikesDoNotDependOnFollowing(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	fan := h.user("Fan Uno", true)
	var liked map[string]any
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/like", fan.Token, nil, &liked)
	if liked["liked"] != true || liked["likes"] != float64(1) {
		t.Fatalf("me gusta sin seguir = %v", liked)
	}
	h.befriend(fan, ana)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/followers/"+fan.ID, ana.Token, nil, nil)
	if p := h.profile(ana, fan.Token); p.Likes != 1 || !p.LikedByMe {
		t.Fatalf("el me gusta se mantiene = %+v", p)
	}
}

func TestThreeDeclinesSuspendRequestsForThirtyDays(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	fan := h.user("Fan Uno", true)
	var sent map[string]string
	follow := "/v1/users/" + ana.ID + "/follow"
	decline := "/v1/me/followers/" + fan.ID
	for i := 0; i < 2; i++ {
		h.must(http.StatusOK, http.MethodPost, follow, fan.Token, nil, &sent)
		h.must(http.StatusNoContent, http.MethodDelete, decline, ana.Token, nil, nil)
		// El rechazo no se muestra: el perfil sigue ofreciendo "Seguir".
		if p := h.profile(ana, fan.Token); p.FollowStatus != "none" {
			t.Fatalf("tras rechazo %d = %+v", i, p)
		}
		h.expectError(http.StatusNotFound, "not_found", http.MethodDelete, follow, fan.Token, nil)
	}
	// Cancelar no borra los rechazos acumulados.
	h.must(http.StatusOK, http.MethodPost, follow, fan.Token, nil, &sent)
	h.must(http.StatusNoContent, http.MethodDelete, follow, fan.Token, nil, nil)
	h.must(http.StatusOK, http.MethodPost, follow, fan.Token, nil, &sent)
	h.must(http.StatusNoContent, http.MethodDelete, decline, ana.Token, nil, nil)
	h.expectError(http.StatusConflict, "follow_wait", http.MethodPost, follow, fan.Token, nil)

	h.clock.Advance(29 * 24 * time.Hour)
	h.expectError(http.StatusConflict, "follow_wait", http.MethodPost, follow, fan.Token, nil)
	h.clock.Advance(2 * 24 * time.Hour)
	h.must(http.StatusOK, http.MethodPost, follow, fan.Token, nil, &sent)
	if sent["status"] != "pending" {
		t.Fatalf("pasada la suspensión = %v", sent)
	}
	// Vuelve a empezar la cuenta: un rechazo más no la suspende de nuevo.
	h.must(http.StatusNoContent, http.MethodDelete, decline, ana.Token, nil, nil)
	h.must(http.StatusOK, http.MethodPost, follow, fan.Token, nil, &sent)
	// Aceptar también borra los rechazos.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/followers/"+fan.ID+"/accept", ana.Token, nil, nil)
	if n := h.count(`SELECT count(*) FROM follows WHERE declines <> 0`); n != 0 {
		t.Fatalf("rechazos tras aceptar = %d", n)
	}
}

func TestFollowerStillHearsAfterTheOtherStopsFollowing(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	fan := h.user("Fan Uno", true)
	h.befriend(fan, owner)
	// Valentina deja de seguir a Fan; Fan sigue a Valentina y le siguen llegando sus avisos.
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/users/"+fan.ID+"/follow", owner.Token, nil, nil)
	h.report(owner, lostReport("Max", laureles, nil))
	if got := kinds(h.notifications(fan)); got != "friend_lost" {
		t.Fatalf("quien sigue = %q", got)
	}
	// Al revés no: Valentina ya no sigue a Fan.
	h.report(fan, lostReport("Luna", laureles, nil))
	if got := kinds(h.notifications(owner)); got != "" {
		t.Fatalf("quien dejó de seguir = %q", got)
	}
}

func TestProfileHidesLocationAndPetsFromStrangers(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	friend := h.user("Amiga", true)
	stranger := h.user("Otra Persona", true)
	h.exec(`UPDATE users SET city = 'Medellín', neighborhood = 'Laureles' WHERE id = $1`, ana.ID)
	h.alertZone(ana, laureles, "Laureles")
	h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", ana.Token, map[string]any{
		"name": "Rocky", "species": "dog", "sex": "male", "age": "adult", "size": "medium", "description": "", "photos": []string{},
	}, nil)
	h.befriend(friend, ana)

	for name, token := range map[string]string{"sin sesión": "", "desconocida": stranger.Token, "amiga": friend.Token} {
		res := h.must(http.StatusOK, http.MethodGet, "/v1/users/"+ana.ID, token, nil, nil)
		for _, private := range []string{"Medell", "Laureles", "6.24", "-75.5"} {
			if strings.Contains(string(res.Body), private) {
				t.Fatalf("%s ve la ubicación (%s): %s", name, private, res.Body)
			}
		}
	}
	if p := h.profile(ana, ""); len(p.Pets) != 0 {
		t.Fatalf("sin sesión ve mascotas: %+v", p.Pets)
	}
	if p := h.profile(ana, stranger.Token); len(p.Pets) != 0 {
		t.Fatalf("una desconocida ve mascotas: %+v", p.Pets)
	}
	if p := h.profile(ana, friend.Token); len(p.Pets) != 1 {
		t.Fatalf("una amiga debe verlas: %+v", p.Pets)
	}
	// La propia cuenta sí ve lo suyo.
	if p := h.profile(ana, ana.Token); len(p.Pets) != 1 || p.User.City != "Medellín" || p.User.Neighborhood == nil {
		t.Fatalf("propio perfil = %+v", p)
	}
	// Una solicitud sin aceptar no abre nada.
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", stranger.Token, nil, nil)
	if p := h.profile(ana, stranger.Token); len(p.Pets) != 0 {
		t.Fatalf("con solicitud pendiente ve mascotas: %+v", p.Pets)
	}
	// Las mascotas piden seguirse mutuamente: si cualquiera deja de seguir, ninguna ve las de la otra.
	h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", friend.Token, map[string]any{
		"name": "Toby", "species": "dog", "sex": "male", "age": "adult", "size": "medium", "description": "", "photos": []string{},
	}, nil)
	if p := h.profile(friend, ana.Token); len(p.Pets) != 1 {
		t.Fatalf("Ana debe ver las de su amiga: %+v", p.Pets)
	}
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/users/"+ana.ID+"/follow", friend.Token, nil, nil)
	if p := h.profile(ana, friend.Token); len(p.Pets) != 0 {
		t.Fatalf("quien dejó de seguir ve mascotas: %+v", p.Pets)
	}
	if p := h.profile(friend, ana.Token); len(p.Pets) != 0 || p.FollowStatus != "accepted" {
		t.Fatalf("quien sigue sin ser seguida ve mascotas: %+v", p)
	}
}

func TestClosingACaseClosesItsChats(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	talker := h.user("Quien Escribe", true)
	archived := func(id string) bool {
		return h.count(`SELECT count(*) FROM threads WHERE id = $1 AND archived`, id) == 1
	}
	direct := func(pet app.Pet) string {
		var out map[string]string
		h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/direct", talker.Token, nil, &out)
		return out["threadId"]
	}

	// Solo quien abrió el caso puede cerrarlo.
	pet := h.report(owner, lostReport("Max", laureles, nil))
	dm := direct(pet)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", talker.Token, map[string]any{"helperIds": []string{}})
	if archived(dm) || archived(pet.GroupID) {
		t.Fatal("no debe cerrarse si quien lo intenta no abrió el caso")
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	if !archived(pet.GroupID) || !archived(dm) {
		t.Fatal("el grupo y el directo se cierran con el caso")
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+dm+"/messages", talker.Token, map[string]string{"text": "Hola"})
	// Con el caso cerrado no se puede abrir otro directo desde ahí.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/direct", talker.Token, nil)

	// Eliminar la publicación también los cierra.
	second := h.user("Otra Familia", true)
	removed := h.report(second, lostReport("Luna", envigado, nil))
	dm = direct(removed)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+removed.ID, second.Token, nil, nil)
	if !archived(removed.GroupID) || !archived(dm) {
		t.Fatal("eliminar la publicación cierra sus chats")
	}

	// Cualquiera de las dos personas puede cerrar el directo, y no afecta al caso.
	open := h.report(h.user("Tercera Familia", true), lostReport("Toby", laureles, nil))
	dm = direct(open)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/threads/"+dm+"/close", talker.Token, nil, nil)
	if !archived(dm) || archived(open.GroupID) {
		t.Fatal("cerrar el directo no cierra el caso")
	}
	if again := direct(open); again == dm || archived(again) {
		t.Fatalf("con el caso activo se puede escribir de nuevo: %q", again)
	}
}

func TestFollowersHearOnceWhenPetIsLostAndOnceWhenFound(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	far := h.user("Amiga Lejos", true)
	near := h.user("Amiga Cerca", true)
	muted := h.user("Amiga Silenciada", true)
	member := h.user("Amiga Del Grupo", true)
	stranger := h.user("Desconocida", true)
	for _, u := range []user{far, near, muted, member} {
		h.befriend(u, owner)
	}
	h.exec(`UPDATE users SET notification_prefs = notification_prefs || '{"friendAlerts": false}' WHERE id = $1`, muted.ID)
	h.alertZone(near, laureles, "Laureles")
	h.alertZone(far, envigado, "Envigado")
	h.device(far)
	h.device(near)

	pet := h.report(owner, lostReport("Max", laureles, nil))
	if got := kinds(h.notifications(far)); got != "friend_lost" {
		t.Fatalf("amiga lejos = %q", got)
	}
	// Quien está en el rango recibe la Alerta Ángel y no el aviso de amigos.
	if got := kinds(h.notifications(near)); got != "angel_alert" {
		t.Fatalf("amiga cerca = %q", got)
	}
	if got := kinds(h.notifications(muted)); got != "" {
		t.Fatalf("con el aviso apagado = %q", got)
	}
	if got := kinds(h.notifications(stranger)); got != "" {
		t.Fatalf("sin seguirla = %q", got)
	}
	push := h.pushesTo(far)
	if len(push) != 1 || push[0].Title != "🚨 Se perdió la mascota de Valentina A." || push[0].Body != "Ayuda a Valentina A. a buscar a Max." || push[0].Channel != "angel-alerts" {
		t.Fatalf("push a la amiga = %+v", push)
	}

	// Aunque el círculo de vida llegue después hasta su zona, no recibe otra alerta del caso.
	h.clock.Advance(2 * time.Hour)
	if _, err := h.app.RunAlertJob(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := kinds(h.notifications(far)); got != "friend_lost" {
		t.Fatalf("una sola alerta por caso = %q", got)
	}

	// Al aparecer, un aviso por persona, también a quien recibió la Alerta Ángel. Quien ya recibe
	// el del grupo no recibe dos.
	h.helpOn(pet, member)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	if got := kinds(h.notifications(far)); got != "friend_found,friend_lost" {
		t.Fatalf("amiga lejos al cerrar = %q", got)
	}
	if got := kinds(h.notifications(near)); got != "friend_found,angel_alert" {
		t.Fatalf("amiga cerca al cerrar = %q", got)
	}
	if got := kinds(h.notifications(member)); got != "case_closed,friend_lost" {
		t.Fatalf("amiga del grupo = %q", got)
	}
	if got := h.pushesTo(far); got[len(got)-1].Title != "🎉 ¡Buenas noticias de Valentina A.!" || got[len(got)-1].Body != "Max ya está en casa." {
		t.Fatalf("push de buenas noticias = %+v", got[len(got)-1])
	}
}

func TestFoundPetAlertsNearbyPhonesOnce(t *testing.T) {
	h := newHarness(t)
	finder := h.user("Daniel Ruiz", true)
	near := h.user("Vecina", true)
	far := h.user("Lejana", true)
	off := h.user("Sin avisos", true)
	h.alertZone(finder, laureles, "Laureles")
	h.alertZone(near, laureles, "Laureles")
	h.alertZone(far, envigado, "Envigado")
	h.alertZone(off, laureles, "Laureles")
	h.exec(`UPDATE users SET notification_prefs = notification_prefs || '{"foundNearby": false}' WHERE id = $1`, off.ID)
	h.device(near)

	h.report(finder, foundReport(laureles))
	if got := kinds(h.notifications(near)); got != "found_nearby" {
		t.Fatalf("vecina = %q", got)
	}
	for name, u := range map[string]user{"quien reportó": finder, "lejana": far, "apagado": off} {
		if got := kinds(h.notifications(u)); got != "" {
			t.Fatalf("%s = %q", name, got)
		}
	}
	push := h.pushesTo(near)
	if len(push) != 1 || push[0].Title != "🐾 Encontraron una mascota cerca de ti" ||
		push[0].Body != "La perrita encontrada está cerca de ti. ¿Sabes de quién es?" || push[0].Channel != "angel-alerts" {
		t.Fatalf("push = %+v", push)
	}

	// Quien perdió una mascota parecida recibe "posible coincidencia", no además la alerta.
	h.clock.Advance(time.Hour)
	family := h.user("Familia", true)
	h.alertZone(family, laureles, "Laureles")
	h.report(family, lostReport("Luna", laureles, map[string]any{"sex": "female"}))
	h.report(finder, foundReport(laureles))
	got := kinds(h.notifications(family))
	if strings.Contains(got, "found_nearby") || !strings.Contains(got, "possible_match") {
		t.Fatalf("familia = %q", got)
	}

	// Comparte el límite diario con la Alerta Ángel.
	for i := 0; i < 6; i++ {
		h.report(h.user("Reporta", true), foundReport(laureles))
	}
	if n := h.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND kind IN ('found_nearby', 'angel_alert')`, near.ID); n != 5 {
		t.Fatalf("alertas en un día = %d", n)
	}
}

func TestRatingsAreGivenWhenClosingACase(t *testing.T) {
	h := newHarness(t)
	helper := h.user("Quien Ayuda", true)
	other := h.user("Otra Ayuda", true)
	if p := h.profile(helper, ""); p.Rating != 5 || p.RatingCount != 0 {
		t.Fatalf("toda cuenta empieza en 5: %+v", p)
	}
	protector := func() int {
		_, tier := badgeOf(h.profile(helper, ""), "protector")
		return tier
	}
	if protector() != 0 {
		t.Fatal("las 5 estrellas iniciales no dan Protector animal")
	}

	closeCase := func(stars int) app.Pet {
		t.Helper()
		owner := h.user("Familia", true)
		pet := h.report(owner, lostReport("Max", laureles, nil))
		h.helpOn(pet, helper)
		h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{
			"helperIds": []string{helper.ID}, "ratings": map[string]int{helper.ID: stars},
		}, nil)
		h.clock.Advance(time.Hour)
		return pet
	}

	// Una mala nota entra sobre las 20 de 5 estrellas: se ve 4,8.
	closeCase(1)
	if p := h.profile(helper, ""); p.Rating != 4.8 || p.RatingCount != 1 {
		t.Fatalf("una de 1 estrella = %+v", p)
	}
	if count, _ := badgeOf(h.profile(helper, ""), "paw_angel"); count != 1 {
		t.Fatalf("Ángel de patas = %d", count)
	}
	// Protector animal llega con la décima calificación real si el promedio pasa de 4,5.
	for i := 0; i < 8; i++ {
		closeCase(5)
	}
	if p := h.profile(helper, ""); p.RatingCount != 9 || protector() != 0 {
		t.Fatalf("con nueve no la tiene aún: %+v", p)
	}
	closeCase(5)
	if protector() != 1 {
		t.Fatal("con diez y un promedio de 4,6 debe tenerla")
	}
	// Se pierde si baja y se recupera si sube: nada queda fijo.
	worst := closeCase(1)
	if protector() != 0 {
		t.Fatal("debe perder la insignia al bajar de 4,5")
	}
	// Solo cuentan las últimas 20: una nota vieja termina saliendo del promedio.
	for i := 0; i < 20; i++ {
		closeCase(5)
	}
	if p := h.profile(helper, ""); p.Rating != 5 || p.RatingCount != 31 || protector() != 1 {
		t.Fatalf("con más de 20 = %+v", p)
	}

	// Validación, una sola por caso, y solo a quien de verdad ayudó.
	owner := h.user("Familia Dos", true)
	pet := h.report(owner, lostReport("Luna", laureles, nil))
	h.helpOn(pet, other)
	for _, bad := range []int{0, 6} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{
			"helperIds": []string{other.ID}, "ratings": map[string]int{other.ID: bad},
		})
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{
		"helperIds": []string{other.ID, helper.ID}, "ratings": map[string]int{other.ID: 3, helper.ID: 1},
	}, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{
		"helperIds": []string{other.ID}, "ratings": map[string]int{other.ID: 5},
	})
	if p := h.profile(other, ""); p.Rating != 4.9 || p.RatingCount != 1 {
		t.Fatalf("calificada una vez = %+v", p)
	}
	if p := h.profile(helper, ""); p.Rating != 5 || p.RatingCount != 31 {
		t.Fatalf("sin participar no recibe calificación = %+v", p)
	}

	// Versiones anteriores de la app: agradecen sin estrellas y no cambia la calificación.
	owner = h.user("Familia Tres", true)
	pet = h.report(owner, lostReport("Toby", laureles, nil))
	h.helpOn(pet, other)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{other.ID}}, nil)
	if p := h.profile(other, ""); p.RatingCount != 1 {
		t.Fatalf("sin estrellas = %+v", p)
	}

	// Borrar el caso quita la calificación: publicar, calificar y borrar no sirve de nada.
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+worst.ID, h.ownerToken(worst), nil, nil)
	if p := h.profile(helper, ""); p.RatingCount != 30 {
		t.Fatalf("caso retirado = %+v", p)
	}
}

// ownerToken emite el token de quien publicó un caso.
func (h *harness) ownerToken(pet app.Pet) string {
	h.t.Helper()
	token, err := h.app.Tokens.IssueAccess(pet.OwnerID)
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

func TestDeletedReportsDoNotEarnBadges(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Quien Publica", true)
	helper := h.user("Quien Ayuda", true)
	found := h.report(owner, foundReport(laureles))
	lost := h.report(owner, lostReport("Max", envigado, nil))
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+lost.ID+"/sightings", helper.Token, map[string]any{
		"at": h.clock.Now(), "location": envigado, "zone": "Envigado",
	}, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+lost.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{helper.ID}}, nil)

	p := h.profile(owner, "")
	if count, _ := badgeOf(p, "reporter"); count != 2 {
		t.Fatalf("Voz de la comunidad = %d", count)
	}
	if count, _ := badgeOf(p, "rescuer"); count != 1 {
		t.Fatalf("Rescate solidario = %d", count)
	}
	if count, _ := badgeOf(p, "reunion"); count != 1 {
		t.Fatalf("De vuelta a casa = %d", count)
	}
	helped := h.profile(helper, "")
	for _, id := range []string{"eyes", "quick", "paw_angel"} {
		if count, _ := badgeOf(helped, id); count != 1 {
			t.Fatalf("%s antes de borrar = %d", id, count)
		}
	}

	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+found.ID, owner.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+lost.ID, owner.Token, nil, nil)
	p = h.profile(owner, "")
	for _, id := range []string{"reporter", "rescuer", "reunion"} {
		if count, _ := badgeOf(p, id); count != 0 {
			t.Fatalf("%s tras borrar = %d", id, count)
		}
	}
	helped = h.profile(helper, "")
	for _, id := range []string{"eyes", "quick", "paw_angel"} {
		if count, _ := badgeOf(helped, id); count != 0 {
			t.Fatalf("%s tras borrar = %d", id, count)
		}
	}
}

func TestQuickResponseBadge(t *testing.T) {
	h := newHarness(t)

	// Respuesta rápida: dentro de la primera hora del caso, una vez por caso, nunca en el propio.
	owner := h.user("Familia Perdida", true)
	witness := h.user("Testigo", true)
	sighting := func(u user, pet app.Pet) {
		t.Helper()
		h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", u.Token, map[string]any{
			"at": h.clock.Now(), "location": laureles, "zone": "Laureles",
		}, nil)
	}
	quick := func() int {
		count, _ := badgeOf(h.profile(witness, ""), "quick")
		return count
	}
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.clock.Advance(59 * time.Minute)
	sighting(witness, pet)
	if got := quick(); got != 1 {
		t.Fatalf("Respuesta rápida = %d", got)
	}
	sighting(witness, pet)
	if got := quick(); got != 1 {
		t.Fatalf("un mismo caso cuenta una vez = %d", got)
	}
	h.clock.Advance(2 * time.Hour)
	sighting(witness, pet)
	late := h.report(owner, lostReport("Luna", envigado, nil))
	h.clock.Advance(61 * time.Minute)
	sighting(witness, late)
	if got := quick(); got != 1 {
		t.Fatalf("pasada la hora no cuenta = %d", got)
	}
}

func TestPopularBadgeFollowsLikes(t *testing.T) {
	h := newHarness(t)
	star := h.user("Muy Querida", true)
	for i := 0; i < 50; i++ {
		fan := h.user("Fan", true)
		h.exec(`INSERT INTO profile_likes (target_id, liker_id) VALUES ($1, $2)`, star.ID, fan.ID)
	}
	if count, tier := badgeOf(h.profile(star, ""), "popular"); count != 50 || tier != 1 {
		t.Fatalf("Popular con 50 = %d, nivel %d", count, tier)
	}
}

func TestExportIncludesNetworkAndRatings(t *testing.T) {
	h := newHarness(t)
	me := h.user("Yo Misma", true)
	fan := h.user("Fan Uno", true)
	owner := h.user("Familia", true)
	h.befriend(fan, me)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.helpOn(pet, me)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{
		"helperIds": []string{me.ID}, "ratings": map[string]int{me.ID: 4},
	}, nil)
	var data app.Export
	h.must(http.StatusOK, http.MethodGet, "/v1/me/export", me.Token, nil, &data)
	if len(data.Network.Followers) != 1 || data.Network.Followers[0].ID != fan.ID || len(data.Ratings) != 1 || data.Ratings[0] != 4 {
		t.Fatalf("exportación = %+v / %+v", data.Network, data.Ratings)
	}
}
