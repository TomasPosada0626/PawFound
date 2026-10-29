package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestReportLifecycleAndNearbySearch(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	pet := h.report(owner, lostReport("Max", map[string]float64{"latitude": 6.24471, "longitude": -75.59162}, nil))
	if pet.Location.Lat == 6.24471 || pet.OwnerShortName != "Valentina A." || pet.State != "active" || pet.CurrentRadius != 663 {
		t.Fatalf("reporte: %+v", pet)
	}
	if pet.Owner == nil || pet.Owner.ShortName != "Valentina A." {
		t.Fatalf("resumen de la familia: %+v", pet.Owner)
	}
	var thread app.Thread
	h.must(http.StatusOK, http.MethodGet, "/v1/threads/"+pet.GroupID, owner.Token, nil, &thread)
	if thread.Kind != "group" || len(thread.MemberIDs) != 1 || thread.LastMessage == nil || thread.LastMessage.Text != "created" {
		t.Fatalf("grupo de caso: %+v", thread)
	}

	// Límite diario: 2 por cuenta en 24 h.
	h.report(owner, lostReport("Luna", laureles, map[string]any{"species": "cat"}))
	res := h.do(http.MethodPost, "/v1/pets", owner.Token, lostReport("Tercero", laureles, map[string]any{"lastSeenAt": h.clock.Now()}))
	if res.Status != http.StatusTooManyRequests || !strings.Contains(string(res.Body), "retryAt") {
		t.Fatalf("límite diario = %d %s", res.Status, res.Body)
	}
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", owner.Token, nil, &me)
	if me.Allowance.Allowed || me.Allowance.RetryAt == nil {
		t.Fatalf("cupo: %+v", me.Allowance)
	}

	// Validaciones.
	for field, extra := range map[string]map[string]any{
		"species": {"species": "dragon"}, "location": {"location": map[string]float64{"latitude": 0, "longitude": 0}},
		"lastSeenAt": {"lastSeenAt": h.clock.Now().Add(2 * time.Hour)}, "name": {"name": " "}, "zone": {"zone": ""},
		"photos": {"photos": []string{"med_inexistente"}},
	} {
		other := h.user("Validador "+field, true)
		body := lostReport("X", laureles, extra)
		if _, ok := body["lastSeenAt"]; !ok {
			body["lastSeenAt"] = h.clock.Now().Add(-time.Minute)
		}
		res := h.do(http.MethodPost, "/v1/pets", other.Token, body)
		if res.Status != http.StatusUnprocessableEntity || !strings.Contains(string(res.Body), field) {
			t.Errorf("%s: %d %s", field, res.Status, res.Body)
		}
	}

	// Búsqueda por radio: público, filtra por tipo y especie, ordena por cercanía.
	finder := h.user("Daniel Ruiz", true)
	found := h.report(finder, map[string]any{
		"kind": "found", "species": "dog", "sex": "unknown", "age": "adult", "size": "medium",
		"description": "", "photos": []string{}, "location": envigado, "zone": "Envigado", "foundSearchRadius": 2000, "foundCondition": "scared", "foundCustody": "with_me",
	})
	if found.FoundSearchRadius == nil || *found.FoundSearchRadius != 2000 || found.Reward || found.CurrentRadius != 2000 {
		t.Fatalf("encontrada: %+v", found)
	}
	var near []app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets?lat=6.2447&lng=-75.5916&radius=3000", "", nil, &near)
	if len(near) != 2 {
		t.Fatalf("a 3 km = %d", len(near))
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/pets?lat=6.2447&lng=-75.5916&radius=20000&kind=found", "", nil, &near)
	if len(near) != 1 || near[0].ID != found.ID {
		t.Fatalf("solo encontradas = %+v", near)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/pets?lat=6.2447&lng=-75.5916&species=cat", "", nil, &near)
	if len(near) != 1 || near[0].Name == nil || *near[0].Name != "Luna" {
		t.Fatalf("solo gatos = %+v", near)
	}
	h.expectError(http.StatusBadRequest, "invalid_input", http.MethodGet, "/v1/pets?lat=x", "", nil)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodGet, "/v1/pets?lat=6.2&lng=-75.5&kind=x", "", nil)

	// Retirar: se archiva y sale del mapa; solo la familia puede.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, "/v1/pets/"+pet.ID, finder.Token, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+pet.ID, owner.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/pets/"+pet.ID, owner.Token, nil, nil)
	var archived app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, "", nil, &archived)
	if archived.State != "archived" {
		t.Fatalf("estado = %s", archived.State)
	}
	var mine []app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/me/pets", owner.Token, nil, &mine)
	if len(mine) != 2 {
		t.Fatalf("mis reportes = %d", len(mine))
	}
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/pets/pet_inexistente", "", nil)
}

