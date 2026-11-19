#!/bin/sh
# Bootstrap de roles (DEC-040, nava-docs/agenda/05-backend/migraciones-atlas.md §6): los
# cuatro roles se crean FUERA de Atlas, antes de la primera migración, con la
# contraseña del secreto del ambiente. Se añade `barberia_backup` (lectura de
# todo, incluso con RLS forzada) para que los respaldos no usen el superusuario.
#
# Se crean con los nombres barberia_* que usan las migraciones históricas; deploy.sh
# los renombra a agenda_* tras la migración 20261121090000 (DEC-183, #660).
set -eu
: "${NAVA_MIGRATOR_PASSWORD:?}" "${NAVA_APP_PASSWORD:?}" "${NAVA_WORKER_PASSWORD:?}" "${NAVA_BACKUP_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_pw="$NAVA_MIGRATOR_PASSWORD" -v app_pw="$NAVA_APP_PASSWORD" \
  -v worker_pw="$NAVA_WORKER_PASSWORD" -v backup_pw="$NAVA_BACKUP_PASSWORD" <<'SQL'
CREATE ROLE barberia_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE barberia_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'migrator_pw';
GRANT barberia_owner TO barberia_migrator;
CREATE ROLE barberia_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_pw';
CREATE ROLE barberia_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'worker_pw';
CREATE ROLE barberia_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD :'backup_pw';
GRANT pg_read_all_data TO barberia_backup;
SQL
