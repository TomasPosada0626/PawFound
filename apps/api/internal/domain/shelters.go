package domain

import (
	"strings"
	"unicode"
)

// Estados de un refugio y motivos de la última revisión en el RUES. Todo se decide solo: un refugio
// queda verificado o la solicitud se rechaza diciendo por qué; solo espera (pending) si el RUES no
// respondió, y entonces se reintenta cada hora.
const (
	ShelterVerified = "verified"
	ShelterPending  = "pending"

	CheckOK           = "rues_ok"
	CheckNotFound     = "not_found"
	CheckNotNonprofit = "not_nonprofit"
	CheckNameMismatch = "name_mismatch"
	CheckDigitDiffers = "dv_mismatch"
	CheckUnavailable  = "unavailable"
	CheckInactive     = "inactive"
	CheckNITTaken     = "nit_taken"
	// CheckManual: moderación devolvió una verificación que había quitado.
	CheckManual = "manual"
)

// RegistryEntry es lo que el RUES dice de un NIT (independiente del proveedor).
type RegistryEntry struct {
	Name, CheckDigit, Status, LegalForm string
}

// CheckShelter decide con lo que dice el RUES. Solo CheckOK verifica: la matrícula está activa, es
// una fundación, asociación o corporación, y el dígito y el nombre coinciden. Cualquier otro motivo
// rechaza la solicitud y dice por qué: no aparece, es una empresa, otro nombre u otro dígito, o la
// matrícula está cancelada o en liquidación.
func CheckShelter(enteredName, checkDigit string, e *RegistryEntry) string {
	if e == nil {
		return CheckNotFound
	}
	if fold(e.Status) != "ACTIVA" || strings.Contains(fold(e.Name), "LIQUIDACION") {
		return CheckInactive
	}
	if e.CheckDigit != "" && e.CheckDigit != checkDigit {
		return CheckDigitDiffers
	}
	if !isNonprofit(e.LegalForm) {
		return CheckNotNonprofit
	}
	if !SimilarNames(enteredName, e.Name) {
		return CheckNameMismatch
	}
	return CheckOK
}

// isNonprofit: fundaciones, asociaciones, corporaciones y demás entidades sin ánimo de lucro.
func isNonprofit(legalForm string) bool {
	f := fold(legalForm)
	for _, word := range []string{"FUNDACION", "ASOCIACION", "CORPORACION", "SIN ANIMO DE LUCRO", "UTILIDAD COMUN"} {
		if strings.Contains(f, word) {
			return true
		}
	}
	return false
}

// shelterStopwords no distinguen a un refugio de otro: "Fundación Huellitas" y "HUELLITAS" son el mismo.
var shelterStopwords = map[string]bool{
	"fundacion": true, "asociacion": true, "corporacion": true, "refugio": true, "albergue": true, "entidad": true,
	"de": true, "del": true, "la": true, "las": true, "el": true, "los": true, "y": true, "e": true, "para": true,
	"por": true, "en": true, "sas": true, "s": true, "a": true, "ltda": true, "esal": true,
}

func nameTokens(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.FieldsFunc(Fold(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if !shelterStopwords[w] {
			out[w] = true
		}
	}
	return out
}

// SimilarNames: el nombre que escribió el refugio coincide con la razón social si todas sus palabras
// importantes están en ella ("Huellitas" ~ "FUNDACION HUELLITAS DE ANTIOQUIA"), o si comparten al
// menos dos palabras y la mitad de las del nombre escrito.
func SimilarNames(entered, official string) bool {
	e, o := nameTokens(entered), nameTokens(official)
	if len(e) == 0 || len(o) == 0 {
		return false
	}
	shared := 0
	for w := range e {
		if o[w] {
			shared++
		}
	}
	return shared == len(e) || (shared >= 2 && shared*2 >= len(e))
}

// fold quita tildes y pasa a mayúsculas: "Fundación" y "FUNDACION" se comparan igual.
func fold(s string) string {
	return strings.ToUpper(Fold(s))
}
