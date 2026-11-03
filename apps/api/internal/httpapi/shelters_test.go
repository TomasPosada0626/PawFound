package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/providers"
)

func TestShelterIsVerifiedInTheRUES(t *testing.T) {
	h := newHarness(t)
	shelter := h.user("Fundación Huellitas", true)
	newbie := h.user("Sin Verificar", false)
	copycat := h.user("Refugio Copia", true)
	moderator := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, moderator.ID)
	h.device(shelter)
	h.registry.set("900123456", &providers.CompanyRecord{Name: "FUNDACION HUELLITAS MEDELLIN", CheckDigit: "", Status: "ACTIVA", LegalForm: "FUNDACIONES", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)

	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/shelter", newbie.Token, map[string]string{"name": "X", "nit": "900123456-8"})
	for _, bad := range []map[string]string{{"name": "", "nit": "900123456-8"}, {"name": "Huellitas", "nit": "900123456-1"}, {"name": "Huellitas", "nit": "abc"}} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_input", http.MethodPost, "/v1/me/shelter", shelter.Token, bad)
	}
	// Fundación activa en el RUES y el nombre coincide: verificado al instante, con el nombre oficial.
	var result app.ShelterResult
	h.must(http.StatusOK, http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Fundación Huellitas", "nit": "900.123.456-8"}, &result)
	if result.Status != "verified" || result.OfficialName == nil || *result.OfficialName != "FUNDACION HUELLITAS MEDELLIN" {
		t.Fatalf("resultado = %+v", result)
	}
	var me app.Me
	h.must(http.StatusOK, http.MethodGet, "/v1/me", shelter.Token, nil, &me)
	if me.User.ShelterStatus == nil || *me.User.ShelterStatus != "verified" || me.User.ShelterName == nil {
		t.Fatalf("estado = %+v", me.User)
	}
	if p := h.profile(shelter, ""); p.User.Shelter == nil || *p.User.Shelter != "Fundación Huellitas" {
		t.Fatalf("perfil = %+v", p.User)
	}
	h.acceptTerms(shelter)
	ad := h.publishAdoption(shelter, laureles, "Laureles, Medellín", nil)
	if ad.Owner.Shelter == nil {
		t.Fatalf("publicación = %+v", ad.Owner)
	}
	// Un NIT verifica una sola cuenta; corregir el nombre con el mismo NIT sí se puede.
	h.expectError(http.StatusConflict, "nit_taken", http.MethodPost, "/v1/me/shelter", copycat.Token, map[string]string{"name": "Huellitas", "nit": "9001234568"})
	h.must(http.StatusOK, http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Fundación Huellitas Medellín", "nit": "900123456-8"}, &result)

	ctx := context.Background()
	list, err := h.app.Shelters(ctx)
	if err != nil || len(list) != 1 || list[0].NIT != "900123456-8" || list[0].ShelterName != "Fundación Huellitas Medellín" || list[0].Status != "verified" {
		t.Fatalf("refugios = %+v %v", list, err)
	}
	// Moderación puede quitar la verificación; entonces no vuelve a verificarse sola.
	mod, err := h.app.LoadActor(ctx, moderator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "reject_shelter", UserID: shelter.ID, Note: "El NIT es de otra empresa"}); err != nil {
		t.Fatal(err)
	}
	if got := h.pushesTo(shelter); len(got) != 1 || got[0].URL != "/pawfamily/refugio" {
		t.Fatalf("aviso = %+v", got)
	}
	if p := h.profile(shelter, ""); p.User.Shelter != nil {
		t.Fatalf("sin verificación = %+v", p.User)
	}
	h.expectError(http.StatusForbidden, "not_allowed", http.MethodPost, "/v1/me/shelter", shelter.Token, map[string]string{"name": "Huellitas", "nit": "900123456-8"})
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "reject_shelter", UserID: shelter.ID}); err == nil {
		t.Fatal("ya estaba sin verificación")
	}
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "verify_shelter", UserID: shelter.ID}); err != nil {
		t.Fatal(err)
	}
	if p := h.profile(shelter, ""); p.User.Shelter == nil {
		t.Fatalf("verificación devuelta = %+v", p.User)
	}
}

