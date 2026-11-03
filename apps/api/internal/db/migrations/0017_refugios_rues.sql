-- Refugios revisados en el RUES (Confecámaras, datos abiertos de datos.gov.co): nombre oficial,
-- resultado de la última revisión y cuándo se hizo, para reintentar las pendientes y volver a
-- revisar las verificadas cada mes.
ALTER TABLE users
    ADD COLUMN shelter_official_name text,
    ADD COLUMN shelter_check text,
    ADD COLUMN shelter_checked_at timestamptz;
