-- Chats (decisión de producto del 2026-10-28): ningún chat se cierra ni se borra solo al
-- terminar el caso. Un mensaje directo lo cierra una de las dos personas; cada quien decide si
-- archivar o eliminar un chat de su propia lista.
ALTER TABLE threads ADD COLUMN closed_by text REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE thread_members ADD COLUMN archived boolean NOT NULL DEFAULT false;
UPDATE threads SET archived = false WHERE kind = 'group';

-- Alertas por ubicación real: alert_zones guarda solo el último punto aproximado (250 m) que
-- envió el celular, sin historial. Un punto viejo deja de usarse (ver internal/app/notify.go).
CREATE INDEX alert_zones_updated_idx ON alert_zones (updated_at);

-- Historias de casos dentro de PawFound: no vencen. Desaparecen cuando la familia las quita o
-- cuando el caso se cierra.
CREATE TABLE stories (
    id         text PRIMARY KEY,
    pet_id     text NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    author_id  text REFERENCES users (id) ON DELETE CASCADE,
    photo_id   text REFERENCES media (id) ON DELETE SET NULL,
    body       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz
);

CREATE INDEX stories_pet_idx ON stories (pet_id, created_at) WHERE removed_at IS NULL;

ALTER TABLE media DROP CONSTRAINT media_purpose_check;
ALTER TABLE media ADD CONSTRAINT media_purpose_check CHECK (purpose IN ('pet', 'owned', 'chat', 'story'));

-- Veterinarias y refugios. La fuente inicial es OpenStreetMap (licencia ODbL: se cita en la
-- app); cada importación actualiza por (source, source_id) sin duplicar.
CREATE TABLE places (
    id            text PRIMARY KEY,
    kind          text NOT NULL CHECK (kind IN ('vet', 'shelter')),
    name          text NOT NULL,
    lat           double precision NOT NULL,
    lng           double precision NOT NULL,
    location      geography (Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
    address       text,
    phone         text,
    website       text,
    opening_hours text,
    emergency     boolean NOT NULL DEFAULT false,
    source        text NOT NULL DEFAULT 'osm',
    source_id     text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);

CREATE INDEX places_location_idx ON places USING gist (location);

CREATE TABLE place_reports (
    id          bigserial PRIMARY KEY,
    place_id    text NOT NULL REFERENCES places (id) ON DELETE CASCADE,
    reporter_id text REFERENCES users (id) ON DELETE SET NULL,
    note        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Verificación gratis por correo (decisión del 2026-10-28): la insignia azul es un correo
-- verificado con un código de 6 dígitos; las cuentas de Google/Apple llegan verificadas. No se
-- envían SMS y el celular queda opcional, sin verificar.
DROP INDEX users_verified_phone_key;
ALTER TABLE users RENAME COLUMN phone_verified TO email_verified;
ALTER TABLE phone_verifications RENAME TO email_verifications;
ALTER TABLE email_verifications RENAME COLUMN phone TO email;
