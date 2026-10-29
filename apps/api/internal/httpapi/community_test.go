package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

func TestPublicProfileAndLikes(t *testing.T) {
	h := newHarness(t)
	ana := h.user("Ana María Gómez", true)
	fan := h.user("Fan", true)
	newbie := h.user("Recién Llegada", false)
	photo, _ := h.upload(ana, "owned", jpegBytes(7))
	h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", ana.Token, map[string]any{
		"name": "Rocky", "species": "dog", "sex": "male",
		"age": "adult", "size": "medium", "description": "", "photos": []string{photo.ID},
	}, nil)

	var liked map[string]any
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/like", fan.Token, nil, &liked)
	if liked["liked"] != true || liked["likes"] != float64(1) {
		t.Fatalf("me gusta = %v", liked)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+ana.ID+"/like", newbie.Token, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+ana.ID+"/like", ana.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodPost, "/v1/users/u_nadie/like", fan.Token, nil)

	var p app.PublicProfile
	res := h.must(http.StatusOK, http.MethodGet, "/v1/users/"+ana.ID, fan.Token, nil, &p)
	if p.User.Name != "Ana M." || p.Likes != 1 || !p.LikedByMe || p.MemberDays != 40 || len(p.Pets) != 1 || p.Pets[0].Photo == nil {
		t.Fatalf("perfil = %+v", p)
	}
	// Nunca correo ni celular en el perfil público.
	if strings.Contains(string(res.Body), "@pawfound.test") || strings.Contains(string(res.Body), "+5730") {
		t.Fatalf("el perfil filtra datos de contacto: %s", res.Body)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+ana.ID, "", nil, &p)
	if p.LikedByMe {
		t.Fatal("sin sesión no hay me gusta propio")
	}
	h.must(http.StatusOK, http.MethodPost, "/v1/users/"+ana.ID+"/like", fan.Token, nil, &liked)
	if liked["liked"] != false || liked["likes"] != float64(0) {
		t.Fatalf("quitar me gusta = %v", liked)
	}
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/users/u_nadie", "", nil)
}

