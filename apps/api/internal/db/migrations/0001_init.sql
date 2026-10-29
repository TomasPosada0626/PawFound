-- Esquema inicial de PawFound (issue #32). Reglas que el esquema hace cumplir por sí mismo:
-- - Toda ubicación guardada ya viene aproximada a celdas de 250 m (internal/geo); el esquema
--   nunca recibe el punto exacto.
-- - Una sola Alerta Ángel por persona y caso (índice único parcial en notifications).
-- - Los registros de moderación y consentimientos son de solo inserción (auditoría).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
    id                 text PRIMARY KEY,
    name               text NOT NULL,
    username           text NOT NULL UNIQUE,
    email              text NOT NULL,
    password_hash      text,
    phone              text,
    phone_verified     boolean NOT NULL DEFAULT false,
    avatar             text NOT NULL DEFAULT 'dog',
    title              text NOT NULL DEFAULT 'animal_lover',
    bio                text NOT NULL DEFAULT '',
    city               text NOT NULL DEFAULT 'Medellín',
    neighborhood       text,
    lang               text NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
    role               text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
    who_can_message    text NOT NULL DEFAULT 'everyone' CHECK (who_can_message IN ('everyone', 'verified', 'nobody')),
    notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
    muted_until        timestamptz,
    suspended_at       timestamptz,
    warnings           integer NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));
-- Un celular verificado pertenece a una sola cuenta (insignia azul).
CREATE UNIQUE INDEX users_verified_phone_key ON users (phone) WHERE phone_verified;

