#!/usr/bin/env bash
# Respaldo cifrado de la base de datos. Nunca deja una copia sin cifrar en el disco.
# pg_dump debe ser de la misma versión de la base o más nuevo (Neon usa PostgreSQL 18).
#
#   DATABASE_URL=postgres://... RESPALDO_CLAVE=... scripts/respaldo.sh archivo.dump.gpg
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"
: "${RESPALDO_CLAVE:?Falta RESPALDO_CLAVE}"
destino="${1:?Indica el archivo de destino}"

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" |
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 --output "$destino" 3<<<"$RESPALDO_CLAVE"

[ -s "$destino" ] || { echo "El respaldo quedó vacío" >&2; exit 1; }
echo "Respaldo listo: $destino ($(wc -c <"$destino") bytes)"
