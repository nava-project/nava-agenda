#!/bin/sh
# Respaldo lógico de la base de NAVA con pg_dump (formato custom, comprimido).
# Lo ejecuta el planificador cada día y deploy.sh antes de migrar.
#
# Conserva propietarios y permisos (agenda_owner, políticas RLS, funciones
# SECURITY DEFINER): sin ellos una restauración rompería el aislamiento por
# barbería. Se conecta como `agenda_backup` (BYPASSRLS + pg_read_all_data);
# un rol corriente leería filas filtradas por RLS y produciría un respaldo
# incompleto sin avisar.
#
# Variables: PGHOST PGUSER PGPASSWORD PGDATABASE (PGSSLMODE=require), BACKUP_DIR,
# BACKUP_RETENTION_DAYS (30), BACKUP_MIN_KEEP (7), BACKUP_RCLONE_REMOTE (opcional).
set -eu
umask 077

DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-30}"
MIN_KEEP="${BACKUP_MIN_KEEP:-7}"
MIN_BYTES=10240

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

ts="$(date -u +%Y%m%dT%H%M%SZ)"
base="$DIR/nava-$ts"
partial="$base.dump.partial"
trap 'rm -f "$partial" "$base.roles.sql.partial"' EXIT

log "iniciando $base.dump"
pg_dump --format=custom --compress=6 --file="$partial"

# Verificación: el archivo debe ser legible por pg_restore y no estar vacío. Un
# respaldo que no se puede leer no cuenta como respaldo.
size="$(wc -c <"$partial")"
[ "$size" -ge "$MIN_BYTES" ] || { log "ERROR: respaldo sospechosamente pequeño ($size bytes)"; exit 1; }
pg_restore --list "$partial" >/dev/null || { log "ERROR: pg_restore no puede leer el respaldo"; exit 1; }

# Definición de roles (sin contraseñas): documenta atributos y membresías.
pg_dumpall -l "$PGDATABASE" --roles-only --no-role-passwords >"$base.roles.sql.partial"

mv "$partial" "$base.dump"
mv "$base.roles.sql.partial" "$base.roles.sql"
(cd "$DIR" && sha256sum "nava-$ts.dump" >"nava-$ts.dump.sha256")
date -u +%s >"$DIR/.last_success"
log "OK nava-$ts.dump ($size bytes)"

# Retención local: borra lo más antiguo que KEEP_DAYS, pero nunca deja menos de
# MIN_KEEP respaldos (protege ante un reloj erróneo o una racha de fallos).
# shellcheck disable=SC2012
for f in $(ls -1t "$DIR"/nava-*.dump 2>/dev/null | tail -n +"$((MIN_KEEP + 1))"); do
  if [ -n "$(find "$f" -mtime +"$KEEP_DAYS")" ]; then
    log "retención: eliminando $(basename "$f")"
    rm -f "${f%.dump}".dump "${f%.dump}".dump.sha256 "${f%.dump}".roles.sql
  fi
done

# Copia externa opcional (docs/04-arquitectura/stack-despliegue-operacion.md §5:
# almacenamiento separado del servidor). Un fallo aquí no invalida el respaldo
# local, pero sí termina con error para que quede visible.
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  log "copia externa a $BACKUP_RCLONE_REMOTE"
  rclone copy "$DIR" "$BACKUP_RCLONE_REMOTE" --include "nava-$ts.*" --retries 3 \
    || { log "ERROR: la copia externa falló (el respaldo local está intacto)"; exit 2; }
  rclone delete "$BACKUP_RCLONE_REMOTE" --min-age "${KEEP_DAYS}d" --include "nava-*" \
    || log "aviso: no se pudo aplicar la retención externa"
  date -u +%s >"$DIR/.last_offsite"
fi
