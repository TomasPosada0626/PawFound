-- Límites de intentos que sobreviven a los reinicios. Solo el hash de la clave (correo o IP).
CREATE TABLE rate_limit_hits (
    scope    text NOT NULL,
    key_hash bytea NOT NULL,
    at       timestamptz NOT NULL
);

CREATE INDEX rate_limit_hits_lookup_idx ON rate_limit_hits (scope, key_hash, at);
CREATE INDEX rate_limit_hits_at_idx ON rate_limit_hits (at);

-- Segundo factor del panel de moderación: un código enviado al correo tras la contraseña.
CREATE TABLE admin_login_challenges (
    token_hash bytea PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash  bytea NOT NULL,
    attempts   integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
);
