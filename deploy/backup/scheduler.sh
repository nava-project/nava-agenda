#!/bin/sh
# Planificador del servicio de respaldos: un respaldo diario a la hora UTC
# BACKUP_HOUR_UTC (3 por defecto) y, los domingos, una prueba de restauración.
# Si el último respaldo exitoso tiene más de 24 h, hace uno al arrancar.
set -u
DIR="${BACKUP_DIR:-/backups}"
HOUR="${BACKUP_HOUR_UTC:-3}"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) scheduler: $*"; }

stop=0
trap 'stop=1; kill "$sleeper" 2>/dev/null' TERM INT
sleeper=0

wait_seconds() {
  sleep "$1" &
  sleeper=$!
  wait "$sleeper" 2>/dev/null
}

last="$(cat "$DIR/.last_success" 2>/dev/null || echo 0)"
if [ $(( $(date -u +%s) - last )) -gt 86400 ]; then
  log "sin respaldo en las últimas 24 h: ejecutando uno ahora"
  backup.sh || log "ERROR: el respaldo inicial falló"
fi

while [ "$stop" = 0 ]; do
  now="$(date -u +%s)"
  delta=$(( ( HOUR * 3600 - now % 86400 + 86400 ) % 86400 ))
  [ "$delta" -gt 0 ] || delta=86400
  log "próximo respaldo en ${delta} s"
  wait_seconds "$delta"
  [ "$stop" = 0 ] || break
  backup.sh || log "ERROR: el respaldo falló"
  if [ "$(date -u +%u)" = 7 ]; then
    restore-test.sh || log "ERROR: la prueba de restauración falló"
  fi
done
log "detenido"
