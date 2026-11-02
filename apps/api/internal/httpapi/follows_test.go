package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

// befriend deja a follower siguiendo a followed con la solicitud aceptada.
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

func foundReport(at map[string]float64, extra map[string]any) map[string]any {
	r := map[string]any{
		"kind": "found", "species": "dog", "sex": "female", "age": "adult", "size": "medium",
		"description": "", "photos": []string{}, "location": at, "zone": "Laureles", "foundSearchRadius": 2000,
	}
	for k, v := range extra {
		r[k] = v
	}
	return r
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

func TestFollowRequestAcceptAndPrivacy(t *testing.T) {
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
	// Mientras no acepte no cuenta como seguidor ni permite "me gusta".
	if p := h.profile(ana, fan.Token); p.Followers != 0 || p.FollowStatus != "pending" {
		t.Fatalf("perfil con solicitud = %+v", p)
	}
	h.expectError(http.StatusForbidden, "follow_required", http.MethodPost, "/v1/users/"+ana.ID+"/like", fan.Token, nil)

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
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, &sent)
	if sent["status"] != "accepted" {
		t.Fatalf("ya la sigue = %v", sent)
	}
	// Cualquiera ve el número, nadie ve la lista: solo existe /me/network.
	if p := h.profile(ana, stranger.Token); p.Followers != 1 || p.Following != 0 || p.FollowStatus != "none" {
		t.Fatalf("perfil para terceros = %+v", p)
	}
	res := h.must(http.StatusOK, http.MethodGet, "/v1/users/"+ana.ID, stranger.Token, nil, nil)
	if strings.Contains(string(res.Body), fan.ID) {
		t.Fatalf("el perfil revela quién la sigue: %s", res.Body)
	}
	if p := h.profile(fan, ""); p.Following != 1 || p.Followers != 0 {
		t.Fatalf("perfil de Fan = %+v", p)
	}
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/me/network", "", nil)
}

