package app

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
)

// Veterinarias: la capa del mapa y "Está herida: busquemos una veterinaria" al reportar una
// mascota encontrada. La fuente es OpenStreetMap, datos abiertos con licencia ODbL: la app
// siempre muestra "© colaboradores de OpenStreetMap". Pueden estar incompletos o
// desactualizados, por eso cada lugar se puede reportar.

// PlacesAttribution acompaña cada respuesta (obligatoria por la licencia ODbL).
const PlacesAttribution = "© colaboradores de OpenStreetMap"

// Place es una veterinaria.
type Place struct {
	ID           string    `json:"id" db:"id"`
	Kind         string    `json:"kind" db:"kind"`
	Name         string    `json:"name" db:"name"`
	Lat          float64   `json:"-" db:"lat"`
	Lng          float64   `json:"-" db:"lng"`
	Location     geo.Point `json:"location" db:"-"`
	Address      *string   `json:"address,omitempty" db:"address"`
	Phone        *string   `json:"phone,omitempty" db:"phone"`
	Website      *string   `json:"website,omitempty" db:"website"`
	OpeningHours *string   `json:"openingHours,omitempty" db:"opening_hours"`
	Emergency    bool      `json:"emergency" db:"emergency"`
	Source       string    `json:"source" db:"source"`
}

// Places busca lugares dentro del radio (máx. 30 km), los más cercanos primero.
func (a *App) Places(ctx context.Context, center geo.Point, radius int, kind string) ([]Place, error) {
	if !validPoint(center) {
		return nil, invalid("center")
	}
	if radius <= 0 || radius > 30_000 {
		radius = 10_000
	}
	if kind != "" && kind != "vet" {
		return nil, invalid("kind")
	}
	rows, _ := a.DB.Query(ctx, `SELECT id, kind, name, lat, lng, address, phone, website, opening_hours, emergency, source FROM places
		WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3) AND ($4 = '' OR kind = $4)
		ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography LIMIT 200`, center.Lat, center.Lng, radius, kind)
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[Place])
	for i := range list {
		list[i].Location = geo.Point{Lat: list[i].Lat, Lng: list[i].Lng}
	}
	return list, err
}

// ReportPlace guarda un aviso de dato incorrecto (cerró, cambió de teléfono, no existe).
func (a *App) ReportPlace(ctx context.Context, ac Actor, placeID, note string) error {
	note = domain.Clean(note, 300)
	if note == "" {
		return invalid("note")
	}
	tag, err := a.DB.Exec(ctx, `INSERT INTO place_reports (place_id, reporter_id, note, created_at)
		SELECT id, $2, $3, $4 FROM places WHERE id = $1`, placeID, ac.ID, note, a.now())
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// ValleDeAburra es la caja (sur, oeste, norte, este) que cubre de Caldas a Barbosa.
var ValleDeAburra = [4]float64{6.04, -75.72, 6.48, -75.28}

type overpassResponse struct {
	Elements []struct {
		Type   string                      `json:"type"`
		ID     int64                       `json:"id"`
		Lat    float64                     `json:"lat"`
		Lon    float64                     `json:"lon"`
		Center *struct{ Lat, Lon float64 } `json:"center"`
		Tags   map[string]string           `json:"tags"`
	} `json:"elements"`
}

// ImportPlaces descarga de la API Overpass de OpenStreetMap las veterinarias dentro de la caja y los guarda (actualiza los existentes, sin duplicar). Lo corre a mano el equipo
// con `api import-places`; devuelve cuántos lugares importó.
//
// Sin endpoint prueba varios servidores públicos de Overpass: el principal a veces rechaza
// conexiones desde la nube (por ejemplo desde Render) o está saturado.
func (a *App) ImportPlaces(ctx context.Context, endpoint string, bbox [4]float64, client *http.Client) (int, error) {
	endpoints := overpassEndpoints
	if endpoint != "" {
		endpoints = []string{endpoint}
	}
	var errs []error
	for _, e := range endpoints {
		n, err := a.importPlacesFrom(ctx, e, bbox, client)
		if err == nil {
			return n, nil
		}
		errs = append(errs, fmt.Errorf("%s: %w", e, err))
		if ctx.Err() != nil {
			break
		}
	}
	return 0, errors.Join(errs...)
}

// overpassEndpoints son servidores públicos de Overpass, en orden de preferencia.
var overpassEndpoints = []string{
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://overpass.private.coffee/api/interpreter",
}

func (a *App) importPlacesFrom(ctx context.Context, endpoint string, bbox [4]float64, client *http.Client) (int, error) {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	box := fmt.Sprintf("%f,%f,%f,%f", bbox[0], bbox[1], bbox[2], bbox[3])
	query := `[out:json][timeout:60];(` +
		`node["amenity"="veterinary"](` + box + `);way["amenity"="veterinary"](` + box + `);` +
		`);out center tags;`
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(url.Values{"data": {query}}.Encode()))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "PawFound/0.2 (+https://pawfound.pages.dev)")
	res, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("overpass respondió %d", res.StatusCode)
	}
	var data overpassResponse
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 20<<20)).Decode(&data); err != nil {
		return 0, err
	}
	imported := 0
	for _, el := range data.Elements {
		lat, lng := el.Lat, el.Lon
		if el.Center != nil {
			lat, lng = el.Center.Lat, el.Center.Lon
		}
		if el.Tags["amenity"] != "veterinary" {
			continue
		}
		name := domain.Clean(el.Tags["name"], 120)
		if name == "" || !validPoint(geo.Point{Lat: lat, Lng: lng}) {
			continue // sin nombre no se puede reconocer el lugar en el mapa
		}
		address := strings.TrimSpace(strings.Join(nonEmpty(el.Tags["addr:street"]+" "+el.Tags["addr:housenumber"], el.Tags["addr:city"]), ", "))
		phone := firstNonEmpty(el.Tags["phone"], el.Tags["contact:phone"])
		website := firstNonEmpty(el.Tags["website"], el.Tags["contact:website"])
		if website != "" && !strings.HasPrefix(website, "http") {
			website = "https://" + website
		}
		emergency := el.Tags["emergency"] == "yes" || strings.Contains(el.Tags["opening_hours"], "24/7")
		sourceID := fmt.Sprintf("%s/%d", el.Type, el.ID)
		if err := a.upsertPlace(ctx, sourceID, name, lat, lng, address, phone, website, el.Tags["opening_hours"], emergency); err != nil {
			return imported, err
		}
		imported++
	}
	return imported, nil
}

