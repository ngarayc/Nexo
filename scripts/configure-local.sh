#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
umask 077
# noclobber evita reemplazar una configuración existente, incluso concurrentemente.
set -o noclobber
{
  printf 'DB_NAME=nexo\nDB_HOST=db\nDEMO_ENABLED=true\n'
  for name in DB_PASSWORD DB_OWNER_PASSWORD SESSION_SECRET INGEST_API_KEY; do
    printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
  done
} > .env.local
printf 'Configuración local creada con permisos privados. Conserva este archivo y el volumen.\n'
