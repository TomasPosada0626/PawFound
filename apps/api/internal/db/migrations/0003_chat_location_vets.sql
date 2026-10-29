-- Ubicación en el chat y veterinarias (decisiones del 2026-10-28).
--
-- Un mensaje puede llevar una ubicación:
-- - current: dónde estaba quien la envió en ese momento (no es en vivo). Solo en mensajes
--   directos.
-- - meeting: un punto de encuentro elegido en el mapa. Solo en mensajes directos.
-- - place: una veterinaria (lugar público) a donde alguien lleva la mascota; se puede enviar
--   al grupo del caso para que la familia sepa dónde buscarla.
--
-- Las ubicaciones de personas (current y meeting) dejan de verse cuando quien la compartió la
-- quita, cuando se cierra el mensaje directo o cuando se cierra el caso. En ese momento las
-- coordenadas se borran (location_lat/lng quedan NULL): el mensaje sigue en el chat y dice
-- "ya no visible".
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'system', 'sighting', 'location'));
ALTER TABLE messages
    ADD COLUMN location_kind      text CHECK (location_kind IN ('current', 'meeting', 'place')),
    ADD COLUMN location_lat       double precision,
    ADD COLUMN location_lng       double precision,
    ADD COLUMN location_label     text,
    ADD COLUMN location_address   text,
    ADD COLUMN place_id           text REFERENCES places (id) ON DELETE SET NULL,
    ADD COLUMN location_hidden_at timestamptz;

-- Los refugios salen del producto: en Medellín no reciben mascotas encontradas. Solo quedan
-- las veterinarias.
DELETE FROM places WHERE kind = 'shelter';
ALTER TABLE places DROP CONSTRAINT places_kind_check;
ALTER TABLE places ADD CONSTRAINT places_kind_check CHECK (kind = 'vet');
