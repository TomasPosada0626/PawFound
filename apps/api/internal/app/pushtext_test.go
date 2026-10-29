package app

import "testing"

func TestPushTextsAndURLs(t *testing.T) {
	if title, body := pushText("owned_match", "en", "Rocky"); title != "Is it Rocky?" || body == "" {
		t.Fatalf("en = %q / %q", title, body)
	}
	// Idioma desconocido → español; sin nombre → "Sin nombre"; tipo desconocido → genérico.
	if title, _ := pushText("sighting", "fr", ""); title != "Nuevo avistamiento" {
		t.Fatalf("fr = %q", title)
	}
	if _, body := pushText("case_closed", "es", ""); body != "Sin nombre ya está en casa" {
		t.Fatalf("sin nombre = %q", body)
	}
	if title, body := pushText("nuevo_tipo", "es", "Max"); title != "PawFound" || body != "Max" {
		t.Fatalf("genérico = %q / %q", title, body)
	}
	if notificationURL(Notification{Kind: "life_circle", PetID: "p"}) != "/alerta/angel/p" || notificationURL(Notification{Kind: "sighting", PetID: "p"}) != "/pet/p" {
		t.Fatal("notificationURL")
	}
	if got := dedupe([]string{"a", "", "b", "a"}); len(got) != 2 {
		t.Fatalf("dedupe = %v", got)
	}
	if mediaIDFromRef("http://api.test/v1/media/med_1") != "med_1" || mediaIDFromRef("med_2") != "med_2" {
		t.Fatal("mediaIDFromRef")
	}
}