func TestOwnedPetsAndFoundMatches(t *testing.T) {
	h := newHarness(t)
	family := h.user("Familia Rocky", true)
	finder := h.user("Quien Encontró", true)
	h.device(family)
	var rocky app.OwnedPet
	h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", family.Token, map[string]any{
		"name": "Rocky", "species": "dog", "breed": "Criollo",
		"sex": "male", "age": "adult", "size": "medium", "color": "Negro con blanco", "description": "Muy juguetón", "photos": []string{},
	}, &rocky)
	var cat app.OwnedPet
	h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", family.Token, map[string]any{
		"name": "Misu", "species": "cat",
		"sex": "female", "age": "adult", "size": "small", "color": "Gris", "description": "", "photos": []string{},
	}, &cat)

	// Sin zona de alertas no hay con qué comparar.
	var matches struct {
		Matches        []app.OwnedMatch `json:"matches"`
		NeedsAlertZone bool             `json:"needsAlertZone"`
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/me/owned-pets/"+rocky.ID+"/matches", family.Token, nil, &matches)
	if !matches.NeedsAlertZone {
		t.Fatal("debe pedir la zona de alertas")
	}
	h.alertZone(family, laureles, "Laureles")

	found := func(extra map[string]any) map[string]any {
		r := map[string]any{
			"kind": "found", "species": "dog", "sex": "male", "age": "adult", "size": "medium", "breed": "criollo",
			"color": "negra y blanca", "description": "", "photos": []string{}, "location": estadio, "zone": "Estadio",
		}
		for k, v := range extra {
			r[k] = v
		}
		return r
	}
	similar := h.report(finder, found(nil))
	h.report(finder, found(map[string]any{"color": "café", "location": belen}))
	list := h.notifications(family)
	if kinds(list) != "owned_match" || list[0].PetID != similar.ID || list[0].OwnedPetID == nil || *list[0].OwnedPetID != rocky.ID {
		t.Fatalf("¿es Rocky? = %+v", list)
	}
	if got := h.pushesTo(family); len(got) != 1 || got[0].Title != "¿Es Rocky?" || got[0].URL != "/pet/"+similar.ID {
		t.Fatalf("push = %+v", got)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/me/owned-pets/"+rocky.ID+"/matches", family.Token, nil, &matches)
	if matches.NeedsAlertZone || len(matches.Matches) != 1 || matches.Matches[0].Pet.ID != similar.ID || matches.Matches[0].Distance < 800 {
		t.Fatalf("coincidencias = %+v", matches)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/me/owned-pets/"+rocky.ID+"/matches", finder.Token, nil)
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/me/owned-pets/own_nada/matches", family.Token, nil)

	// Si Rocky ya tiene un reporte de pérdida activo, ese caso recibe la coincidencia normal.
	var lost app.Pet
	h.must(http.StatusCreated, http.MethodPost, "/v1/pets", family.Token, lostReport("Rocky", laureles, map[string]any{"ownedPetId": rocky.ID, "lastSeenAt": h.clock.Now()}), &lost)
	var mine []app.OwnedPet
	h.must(http.StatusOK, http.MethodGet, "/v1/me/owned-pets", family.Token, nil, &mine)
	if mine[0].LastCaseID == nil || *mine[0].LastCaseID != lost.ID {
		t.Fatalf("el perfil debe quedar enlazado al caso: %+v", mine[0])
	}
	other := h.user("Otra Persona", true)
	h.clock.Advance(time.Minute)
	h.report(other, found(nil))
	got := kinds(h.notifications(family))
	if strings.Count(got, "owned_match") != 1 || !strings.Contains(got, "possible_match") {
		t.Fatalf("con reporte activo = %q", got)
	}
	var possible []app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+lost.ID+"/matches", family.Token, nil, &possible)
	if len(possible) < 2 {
		t.Fatalf("coincidencias del caso = %d", len(possible))
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/pets/"+lost.ID+"/matches", other.Token, nil)

	// Editar y borrar; validaciones; límite de 10.
	h.must(http.StatusOK, http.MethodPut, "/v1/me/owned-pets/"+cat.ID, family.Token, map[string]any{
		"name": "Misu", "species": "cat",
		"sex": "female", "age": "senior", "size": "small", "description": "", "photos": []string{},
	}, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPut, "/v1/me/owned-pets/"+cat.ID, finder.Token, map[string]any{
		"name": "X", "species": "cat",
		"sex": "female", "age": "senior", "size": "small", "photos": []string{},
	})
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/owned-pets", family.Token, map[string]any{"name": "", "species": "dog"})
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodDelete, "/v1/me/owned-pets/"+cat.ID, finder.Token, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/owned-pets/"+cat.ID, family.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me/owned-pets/"+cat.ID, family.Token, nil, nil)
	for i := 0; i < 9; i++ {
		h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", family.Token, map[string]any{
			"name": "M", "species": "other",
			"sex": "unknown", "age": "unknown", "size": "small", "photos": []string{},
		}, nil)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/owned-pets", family.Token, map[string]any{
		"name": "Once", "species": "other",
		"sex": "unknown", "age": "unknown", "size": "small", "photos": []string{},
	})
}

