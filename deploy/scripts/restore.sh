#!/usr/bin/env bash
# Restaura un respaldo en la base de producción. DESTRUCTIVO: reemplaza la base
# `nava` completa por el contenido del respaldo.
#
# Uso: CONFIRM_RESTORE=yes restore.sh /srv/nava-agenda/backups/nava-YYYYmmddTHHMMSSZ.dump
#
# Pasos: verifica la suma SHA-256, hace un respaldo de seguridad del estado actual,
# detiene API y worker, restaura (propietarios y RLS incluidos) y vuelve a arrancar.
# Los roles de PostgreSQL ya existen (los crea el bootstrap del contenedor); sobre un
# servidor nuevo, ejecuta antes deploy.sh para que `db` exista con los mismos db.env.
set -euo pipefail

dump="${1:?uso: CONFIRM_RESTORE=yes restore.sh <archivo.dump>}"
[ "${CONFIRM_RESTORE:-}" = yes ] || { echo "Operación destructiva: repite con CONFIRM_RESTORE=yes" >&2; exit 2; }
[ -f "$dump" ] || { echo "no existe $dump" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${NAVA_ENV_DIR:-/srv/nava-agenda/env}"
BASE_DIR="${NAVA_BASE_DIR:-/srv/nava-agenda}"
export IMAGE_TAG; IMAGE_TAG="$(cat "$BASE_DIR/current-tag")"
export DB_IMAGE_TAG; DB_IMAGE_TAG="$(cat "$BASE_DIR/current-db-tag")"
compose=(docker compose --env-file "$ENV_DIR/stack.env" -f "$here/compose.yaml")

echo "1/5 verificando $(basename "$dump")"
(cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")

echo "2/5 respaldo de seguridad del estado actual"
"${compose[@]}" run --rm -T --no-deps --entrypoint with-secrets backup backup.sh

echo "3/5 deteniendo API y worker"
"${compose[@]}" stop api worker

echo "4/5 restaurando"
"${compose[@]}" exec -T -u postgres db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='nava' AND pid <> pg_backend_pid()" >/dev/null
"${compose[@]}" exec -T -u postgres db pg_restore -U postgres --dbname=postgres \
  --clean --if-exists --create --exit-on-error <"$dump"

echo "5/5 arrancando API y worker"
"${compose[@]}" up -d --wait --wait-timeout 180 api worker
"${compose[@]}" exec -T web wget -q -O - http://api:8080/health/db >/dev/null
echo "Restauración completada."
