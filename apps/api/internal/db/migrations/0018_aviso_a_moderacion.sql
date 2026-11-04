-- Cuándo se avisó por correo a moderación de cada reporte, para mandar un solo correo por tanda y
-- no repetir el aviso.
ALTER TABLE reports ADD COLUMN notified_at timestamptz;