func TestReportsModerationAndSanctions(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	owner := h.user("Familia", true)
	rude := h.user("Grosero", true)
	scammer := h.user("Estafador", true)
	mod := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, mod.ID)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", rude.Token, nil, nil)
	var msg app.Message
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", rude.Token, map[string]string{"text": "eres una idiota"}, &msg)

	// Reportar persona con el mensaje como contexto; repetir no duplica.
	body := map[string]string{"reason": "rude", "messageId": msg.ID, "note": "Me insultó"}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/users/"+rude.ID+"/report", owner.Token, body, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/users/"+rude.ID+"/report", owner.Token, body, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+owner.ID+"/report", owner.Token, body)
	h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/users/"+rude.ID+"/report", owner.Token, map[string]string{"reason": "feo"})
	// No se puede reportar un mensaje de un chat ajeno ni atribuirlo a otra persona.
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/users/"+scammer.ID+"/report", owner.Token, map[string]string{"reason": "rude", "messageId": msg.ID})
	h.must(http.StatusNoContent, http.MethodPost, "/v1/users/"+scammer.ID+"/report", owner.Token, map[string]string{"reason": "scam"}, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/pets/"+pet.ID+"/report", rude.Token, map[string]string{"note": "falso"}, nil)
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/pets/"+pet.ID+"/report", owner.Token, map[string]string{})

	queue, err := h.app.ModerationQueue(ctx, "open", 0)
	if err != nil || len(queue) != 3 {
		t.Fatalf("cola = %d %v", len(queue), err)
	}
	var rudeReport app.QueueItem
	for _, q := range queue {
		if q.MessageID != nil {
			rudeReport = q
		}
	}
	detail, err := h.app.ModerationReport(ctx, rudeReport.ID)
	if err != nil || detail.Message == nil || detail.Message.Text != "eres una idiota" || len(detail.Context) == 0 || detail.Suggest != "warn" {
		t.Fatalf("detalle = %+v %v", detail, err)
	}

	// Sanciones escalonadas, con bitácora.
	modActor, _ := h.app.LoadActor(ctx, mod.ID)
	ownerActor, _ := h.app.LoadActor(ctx, owner.ID)
	if err := h.app.Moderate(ctx, ownerActor, app.ModerationInput{Action: "warn", UserID: rude.ID}); err != app.ErrNotAllowed {
		t.Fatalf("una cuenta normal no modera: %v", err)
	}
	for _, in := range []app.ModerationInput{{Action: "fly"}, {Action: "mute", UserID: rude.ID, Hours: 5}, {Action: "suspend", UserID: rude.ID}} {
		if err := h.app.Moderate(ctx, modActor, in); err == nil {
			t.Errorf("%+v debía fallar", in)
		}
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "warn", ReportID: rudeReport.ID, Note: "primer aviso"}); err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "mute", UserID: rude.ID, Hours: 24}); err != nil {
		t.Fatal(err)
	}
	h.expectError(http.StatusForbidden, "muted", http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", rude.Token, map[string]string{"text": "hola"})
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "remove_message", MessageID: msg.ID}); err != nil {
		t.Fatal(err)
	}
	var history []app.Message
	h.must(http.StatusOK, http.MethodGet, "/v1/threads/"+pet.GroupID+"/messages", owner.Token, nil, &history)
	for _, m := range history {
		if m.ID == msg.ID {
			t.Fatal("el mensaje retirado sigue visible")
		}
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "restore_message", MessageID: msg.ID}); err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "remove_message", MessageID: "m_nada"}); err != app.ErrNotFound {
		t.Fatalf("mensaje inexistente: %v", err)
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "unmute", UserID: rude.ID}); err != nil {
		t.Fatal(err)
	}
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", rude.Token, map[string]string{"text": "perdón"}, nil)
	detail, _ = h.app.ModerationReport(ctx, rudeReport.ID)
	if detail.Item.Status != "actioned" || detail.Suggest != "mute168" || len(detail.History) != 5 {
		t.Fatalf("tras sanciones: status=%s suggest=%s history=%d", detail.Item.Status, detail.Suggest, len(detail.History))
	}

	// Retirar una publicación: sale del mapa, no cuenta para insignias y solo la ve su autor.
	var petReport string
	for _, q := range queue {
		if q.TargetKind == "pet" {
			petReport = q.ID
		}
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "remove_pet", ReportID: petReport, Note: "falso"}); err != nil {
		t.Fatal(err)
	}
	h.expectError(http.StatusNotFound, "not_found", http.MethodGet, "/v1/pets/"+pet.ID, rude.Token, nil)
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, owner.Token, nil, nil)
	var p app.PublicProfile
	h.must(http.StatusOK, http.MethodGet, "/v1/users/"+owner.ID, "", nil, &p)
	if p.Badges[1].ID != "reporter" || p.Badges[1].Count != 0 {
		t.Fatalf("un reporte retirado no cuenta: %+v", p.Badges[1])
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "restore_pet", PetID: pet.ID}); err != nil {
		t.Fatal(err)
	}

	// Suspender: la sesión deja de servir; levantarla la devuelve.
	var scamReport string
	for _, q := range queue {
		if q.Reason == "scam" {
			scamReport = q.ID
		}
	}
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "suspend", ReportID: scamReport, Note: "estafa confirmada"}); err != nil {
		t.Fatal(err)
	}
	h.expectError(http.StatusForbidden, "suspended", http.MethodGet, "/v1/me", scammer.Token, nil)
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "unsuspend", UserID: scammer.ID, Note: "apelación aceptada"}); err != nil {
		t.Fatal(err)
	}
	h.must(http.StatusOK, http.MethodGet, "/v1/me", scammer.Token, nil, nil)
	// Nadie modera al equipo ni a sí mismo, salvo un admin.
	if err := h.app.Moderate(ctx, modActor, app.ModerationInput{Action: "warn", UserID: mod.ID}); err != app.ErrNotAllowed {
		t.Fatalf("auto-sanción: %v", err)
	}
	stats, _ := h.app.ModerationStats(ctx)
	if stats.Open != 0 || stats.Resolved24 != 3 {
		t.Fatalf("stats = %+v", stats)
	}
	if log, _ := h.app.ModerationLog(ctx, "", 100); len(log) != 9 {
		t.Fatalf("bitácora = %d", len(log))
	}
	if found, _ := h.app.FindUsers(ctx, "Grosero"); len(found) != 1 {
		t.Fatalf("búsqueda = %d", len(found))
	}
	if found, _ := h.app.FindUsers(ctx, "%"); len(found) != 0 {
		t.Fatal("los comodines de LIKE se escapan")
	}
	if err := h.app.GrantRole(ctx, rude.ID+"@pawfound.test", "admin"); err != nil {
		t.Fatal(err)
	}
	if err := h.app.GrantRole(ctx, "nadie@x.co", "admin"); err == nil {
		t.Fatal("GrantRole sin cuenta")
	}
	if err := h.app.GrantRole(ctx, "nadie@x.co", "rey"); err == nil {
		t.Fatal("GrantRole con rol inválido")
	}
}

