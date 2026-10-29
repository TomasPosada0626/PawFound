package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// BrevoMailer envía los correos con la API web de Brevo (HTTPS, puerto 443). Es la opción
// para hostings que bloquean SMTP: el plan gratis de Render cierra los puertos 465 y 587 desde
// septiembre de 2025, y por ahí no sale ningún código. Se configura con BREVO_API_KEY (una
// clave de API v3 de Brevo, distinta de la clave SMTP) y SMTP_FROM, el remitente verificado.
type BrevoMailer struct {
	APIKey string
	From   string
	// Endpoint por defecto https://api.brevo.com/v3/smtp/email (las pruebas usan un servidor falso).
	Endpoint string
	Client   *http.Client
}

const brevoEndpoint = "https://api.brevo.com/v3/smtp/email"

// SendVerificationCode envía el código de 6 dígitos.
func (m BrevoMailer) SendVerificationCode(ctx context.Context, email, code, lang string) error {
	subject, body := verificationMessage(code, lang)
	return m.send(ctx, email, subject, body)
}

// SendPasswordReset envía el enlace de un solo uso.
func (m BrevoMailer) SendPasswordReset(ctx context.Context, email, link string) error {
	subject, body := resetMessage(link)
	return m.send(ctx, email, subject, body)
}

func (m BrevoMailer) send(ctx context.Context, to, subject, body string) error {
	if m.APIKey == "" || m.From == "" {
		return ErrDisabled
	}
	if strings.ContainsAny(to, "\r\n") || !strings.Contains(to, "@") {
		return errHeaderInjection
	}
	payload, err := json.Marshal(map[string]any{
		"sender":      map[string]string{"name": "PawFound", "email": m.From},
		"to":          []map[string]string{{"email": to}},
		"subject":     subject,
		"textContent": strings.ReplaceAll(body, "\r\n", "\n"),
	})
	if err != nil {
		return err
	}
	endpoint := m.Endpoint
	if endpoint == "" {
		endpoint = brevoEndpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("api-key", m.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		// El detalle de Brevo (por ejemplo, remitente sin verificar o IP no autorizada) va al
		// log del servidor; nunca se muestra a la persona.
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("brevo respondió %d: %s", res.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}
