package domain

import (
	"encoding/json"
	"flag"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/geo"
)

var update = flag.Bool("update", false, "reescribe los puntajes esperados de los fixtures compartidos")

func TestNewID(t *testing.T) {
	a, b := NewID("pet"), NewID("pet")
	if !strings.HasPrefix(a, "pet_") || len(a) != len("pet_")+20 {
		t.Fatalf("NewID = %q", a)
	}
	if a == b {
		t.Fatal("dos ids iguales")
	}
}

func TestValidators(t *testing.T) {
	for email, want := range map[string]bool{"ana@pawfound.app": true, " ana@x.co ": true, "ana@x": false, "sin-arroba": false, "": false} {
		if got := ValidEmail(email); got != want {
			t.Errorf("ValidEmail(%q) = %v", email, got)
		}
	}
	phones := map[string]string{
		"300 123 4567":       "+573001234567",
		"+57 (300) 123-4567": "+573001234567",
		"573001234567":       "+573001234567",
		"6011234567":         "",
		"30012345":           "",
	}
	for in, want := range phones {
		if got := NormalizeColombianMobile(in); got != want {
			t.Errorf("NormalizeColombianMobile(%q) = %q, want %q", in, got, want)
		}
	}
	for pw, want := range map[string]string{"corta1": "too_short", "solamenteletras": "needs_number", "12345678": "needs_letter", "Patitas2026": "", strings.Repeat("a1", 200): "too_long"} {
		if got := PasswordIssue(pw); got != want {
			t.Errorf("PasswordIssue(%q) = %q, want %q", pw, got, want)
		}
	}
	for in, want := range map[string]string{"@Valen_A": "valen_a", "ab": "", "con espacio": "", "ñandú": ""} {
		if got := NormalizeUsername(in); got != want {
			t.Errorf("NormalizeUsername(%q) = %q, want %q", in, got, want)
		}
	}
	if got := UsernameBase("Tomás.Posada+pets@gmail.com"); got != "tomsposadapets" {
		t.Errorf("UsernameBase = %q", got)
	}
	if got := UsernameBase("a@b.co"); got != "pawfriend" {
		t.Errorf("UsernameBase corto = %q", got)
	}
	if got := UsernameBase("unnombredeusuariomuylargo@b.co"); len(got) != 16 {
		t.Errorf("UsernameBase largo = %q", got)
	}
}

func TestTextHelpers(t *testing.T) {
	if got := ShortName("  valentina arango pérez "); got != "valentina A." {
		t.Errorf("ShortName = %q", got)
	}
	if ShortName("Carlos") != "Carlos" || ShortName("   ") != "" {
		t.Error("ShortName con una o cero palabras")
	}
	if got := Clean("  ñandúes  ", 3); got != "ñan" {
		t.Errorf("Clean = %q", got)
	}
	if got := Fold(" Pastor ALEMÁN "); got != "pastor aleman" {
		t.Errorf("Fold = %q", got)
	}
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	if MemberDays(now.Add(-49*time.Hour), now) != 2 || MemberDays(now.Add(time.Hour), now) != 0 {
		t.Error("MemberDays")
	}
	if !ValidClock("07:30") || ValidClock("24:00") || ValidClock("7:30") || ValidClock("aa:bb") {
		t.Error("ValidClock")
	}
}

func TestPublishAllowance(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	if ok, _ := PublishAllowance([]time.Time{now.Add(-30 * time.Hour), now.Add(-2 * time.Hour)}, now); !ok {
		t.Fatal("una publicación vieja no debe contar")
	}
	first, second := now.Add(-5*time.Hour), now.Add(-1*time.Hour)
	ok, retry := PublishAllowance([]time.Time{second, first}, now)
	if ok || !retry.Equal(first.Add(24*time.Hour)) {
		t.Fatalf("ok=%v retry=%v", ok, retry)
	}
	third := now.Add(-3 * time.Hour)
	if _, retry := PublishAllowance([]time.Time{first, second, third}, now); !retry.Equal(third.Add(24 * time.Hour)) {
		t.Fatalf("con tres en la ventana, retry=%v", retry)
	}
}

func TestQuietTime(t *testing.T) {
	p := DefaultNotificationPrefs()
	at := func(h, m int) time.Time { return time.Date(2026, 10, 28, h, m, 0, 0, Bogota) }
	if IsQuietTime(p, at(23, 0)) {
		t.Fatal("modo descanso apagado no silencia")
	}
	p.QuietHours = true
	for _, c := range []struct {
		h, m int
		want bool
	}{{23, 0, true}, {6, 59, true}, {7, 0, false}, {12, 0, false}, {22, 0, true}} {
		if got := IsQuietTime(p, at(c.h, c.m)); got != c.want {
			t.Errorf("%02d:%02d = %v", c.h, c.m, got)
		}
	}
	// La hora se evalúa en Colombia aunque llegue en UTC: 04:00 UTC = 23:00 en Bogotá.
	if !IsQuietTime(p, time.Date(2026, 10, 29, 4, 0, 0, 0, time.UTC)) {
		t.Error("no convirtió a la hora de Colombia")
	}
	p.QuietFrom, p.QuietTo = "13:00", "15:00"
	if !IsQuietTime(p, at(14, 0)) || IsQuietTime(p, at(16, 0)) {
		t.Error("rango diurno")
	}
	p.QuietTo = "13:00"
	if IsQuietTime(p, at(13, 0)) {
		t.Error("rango vacío")
	}
}

