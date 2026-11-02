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

// AccountDeletedNotice confirma que se borró la cuenta: si no fue la persona, al menos se entera.
func AccountDeletedNotice(link, lang string) Notice {
	if lang == "en" {
		return Notice{
			Lang: "en", Subject: "Your PawFound account was deleted",
			Preheader: "We erased your profile and everything you posted.",
			Title:     "Your account was deleted",
			Intro:     "We erased your profile, your reports, your PawFamily posts, your messages, your photos and your location. Thank you for helping pets get back home.",
			Button:    "Visit PawFound", Link: link,
			Safety: "We keep no copy of your data. If you come back, you will start with a new account.",
			Ignore: "You get this email because the PawFound account with this address was deleted.",
		}
	}
	return Notice{
		Lang: "es", Subject: "Tu cuenta de PawFound fue eliminada",
		Preheader: "Borramos tu perfil y todo lo que publicaste.",
		Title:     "Tu cuenta fue eliminada",
		Intro:     "Borramos tu perfil, tus reportes, tus publicaciones de PawFamily, tus mensajes, tus fotos y tu ubicación. Gracias por ayudar a que las mascotas vuelvan a casa.",
		Button:    "Visitar PawFound", Link: link,
		Safety: "No guardamos copia de tus datos. Si vuelves, empezarás con una cuenta nueva.",
		Ignore: "Recibes este correo porque se eliminó la cuenta de PawFound con esta dirección.",
	}
}

// noticeText es la versión de solo texto del aviso.
func noticeText(n Notice) string {
	return strings.Join([]string{n.Title, "", n.Intro, "", n.Link, "", n.Safety}, "\r\n") + "\r\n"
}
