-- Refugios en PawFamily: se verifican al instante con un NIT de dígito de verificación válido (DIAN).
-- Moderación puede quitar la verificación ('rejected'); entonces la cuenta no puede volver a verificarse sola.
ALTER TABLE users
    ADD COLUMN shelter_name text,
    ADD COLUMN shelter_nit text,
    ADD COLUMN shelter_status text CHECK (shelter_status IN ('pending', 'verified', 'rejected')),
    ADD COLUMN shelter_requested_at timestamptz;

-- Un NIT verifica una sola cuenta.
CREATE UNIQUE INDEX users_shelter_nit_idx ON users (shelter_nit) WHERE shelter_status = 'verified';
