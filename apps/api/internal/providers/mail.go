package providers

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// LogPush registra las notificaciones sin enviarlas.
type LogPush struct{ Log *slog.Logger }

// Send registra cuántas notificaciones habría enviado.
func (p LogPush) Send(_ context.Context, messages []PushMessage) error {
	for _, m := range messages {
		p.Log.Info("push de desarrollo (no se envió)", "title", m.Title, "url", m.URL, "channel", m.Channel, "silent", m.Silent)
	}
	return nil
}

// SMTPMailer envía los correos por SMTP con STARTTLS (puerto 587) o TLS directo (465). Sirve
// con cualquier proveedor de correo transaccional; varios tienen capa gratuita con un límite
// diario, suficiente para el piloto. Se configura con SMTP_HOST, SMTP_PORT, SMTP_USERNAME,
// SMTP_PASSWORD y SMTP_FROM, tras la evaluación de privacidad del proveedor.
type SMTPMailer struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
	Timeout  time.Duration
}

var verificationTexts = map[string][3]string{
	"es": {
		"Tu código de PawFound: %s", "Hola,\r\n\r\nTu código para verificar tu cuenta de PawFound es:\r\n\r\n    %s\r\n\r\n" +
			"Vence en 10 minutos. Si no creaste una cuenta, ignora este correo.\r\n\r\nNunca compartas este código: PawFound jamás te lo pedirá por chat.\r\n",
		"Restablece tu contraseña de PawFound",
	},
	"en": {
		"Your PawFound code: %s", "Hi,\r\n\r\nYour code to verify your PawFound account is:\r\n\r\n    %s\r\n\r\n" +
			"It expires in 10 minutes. If you didn't create an account, ignore this email.\r\n\r\nNever share this code: PawFound will never ask for it in a chat.\r\n",
		"Reset your PawFound password",
	},
}

// verificationMessage arma el asunto y el texto del código de 6 dígitos en el idioma pedido.
func verificationMessage(code, lang string) (subject, body string) {
	t, ok := verificationTexts[lang]
	if !ok {
		t = verificationTexts["es"]
	}
	return fmt.Sprintf(t[0], code), fmt.Sprintf(t[1], code)
}

// resetMessage arma el correo del enlace para restablecer la contraseña.
func resetMessage(link string) (subject, body string) {
	body = "Hola,\r\n\r\nPara elegir una contraseña nueva abre este enlace (vence en 30 minutos):\r\n\r\n" + link +
		"\r\n\r\nSi no lo pediste, ignora este correo: tu contraseña no cambia.\r\n"
	return verificationTexts["es"][2], body
}

// SendVerificationCode envía el código de 6 dígitos.
func (m SMTPMailer) SendVerificationCode(_ context.Context, email, _, code, lang string) error {
	subject, body := verificationMessage(code, lang)
	return m.send(email, subject, body)
}

// SendPasswordReset envía el enlace de un solo uso.
func (m SMTPMailer) SendPasswordReset(_ context.Context, email, link string) error {
	subject, body := resetMessage(link)
	return m.send(email, subject, body)
}

var errHeaderInjection = errors.New("dirección de correo inválida")

func (m SMTPMailer) send(to, subject, body string) error {
	if m.Host == "" || m.From == "" {
		return ErrDisabled
	}
	// Una dirección con saltos de línea podría inyectar cabeceras.
	if strings.ContainsAny(to, "\r\n") || strings.ContainsAny(m.From, "\r\n") {
		return errHeaderInjection
	}
	port := m.Port
	if port == "" {
		port = "587"
	}
	msg := strings.Join([]string{
		"From: PawFound <" + m.From + ">",
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("utf-8", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		body,
	}, "\r\n")
	timeout := m.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	addr := net.JoinHostPort(m.Host, port)
	var conn net.Conn
	var err error
	dialer := &net.Dialer{Timeout: timeout}
	if port == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(timeout))
	client, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer func() { _ = client.Close() }()
	if port != "465" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("el servidor SMTP no ofrece STARTTLS: no se envía en texto plano")
		}
		if err := client.StartTLS(&tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if m.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", m.Username, m.Password, m.Host)); err != nil {
			return err
		}
	}
	if err := client.Mail(m.From); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
