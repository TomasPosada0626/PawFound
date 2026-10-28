package geo

import "testing"

func TestApproximateStaysWithinCellAndIsDeterministic(t *testing.T) {
	exact := Point{Lat: 6.2449, Lng: -75.5912}
	approx := Approximate(exact)
	if approx == exact {
		t.Fatal("la ubicación publicada no debe ser la exacta")
	}
	if d := DistanceMeters(exact, approx); d > ApproxCellMeters {
		t.Fatalf("distancia a la celda = %.1f m, máximo %v", d, ApproxCellMeters)
	}
	if again := Approximate(exact); again != approx {
		t.Fatalf("no determinista: %v vs %v", again, approx)
	}
	if near := Approximate(Point{Lat: 6.24491, Lng: -75.59121}); near != approx {
		t.Fatalf("puntos de la misma celda deberían coincidir: %v vs %v", near, approx)
	}
}

func TestDistanceMeters(t *testing.T) {
	a := Point{Lat: 6.2449, Lng: -75.5912}
	if d := DistanceMeters(a, a); d != 0 {
		t.Fatalf("distancia a sí mismo = %v", d)
	}
	b := Point{Lat: a.Lat + 1000/metersPerDegreeLat, Lng: a.Lng}
	if d := DistanceMeters(a, b); d < 990 || d > 1010 {
		t.Fatalf("~1 km al norte = %.1f m", d)
	}
}
