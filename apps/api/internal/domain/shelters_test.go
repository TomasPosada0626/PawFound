package domain

import "testing"

func TestShelterDecision(t *testing.T) {
	active := func(name, form string) *RegistryEntry {
		return &RegistryEntry{Name: name, CheckDigit: "7", Status: "ACTIVA", LegalForm: form}
	}
	cases := []struct {
		name, entered, dv string
		entry             *RegistryEntry
		status, reason    string
	}{
		{"fundación activa con el mismo nombre", "Fundación Bienestar Animal", "7", active("FUNDACION BIENESTAR ANIMAL", "FUNDACIONES"), ShelterVerified, CheckOK},
		{"nombre corto contenido en la razón social", "Bienestar Animal", "7", active("FUNDACION BIENESTAR ANIMAL DE ANTIOQUIA", "FUNDACIONES"), ShelterVerified, CheckOK},
		{"asociación con tildes", "Asociación Huellitas", "7", active("ASOCIACION HUELLITAS", "ASOCIACIONES, CORPORACIONES, FUNDACIONES E INSTITUCIONES DE UTILIDAD COMÚN"), ShelterVerified, CheckOK},
		{"no aparece", "Patitas", "7", nil, ShelterPending, CheckNotFound},
		{"cancelada", "Bienestar Animal", "7", &RegistryEntry{Name: "FUNDACION BIENESTAR ANIMAL", Status: "CANCELADA", LegalForm: "FUNDACIONES"}, ShelterInactive, CheckInactive},
		{"en liquidación", "Atención Animal", "7", active("FUNDACION ATENCION ANIMAL EN LIQUIDACIÓN", "FUNDACIONES"), ShelterInactive, CheckInactive},
		{"empresa", "Animal Venture", "7", active("ANIMAL VENTURE SAS", "SOCIEDADES POR ACCIONES SIMPLIFICADAS SAS"), ShelterPending, CheckNotNonprofit},
		{"otro nombre", "Refugio Las Patas", "7", active("FUNDACION BIENESTAR ANIMAL", "FUNDACIONES"), ShelterPending, CheckNameMismatch},
		{"otro dígito", "Bienestar Animal", "3", active("FUNDACION BIENESTAR ANIMAL", "FUNDACIONES"), ShelterPending, CheckDigitDiffers},
	}
	for _, c := range cases {
		status, reason := ShelterDecision(c.entered, c.dv, c.entry)
		if status != c.status || reason != c.reason {
			t.Errorf("%s: %s/%s, se esperaba %s/%s", c.name, status, reason, c.status, c.reason)
		}
	}
}

func TestSimilarNames(t *testing.T) {
	for _, c := range []struct {
		entered, official string
		want              bool
	}{
		{"Huellitas", "FUNDACION HUELLITAS DE ANTIOQUIA", true},
		{"Fundación Huellitas Medellín", "FUNDACION HUELLITAS MEDELLIN", true},
		{"Refugio Amigos de los Gatos", "FUNDACION AMIGOS DE LOS GATOS Y PERROS", true},
		{"Patitas", "FUNDACION HUELLITAS", false},
		{"Fundación", "FUNDACION HUELLITAS", false},
		{"", "FUNDACION HUELLITAS", false},
	} {
		if got := SimilarNames(c.entered, c.official); got != c.want {
			t.Errorf("%q ~ %q = %v", c.entered, c.official, got)
		}
	}
}
