package app

import (
	"testing"

	"github.com/TomasPosada0626/PawFound/apps/api/internal/domain"
)

func TestShelterCheckText(t *testing.T) {
	seen := map[string]bool{}
	for _, check := range []string{domain.CheckOK, domain.CheckNotNonprofit, domain.CheckNameMismatch, domain.CheckDigitDiffers,
		domain.CheckNotFound, domain.CheckUnavailable, domain.CheckManual, ""} {
		text := Shelter{Check: &check}.CheckText()
		if text == "" || seen[text] {
			t.Errorf("%q: texto %q repetido o vacío", check, text)
		}
		seen[text] = true
	}
}