func TestDuplicatePhotoOpensAutomaticReport(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	real := h.user("Familia Real", true)
	scammer := h.user("Estafador", true)
	original, _ := h.upload(real, "pet", jpegBytes(9))
	h.report(real, lostReport("Toby", laureles, map[string]any{"photos": []string{original.ID}}))
	copied, _ := h.upload(scammer, "pet", jpegBytes(9))
	h.report(scammer, map[string]any{
		"kind": "found", "species": "dog", "sex": "male", "age": "adult", "size": "medium",
		"description": "Lo tengo, escríbeme", "photos": []string{copied.ID}, "location": estadio, "zone": "Estadio",
	})
	queue, _ := h.app.ModerationQueue(ctx, "open", 0)
	if len(queue) != 1 || !queue[0].Automatic() || queue[0].Reason != "scam" || *queue[0].ReportedID != scammer.ID {
		t.Fatalf("cola = %+v", queue)
	}
	// Las fotos de otra cuenta no se pueden adjuntar a un reporte propio.
	res := h.do(http.MethodPost, "/v1/pets", scammer.Token, lostReport("Robado", laureles, map[string]any{"photos": []string{original.ID}, "lastSeenAt": h.clock.Now()}))
	if res.Status != http.StatusUnprocessableEntity {
		t.Fatalf("foto ajena = %d", res.Status)
	}
}