func TestAngelAlertReachGrowsWithLifeCircle(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	near := h.user("Carlos Mejía", true)  // ~0,9 km: dentro del círculo inicial de perro en pánico (1 km)
	mid := h.user("Laura Gil", true)      // ~2 km: entra cuando el círculo crece
	far := h.user("Pedro Far", true)      // ~8 km
	optOut := h.user("Sin Alertas", true) // a 0,9 km pero con alertas apagadas
	for _, u := range []user{owner, near, mid, far, optOut} {
		h.device(u)
	}
	h.alertZone(owner, laureles, "Laureles")
	h.alertZone(near, estadio, "Estadio")
	h.alertZone(mid, belen, "Belén")
	h.alertZone(far, envigado, "Envigado")
	h.alertZone(optOut, estadio, "Estadio")
	h.must(http.StatusOK, http.MethodPut, "/v1/me/notification-prefs", optOut.Token, map[string]any{"angelAlerts": false}, nil)
	h.must(http.StatusOK, http.MethodPut, "/v1/me/notification-prefs", near.Token, map[string]any{"quietHours": true, "quietFrom": "09:00", "quietTo": "11:00"}, nil)

	pet := h.report(owner, lostReport("Negrita", laureles, map[string]any{"traumaticEvent": true, "lastSeenAt": h.clock.Now()}))
	if got := kinds(h.notifications(near)); got != "angel_alert" {
		t.Fatalf("cerca = %q", got)
	}
	for _, u := range []user{owner, mid, far, optOut} {
		if got := kinds(h.notifications(u)); got != "" {
			t.Fatalf("%s no debía recibir nada: %q", u.Name, got)
		}
	}
	pushes := h.pushesTo(near)
	// 15:00 UTC = 10:00 en Colombia: dentro del modo descanso (09–11), llega sin sonar.
	if len(pushes) != 1 || pushes[0].URL != "/alerta/angel/"+pet.ID || pushes[0].Channel != "angel-alerts" || !pushes[0].Silent ||
		!strings.Contains(pushes[0].Body, "Negrita") {
		t.Fatalf("push = %+v", pushes)
	}

	// El job no repite a quien ya recibió y no llega a nadie más mientras el círculo no crezca.
	if n, _ := h.app.RunAlertJob(context.Background()); n != 0 {
		t.Fatalf("job sin crecimiento = %d", n)
	}
	// 1 h después el círculo de perro en pánico mide ~2,2 km: llega a Belén, no a Envigado.
	h.clock.Advance(time.Hour)
	if n, _ := h.app.RunAlertJob(context.Background()); n != 1 {
		t.Fatalf("job a la hora = %d", n)
	}
	if got := kinds(h.notifications(mid)); got != "life_circle" {
		t.Fatalf("Belén = %q", got)
	}
	if got := kinds(h.notifications(near)); got != "angel_alert" {
		t.Fatalf("una sola alerta por persona y caso: %q", got)
	}
	// En 48 h llega al tope (8 km) y alcanza Envigado.
	h.clock.Advance(47 * time.Hour)
	if n, _ := h.app.RunAlertJob(context.Background()); n != 1 {
		t.Fatalf("job al tope = %d", n)
	}
	if got := kinds(h.notifications(far)); got != "life_circle" {
		t.Fatalf("Envigado = %q", got)
	}
	if got := h.pushesTo(far); len(got) != 1 || !strings.Contains(got[0].Title, "llegó a tu zona") {
		t.Fatalf("push de crecimiento = %+v", got)
	}

	// Un caso cerrado no alerta más.
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{}}, nil)
	late := h.user("Tarde", true)
	h.alertZone(late, laureles, "Laureles")
	if n, _ := h.app.RunAlertJob(context.Background()); n != 0 {
		t.Fatalf("caso cerrado alertó a %d", n)
	}
}

func TestAngelAlertDailyCap(t *testing.T) {
	h := newHarness(t)
	neighbor := h.user("Vecina", true)
	h.alertZone(neighbor, laureles, "Laureles")
	for i := 0; i < 6; i++ {
		owner := h.user(fmt.Sprintf("Familia %d", i), true)
		h.report(owner, lostReport(fmt.Sprintf("Perro %d", i), laureles, nil))
	}
	if got := len(h.notifications(neighbor)); got != 5 {
		t.Fatalf("máximo 5 alertas al día, llegaron %d", got)
	}
	h.clock.Advance(25 * time.Hour)
	if n, _ := h.app.RunAlertJob(context.Background()); n != 1 {
		t.Fatalf("al día siguiente debe llegar la pendiente: %d", n)
	}
}