func TestShelterReviewCases(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	shop := h.user("Tienda", true)
	unknown := h.user("Nuevo Refugio", true)
	closed := h.user("Cerrado", true)
	other := h.user("Otro Nombre", true)
	offline := h.user("Sin RUES", true)
	// 900123456-8, 800058136-5, 900078738-7, 901015729-4 y 830054539-0 tienen el dígito correcto.
	h.registry.set("800058136", &providers.CompanyRecord{Name: "NUTRICION ANIMAL SAS", CheckDigit: "", Status: "ACTIVA", LegalForm: "SOCIEDADES POR ACCIONES SIMPLIFICADAS SAS", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)
	h.registry.set("900078738", &providers.CompanyRecord{Name: "FUNDACION BIENESTAR ANIMAL", CheckDigit: "", Status: "CANCELADA", LegalForm: "FUNDACIONES", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)
	h.registry.set("901015729", &providers.CompanyRecord{Name: "FUNDACION AMIGOS DE LOS GATOS", CheckDigit: "", Status: "ACTIVA", LegalForm: "FUNDACIONES", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)

	send := func(u user, name, nit string) app.ShelterResult {
		t.Helper()
		var r app.ShelterResult
		h.must(http.StatusOK, http.MethodPost, "/v1/me/shelter", u.Token, map[string]string{"name": name, "nit": nit}, &r)
		return r
	}
	// Una empresa (SAS) no se verifica sola: queda en revisión con su razón social.
	if r := send(shop, "Nutrición Animal", "800058136-5"); r.Status != "pending" || r.OfficialName == nil {
		t.Fatalf("empresa = %+v", r)
	}
	// Si no aparece en el RUES, queda en revisión.
	if r := send(unknown, "Patitas Felices", "900123456-8"); r.Status != "pending" || r.OfficialName != nil {
		t.Fatalf("no aparece = %+v", r)
	}
	// Cancelada o en liquidación: se rechaza y no queda guardada.
	h.expectError(http.StatusUnprocessableEntity, "nit_inactive", http.MethodPost, "/v1/me/shelter", closed.Token, map[string]string{"name": "Bienestar Animal", "nit": "900078738-7"})
	// El nombre no coincide con la razón social: en revisión.
	if r := send(other, "Refugio Las Patas", "901015729-4"); r.Status != "pending" {
		t.Fatalf("otro nombre = %+v", r)
	}
	// El RUES no responde: en revisión, y se reintenta cada hora.
	h.registry.set("830054539", nil, errors.New("sin conexión"))
	if r := send(offline, "Refugio Esperanza", "830054539-0"); r.Status != "pending" {
		t.Fatalf("sin RUES = %+v", r)
	}
	list, err := h.app.Shelters(ctx)
	if err != nil || len(list) != 4 {
		t.Fatalf("en revisión = %+v %v", list, err)
	}
	for _, s := range list {
		if s.Status != "pending" || s.CheckText() == "" {
			t.Fatalf("refugio = %+v", s)
		}
	}
	h.device(offline)
	h.device(unknown)
	// Antes de la hora no se reintenta; después, ya con el RUES respondiendo, se verifica y se avisa.
	h.registry.set("830054539", &providers.CompanyRecord{Name: "FUNDACION REFUGIO ESPERANZA", CheckDigit: "", Status: "ACTIVA", LegalForm: "FUNDACIONES", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)
	if v, _, err := h.app.RunShelterChecks(ctx); err != nil || v != 0 {
		t.Fatalf("antes de la hora = %d %v", v, err)
	}
	h.clock.Advance(61 * time.Minute)
	if v, _, err := h.app.RunShelterChecks(ctx); err != nil || v != 1 {
		t.Fatalf("reintento = %d %v", v, err)
	}
	if got := h.pushesTo(offline); len(got) != 1 || !strings.Contains(got[0].Title, "Refugio verificado") {
		t.Fatalf("aviso de verificado = %+v", got)
	}
	// Uno que no aparecía se reintenta cada semana: cuando el RUES lo publica, queda verificado.
	h.registry.set("900123456", &providers.CompanyRecord{Name: "FUNDACION PATITAS FELICES", CheckDigit: "", Status: "ACTIVA", LegalForm: "FUNDACIONES", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)
	h.clock.Advance(7 * 24 * time.Hour)
	if v, _, err := h.app.RunShelterChecks(ctx); err != nil || v != 1 {
		t.Fatalf("aparece en el RUES = %d %v", v, err)
	}
	// Cada mes se revisan los verificados: si la matrícula se cancela, pierden la verificación.
	h.registry.set("830054539", &providers.CompanyRecord{Name: "FUNDACION REFUGIO ESPERANZA", CheckDigit: "", Status: "CANCELADA", LegalForm: "FUNDACIONES", Chamber: "MEDELLIN PARA ANTIOQUIA"}, nil)
	h.clock.Advance(31 * 24 * time.Hour)
	if _, lost, err := h.app.RunShelterChecks(ctx); err != nil || lost != 1 {
		t.Fatalf("revisión mensual = %d %v", lost, err)
	}
	var status string
	if err := h.app.DB.QueryRow(ctx, `SELECT shelter_status FROM users WHERE id = $1`, offline.ID).Scan(&status); err != nil || status != "pending" {
		t.Fatalf("estado tras cancelarse = %q %v", status, err)
	}
	if got := h.pushesTo(offline); !strings.Contains(got[len(got)-1].Title, "Revisión de tu refugio") {
		t.Fatalf("aviso de revisión = %+v", got)
	}
	// Una aprobación a mano no se deshace por el nombre o el tipo: solo si la matrícula se cancela.
	moderator := h.user("Moderadora", true)
	h.exec(`UPDATE users SET role = 'moderator' WHERE id = $1`, moderator.ID)
	mod, _ := h.app.LoadActor(ctx, moderator.ID)
	if err := h.app.Moderate(ctx, mod, app.ModerationInput{Action: "verify_shelter", UserID: shop.ID}); err != nil {
		t.Fatal(err)
	}
	h.clock.Advance(31 * 24 * time.Hour)
	if _, lost, err := h.app.RunShelterChecks(ctx); err != nil || lost != 0 {
		t.Fatalf("aprobado a mano = %d %v", lost, err)
	}
	if err := h.app.DB.QueryRow(ctx, `SELECT shelter_status FROM users WHERE id = $1`, shop.ID).Scan(&status); err != nil || status != "verified" {
		t.Fatalf("estado del aprobado a mano = %q %v", status, err)
	}
}

func TestAdoptingEarnsTheNewMemberBadge(t *testing.T) {
	h := newHarness(t)
	owner := h.user("Familia", true)
	adopter := h.user("Quien Adopta", true)
	h.device(adopter)
	h.acceptTerms(owner)
	h.acceptTerms(adopter)
	ad := h.publishAdoption(owner, laureles, "Laureles, Medellín", nil)
	var sent app.Application
	h.must(http.StatusCreated, http.MethodPost, "/v1/adoptions/"+ad.ID+"/apply", adopter.Token, applicationBody(nil), &sent)
	h.must(http.StatusOK, http.MethodPost, "/v1/adoption-applications/"+sent.ID+"/accept", owner.Token, nil, nil)
	if count, tier := badgeOf(h.profile(adopter, ""), "new_member"); count != 0 || tier != 0 {
		t.Fatalf("antes de adoptar = %d/%d", count, tier)
	}
	h.must(http.StatusNoContent, http.MethodPost, "/v1/adoptions/"+ad.ID+"/adopted", owner.Token, nil, nil)
	if count, tier := badgeOf(h.profile(adopter, ""), "new_member"); count != 1 || tier != 1 {
		t.Fatalf("Nuevo integrante = %d/%d", count, tier)
	}
	got := h.pushesTo(adopter)
	if last := got[len(got)-1]; last.URL != "/profile" || last.Title != "🏡 ¡Bienvenido el nuevo integrante!" {
		t.Fatalf("aviso = %+v", last)
	}
}
