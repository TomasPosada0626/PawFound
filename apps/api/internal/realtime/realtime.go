// Package realtime entrega eventos en vivo (mensajes nuevos, notificaciones) por WebSocket.
//
// El cliente abre /v1/ws y su primer mensaje debe ser {"type":"auth","token":"<access>"} en
// menos de 5 segundos: el token nunca viaja en la URL, que suele quedar en logs de proxies.
// Desde ahí el servidor solo envía; si el cliente se atrasa, se cierra su conexión en vez
// de frenar al resto (la app recupera lo perdido con la API REST al reconectar).
package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Event es lo que recibe la app.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data,omitempty"`
}

// Hub reparte eventos a las conexiones abiertas de cada cuenta.
type Hub struct {
	mu    sync.RWMutex
	conns map[string]map[chan Event]struct{}
}

// NewHub crea un hub vacío.
func NewHub() *Hub { return &Hub{conns: map[string]map[chan Event]struct{}{}} }

const buffer = 32

func (h *Hub) subscribe(userID string) chan Event {
	ch := make(chan Event, buffer)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conns[userID] == nil {
		h.conns[userID] = map[chan Event]struct{}{}
	}
	h.conns[userID][ch] = struct{}{}
	return ch
}

func (h *Hub) unsubscribe(userID string, ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set := h.conns[userID]; set != nil {
		if _, ok := set[ch]; ok {
			delete(set, ch)
			close(ch)
		}
		if len(set) == 0 {
			delete(h.conns, userID)
		}
	}
}

// Publish envía el evento a todas las conexiones de esas cuentas sin bloquear.
func (h *Hub) Publish(userIDs []string, event Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, id := range userIDs {
		for ch := range h.conns[id] {
			select {
			case ch <- event:
			default: // cliente atrasado: se descarta y se cerrará por el ping
			}
		}
	}
}

// Connected cuenta las conexiones de una cuenta (para pruebas y métricas).
func (h *Hub) Connected(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID])
}

// Authenticator convierte el token de acceso en el id de la cuenta.
type Authenticator func(ctx context.Context, token string) (string, error)

// Handler acepta conexiones WebSocket autenticadas.
func (h *Hub) Handler(auth Authenticator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Los timeouts de lectura/escritura del servidor HTTP cortarían la conexión larga.
		rc := http.NewResponseController(w)
		_ = rc.SetReadDeadline(time.Time{})
		_ = rc.SetWriteDeadline(time.Time{})
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.CloseNow() }()
		conn.SetReadLimit(4096)
		ctx := r.Context()

		authCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_, raw, err := conn.Read(authCtx)
		cancel()
		if err != nil {
			_ = conn.Close(websocket.StatusPolicyViolation, "auth requerida")
			return
		}
		var hello struct {
			Type  string `json:"type"`
			Token string `json:"token"`
		}
		userID := ""
		if json.Unmarshal(raw, &hello) == nil && hello.Type == "auth" {
			userID, err = auth(ctx, hello.Token)
		}
		if userID == "" || err != nil {
			_ = conn.Close(websocket.StatusPolicyViolation, "token inválido")
			return
		}
		ch := h.subscribe(userID)
		defer h.unsubscribe(userID, ch)
		if err := writeJSON(ctx, conn, Event{Type: "ready"}); err != nil {
			return
		}

		// El cliente no envía nada más: leer solo detecta el cierre de la conexión.
		readCtx := conn.CloseRead(ctx)
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-readCtx.Done():
				return
			case event, ok := <-ch:
				if !ok || writeJSON(ctx, conn, event) != nil {
					return
				}
			case <-ping.C:
				pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Ping(pingCtx)
				cancel()
				if err != nil {
					return
				}
			}
		}
	}
}

func writeJSON(ctx context.Context, conn *websocket.Conn, event Event) error {
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, raw)
}
