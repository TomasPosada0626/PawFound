-- Seguidores con solicitud y aceptación. 'declined' guarda que la persona rechazó o eliminó a
-- quien la seguía: no hay bloqueos, así que no se puede volver a insistir de inmediato.
CREATE TABLE follows (
    follower_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followed_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status      text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id)
);

CREATE INDEX follows_followed_idx ON follows (followed_id, status);

-- La calificación la pone la familia al cerrar el caso: una por persona y caso.
ALTER TABLE pet_helpers
    ADD COLUMN stars smallint CHECK (stars BETWEEN 1 AND 5),
    ADD COLUMN rated_at timestamptz;

CREATE INDEX pet_helpers_rated_idx ON pet_helpers (user_id, rated_at DESC) WHERE stars IS NOT NULL;

-- Búsqueda de personas por el comienzo de su nombre de usuario.
CREATE INDEX users_username_prefix_idx ON users (username text_pattern_ops);

-- Un solo aviso a los seguidores por caso cuando se pierde y otro cuando aparece, y una sola
-- alerta de mascota encontrada por persona y caso.
CREATE UNIQUE INDEX notifications_one_friend_idx ON notifications (user_id, pet_id, kind) WHERE kind IN ('friend_lost', 'friend_found');
CREATE UNIQUE INDEX notifications_one_found_alert_idx ON notifications (user_id, pet_id) WHERE kind = 'found_nearby';