func TestRemovedFollowerWaitsAndLosesLike(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana Gómez", true)
	fan := h.user("Fan Uno", true)
	h.befriend(fan, ana)
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/like", fan.Token, nil, nil)
	if p := h.profile(ana, fan.Token); p.Likes != 1 || !p.LikedByMe || p.Followers != 1 {
		t.Fatalf("perfil = %+v", p)
	}

	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/followers/"+fan.ID, ana.Token, nil, nil)
	// No se le avisa ni se le muestra el rechazo: el perfil sigue ofreciendo "Seguir".
	if p := h.profile(ana, fan.Token); p.Likes != 0 || p.Followers != 0 || p.FollowStatus != "none" {
		t.Fatalf("tras eliminarlo = %+v", p)
	}
	// No puede insistir de inmediato, ni saltarse la espera dejando de seguir.
	h.expectError(http.StatusConflict, "follow_wait", http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodDelete, "/v1/users/"+ana.ID+"/follow", fan.Token, nil)
	h.expectError(http.StatusConflict, "follow_wait", http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil)
	h.clock.Advance(31 * 24 * time.Hour)
	var sent map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, &sent)
	if sent["status"] != "pending" {
		t.Fatalf("pasada la espera = %v", sent)
	}

	// Dejar de seguir también quita el "me gusta": no se puede seguir, dar like y salir.
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/followers/"+fan.ID+"/accept", ana.Token, nil, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/like", fan.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, nil)
	if p := h.profile(ana, ""); p.Likes != 0 || p.Followers != 0 {
		t.Fatalf("tras dejar de seguir = %+v", p)
	}
	// Quien dejó de seguir por decisión propia puede volver cuando quiera.
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/follow", fan.Token, nil, &sent)
	if sent["status"] != "pending" {
		t.Fatalf("volver a pedir = %v", sent)
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

	// Al aparecer, un aviso por persona. Quien ya recibe el del grupo no recibe dos.
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

	h.report(finder, foundReport(laureles, nil))
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
	h.report(finder, foundReport(laureles, nil))
	got := kinds(h.notifications(family))
	if strings.Contains(got, "found_nearby") || !strings.Contains(got, "possible_match") {
		t.Fatalf("familia = %q", got)
	}

	// Comparte el límite diario con la Alerta Ángel.
	for i := 0; i < 6; i++ {
		h.report(h.user("Reporta", true), foundReport(laureles, nil))
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

	closeCase := func(stars int) app.Pet {
		t.Helper()
		owner := h.user("Familia", true)
		pet := h.report(owner, lostReport("Max", laureles, nil))
		h.helpOn(pet, helper)
		h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{
			"helperIds": []string{helper.ID}, "ratings": map[string]int{helper.ID: stars},
		}, nil)
		return pet
	}

	// Una mala nota entra sobre las 20 de 5 estrellas: no hunde a quien recién empieza.
	closeCase(1)
	if p := h.profile(helper, ""); p.Rating != 4.8 || p.RatingCount != 1 {
		t.Fatalf("una de 1 estrella = %+v", p)
	}
	// Ni con 4,8 se tiene la insignia todavía: pide al menos 5 calificaciones reales.
	if _, tier := badgeOf(h.profile(helper, ""), "protector"); tier != 0 {
		t.Fatal("no debe tener Protector animal con una sola calificación")
	}
	for i := 0; i < 4; i++ {
		h.clock.Advance(time.Hour)
		closeCase(5)
	}
	p := h.profile(helper, "")
	if _, tier := badgeOf(p, "protector"); p.Rating != 4.8 || p.RatingCount != 5 || tier != 1 {
		t.Fatalf("con 5 calificaciones y 4,8 = %+v", p)
	}
	if count, _ := badgeOf(p, "paw_angel"); count != 5 {
		t.Fatalf("Ángel de patas = %d", count)
	}
	// Se pierde si baja y se recupera si sube: nada queda fijo.
	h.clock.Advance(time.Hour)
	worst := closeCase(1)
	if _, tier := badgeOf(h.profile(helper, ""), "protector"); tier != 0 {
		t.Fatal("debe perder la insignia al bajar de 4,8")
	}
	h.exec(`UPDATE pet_helpers SET stars = 5 WHERE pet_id = $1`, worst.ID)
	if _, tier := badgeOf(h.profile(helper, ""), "protector"); tier != 1 {
		t.Fatal("debe recuperar la insignia al subir")
	}
	// Solo cuentan las últimas 20: una nota vieja termina saliendo del promedio.
	h.exec(`UPDATE pet_helpers SET stars = 1 WHERE pet_id = $1`, worst.ID)
	for i := 0; i < 20; i++ {
		h.clock.Advance(time.Hour)
		closeCase(5)
	}
	if p := h.profile(helper, ""); p.Rating != 5 || p.RatingCount != 26 {
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
	if p := h.profile(helper, ""); p.Rating != 5 || p.RatingCount != 26 {
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
	if n := h.count(`SELECT count(*) FROM pets WHERE id = $1 AND withdrawn_at IS NOT NULL`, worst.ID); n != 1 {
		t.Fatal("el caso debe quedar retirado")
	}
	if p := h.profile(helper, ""); p.RatingCount != 25 {
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
	found := h.report(owner, foundReport(laureles, nil))
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

func TestFosterAndQuickResponseBadges(t *testing.T) {
	h := newHarness(t)
	finder := h.user("Quien Cuida", true)
	family := h.user("La Familia", true)

	foster := func() int {
		count, _ := badgeOf(h.profile(finder, ""), "foster")
		return count
	}
	closeFound := func(extra map[string]any, wait time.Duration, helpers []string) {
		t.Helper()
		pet := h.report(finder, foundReport(laureles, extra))
		h.helpOn(pet, family)
		h.clock.Advance(wait)
		h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", finder.Token, map[string]any{"helperIds": helpers}, nil)
	}
	withMe := map[string]any{"foundCustody": "with_me"}
	// Cuenta: la tuvo consigo, pasó un día y volvió con alguien que participó.
	closeFound(withMe, 25*time.Hour, []string{family.ID})
	if got := foster(); got != 1 {
		t.Fatalf("Hogar de paso = %d", got)
	}
	// No cuenta: menos de un día, sin nadie que participara, o la mascota no estaba con esa persona.
	closeFound(withMe, time.Hour, []string{family.ID})
	closeFound(withMe, 25*time.Hour, []string{})
	closeFound(map[string]any{"foundCustody": "vet"}, 25*time.Hour, []string{family.ID})
	if got := foster(); got != 1 {
		t.Fatalf("Hogar de paso sin cumplir las condiciones = %d", got)
	}

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
