package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/app"
)

const overpassSample = `{"elements": [
	{"type": "node", "id": 1, "lat": 6.25, "lon": -75.56, "tags": {
		"amenity": "veterinary", "name": "Vet Centro", "addr:street": "Calle 10", "addr:housenumber": "20",
		"phone": "+57 300 000 0000", "website": "vetcentro.co", "opening_hours": "24/7"}},
	{"type": "way", "id": 2, "center": {"lat": 6.2, "lon": -75.6}, "tags": {
		"amenity": "veterinary", "name": "Vet Sur", "contact:phone": "+57 311 111 1111",
		"contact:website": "https://vetsur.co", "emergency": "yes"}},
	{"type": "node", "id": 3, "lat": 6.21, "lon": -75.61, "tags": {"amenity": "veterinary"}},
	{"type": "node", "id": 4, "lat": 99, "lon": 0, "tags": {"amenity": "veterinary", "name": "Fuera del mapa"}},
	{"type": "node", "id": 5, "lat": 6.22, "lon": -75.62, "tags": {"amenity": "pharmacy", "name": "Farmacia"}}
]}`

func TestImportPlacesFromOpenStreetMap(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	var query string
	osm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.FormValue("data")
		_, _ = w.Write([]byte(overpassSample))
	}))
	defer osm.Close()

	// Solo veterinarias con nombre y un punto válido; importar otra vez no las duplica.
	for range 2 {
		n, err := h.app.ImportPlaces(ctx, osm.URL, app.ValleDeAburra, osm.Client())
		if err != nil || n != 2 {
			t.Fatalf("importadas = %d, %v", n, err)
		}
	}
	if query == "" {
		t.Fatal("debe consultar a Overpass")
	}
	if n := h.count(`SELECT count(*) FROM places`); n != 2 {
		t.Fatalf("lugares = %d", n)
	}
	if n := h.count(`SELECT count(*) FROM places WHERE name = 'Vet Centro' AND emergency AND website = 'https://vetcentro.co' AND address LIKE 'Calle 10 20%'`); n != 1 {
		t.Fatal("completa la web y marca urgencias si atiende 24/7")
	}
	if n := h.count(`SELECT count(*) FROM places WHERE name = 'Vet Sur' AND emergency AND phone = '+57 311 111 1111' AND website = 'https://vetsur.co'`); n != 1 {
		t.Fatal("usa los datos de contacto alternativos y el centro del edificio")
	}
}

func TestImportPlacesReportsFailures(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	for name, reply := range map[string]http.HandlerFunc{
		"saturado":   func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) },
		"no es JSON": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("<html>")) },
	} {
		osm := httptest.NewServer(reply)
		if n, err := h.app.ImportPlaces(ctx, osm.URL, app.ValleDeAburra, osm.Client()); err == nil || n != 0 {
			t.Errorf("%s: importadas = %d, %v", name, n, err)
		}
		osm.Close()
	}
	// Con el contexto cancelado deja de probar servidores.
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := h.app.ImportPlaces(canceled, "", app.ValleDeAburra, nil); err == nil {
		t.Fatal("debe fallar con el contexto cancelado")
	}
	if n := h.count(`SELECT count(*) FROM places`); n != 0 {
		t.Fatalf("no debe guardar nada: %d", n)
	}
}

func TestClientIPOnlyTrustsAValidProxyHeader(t *testing.T) {
	behindProxy := &Server{ClientIPHeader: "CF-Connecting-IP"}
	request := func(remote, header string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		if header != "" {
			r.Header.Set("CF-Connecting-IP", header)
		}
		return r
	}
	if got := behindProxy.clientIP(request("10.0.0.1:443", "190.1.2.3")); got != "190.1.2.3" {
		t.Fatalf("cabecera del proxy = %q", got)
	}
	// Un valor que no es una IP no se usa: evita saltarse los límites por IP.
	if got := behindProxy.clientIP(request("10.0.0.1:443", "no-es-ip")); got != "10.0.0.1" {
		t.Fatalf("cabecera inválida = %q", got)
	}
	if got := (&Server{}).clientIP(request("10.0.0.1:443", "190.1.2.3")); got != "10.0.0.1" {
		t.Fatalf("sin proxy configurado no se confía en la cabecera: %q", got)
	}
	if got := (&Server{}).clientIP(request("sin-puerto", "")); got != "sin-puerto" {
		t.Fatalf("dirección sin puerto = %q", got)
	}
}

func TestPromoteAdminsRequiresVerifiedEmail(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	if n, err := h.app.PromoteAdmins(ctx, ""); err != nil || n != 0 {
		t.Fatalf("sin lista = %d, %v", n, err)
	}
	verified := h.user("Admin Real", true)
	impostor := h.user("Se Hace Pasar", false)
	h.app.AdminEmails = []string{verified.ID + "@pawfound.test", impostor.ID + "@pawfound.test"}
	if n, err := h.app.PromoteAdmins(ctx, ""); err != nil || n != 1 {
		t.Fatalf("promovidas = %d, %v", n, err)
	}
	if n := h.count(`SELECT count(*) FROM users WHERE id = $1 AND role = 'admin'`, impostor.ID); n != 0 {
		t.Fatal("un correo sin verificar no recibe el panel")
	}
	if n := h.count(`SELECT count(*) FROM users WHERE id = $1 AND role = 'admin'`, verified.ID); n != 1 {
		t.Fatal("el correo verificado sí")
	}
}

func TestUsernameRejectsSpecialCharacters(t *testing.T) {
	h := newHarness(t)
	h.must(http.StatusCreated, http.MethodPost, "/v1/auth/register", "", registerBody("valen@pawfound.app", "valen_a"), nil)
	for _, bad := range []string{"@valen_b", "valen.b", "valen b", "valen-b"} {
		h.expectError(http.StatusUnprocessableEntity, "invalid_username", http.MethodPost, "/v1/auth/register", "", registerBody("otra@pawfound.app", bad))
	}
	// Con arroba adelante se trata como un correo, y no existe.
	h.expectError(http.StatusUnauthorized, "invalid_credentials", http.MethodPost, "/v1/auth/login", "",
		map[string]string{"identifier": "@valen_a", "password": "Patitas2026"})
	h.must(http.StatusOK, http.MethodPost, "/v1/auth/login", "", map[string]string{"identifier": "valen_a", "password": "Patitas2026"}, nil)
}
