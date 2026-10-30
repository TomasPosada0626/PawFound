-- Foto de perfil propia (opcional, visible para todas las personas). Sin foto, la cuenta
-- muestra su avatar. Si la foto se borra, la cuenta vuelve al avatar.
ALTER TABLE users ADD COLUMN photo_id text REFERENCES media (id) ON DELETE SET NULL;

ALTER TABLE media DROP CONSTRAINT media_purpose_check;
ALTER TABLE media ADD CONSTRAINT media_purpose_check CHECK (purpose IN ('pet', 'owned', 'chat', 'story', 'avatar'));
