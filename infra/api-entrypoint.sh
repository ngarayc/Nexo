#!/bin/sh
set -eu
node /app/apps/api/dist/platform/database/migrate-main.js
# El proceso HTTP no hereda la credencial del propietario de migraciones.
exec env -u DB_OWNER_PASSWORD node /app/apps/api/dist/main.js
