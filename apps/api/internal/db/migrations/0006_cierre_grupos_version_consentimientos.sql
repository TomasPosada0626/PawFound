-- El grupo de un caso se cierra solo al marcar la mascota como encontrada; se cierran también
-- los de los casos que ya terminaron.
UPDATE threads SET archived = true WHERE id IN (SELECT group_id FROM pets WHERE state = 'reunited');

-- Versión del texto de cada consentimiento. Lo registrado antes queda sin versión: no se conoce.
ALTER TABLE consents ADD COLUMN text_version text;

-- Apagar o encender la Alerta Ángel también queda en el historial.
ALTER TABLE consents DROP CONSTRAINT consents_kind_check;
ALTER TABLE consents ADD CONSTRAINT consents_kind_check
    CHECK (kind IN ('alert_zone', 'push', 'location', 'terms', 'angel_alerts'));
