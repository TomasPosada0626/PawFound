package providers

import (
	"bytes"
	"html/template"
	"strings"
)

// Correos con la identidad de PawFound: encabezado aguamarina con el logo, el código grande y
// un pie con la web y el contacto. Hechos con tablas y estilos en línea, que es lo que respetan
// Gmail, Outlook y los demás clientes de correo. Siempre van junto a la versión de texto.

// EmailBrand es lo que el correo necesita de la marca: el logo y la web (PUBLIC_WEB_URL).
type EmailBrand struct {
	WebURL  string
	LogoURL string
	Contact string
}

type emailCopy struct {
	Lang, Preheader, Greeting, Intro, CodeLabel, Expires, Safety, Ignore, Tagline, Visit, Write string
	ButtonLabel, ButtonFallback                                                                 string
}

var verificationCopy = map[string]emailCopy{
	"es": {
		Lang:      "es",
		Preheader: "Escríbelo en la app para verificar tu cuenta. Vence en 10 minutos.",
		Greeting:  "¡Hola, %s! 🐾",
		Intro:     "Gracias por sumarte a la comunidad que ayuda a que las mascotas vuelvan a casa. Escribe este código en PawFound para verificar tu cuenta y recibir tu primera insignia: Protector verificado.",
		CodeLabel: "Tu código de verificación",
		Expires:   "Vence en 10 minutos.",
		Safety:    "Nunca compartas este código. Nadie de PawFound te lo pedirá por chat, llamada ni WhatsApp.",
		Ignore:    "¿No creaste una cuenta? Ignora este correo: sin el código nadie puede usarla.",
		Tagline:   "Que ninguna mascota se quede sin volver a casa.",
		Visit:     "Visita",
		Write:     "Escríbenos a",
	},
	"en": {
		Lang:      "en",
		Preheader: "Enter it in the app to verify your account. It expires in 10 minutes.",
		Greeting:  "Hi, %s! 🐾",
		Intro:     "Thanks for joining the community that helps pets get back home. Enter this code in PawFound to verify your account and earn your first badge: Verified protector.",
		CodeLabel: "Your verification code",
		Expires:   "It expires in 10 minutes.",
		Safety:    "Never share this code. No one from PawFound will ask for it by chat, call or WhatsApp.",
		Ignore:    "Didn't create an account? Ignore this email: no one can use it without the code.",
		Tagline:   "So no pet is left without a way home.",
		Visit:     "Visit",
		Write:     "Write to us at",
	},
}

var resetCopy = emailCopy{
	Lang:           "es",
	Preheader:      "Elige una contraseña nueva. El enlace vence en 30 minutos.",
	Greeting:       "Restablece tu contraseña",
	Intro:          "Recibimos una solicitud para cambiar la contraseña de tu cuenta de PawFound. Toca el botón para elegir una nueva; el enlace vence en 30 minutos y sirve una sola vez.",
	ButtonLabel:    "Elegir contraseña nueva",
	ButtonFallback: "Si el botón no funciona, copia este enlace en tu navegador:",
	Safety:         "PawFound nunca te pedirá tu contraseña por chat, llamada ni WhatsApp.",
	Ignore:         "¿No lo pediste? Ignora este correo: tu contraseña no cambia.",
	Tagline:        "Que ninguna mascota se quede sin volver a casa.",
	Visit:          "Visita",
	Write:          "Escríbenos a",
}

// emailLayout es el marco común. El contenido central llega en .Body (ya escapado).
var emailLayout = template.Must(template.New("layout").Parse(`<!doctype html>
<html lang="{{.C.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>PawFound</title>
</head>
<body style="margin:0;padding:0;background:#F3F8F9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{.C.Preheader}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F8F9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:24px;overflow:hidden;font-family:'Nunito','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#13254A;">
<tr><td align="center" bgcolor="#08807A" style="background:#08807A;background-image:linear-gradient(135deg,#12B3A6 0%,#08807A 55%,#065F69 100%);padding:28px 24px;">
{{if .B.LogoURL}}<img src="{{.B.LogoURL}}" width="64" height="64" alt="" style="display:block;border:0;border-radius:16px;margin:0 auto 10px;">{{end}}
<div style="font-size:28px;font-weight:900;letter-spacing:0.3px;color:#FFFFFF;">Paw<span style="color:#C9F5EE;">Found</span></div>
</td></tr>
<tr><td style="padding:32px 32px 8px;">{{.Body}}</td></tr>
<tr><td style="padding:8px 32px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="background:#FDECEC;border-radius:14px;padding:14px 16px;font-size:14px;line-height:20px;color:#7A1414;">🔒 {{.C.Safety}}</td>
</tr></table>
<p style="margin:18px 0 0;font-size:13px;line-height:19px;color:#5D6C80;">{{.C.Ignore}}</p>
</td></tr>
<tr><td align="center" style="background:#F3F8F9;padding:22px 24px;font-size:12px;line-height:18px;color:#5D6C80;">
<strong style="color:#08807A;">PawFound</strong> · {{.C.Tagline}}<br>
{{if .B.WebURL}}{{.C.Visit}} <a href="{{.B.WebURL}}" style="color:#08807A;text-decoration:none;font-weight:700;">{{.B.WebURL}}</a><br>{{end}}
{{if .B.Contact}}{{.C.Write}} <a href="mailto:{{.B.Contact}}" style="color:#08807A;text-decoration:none;">{{.B.Contact}}</a>{{end}}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`))