// upsertPlace guarda o actualiza una veterinaria de OpenStreetMap (sin duplicar por source_id).
func (a *App) upsertPlace(ctx context.Context, sourceID, name string, lat, lng float64, address, phone, website, hours string, emergency bool) error {
	_, err := a.DB.Exec(ctx, `INSERT INTO places (id, kind, name, lat, lng, address, phone, website, opening_hours, emergency, source, source_id, updated_at)
		VALUES ($1, 'vet', $2, $3, $4, $5, $6, $7, $8, $9, 'osm', $10, $11)
		ON CONFLICT (source, source_id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
			address = EXCLUDED.address, phone = EXCLUDED.phone, website = EXCLUDED.website, opening_hours = EXCLUDED.opening_hours,
			emergency = EXCLUDED.emergency, updated_at = EXCLUDED.updated_at`,
		domain.NewID("plc"), name, lat, lng, optional(address), optional(phone), optional(website), optional(hours), emergency, sourceID, a.now())
	return err
}

// placesSnapshot es la última importación de OpenStreetMap del Valle de Aburrá (© colaboradores
// de OpenStreetMap, ODbL), la misma que usa el modo demostración de la app.
//
//go:embed places_osm.json
var placesSnapshot []byte

// SeedPlacesSnapshot carga las veterinarias guardadas cuando Overpass no responde: así la app
// nunca arranca sin veterinarias. Una importación posterior las actualiza sin duplicar.
func (a *App) SeedPlacesSnapshot(ctx context.Context) (int, error) {
	var list []struct {
		ID           string    `json:"id"`
		Name         string    `json:"name"`
		Location     geo.Point `json:"location"`
		Address      string    `json:"address"`
		Phone        string    `json:"phone"`
		Website      string    `json:"website"`
		OpeningHours string    `json:"openingHours"`
		Emergency    bool      `json:"emergency"`
	}
	if err := json.Unmarshal(placesSnapshot, &list); err != nil {
		return 0, err
	}
	seeded := 0
	for _, p := range list {
		if p.Name == "" || !validPoint(p.Location) {
			continue
		}
		if err := a.upsertPlace(ctx, p.ID, p.Name, p.Location.Lat, p.Location.Lng, p.Address, p.Phone, p.Website, p.OpeningHours, p.Emergency); err != nil {
			return seeded, err
		}
		seeded++
	}
	return seeded, nil
}

func nonEmpty(values ...string) []string {
	var out []string
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}
