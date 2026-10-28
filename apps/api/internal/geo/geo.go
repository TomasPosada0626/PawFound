// Package geo contiene utilidades geoespaciales que protegen la ubicación de las personas.
package geo

import "math"

const metersPerDegreeLat = 111_320.0

// ApproxCellMeters es el tamaño de celda con que se aproxima toda ubicación publicada.
const ApproxCellMeters = 250.0

// Point es una coordenada geográfica en grados.
type Point struct {
	Lat float64 `json:"latitude"`
	Lng float64 `json:"longitude"`
}

// Approximate ajusta un punto al centro de su celda de ~250 m. Es determinista a
// propósito: un desplazamiento aleatorio por reporte se puede promediar para reconstruir
// el punto exacto; una cuadrícula fija no filtra más que la celda. Debe coincidir con
// apps/mobile/src/domain/geo.ts (approximateLocation).
func Approximate(p Point) Point {
	latStep := ApproxCellMeters / metersPerDegreeLat
	lat := (math.Floor(p.Lat/latStep) + 0.5) * latStep
	lngStep := ApproxCellMeters / (metersPerDegreeLat * math.Cos(lat*math.Pi/180))
	lng := (math.Floor(p.Lng/lngStep) + 0.5) * lngStep
	return Point{Lat: round6(lat), Lng: round6(lng)}
}

// DistanceMeters calcula la distancia haversine entre dos puntos.
func DistanceMeters(a, b Point) float64 {
	const earthRadius = 6_371_000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := toRad(b.Lat - a.Lat)
	dLng := toRad(b.Lng - a.Lng)
	h := math.Pow(math.Sin(dLat/2), 2) + math.Cos(toRad(a.Lat))*math.Cos(toRad(b.Lat))*math.Pow(math.Sin(dLng/2), 2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(h)))
}

func round6(n float64) float64 { return math.Round(n*1e6) / 1e6 }
