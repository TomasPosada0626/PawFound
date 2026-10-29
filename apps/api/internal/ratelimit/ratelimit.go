// Package ratelimit limita intentos por clave (IP, correo, cuenta) en una ventana de tiempo.
//
// Vive en memoria: alcanza para una sola instancia de la API. Al escalar a varias
// instancias se reemplaza por Upstash Redis (issue #40) detrás de la misma interfaz. Los
// límites de negocio que deben ser exactos (mensajes por minuto, reportes por día) no
// dependen de esto: se cuentan en la base de datos.
package ratelimit

import (
	"sync"
	"time"
)

// Limiter cuenta eventos por clave en una ventana deslizante.
type Limiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	now    func() time.Time
	hits   map[string][]time.Time
	sweep  time.Time
}

// New crea un límite de `limit` eventos por `window`.
func New(limit int, window time.Duration, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{limit: limit, window: window, now: now, hits: map[string][]time.Time{}}
}

// Allow registra un intento y dice si cabe en la ventana; si no, cuánto falta.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.sweep) > l.window {
		l.cleanup(now)
	}
	recent := l.recent(key, now)
	if len(recent) >= l.limit {
		l.hits[key] = recent
		return false, recent[0].Add(l.window).Sub(now)
	}
	l.hits[key] = append(recent, now)
	return true, 0
}

// Reset borra los intentos de una clave (p. ej., tras un inicio de sesión correcto).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

func (l *Limiter) recent(key string, now time.Time) []time.Time {
	hits := l.hits[key]
	i := 0
	for i < len(hits) && now.Sub(hits[i]) >= l.window {
		i++
	}
	return hits[i:]
}

func (l *Limiter) cleanup(now time.Time) {
	for key := range l.hits {
		if len(l.recent(key, now)) == 0 {
			delete(l.hits, key)
		}
	}
	l.sweep = now
}
