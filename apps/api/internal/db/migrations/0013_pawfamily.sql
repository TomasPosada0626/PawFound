-- PawFamily: adopción responsable y 100 % gratuita, dentro de PawFound.

-- Mascotas en adopción, publicadas por una persona o por un refugio. La dirección es opcional y
-- solo la ven la familia que publica y quien fue aceptado para adoptar.
CREATE TABLE adoptions (
    id                 text PRIMARY KEY,
    owner_id           text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               text NOT NULL,
    species            text NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
    breed              text,
    sex                text NOT NULL CHECK (sex IN ('male', 'female', 'unknown')),
    age                text NOT NULL CHECK (age IN ('puppy', 'young', 'adult', 'senior', 'unknown')),
    size               text NOT NULL CHECK (size IN ('small', 'medium', 'large')),
    color              text,
    description        text NOT NULL,
    vaccinated         boolean NOT NULL DEFAULT false,
    sterilized         boolean NOT NULL DEFAULT false,
    photos             text[] NOT NULL,
    lat                double precision NOT NULL,
    lng                double precision NOT NULL,
    location           geography (Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
    zone               text NOT NULL,
    city_key           text,
    address            text,
    status             text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_process', 'adopted', 'withdrawn')),
    moderation_removed boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    adopted_at         timestamptz
);

CREATE INDEX adoptions_location_idx ON adoptions USING gist (location);
CREATE INDEX adoptions_owner_idx ON adoptions (owner_id, created_at DESC);
CREATE INDEX adoptions_city_idx ON adoptions (city_key);

-- Solicitudes para adoptar: solo lo necesario para decidir. Una por persona y mascota.
CREATE TABLE adoption_applications (
    id           text PRIMARY KEY,
    adoption_id  text NOT NULL REFERENCES adoptions (id) ON DELETE CASCADE,
    applicant_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    full_name    text NOT NULL,
    household    smallint NOT NULL CHECK (household BETWEEN 1 AND 20),
    neighborhood text NOT NULL,
    city         text NOT NULL,
    had_pets     boolean NOT NULL,
    pets_count   smallint NOT NULL DEFAULT 0 CHECK (pets_count BETWEEN 0 AND 50),
    reason       text NOT NULL,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    thread_id    text REFERENCES threads (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    decided_at   timestamptz,
    UNIQUE (adoption_id, applicant_id)
);

CREATE INDEX adoption_applications_applicant_idx ON adoption_applications (applicant_id, created_at DESC);

-- Aceptar las políticas de PawFamily queda registrado como los demás consentimientos.
ALTER TABLE consents DROP CONSTRAINT consents_kind_check;
ALTER TABLE consents ADD CONSTRAINT consents_kind_check
    CHECK (kind IN ('alert_zone', 'push', 'location', 'terms', 'angel_alerts', 'adoption_terms'));

-- Fotos de las publicaciones de adopción.
ALTER TABLE media DROP CONSTRAINT media_purpose_check;
ALTER TABLE media ADD CONSTRAINT media_purpose_check CHECK (purpose IN ('pet', 'owned', 'chat', 'story', 'avatar', 'adoption'));

-- Reportes de publicaciones de adopción, con un motivo propio: pedir dinero.
ALTER TABLE reports ADD COLUMN adoption_id text REFERENCES adoptions (id) ON DELETE SET NULL;
ALTER TABLE reports DROP CONSTRAINT reports_target_kind_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_kind_check CHECK (target_kind IN ('user', 'message', 'pet', 'adoption'));
ALTER TABLE reports DROP CONSTRAINT reports_reason_check;
ALTER TABLE reports ADD CONSTRAINT reports_reason_check CHECK (reason IN ('spam', 'rude', 'scam', 'inappropriate', 'other', 'money'));
ALTER TABLE moderation_actions ADD COLUMN adoption_id text;
