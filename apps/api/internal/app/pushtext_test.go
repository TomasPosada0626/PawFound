package app

import "testing"

func TestPushTextsAndURLs(t *testing.T) {
	if title, body := pushText("owned_match", "en", pushPet{Name: "Rocky"}); title != "Is it Rocky?" || body == "" {
		t.Fatalf("en = %q / %q", title, body)
	}
	// Idioma desconocido → español; tipo desconocido → genérico.
	if title, _ := pushText("sighting", "fr", pushPet{}); title != "Nuevo avistamiento" {
		t.Fatalf("fr = %q", title)
	}
	// Sin nombre se usa la especie y el sexo, con la gramática correcta.
	for _, c := range []struct {
		kind, lang string
		pet        pushPet
		want       string
	}{
		{"case_closed", "es", pushPet{Kind: "found", Species: "dog", Sex: "unknown"}, "El perrito encontrado ya está en casa"},
		{"case_closed", "es", pushPet{Kind: "found", Species: "cat", Sex: "female"}, "La gatica encontrada ya está en casa"},
		{"sighting", "es", pushPet{Kind: "found", Species: "dog", Sex: "male"}, "Alguien vio al perrito encontrado"},
		{"sighting", "es", pushPet{Kind: "found", Species: "dog", Sex: "female"}, "Alguien vio a la perrita encontrada"},
		{"sighting", "es", pushPet{Kind: "found", Species: "cat", Sex: "male"}, "Alguien vio al gatico encontrado"},
		{"sighting", "es", pushPet{Kind: "found", Species: "other", Sex: "male"}, "Alguien vio a la mascota encontrada"},
		{"sighting", "es", pushPet{Kind: "lost", Species: "dog", Sex: "female"}, "Alguien vio a la perrita perdida"},
		{"thanked", "es", pushPet{Kind: "found", Species: "dog"}, "La familia del perrito encontrado dice que fuiste clave en el reencuentro. Ganaste «Ángel de patas»."},
		{"case_closed", "en", pushPet{Kind: "found", Species: "cat", Sex: "female"}, "The found cat is back home"},
		// Sin datos de la mascota sigue siendo una frase correcta, nunca un texto vacío.
		{"possible_match", "es", pushPet{}, "Un reporte nuevo podría ser la mascota encontrada"},
	} {
		if _, body := pushText(c.kind, c.lang, c.pet); body != c.want {
			t.Errorf("%s/%s %+v = %q, quería %q", c.kind, c.lang, c.pet, body, c.want)
		}
	}
	if title, body := pushText("nuevo_tipo", "es", pushPet{Name: "Max"}); title != "PawFound" || body != "Max" {
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
