// Package providers define los servicios externos de la API (SMS, push, traducción, correo)
// detrás de interfaces.
//
// Ningún proveedor real se activa sin su evaluación de seguridad y privacidad
// (docs/legal/incidentes-y-proveedores.md). Mientras tanto, en desarrollo se usan las
// implementaciones "Log", que solo escriben en el log del servidor y nunca salen a internet.
// En producción, sin proveedor configurado, la función correspondiente queda deshabilitada.
package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// SMS envía el código de verificación.
type SMS interface {
	SendCode(ctx context.Context, phone, code string) error
}

// Push entrega notificaciones a los celulares.
type Push interface {
	Send(ctx context.Context, messages []PushMessage) error
}

// PushMessage es una notificación para un dispositivo. URL es una ruta interna de la app
// ("/alerta/angel/<id>"), nunca un enlace externo.
type PushMessage struct {
	Token   string
	Title   string
	Body    string
	URL     string
	Channel string
	Silent  bool
}

// Translator traduce mensajes de chat. Puede ser nil: sin proveedor, los mensajes se
// muestran en su idioma original y no se inventan traducciones.
type Translator interface {
	Translate(ctx context.Context, text, from, to string) (string, error)
}

// Mailer envía el enlace para restablecer la contraseña.
type Mailer interface {
	SendPasswordReset(ctx context.Context, email, link string) error
}

// ErrDisabled: la función necesita un proveedor que todavía no se activó.
var ErrDisabled = errors.New("proveedor no configurado")

// LogSMS escribe el código en el log. Solo se permite con APP_ENV=development.
type LogSMS struct{ Log *slog.Logger }

// SendCode registra el código para poder probar el registro en local.
func (s LogSMS) SendCode(_ context.Context, phone, code string) error {
	s.Log.Info("SMS de desarrollo (no se envió)", "phone_suffix", suffix(phone), "code", code)
	return nil
}

// DisabledSMS hace que el registro falle con un error claro en vez de quedarse esperando.
type DisabledSMS struct{}

// SendCode siempre falla con ErrDisabled.
func (DisabledSMS) SendCode(context.Context, string, string) error { return ErrDisabled }

// LogPush registra las notificaciones sin enviarlas.
type LogPush struct{ Log *slog.Logger }

// Send registra cuántas notificaciones habría enviado.
func (p LogPush) Send(_ context.Context, messages []PushMessage) error {
	for _, m := range messages {
		p.Log.Info("push de desarrollo (no se envió)", "title", m.Title, "url", m.URL, "channel", m.Channel, "silent", m.Silent)
	}
	return nil
}

// ExpoPush envía por el servicio push de Expo, que entrega por FCM (Android) y APNs (iOS)
// con el mismo código. Requiere la evaluación del proveedor (issue #39) antes de activarse
// con PUSH_PROVIDER=expo.
type ExpoPush struct {
	AccessToken string
	Endpoint    string
	Client      *http.Client
}

type expoMessage struct {
	To        string            `json:"to"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Data      map[string]string `json:"data"`
	ChannelID string            `json:"channelId,omitempty"`
	Sound     *string           `json:"sound"`
	Priority  string            `json:"priority"`
}

// Send agrupa de a 100 mensajes, el máximo que acepta Expo por petición.
func (p ExpoPush) Send(ctx context.Context, messages []PushMessage) error {
	endpoint := p.Endpoint
	if endpoint == "" {
		endpoint = "https://exp.host/--/api/v2/push/send"
	}
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	for start := 0; start < len(messages); start += 100 {
		batch := messages[start:min(start+100, len(messages))]
		payload := make([]expoMessage, len(batch))
		for i, m := range batch {
			sound := "default"
			em := expoMessage{To: m.Token, Title: m.Title, Body: m.Body, Data: map[string]string{"url": m.URL}, ChannelID: m.Channel, Sound: &sound, Priority: "high"}
			if m.Silent {
				em.Sound, em.Priority = nil, "normal"
			}
			payload[i] = em
		}
		body, _ := json.Marshal(payload)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if p.AccessToken != "" {
			req.Header.Set("Authorization", "Bearer "+p.AccessToken)
		}
		res, err := client.Do(req)
		if err != nil {
			return err
		}
		_ = res.Body.Close()
		if res.StatusCode >= 300 {
			return fmt.Errorf("expo push respondió %d", res.StatusCode)
		}
	}
	return nil
}

// LogMailer registra el enlace de restablecimiento (solo desarrollo).
type LogMailer struct{ Log *slog.Logger }

// SendPasswordReset registra el envío sin el enlace completo en producción.
func (m LogMailer) SendPasswordReset(_ context.Context, _ string, link string) error {
	m.Log.Info("correo de desarrollo (no se envió)", "reset_link", link)
	return nil
}

func suffix(phone string) string {
	if len(phone) < 2 {
		return "**"
	}
	return "…" + phone[len(phone)-2:]
}
