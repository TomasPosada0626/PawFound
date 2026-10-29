-- Sin refugios en ninguna parte del producto (decisión del 2026-10-28): en Medellín no reciben
-- mascotas encontradas, así que "La llevé a un refugio" deja de ser una opción del reporte.
UPDATE pets SET found_custody = NULL WHERE found_custody = 'shelter';
ALTER TABLE pets DROP CONSTRAINT pets_found_custody_check;
ALTER TABLE pets ADD CONSTRAINT pets_found_custody_check CHECK (found_custody IN ('with_me', 'vet', 'left_there'));
