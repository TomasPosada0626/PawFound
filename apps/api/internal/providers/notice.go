package providers

import "strings"

// Notice es un aviso por correo con un botón (por ejemplo, una solicitud de adopción nueva).
type Notice struct {
	Lang, Subject, Preheader, Title, Intro, Button, Link, Safety, Ignore string
}

// AdoptionRequestNotice avisa a quien publicó en PawFamily que alguien quiere adoptar.
func AdoptionRequestNotice(petName, link, lang string) Notice {
	if lang == "en" {
		return Notice{
			Lang: "en", Subject: "🏡 New adoption request for " + petName,
			Preheader: "Someone wants to adopt " + petName + ".",
			Title:     "New adoption request",
			Intro:     "Someone wants to adopt " + petName + ". Open PawFound, go to PawFamily and accept or decline the request.",
			Button:    "Open PawFound", Link: link,
			Safety: "Adoption in PawFamily is 100% free: never ask for or pay money.",
			Ignore: "You get this email because you put a pet up for adoption in PawFamily.",
		}
	}
	return Notice{
		Lang: "es", Subject: "🏡 Nueva solicitud para adoptar a " + petName,
		Preheader: "Alguien quiere adoptar a " + petName + ".",
		Title:     "Nueva solicitud de adopción",
		Intro:     "Alguien quiere adoptar a " + petName + ". Abre PawFound, entra a PawFamily y acepta o rechaza la solicitud.",
		Button:    "Abrir PawFound", Link: link,
		Safety: "En PawFamily la adopción es 100 % gratuita: nunca pidas ni pagues dinero.",
		Ignore: "Recibes este correo porque diste una mascota en adopción en PawFamily.",
	}
}

// noticeText es la versión de solo texto del aviso.
func noticeText(n Notice) string {
	return strings.Join([]string{n.Title, "", n.Intro, "", n.Link, "", n.Safety}, "\r\n") + "\r\n"
}
