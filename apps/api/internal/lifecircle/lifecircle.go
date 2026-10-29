// Package lifecircle implementa el "círculo de vida": el radio estimado de búsqueda de
// una mascota perdida, que se amplía con el tiempo desde el último avistamiento.
//
// Regla fijada en PRODUCT.md (issue #10): radio = min(inicial + tasa × √horas, tope),
// con parámetros distintos por perfil. La app móvil aplica la misma regla; ambas validan
// contra packages/contracts/fixtures/life-circle.json para no desincronizarse.
package lifecircle

import (
	"math"
	"time"
)

// Profile agrupa especie y temperamento en un patrón de desplazamiento.
type Profile string

// Perfiles soportados.
const (
	DogPanic Profile = "dog_panic"
	DogCalm  Profile = "dog_calm"
	CatOrShy Profile = "cat_or_shy"
	Unknown  Profile = "unknown"
)

// Params define el crecimiento de un perfil, en metros.
type Params struct {
	Initial float64 `json:"initial"`
	Rate    float64 `json:"rate"`
	Cap     float64 `json:"cap"`
}

// Profiles es la tabla de PRODUCT.md. Decisión del 2026-10-28: todas las mascotas arrancan en
// 250 m y llegan a 2 km en unos 30 minutos (tasa = 1750 m / √0,5 h). Los perfiles se conservan
// para poder volver a diferenciar la velocidad por especie si el piloto lo muestra.
var Profiles = map[Profile]Params{
	DogPanic: {Initial: 250, Rate: 2475, Cap: 2000},
	DogCalm:  {Initial: 250, Rate: 2475, Cap: 2000},
	CatOrShy: {Initial: 250, Rate: 2475, Cap: 2000},
	Unknown:  {Initial: 250, Rate: 2475, Cap: 2000},
}

// Species de la mascota reportada.
type Species string

// Especies soportadas.
const (
	Dog   Species = "dog"
	Cat   Species = "cat"
	Other Species = "other"
)

// ProfileFor elige el perfil. Precedencia: gato → CatOrShy; perro con evento traumático →
// DogPanic (el pánico domina aunque sea tímido); tímida/de interior → CatOrShy;
// perro → DogCalm; resto → Unknown.
func ProfileFor(species Species, traumaticEvent, shyOrIndoor bool) Profile {
	switch {
	case species == Cat:
		return CatOrShy
	case species == Dog && traumaticEvent:
		return DogPanic
	case shyOrIndoor:
		return CatOrShy
	case species == Dog:
		return DogCalm
	default:
		return Unknown
	}
}

// RadiusMeters devuelve el radio redondeado al metro tras `hours` horas. Horas negativas o
// no finitas cuentan como cero; un perfil desconocido usa Unknown.
func RadiusMeters(profile Profile, hours float64) int {
	p, ok := Profiles[profile]
	if !ok {
		p = Profiles[Unknown]
	}
	if math.IsNaN(hours) || math.IsInf(hours, 0) || hours < 0 {
		hours = 0
	}
	return int(math.Round(math.Min(p.Initial+p.Rate*math.Sqrt(hours), p.Cap)))
}

// RadiusSince calcula el radio vigente desde el último avistamiento.
func RadiusSince(profile Profile, lastSeen, now time.Time) int {
	return RadiusMeters(profile, now.Sub(lastSeen).Hours())
}
