package ratelimit

import (
	"context"
	"crypto/sha256"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Allower es un límite de intentos por clave.
type Allower interface {
	Allow(key string) (bool, time.Duration)
	Reset(key string)
}

// Durable cuenta los intentos en PostgreSQL: sobreviven a los reinicios del servidor, frecuentes
// en el plan gratuito. Guarda solo el hash de la clave (correo o IP), nunca el valor. Si la base
// falla, cuenta en memoria: el límite nunca queda desactivado.
type Durable struct {
	db       *pgxpool.Pool
	scope    string
	limit    int
	window   time.Duration
	now      func() time.Time
	fallback *Limiter
}

const durableTimeout = 3 * time.Second

// NewDurable crea un límite de `limit` eventos por `window`, separado de otros por `scope`.
func NewDurable(db *pgxpool.Pool, scope string, limit int, window time.Duration, now func() time.Time) *Durable {
	if now == nil {
		now = time.Now
	}
	return &Durable{db: db, scope: scope, limit: limit, window: window, now: now, fallback: New(limit, window, now)}
}

func hashKey(scope, key string) []byte {
	sum := sha256.Sum256([]byte(scope + "\x00" + key))
	return sum[:]
}

// Allow registra un intento y dice si cabe en la ventana; si no, cuánto falta.
func (d *Durable) Allow(key string) (bool, time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), durableTimeout)
	defer cancel()
	now := d.now()
	hash := hashKey(d.scope, key)
	var count int
	var oldest *time.Time
	if err := d.db.QueryRow(ctx, `SELECT count(*), min(at) FROM rate_limit_hits WHERE scope = $1 AND key_hash = $2 AND at > $3`,
		d.scope, hash, now.Add(-d.window)).Scan(&count, &oldest); err != nil {
		return d.fallback.Allow(key)
	}
	if count >= d.limit && oldest != nil {
		return false, oldest.Add(d.window).Sub(now)
	}
	if _, err := d.db.Exec(ctx, `INSERT INTO rate_limit_hits (scope, key_hash, at) VALUES ($1, $2, $3)`, d.scope, hash, now); err != nil {
		return d.fallback.Allow(key)
	}
	return true, 0
}

// Reset borra los intentos de una clave (p. ej., tras un inicio de sesión correcto).
func (d *Durable) Reset(key string) {
	ctx, cancel := context.WithTimeout(context.Background(), durableTimeout)
	defer cancel()
	_, _ = d.db.Exec(ctx, `DELETE FROM rate_limit_hits WHERE scope = $1 AND key_hash = $2`, d.scope, hashKey(d.scope, key))
	d.fallback.Reset(key)
}