func TestSightingsChatPhotosAndReunion(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Valentina Arango", true)
	helper := h.user("Carlos Mejía", true)
	witness := h.user("Laura Gil", true)
	sharer := h.user("Pedro Comparte", true)
	stranger := h.user("Desconocido", true)
	unverified := h.user("Sin Verificar", false)
	for _, u := range []user{owner, helper, witness, sharer} {
		h.device(u)
	}
	pet := h.report(owner, lostReport("Max", laureles, nil))

	// "La vi": la familia recibe el aviso y quién lo reportó; el resto no ve el autor.
	h.clock.Advance(30 * time.Minute)
	var updated app.Pet
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", witness.Token, map[string]any{
		"at": h.clock.Now(), "location": belen, "zone": "Belén", "note": "Iba hacia el parque",
	}, &updated)
	if updated.Zone != "Belén" || !updated.LastSeenAt.Equal(h.clock.Now()) || len(updated.Sightings) != 1 || updated.Sightings[0].AuthorID != "" {
		t.Fatalf("avistamiento visto por quien lo reporta: %+v", updated)
	}
	var ownerView app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, owner.Token, nil, &ownerView)
	if ownerView.Sightings[0].AuthorID != witness.ID {
		t.Fatal("la familia debe saber quién la vio, para poder agradecer")
	}
	if got := kinds(h.notifications(owner)); got != "sighting" {
		t.Fatalf("familia = %q", got)
	}
	// Un avistamiento más viejo no mueve el último punto conocido.
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", witness.Token, map[string]any{
		"at": h.clock.Now().Add(-2 * time.Hour), "location": envigado, "zone": "Envigado",
	}, &updated)
	if updated.Zone != "Belén" {
		t.Fatalf("un avistamiento viejo movió el caso a %s", updated.Zone)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", unverified.Token, map[string]any{"at": h.clock.Now(), "location": belen, "zone": "Belén"})

	// Grupo de caso: unirse, escribir, traducción una vez por idioma, foto.
	var joined map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", helper.Token, nil, &joined)
	if joined["threadId"] != pet.GroupID {
		t.Fatalf("join = %v", joined)
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", helper.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPut, "/v1/me/lang", owner.Token, map[string]string{"lang": "en"}, nil)
	var msg app.Message
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"text": "  Lo vi cerca del parque  ", "lang": "es"}, &msg)
	if msg.Text != "Lo vi cerca del parque" || msg.Translations["en"] != "[en] Lo vi cerca del parque" || len(msg.Translations) != 1 {
		t.Fatalf("mensaje: %+v", msg)
	}
	if got := h.pushesTo(owner); len(got) == 0 || got[len(got)-1].Body != "[en] Lo vi cerca del parque" || got[len(got)-1].URL != "/chat/"+pet.GroupID {
		t.Fatalf("push del grupo en el idioma de quien lee: %+v", got)
	}
	photo, res := h.upload(helper, "chat", jpegBytes(3))
	if res.Status != http.StatusCreated || photo.Width != 320 {
		t.Fatalf("subida: %d %s", res.Status, res.Body)
	}
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"photoId": photo.URL}, &msg)
	if msg.Photo == nil || msg.Photo.URL != photo.URL || msg.Text != "" {
		t.Fatalf("mensaje con foto: %+v", msg)
	}
	// La misma foto no se puede reutilizar, y no se envían mensajes vacíos.
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"photoId": photo.ID})
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"text": "   "})
	// Foto de chat: solo miembros. Quien no está en el chat recibe 404.
	path := strings.TrimPrefix(photo.URL, "http://api.test")
	if res := h.do(http.MethodGet, path, owner.Token, nil); res.Status != http.StatusOK || res.Header.Get("Content-Type") != "image/jpeg" || bytes.Contains(res.Body, []byte("Exif")) {
		t.Fatalf("miembro = %d %s", res.Status, res.Header.Get("Content-Type"))
	}
	for _, token := range []string{stranger.Token, ""} {
		if res := h.do(http.MethodGet, path, token, nil); res.Status != http.StatusNotFound {
			t.Fatalf("no miembro = %d", res.Status)
		}
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", stranger.Token, map[string]string{"text": "hola"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/threads/"+pet.GroupID+"/messages", stranger.Token, nil)

	// Mensaje directo con la familia, con foto.
	var dm map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/direct", helper.Token, nil, &dm)
	var dmAgain map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/direct", helper.Token, nil, &dmAgain)
	if dm["threadId"] != dmAgain["threadId"] {
		t.Fatal("el DM debe reutilizarse")
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/direct", owner.Token, nil)
	h.clock.Advance(time.Second)
	dmPhoto, _ := h.upload(helper, "chat", jpegBytes(5))
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+dm["threadId"]+"/messages", helper.Token, map[string]string{"text": "¿Es este?", "photoId": dmPhoto.ID}, &msg)
	var threads []app.Thread
	h.must(http.StatusOK, http.MethodGet, "/v1/threads", owner.Token, nil, &threads)
	unread := map[string]int{}
	for _, th := range threads {
		unread[th.Kind] = th.Unread
	}
	if len(threads) != 2 || unread["dm"] != 1 || unread["group"] < 3 {
		t.Fatalf("bandeja: %+v", unread)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/threads/"+dm["threadId"]+"/read", owner.Token, nil, nil)
	var dmThread app.Thread
	h.must(http.StatusOK, http.MethodGet, "/v1/threads/"+dm["threadId"], owner.Token, nil, &dmThread)
	if dmThread.LastMessage == nil || dmThread.LastMessage.Photo == nil || len(dmThread.Members) != 2 {
		t.Fatalf("DM: %+v", dmThread)
	}
	var history []app.Message
	h.must(http.StatusOK, http.MethodGet, "/v1/threads/"+dm["threadId"]+"/messages?limit=10", owner.Token, nil, &history)
	if len(history) != 1 || history[0].Photo == nil {
		t.Fatalf("historial = %+v", history)
	}
	h.expectError(http.StatusBadRequest, "invalid_input", http.MethodGet, "/v1/threads/"+dm["threadId"]+"/messages?before=ayer", owner.Token, nil)
	var muted map[string]bool
	h.must(http.StatusOK, http.MethodPost, "/v1/threads/"+dm["threadId"]+"/mute", owner.Token, nil, &muted)
	if !muted["muted"] {
		t.Fatal("silenciar")
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+dm["threadId"]+"/mute", stranger.Token, nil)

	// Compartir (cuenta casos distintos por persona).
	h.must(http.StatusNoContent, http.MethodPost, "/v1/pets/"+pet.ID+"/share", sharer.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/pets/"+pet.ID+"/share", sharer.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/pets/"+pet.ID+"/share", "", nil, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/pets/nada/share", "", nil)

	// Reencuentro: la familia agradece solo a quienes participaron.
	var candidates []app.HelperCandidate
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID+"/helpers", owner.Token, nil, &candidates)
	reasons := map[string]string{}
	for _, c := range candidates {
		reasons[c.UserID] = strings.Join(c.Reasons, ",")
	}
	if len(candidates) != 2 || reasons[helper.ID] != "group,direct" || reasons[witness.ID] != "sighting" {
		t.Fatalf("candidatos = %+v", reasons)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/pets/"+pet.ID+"/helpers", helper.Token, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", helper.Token, map[string]any{})
	var closed app.Pet
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{"helperIds": []string{helper.ID, stranger.ID, helper.ID}}, &closed)
	if closed.State != "reunited" || closed.ReunitedAt == nil || strings.Join(closed.HelperIDs, ",") != helper.ID {
		t.Fatalf("cierre: %+v", closed)
	}
	if got := kinds(h.notifications(helper)); got != "thanked" {
		t.Fatalf("ayudante = %q", got)
	}
	if got := kinds(h.notifications(sharer)); got != "case_closed" {
		t.Fatalf("quien compartió debe saber que ya puede quitar la historia: %q", got)
	}
	if got := kinds(h.notifications(stranger)); got != "" {
		t.Fatalf("quien no participó = %q", got)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"text": "hola"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/join", stranger.Token, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/reunite", owner.Token, map[string]any{})

	// Insignias calculadas en el servidor a partir de los hechos.
	var profile app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+helper.ID, "", nil, &profile)
	badge := map[string]int{}
	for _, b := range profile.Badges {
		badge[b.ID] = b.Count
	}
	if badge["paw_angel"] != 1 || badge["community"] != 1 || badge["verified"] != 1 {
		t.Fatalf("insignias del ayudante = %+v", badge)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+owner.ID, "", nil, &profile)
	for _, b := range profile.Badges {
		badge[b.ID] = b.Count
	}
	if badge["reunion"] != 1 || badge["reporter"] != 1 || badge["community"] != 0 {
		t.Fatalf("insignias de la familia = %+v", badge)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+sharer.ID, "", nil, &profile)
	if profile.Badges[6].ID != "spreader" || profile.Badges[6].Count != 1 {
		t.Fatalf("Megáfono = %+v", profile.Badges[6])
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+witness.ID, "", nil, &profile)
	if profile.Badges[3].ID != "eyes" || profile.Badges[3].Count != 2 {
		t.Fatalf("Ojos atentos = %+v", profile.Badges[3])
	}
}

