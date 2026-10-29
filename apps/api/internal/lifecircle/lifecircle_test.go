package lifecircle

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type fixture struct {
	Profiles map[Profile]Params `json:"profiles"`
	Cases    []struct {
		Profile Profile `json:"profile"`
		Hours   float64 `json:"hours"`
		Meters  int     `json:"meters"`
	} `json:"cases"`
}

func loadFixture(t *testing.T) fixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "life-circle.json"))
	if err != nil {
		t.Fatalf("leer fixture compartido: %v", err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parsear fixture: %v", err)
	}
	return f
}

// La tabla y los vectores son los mismos que valida la app móvil.
func TestMatchesSharedFixture(t *testing.T) {
	f := loadFixture(t)
	if len(f.Profiles) != len(Profiles) {
		t.Fatalf("perfiles = %d, fixture = %d", len(Profiles), len(f.Profiles))
	}
	for name, want := range f.Profiles {
		if got := Profiles[name]; got != want {
			t.Errorf("Profiles[%s] = %+v, fixture = %+v", name, got, want)
		}
	}
	for _, c := range f.Cases {
		if got := RadiusMeters(c.Profile, c.Hours); got != c.Meters {
			t.Errorf("RadiusMeters(%s, %v) = %d, fixture = %d", c.Profile, c.Hours, got, c.Meters)
		}
	}
}

func TestProfileFor(t *testing.T) {
	tests := []struct {
		species        Species
		traumatic, shy bool
		want           Profile
	}{
		{Cat, false, false, CatOrShy},
		{Cat, true, false, CatOrShy},
		{Dog, true, true, DogPanic},
		{Dog, false, true, CatOrShy},
		{Dog, false, false, DogCalm},
		{Other, false, true, CatOrShy},
		{Other, true, false, Unknown},
	}
	for _, tt := range tests {
		if got := ProfileFor(tt.species, tt.traumatic, tt.shy); got != tt.want {
			t.Errorf("ProfileFor(%s, %v, %v) = %s, want %s", tt.species, tt.traumatic, tt.shy, got, tt.want)
		}
	}
}

func TestRadiusEdgeCases(t *testing.T) {
	for _, h := range []float64{-5, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if got := RadiusMeters(DogCalm, h); got != 500 {
			t.Errorf("RadiusMeters(DogCalm, %v) = %d, want 500", h, got)
		}
	}
	if got := RadiusMeters("inventado", 0); got != 300 {
		t.Errorf("perfil desconocido = %d, want 300 (Unknown)", got)
	}
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	if got := RadiusSince(DogPanic, now.Add(-time.Hour), now); got != 2200 {
		t.Errorf("RadiusSince 1h panic = %d, want 2200", got)
	}
}
