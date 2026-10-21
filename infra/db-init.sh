#!/bin/bash
set -euo pipefail
# psql escapa los valores; no se interpola la contraseña dentro de SQL o argumentos.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password NEXO_APP_PASSWORD
SELECT format('CREATE ROLE nexo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_password') \gexec
REVOKE ALL ON DATABASE nexo FROM PUBLIC;
GRANT CONNECT ON DATABASE nexo TO nexo_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
