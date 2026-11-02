#!/usr/bin/env bash
# Restaura un respaldo en una base vacía. Se niega a escribir sobre una base que ya tiene datos.
# Todo o nada: si algo falla, la base queda como estaba.
#
#   DATABASE_URL=postgres://... RESPALDO_CLAVE=... scripts/restaurar.sh archivo.dump.gpg
set -euo pipefail

: "${DATABASE_URL:?Falta la DATABASE_URL de una base vacía}"
: "${RESPALDO_CLAVE:?Falta RESPALDO_CLAVE}"
origen="${1:?Indica el archivo del respaldo}"

tablas="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'")"
if [ "$tablas" != "0" ]; then
  echo "La base de destino ya tiene $tablas tablas: restaura solo en una base vacía." >&2
  exit 1
fi

# transaction_timeout lo escribe pg_dump 17 y no existe en PostgreSQL 16.
gpg --batch --quiet --decrypt --passphrase-fd 3 "$origen" 3<<<"$RESPALDO_CLAVE" |
  pg_restore --no-owner --no-privileges --file=- |
  sed '/^SET transaction_timeout/d' |
  psql "$DATABASE_URL" --quiet --single-transaction -v ON_ERROR_STOP=1 >/dev/null

echo "Restaurado. Tablas: $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
