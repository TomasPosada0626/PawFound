package domain

import (
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
	"github.com/TomasPosada0626/PawFound/apps/api/internal/lifecircle"
)

// Case es lo mínimo de un reporte que necesitan las reglas de radio y coincidencias.
type Case struct {
	ID                string
	Kind              string
	State             string
	Species           string
	Sex               string
	Size              string
	Breed             string
	Color             string
	TraumaticEvent    bool
	ShyOrIndoor       bool
	LastSeenAt        time.Time
	Location          geo.Point
	FoundSearchRadius int
	OwnerID           string
}

// CurrentRadius: las perdidas usan el círculo de vida; las encontradas, el radio elegido.
func CurrentRadius(c Case, now time.Time) int {
	if c.Kind == "found" {
		if FoundRadius[c.FoundSearchRadius] {
			return c.FoundSearchRadius
		}
		return 400
	}
	profile := lifecircle.ProfileFor(lifecircle.Species(c.Species), c.TraumaticEvent, c.ShyOrIndoor)
	return lifecircle.RadiusSince(profile, c.LastSeenAt, now)
}

// Match es una posible coincidencia entre reportes.
type Match struct {
	Case     Case
	Distance float64
	Score    float64
}

// matchMargin amplía el círculo para tolerar el error de la ubicación aproximada.
const matchMargin = 500.0

// PossibleMatches replica findPossibleMatches (rules.ts): reportes del tipo opuesto, activos,
// de la misma especie, dentro del círculo de vida de la perdida (más un margen) y con fechas
// compatibles. Sin IA: favorece cercanía y coincidencia de tamaño, sexo y raza.
func PossibleMatches(target Case, candidates []Case, now time.Time, limit int) []Match {
	opposite := "lost"
	if target.Kind == "lost" {
		opposite = "found"
	}
	var out []Match
	for _, c := range candidates {
		if c.ID == target.ID || c.Kind != opposite || c.State != "active" {
			continue
		}
		if c.Species != target.Species && c.Species != "other" && target.Species != "other" {
			continue
		}
		lost, found := target, c
		if target.Kind != "lost" {
			lost, found = c, target
		}
		distance := geo.DistanceMeters(lost.Location, found.Location)
		radius := float64(CurrentRadius(lost, now)) + matchMargin
		timeOK := !found.LastSeenAt.Before(lost.LastSeenAt.Add(-2 * time.Hour))
		if distance > radius || !timeOK {
			continue
		}
		score := 1 - distance/radius
		if c.Size == target.Size {
			score += 0.3
		}
		if c.Sex != "unknown" && c.Sex == target.Sex {
			score += 0.2
		}
		if c.Breed != "" && target.Breed != "" && Fold(c.Breed) == Fold(target.Breed) {
			score += 0.3
		}
		out = append(out, Match{Case: c, Distance: distance, Score: score})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// OwnedPet es un perfil de "Mis mascotas" con la zona aproximada de su familia.
type OwnedPet struct {
	ID      string
	OwnerID string
	Species string
	Sex     string
	Size    string
	Breed   string
	Color   string
	Zone    geo.Point
}

// OwnedMatchRadius: hasta dónde puede haber llegado una mascota de la especie sin que su
// familia lo note. Es el tope del perfil más amplio de la especie más el margen de
// ubicación aproximada (gato 1,3 km, perro 8,5 km, otra 5,5 km).
func OwnedMatchRadius(species string) float64 {
	profile := lifecircle.Unknown
	switch species {
	case "dog":
		profile = lifecircle.DogPanic
	case "cat":
		profile = lifecircle.CatOrShy
	}
	return lifecircle.Profiles[profile].Cap + matchMargin
}

var sizeIndex = map[string]int{"small": 0, "medium": 1, "large": 2}

var colorStopWords = set("con", "sin", "and", "with", "muy", "tipo", "los", "las", "del", "color")

// colorTokens normaliza colores para comparar "negra con blanco" con "Negro y blanca": cada
// palabra se reduce a sus primeras 4 letras sin tildes (negr, blan, cafe, gris).
func colorTokens(color string) map[string]bool {
	tokens := map[string]bool{}
	for _, word := range strings.FieldsFunc(Fold(color), func(r rune) bool { return !unicode.IsLetter(r) }) {
		if len([]rune(word)) < 3 || colorStopWords[word] {
			continue
		}
		r := []rune(word)
		if len(r) > 4 {
			r = r[:4]
		}
		tokens[string(r)] = true
	}
	return tokens
}

// MatchOwned decide si un reporte de mascota encontrada se parece a una mascota propia lo
// suficiente como para preguntarle a su familia "¿es la tuya?". Es deliberadamente estricta:
// una falsa alarma asusta a una familia cuya mascota está en casa.
//   - Misma especie, dentro de OwnedMatchRadius de la zona de la familia.
//   - Tamaño igual o vecino (quien encuentra puede calcularlo mal).
//   - Sexo y color no se contradicen cuando ambos se conocen.
//   - Al menos dos señales a favor: tamaño, sexo, raza o color.
func MatchOwned(found Case, owned OwnedPet) (float64, bool) {
	if found.Kind != "found" || found.State != "active" || found.Species != owned.Species {
		return 0, false
	}
	radius := OwnedMatchRadius(owned.Species)
	distance := geo.DistanceMeters(owned.Zone, found.Location)
	if distance > radius {
		return 0, false
	}
	sizeDiff := sizeIndex[found.Size] - sizeIndex[owned.Size]
	if sizeDiff < -1 || sizeDiff > 1 {
		return 0, false
	}
	bothSexes := found.Sex != "unknown" && owned.Sex != "unknown"
	if bothSexes && found.Sex != owned.Sex {
		return 0, false
	}
	foundColors, ownedColors := colorTokens(found.Color), colorTokens(owned.Color)
	colorOverlap := false
	for token := range foundColors {
		colorOverlap = colorOverlap || ownedColors[token]
	}
	if len(foundColors) > 0 && len(ownedColors) > 0 && !colorOverlap {
		return 0, false
	}
	sizeEq := sizeDiff == 0
	sexEq := bothSexes && found.Sex == owned.Sex
	breedEq := found.Breed != "" && owned.Breed != "" && Fold(found.Breed) == Fold(owned.Breed)
	signals, score := 0, 1-distance/radius
	for _, s := range []struct {
		ok     bool
		weight float64
	}{{sizeEq, 0.3}, {sexEq, 0.2}, {breedEq, 0.3}, {colorOverlap, 0.3}} {
		if s.ok {
			signals++
			score += s.weight
		}
	}
	if signals < 2 {
		return 0, false
	}
	return score, true
}