func TestExportAndDeleteAccount(t *testing.T) {
	h := newHarness(t)
	gone := h.user("Se Va", true)
	stays := h.user("Se Queda", true)
	pet := h.report(gone, lostReport("Max", laureles, nil))
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/join", stays.Token, nil, nil)
	h.must(http.StatusCreated, http.MethodPost, "/v1/threads/"+pet.GroupID+"/messages", gone.Token, map[string]string{"text": "gracias"}, nil)
	var dm map[string]string
	h.must(http.StatusOK, http.MethodPost, "/v1/pets/"+pet.ID+"/direct", stays.Token, nil, &dm)
	h.alertZone(gone, laureles, "Laureles")
	photo, _ := h.upload(gone, "owned", jpegBytes(2))
	h.must(http.StatusCreated, http.MethodPost, "/v1/me/owned-pets", gone.Token, map[string]any{
		"name": "Max", "species": "dog", "sex": "male",
		"age": "adult", "size": "medium", "photos": []string{photo.ID},
	}, nil)

	var export app.Export
	res := h.must(http.StatusOK, http.MethodGet, "/v1/me/export", gone.Token, nil, &export)
	if !strings.Contains(res.Header.Get("Content-Disposition"), "attachment") || len(export.Reports) != 1 || len(export.Messages) != 1 ||
		len(export.OwnedPets) != 1 || len(export.Consents) != 1 || export.Me.AlertZone == nil {
		t.Fatalf("exportación = %+v", export)
	}

	h.must(http.StatusNoContent, http.MethodDelete, "/v1/me", gone.Token, nil, nil)
	h.expectError(http.StatusUnauthorized, "unauthorized", http.MethodGet, "/v1/me", gone.Token, nil)
	var archived app.Pet
	h.must(http.StatusOK, http.MethodGet, "/v1/pets/"+pet.ID, stays.Token, nil, &archived)
	if archived.State != "archived" || archived.OwnerID != "" {
		t.Fatalf("el reporte se archiva sin autor: %+v", archived)
	}
	var history []app.Message
	h.must(http.StatusOK, http.MethodGet, "/v1/threads/"+pet.GroupID+"/messages", stays.Token, nil, &history)
	for _, m := range history {
		if m.Text == "gracias" || m.AuthorID == gone.ID {
			t.Fatalf("quedó un rastro de la cuenta: %+v", m)
		}
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodGet, "/v1/threads/"+dm["threadId"]+"/messages", stays.Token, nil)
	if n := h.count(`SELECT count(*) FROM media WHERE id = $1`, photo.ID); n != 0 {
		t.Fatal("las fotos de Mis mascotas se borran")
	}
	if n := h.count(`SELECT count(*) FROM alert_zones`); n != 0 {
		t.Fatal("la zona de alertas se borra")
	}
}

func TestNotificationsInbox(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	witness := h.user("Testigo", true)
	pet := h.report(owner, lostReport("Max", laureles, nil))
	for i := 0; i < 2; i++ {
		h.clock.Advance(time.Minute)
		h.must(http.StatusCreated, http.MethodPost, "/v1/pets/"+pet.ID+"/sightings", witness.Token, map[string]any{"at": h.clock.Now(), "location": belen, "zone": "Belén"}, nil)
	}
	list := h.notifications(owner)
	if len(list) != 2 || list[0].Read || !list[0].At.After(list[1].At) {
		t.Fatalf("bandeja = %+v", list)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/notifications/"+list[0].ID+"/read", owner.Token, nil, nil)
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/notifications/"+list[1].ID+"/read", witness.Token, nil, nil) // ajena: no cambia nada
	list = h.notifications(owner)
	if !list[0].Read || list[1].Read {
		t.Fatalf("leída = %+v", list)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/me/notifications/read-all", owner.Token, nil, nil)
	if list = h.notifications(owner); !list[1].Read {
		t.Fatal("marcar todas")
	}
}
