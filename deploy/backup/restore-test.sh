#!/bin/sh
# Prueba de restauración: levanta una instancia PostgreSQL efímera DENTRO del
# contenedor (solo socket Unix, datos en tmpfs), restaura el respaldo más
# reciente y comprueba el resultado. "Una copia cuya restauración no se haya
# probado no satisface el requisito operativo" (stack-despliegue-operacion.md §5).
set -eu
umask 077
DIR="${BACKUP_DIR:-/backups}"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restore-test: $*"; }

# shellcheck disable=SC2012
latest="$(ls -1t "$DIR"/nava-*.dump 2>/dev/null | head -n 1 || true)"
[ -n "$latest" ] || { log "ERROR: no hay respaldos que probar"; exit 1; }
log "probando $(basename "$latest")"
(cd "$DIR" && sha256sum -c "$(basename "$latest").sha256" >/dev/null) || { log "ERROR: suma SHA-256 distinta"; exit 1; }

work="$(mktemp -d /tmp/restore-test.XXXXXX)"
started=0
cleanup() {
  [ "$started" = 1 ] && pg_ctl -D "$work/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

started_at="$(date -u +%s)"
initdb -D "$work/data" -U postgres --auth=trust -E UTF8 >/dev/null
pg_ctl -D "$work/data" -l "$work/pg.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories=$work -c shared_buffers=32MB -c max_connections=10 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
  start >/dev/null
started=1
q() { psql -h "$work" -U postgres -d "$1" -v ON_ERROR_STOP=1 -Atqc "$2"; }

# Roles primero: el respaldo conserva propietarios y permisos, que los citan.
roles="${latest%.dump}.roles.sql"
[ -f "$roles" ] && psql -h "$work" -U postgres -d postgres -q -f "$roles" >/dev/null 2>&1 || true

pg_restore -h "$work" -U postgres --create --dbname=postgres --exit-on-error "$latest"

db="$(pg_restore --list "$latest" | sed -n 's/^;[[:space:]]*dbname: //p' | head -n 1)"
[ -n "$db" ] || db="${PGDATABASE:-nava}"

expected="$(pg_restore --list "$latest" | grep -c ' TABLE public ' || true)"
restored="$(q "$db" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
[ "$restored" -ge 1 ] && [ "$restored" = "$expected" ] \
  || { log "ERROR: tablas restauradas ($restored) distintas de las del respaldo ($expected)"; exit 1; }

revisions="$(q "$db" "SELECT count(*) FROM atlas_schema_revisions.atlas_schema_revisions")"
[ "$revisions" -ge 1 ] || { log "ERROR: sin historial de migraciones en la copia restaurada"; exit 1; }

# Las políticas RLS deben haber sobrevivido: sin ellas habría fuga entre barberías.
rls="$(q "$db" "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"
[ "$rls" -ge 1 ] || { log "ERROR: la copia restaurada no tiene políticas RLS"; exit 1; }

date -u +%s >"$DIR/.last_restore_test"
log "OK: $restored tablas, $revisions migraciones, $rls políticas RLS, $(( $(date -u +%s) - started_at )) s"