var verificationBody = template.Must(template.New("code").Parse(`<h1 style="margin:0 0 12px;font-size:24px;line-height:30px;font-weight:800;color:#13254A;">{{.Greeting}}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:24px;color:#2A3B55;">{{.Intro}}</p>
<p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#5D6C80;">{{.CodeLabel}}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td align="center" style="background:#E0F6F3;border:2px dashed #12B3A6;border-radius:18px;padding:18px 12px;">
<span style="font-family:'Courier New',Consolas,monospace;font-size:40px;line-height:46px;font-weight:700;letter-spacing:12px;color:#08807A;">{{.Code}}</span>
</td></tr></table>
<p style="margin:12px 0 0;font-size:14px;line-height:20px;color:#5D6C80;">⏱ {{.Expires}}</p>`))

var resetBody = template.Must(template.New("reset").Parse(`<h1 style="margin:0 0 12px;font-size:24px;line-height:30px;font-weight:800;color:#13254A;">{{.Greeting}}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:24px;color:#2A3B55;">{{.Intro}}</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
<td align="center" bgcolor="#08807A" style="border-radius:14px;">
<a href="{{.Link}}" style="display:inline-block;padding:15px 28px;font-size:16px;font-weight:800;color:#FFFFFF;text-decoration:none;border-radius:14px;">{{.ButtonLabel}}</a>
</td></tr></table>
<p style="margin:22px 0 4px;font-size:13px;line-height:19px;color:#5D6C80;">{{.ButtonFallback}}</p>
<p style="margin:0;font-size:13px;line-height:19px;word-break:break-all;"><a href="{{.Link}}" style="color:#08807A;">{{.Link}}</a></p>`))

// firstName saluda por el primer nombre ("Valentina Arango" → "Valentina").
func firstName(name string) string {
	if fields := strings.Fields(name); len(fields) > 0 {
		return fields[0]
	}
	return ""
}

func render(brand EmailBrand, c emailCopy, body *template.Template, data any) (string, error) {
	var inner bytes.Buffer
	if err := body.Execute(&inner, data); err != nil {
		return "", err
	}
	var out bytes.Buffer
	err := emailLayout.Execute(&out, map[string]any{"B": brand, "C": c, "Body": template.HTML(inner.String())}) //nolint:gosec // inner viene de una plantilla que ya escapó cada dato
	return out.String(), err
}

// verificationHTML arma el correo del código de 6 dígitos.
func verificationHTML(brand EmailBrand, name, code, lang string) (string, error) {
	c, ok := verificationCopy[lang]
	if !ok {
		c = verificationCopy["es"]
	}
	greeting := strings.Replace(c.Greeting, "%s", firstName(name), 1)
	if firstName(name) == "" {
		greeting = strings.Replace(strings.Replace(c.Greeting, ", %s", "", 1), "%s", "", 1)
	}
	return render(brand, c, verificationBody, map[string]string{
		"Greeting": greeting, "Intro": c.Intro, "CodeLabel": c.CodeLabel, "Code": code, "Expires": c.Expires,
	})
}

// resetHTML arma el correo del enlace para restablecer la contraseña.
func resetHTML(brand EmailBrand, link string) (string, error) {
	c := resetCopy
	return render(brand, c, resetBody, map[string]string{
		"Greeting": c.Greeting, "Intro": c.Intro, "ButtonLabel": c.ButtonLabel, "ButtonFallback": c.ButtonFallback, "Link": link,
	})
}
