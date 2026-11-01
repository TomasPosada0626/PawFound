-- La familia puede eliminar su publicación: deja de verse para todas las personas, pero la fila
-- se conserva según la política de retención.
ALTER TABLE pets ADD COLUMN withdrawn_at timestamptz;