func TestBadges(t *testing.T) {
	progress := Badges(map[string]int{"verified": 1, "reporter": 6, "reunion": 3, "spreader": -2})
	byID := map[string]BadgeProgress{}
	for _, p := range progress {
		byID[p.ID] = p
	}
	if len(progress) != 8 || progress[0].ID != "verified" {
		t.Fatalf("orden o cantidad: %+v", progress)
	}
	if r := byID["reporter"]; r.Tier != 2 || r.Next == nil || *r.Next != 10 {
		t.Errorf("reporter = %+v", r)
	}
	if r := byID["reunion"]; r.Tier != 1 || r.MaxTier != 1 || r.Next != nil {
		t.Errorf("reunion tiene un solo nivel: %+v", r)
	}
	if s := byID["spreader"]; s.Count != 0 || s.Tier != 0 {
		t.Errorf("conteos negativos cuentan como cero: %+v", s)
	}
}

func TestCurrentRadiusAndPossibleMatches(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	center := geo.Point{Lat: 6.2447, Lng: -75.5916}
	lost := Case{
		ID: "l1", Kind: "lost", State: "active", Species: "dog", Sex: "male", Size: "medium", Breed: "Criollo",
		LastSeenAt: now, Location: center, OwnerID: "u1",
	}
	if got := CurrentRadius(lost, now); got != 500 {
		t.Fatalf("radio inicial de perro tranquilo = %d", got)
	}
	if CurrentRadius(Case{Kind: "found", FoundSearchRadius: 2000}, now) != 2000 || CurrentRadius(Case{Kind: "found", FoundSearchRadius: 7}, now) != 400 {
		t.Fatal("radio de encontrada")
	}
	near := geo.Point{Lat: center.Lat + 300/111320.0, Lng: center.Lng}
	candidates := []Case{
		{ID: "f1", Kind: "found", State: "active", Species: "dog", Sex: "male", Size: "medium", Breed: "criollo", LastSeenAt: now, Location: near},
		{ID: "f2", Kind: "found", State: "active", Species: "dog", Sex: "female", Size: "large", LastSeenAt: now, Location: near},
		{ID: "f3", Kind: "found", State: "active", Species: "cat", LastSeenAt: now, Location: near},
		{ID: "f4", Kind: "found", State: "reunited", Species: "dog", LastSeenAt: now, Location: near},
		{ID: "f5", Kind: "found", State: "active", Species: "dog", LastSeenAt: now.Add(-5 * time.Hour), Location: near},
		{ID: "f6", Kind: "found", State: "active", Species: "other", LastSeenAt: now, Location: geo.Point{Lat: 7, Lng: -75}},
	}
	matches := PossibleMatches(lost, candidates, now, 5)
	if len(matches) != 2 || matches[0].Case.ID != "f1" || matches[1].Case.ID != "f2" {
		t.Fatalf("matches = %+v", matches)
	}
	if got := PossibleMatches(lost, candidates, now, 1); len(got) != 1 {
		t.Fatal("limit")
	}
	// Desde la encontrada, el círculo que manda es el de la perdida.
	back := PossibleMatches(candidates[0], []Case{lost}, now, 5)
	if len(back) != 1 || back[0].Case.ID != "l1" {
		t.Fatalf("desde la encontrada = %+v", back)
	}
}

type matchFixture struct {
	Description string `json:"description"`
	Cases       []struct {
		Name  string `json:"name"`
		Owned struct {
			Species string    `json:"species"`
			Sex     string    `json:"sex"`
			Size    string    `json:"size"`
			Breed   string    `json:"breed"`
			Color   string    `json:"color"`
			Zone    geo.Point `json:"zone"`
		} `json:"owned"`
		Found struct {
			Species  string    `json:"species"`
			Sex      string    `json:"sex"`
			Size     string    `json:"size"`
			Breed    string    `json:"breed"`
			Color    string    `json:"color"`
			State    string    `json:"state"`
			Location geo.Point `json:"location"`
		} `json:"found"`
		Match bool    `json:"match"`
		Score float64 `json:"score"`
	} `json:"cases"`
}

// Los mismos vectores los valida apps/mobile/src/domain/__tests__/matching.test.ts.
func TestOwnedMatchesSharedFixture(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "owned-matches.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("leer fixture: %v", err)
	}
	var f matchFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parsear fixture: %v", err)
	}
	for i, c := range f.Cases {
		found := Case{
			Kind: "found", State: c.Found.State, Species: c.Found.Species, Sex: c.Found.Sex, Size: c.Found.Size,
			Breed: c.Found.Breed, Color: c.Found.Color, Location: c.Found.Location,
		}
		owned := OwnedPet{Species: c.Owned.Species, Sex: c.Owned.Sex, Size: c.Owned.Size, Breed: c.Owned.Breed, Color: c.Owned.Color, Zone: c.Owned.Zone}
		score, ok := MatchOwned(found, owned)
		score = math.Round(score*1000) / 1000
		if *update {
			f.Cases[i].Score = score
			continue
		}
		if ok != c.Match || score != c.Score {
			t.Errorf("%s: match=%v score=%v, fixture match=%v score=%v", c.Name, ok, score, c.Match, c.Score)
		}
	}
	if *update {
		out, _ := json.MarshalIndent(f, "", "  ")
		if err := os.WriteFile(path, append(out, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok := MatchOwned(Case{Kind: "lost", State: "active", Species: "dog"}, OwnedPet{Species: "dog"}); ok {
		t.Error("un reporte de perdida nunca es coincidencia de una mascota propia")
	}
}