CREATE TABLE oauth_identities (
    provider   text NOT NULL,
    subject    text NOT NULL,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

-- Refresh tokens opacos, guardados solo como hash. Rotan en cada uso; reutilizar uno ya
-- rotado revoca toda la familia (señal de robo).
CREATE TABLE refresh_tokens (
    id          text PRIMARY KEY,
    user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family      text NOT NULL,
    token_hash  bytea NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family);

-- Enlaces de un solo uso para restablecer la contraseña (válidos 30 minutos).
CREATE TABLE password_resets (
    token_hash bytea PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

CREATE TABLE phone_verifications (
    user_id      text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    phone        text NOT NULL,
    code_hash    bytea NOT NULL,
    sent_at      timestamptz NOT NULL,
    attempts     integer NOT NULL DEFAULT 0,
    locked_until timestamptz
);

-- Zona de Alertas Ángel: solo existe con consentimiento y siempre es un punto aproximado.
CREATE TABLE alert_zones (
    user_id    text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    lat        double precision NOT NULL,
    lng        double precision NOT NULL,
    zone       text NOT NULL,
    location   geography (Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_zones_location_idx ON alert_zones USING gist (location);

-- Consentimientos granulares y auditables (issue #43): nunca se actualiza una fila, se agrega otra.
CREATE TABLE consents (
    id      bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind    text NOT NULL CHECK (kind IN ('alert_zone', 'push', 'location', 'terms')),
    granted boolean NOT NULL,
    at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consents_user_idx ON consents (user_id, at);

CREATE TABLE devices (
    token        text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform     text NOT NULL CHECK (platform IN ('android', 'ios')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX devices_user_idx ON devices (user_id);

-- Imágenes ya procesadas: re-codificadas (sin EXIF ni GPS), redimensionadas y con hash
-- perceptual para detectar fotos repetidas entre cuentas.
CREATE TABLE media (
    id           text PRIMARY KEY,
    owner_id     text REFERENCES users (id) ON DELETE SET NULL,
    purpose      text NOT NULL CHECK (purpose IN ('pet', 'owned', 'chat')),
    content_type text NOT NULL,
    width        integer NOT NULL,
    height       integer NOT NULL,
    bytes        integer NOT NULL,
    phash        bigint NOT NULL,
    storage_key  text NOT NULL,
    thread_id    text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_phash_idx ON media (phash);

CREATE TABLE owned_pets (
    id            text PRIMARY KEY,
    owner_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          text NOT NULL,
    species       text NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
    breed         text,
    sex           text NOT NULL CHECK (sex IN ('male', 'female', 'unknown')),
    age           text NOT NULL CHECK (age IN ('puppy', 'young', 'adult', 'senior', 'unknown')),
    size          text NOT NULL CHECK (size IN ('small', 'medium', 'large')),
    color         text,
    collar        text,
    marks         text,
    description   text NOT NULL DEFAULT '',
    photos        text[] NOT NULL DEFAULT '{}',
    shy_or_indoor boolean NOT NULL DEFAULT false,
    last_case_id  text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX owned_pets_owner_idx ON owned_pets (owner_id);

CREATE TABLE pets (
    id                  text PRIMARY KEY,
    kind                text NOT NULL CHECK (kind IN ('lost', 'found')),
    state               text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'reunited', 'archived')),
    name                text,
    species             text NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
    breed               text,
    sex                 text NOT NULL CHECK (sex IN ('male', 'female', 'unknown')),
    age                 text NOT NULL CHECK (age IN ('puppy', 'young', 'adult', 'senior', 'unknown')),
    size                text NOT NULL CHECK (size IN ('small', 'medium', 'large')),
    color               text,
    collar              text,
    marks               text,
    description         text NOT NULL,
    photos              text[] NOT NULL DEFAULT '{}',
    traumatic_event     boolean NOT NULL DEFAULT false,
    shy_or_indoor       boolean NOT NULL DEFAULT false,
    last_seen_at        timestamptz NOT NULL,
    lat                 double precision NOT NULL,
    lng                 double precision NOT NULL,
    zone                text NOT NULL,
    location            geography (Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
    found_search_radius integer,
    reward              boolean NOT NULL DEFAULT false,
    found_condition     text CHECK (found_condition IN ('good', 'scared', 'injured', 'needs_vet')),
    found_custody       text CHECK (found_custody IN ('with_me', 'vet', 'shelter', 'left_there')),
    owner_id            text REFERENCES users (id) ON DELETE SET NULL,
    owner_short_name    text NOT NULL,
    owned_pet_id        text,
    group_id            text NOT NULL,
    share_count         integer NOT NULL DEFAULT 0,
    moderation_removed  boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    reunited_at         timestamptz
);

CREATE INDEX pets_location_idx ON pets USING gist (location);
CREATE INDEX pets_owner_created_idx ON pets (owner_id, created_at);
CREATE INDEX pets_active_idx ON pets (state, kind) WHERE state = 'active';

CREATE TABLE sightings (
    id                text PRIMARY KEY,
    pet_id            text NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    author_id         text REFERENCES users (id) ON DELETE SET NULL,
    author_short_name text NOT NULL,
    at                timestamptz NOT NULL,
    lat               double precision NOT NULL,
    lng               double precision NOT NULL,
    zone              text NOT NULL,
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sightings_pet_idx ON sightings (pet_id, at DESC);
CREATE INDEX sightings_author_idx ON sightings (author_id);

-- "Ángel de patas": personas a quienes la familia agradeció al cerrar el caso.
CREATE TABLE pet_helpers (
    pet_id  text NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (pet_id, user_id)
);

-- Casos compartidos por cada cuenta, sin repetir (insignia "Megáfono").
CREATE TABLE pet_shares (
    pet_id  text NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pet_id, user_id)
);

CREATE TABLE threads (
    id         text PRIMARY KEY,
    kind       text NOT NULL CHECK (kind IN ('dm', 'group')),
    pet_id     text REFERENCES pets (id) ON DELETE SET NULL,
    archived   boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE thread_members (
    thread_id text NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    read_at   timestamptz NOT NULL DEFAULT now(),
    muted     boolean NOT NULL DEFAULT false,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX thread_members_user_idx ON thread_members (user_id);

CREATE TABLE messages (
    id                text PRIMARY KEY,
    thread_id         text NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    author_id         text REFERENCES users (id) ON DELETE SET NULL,
    author_short_name text NOT NULL,
    kind              text NOT NULL CHECK (kind IN ('text', 'system', 'sighting')),
    body              text NOT NULL,
    lang              text CHECK (lang IN ('es', 'en')),
    translations      jsonb NOT NULL DEFAULT '{}'::jsonb,
    photo_id          text REFERENCES media (id) ON DELETE SET NULL,
    at                timestamptz NOT NULL DEFAULT now(),
    removed_at        timestamptz
);

CREATE INDEX messages_thread_at_idx ON messages (thread_id, at);
CREATE INDEX messages_author_at_idx ON messages (author_id, at);

CREATE TABLE notifications (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         text NOT NULL,
    pet_id       text NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    owned_pet_id text,
    at           timestamptz NOT NULL DEFAULT now(),
    read         boolean NOT NULL DEFAULT false,
    pushed       boolean NOT NULL DEFAULT false
);

CREATE INDEX notifications_user_at_idx ON notifications (user_id, at DESC);
-- Una sola Alerta Ángel por persona y caso, aunque el job corra dos veces a la vez.
CREATE UNIQUE INDEX notifications_one_alert_idx ON notifications (user_id, pet_id) WHERE kind IN ('angel_alert', 'life_circle');
-- Un solo aviso de "¿es tu mascota?" por perfil propio y reporte encontrado.
CREATE UNIQUE INDEX notifications_one_owned_match_idx ON notifications (user_id, pet_id, owned_pet_id) WHERE kind = 'owned_match';

CREATE TABLE profile_likes (
    target_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    liker_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (target_id, liker_id)
);

-- Cola de moderación: personas, mensajes y publicaciones reportadas. Sin bloqueos entre personas.
CREATE TABLE reports (
    id               text PRIMARY KEY,
    reporter_id      text REFERENCES users (id) ON DELETE SET NULL,
    target_kind      text NOT NULL CHECK (target_kind IN ('user', 'message', 'pet')),
    reported_user_id text REFERENCES users (id) ON DELETE SET NULL,
    pet_id           text REFERENCES pets (id) ON DELETE SET NULL,
    thread_id        text,
    message_id       text,
    reason           text NOT NULL CHECK (reason IN ('spam', 'rude', 'scam', 'inappropriate', 'other')),
    note             text,
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,
    resolved_by      text REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX reports_status_idx ON reports (status, created_at);
CREATE UNIQUE INDEX reports_dedupe_idx ON reports (reporter_id, target_kind, coalesce(reported_user_id, ''), coalesce(pet_id, ''), coalesce(message_id, ''));

-- Bitácora de decisiones de moderación (solo inserción): quién hizo qué, cuándo y por qué.
CREATE TABLE moderation_actions (
    id             bigserial PRIMARY KEY,
    moderator_id   text REFERENCES users (id) ON DELETE SET NULL,
    action         text NOT NULL,
    target_user_id text REFERENCES users (id) ON DELETE SET NULL,
    pet_id         text,
    message_id     text,
    report_id      text,
    hours          integer,
    note           text NOT NULL DEFAULT '',
    at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX moderation_actions_target_idx ON moderation_actions (target_user_id, at DESC);

-- Sesiones del panel de moderación web (cookie HttpOnly); el id se guarda como hash.
CREATE TABLE admin_sessions (
    id_hash    bytea PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    csrf       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
