-- Recordatorios a la familia (3, 7 y 14 días) y archivado de casos sin novedades en 60 días.
-- reminded_days: el último recordatorio enviado, para no repetirlo. archive_warned_at: cuándo se
-- avisó que el caso se archivaría; si después hubo novedades, el aviso deja de valer.
ALTER TABLE pets ADD COLUMN reminded_days integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN archive_warned_at timestamptz;
