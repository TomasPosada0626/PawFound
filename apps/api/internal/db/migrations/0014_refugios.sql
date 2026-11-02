-- Refugios en PawFamily: piden la verificación adicional con su NIT y moderación la aprueba.
ALTER TABLE users
    ADD COLUMN shelter_name text,
    ADD COLUMN shelter_nit text,
    ADD COLUMN shelter_status text CHECK (shelter_status IN ('pending', 'verified', 'rejected')),
    ADD COLUMN shelter_requested_at timestamptz;

CREATE INDEX users_shelter_pending_idx ON users (shelter_requested_at) WHERE shelter_status = 'pending';