func TestChatRulesRateLimitMutePrivacy(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	talker := h.user("Charlatán", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", talker.Token, nil, nil)
	for i := 0; i < 12; i++ {
		h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", talker.Token, map[string]string{"text": fmt.Sprintf("m%d", i)}, nil)
	}
	h.expectError(http.StatusTooManyRequests, "rate_limited", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", talker.Token, map[string]string{"text": "otro"})
	h.clock.Advance(61 * time.Second)
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", talker.Token, map[string]string{"text": "ya puedo"}, nil)

	// Restricción de moderación.
	h.exec(`UPDATE users SET muted_until = $2 WHERE id = $1`, talker.ID, h.clock.Now().Add(24*time.Hour))
	res := h.do(http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", talker.Token, map[string]string{"text": "hola"})
	if res.Status != http.StatusForbidden || res.code() != "muted" || !strings.Contains(string(res.Body), "until") {
		t.Fatalf("restringido = %d %s", res.Status, res.Body)
	}

	// "Quién puede escribirme".
	h.must(http.StatusOK, http.MethodPut, "/v1/me/privacy", owner.Token, map[string]string{"whoCanMessage": "nobody"}, nil)
	h.expectError(http.StatusForbidden, "cannot_message", http.MethodPost, "/v1/pets/"+pet.ID+"/direct", talker.Token, nil)
	h.must(http.StatusOK, http.MethodPut, "/v1/me/privacy", owner.Token, map[string]string{"whoCanMessage": "verified"}, nil)
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/direct", talker.Token, nil, nil)
}

func TestRealtimeMessages(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	helper := h.user("Ayudante", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", helper.Token, nil, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.srv.URL, "http")+"/v1/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","token":"`+owner.Token+`"}`))
	readEvent := func() map[string]any {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var e map[string]any
		_ = json.Unmarshal(raw, &e)
		return e
	}
	if e := readEvent(); e["type"] != "ready" {
		t.Fatalf("primer evento = %v", e)
	}
	for h.app.Hub.Connected(owner.ID) == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", helper.Token, map[string]string{"text": "¡La encontré!"}, nil)
	e := readEvent()
	data, _ := e["data"].(map[string]any)
	if e["type"] != "message" || data["text"] != "¡La encontré!" {
		t.Fatalf("evento = %v", e)
	}
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", helper.Token, map[string]any{"at": h.clock.Now(), "location": belen, "zone": "Belén"}, nil)
	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		seen[readEvent()["type"].(string)] = true
	}
	if !seen["message"] || !seen["notification"] {
		t.Fatalf("avistamiento en vivo = %v", seen)
	}
}

func TestUploadRejectsNonImages(t *testing.T) {
	h := newHarness(t)
	u := h.user("Sube", true)
	unverified := h.user("Nueva", false)
	if _, res := h.upload(u, "pet", []byte("<html>no soy foto</html>")); res.Status != http.StatusUnprocessableEntity || res.code() != "invalid_image" {
		t.Fatalf("no imagen = %d %s", res.Status, res.Body)
	}
	if _, res := h.upload(u, "avatar", jpegBytes(1)); res.Status != http.StatusUnprocessableEntity {
		t.Fatalf("propósito inválido = %d", res.Status)
	}
	if _, res := h.upload(unverified, "chat", jpegBytes(1)); res.Status != http.StatusForbidden {
		t.Fatalf("sin verificar = %d", res.Status)
	}
	if _, res := h.upload(unverified, "owned", jpegBytes(1)); res.Status != http.StatusCreated {
		t.Fatalf("mis mascotas sin verificar = %d", res.Status)
	}
	req, _ := http.NewRequest(http.MethodPost, h.srv.URL+"/v1/media", strings.NewReader("x"))
	req.Header.Set("Authorization", "Bearer "+u.Token)
	resp, _ := h.srv.Client().Do(req)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge && resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("sin multipart = %d", resp.StatusCode)
	}
	if res := h.do(http.MethodGet, "/v1/media/med_nada", "", nil); res.Status != http.StatusNotFound {
		t.Fatalf("media inexistente = %d", res.Status)
	}
}
