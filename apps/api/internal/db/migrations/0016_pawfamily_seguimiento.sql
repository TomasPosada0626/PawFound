-- PawFamily: las solicitudes vencen tras 14 días sin respuesta, y después de adoptar la nueva
-- familia comparte cómo está la mascota (a los 7 y 30 días se le recuerda).
ALTER TABLE adoption_applications DROP CONSTRAINT adoption_applications_status_check;
ALTER TABLE adoption_applications ADD CONSTRAINT adoption_applications_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired'));

-- followup_days: el último recordatorio de seguimiento enviado, para no repetirlo.
ALTER TABLE adoptions ADD COLUMN followup_days integer NOT NULL DEFAULT 0;

-- Novedades de la nueva familia: las ven quien dio en adopción y quien adoptó.
CREATE TABLE adoption_updates (
    id          text PRIMARY KEY,
    adoption_id text NOT NULL REFERENCES adoptions (id) ON DELETE CASCADE,
    author_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    photo_id    text REFERENCES media (id) ON DELETE SET NULL,
    body        text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX adoption_updates_adoption_idx ON adoption_updates (adoption_id, created_at DESC);
