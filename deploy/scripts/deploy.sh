#!/usr/bin/env bash
# Despliegue de una versión de NAVA en el VPS. Corre en el servidor como `deploy`,
# desde el directorio de la versión (/srv/barberia/releases/<sha>/deploy/scripts).
#
# Orden (docs/05-backend/migraciones-atlas.md, "Despliegue"):
#   1. valida entornos y que las imágenes estén en el Docker del host
#   2. levanta PostgreSQL (la crea y hace el bootstrap de roles si es la primera vez)
#   3. respaldo previo verificado
#   4. migraciones con Atlas como barberia_migrator (si fallan, NO se toca la aplicación)
#   5. arranca API, worker, web y respaldos; espera a que estén sanos
#   6. pruebas de humo
#
# Uso: deploy.sh <sha> --db-tag <tag> [--no-migrate]
#   Las imágenes no se descargan de ningún registro: Jenkins las construye en el Docker del
#   host (DEC-177). --no-pull se acepta y no hace nada: release.sh lo pasa también al
#   deploy.sh de versiones anteriores a #634, que sí descargaban.
#   --no-migrate reversión de la aplicación SIN tocar el esquema ni respaldar; solo es
#                seguro si el esquema actual es compatible con la versión anterior
set -euo pipefail

sha="${1:?uso: deploy.sh <sha> --db-tag <tag> [opciones]}"; shift
db_tag=""; migrate=1
while [ $# -gt 0 ]; do
  case "$1" in
    --db-tag) db_tag="${2:?}"; shift 2 ;;
    --no-pull) shift ;;
    --no-migrate) migrate=0; shift ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "sha inválido: $sha" >&2; exit 2; }
[ -n "$db_tag" ] || { echo "falta --db-tag" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${NAVA_ENV_DIR:-/srv/barberia/env}"
BASE_DIR="${NAVA_BASE_DIR:-/srv/barberia}"
LOG="$BASE_DIR/deploy.log"
export IMAGE_TAG="$sha" DB_IMAGE_TAG="$db_tag"
compose=(docker compose --env-file "$ENV_DIR/stack.env" -f "$here/compose.yaml")

log() { printf '%s deploy[%s]: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${sha:0:12}" "$*" | tee -a "$LOG"; }
get() { grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- || true; }
fail() { log "ERROR: $*"; exit 1; }
# Muestra la salida completa en pantalla y guarda en el registro solo su cola:
# el SQL de Atlas es enorme y el registro debe seguir siendo legible.
show() {
  local out rc=0; out="$(mktemp)"
  "$@" >"$out" 2>&1 || rc=$?
  cat "$out"; tail -n 8 "$out" >>"$LOG"; rm -f "$out"
  return "$rc"
}

log "inicio (actor: ${DEPLOY_ACTOR:-desconocido}, migraciones: $migrate)"

# --- 1. Configuración y secretos ----------------------------------------------
SECRETS_DIR="${NAVA_SECRETS_DIR:-$(get NAVA_SECRETS_DIR "$ENV_DIR/stack.env")}"
SECRETS_DIR="${SECRETS_DIR:-/srv/barberia/secrets}"
for f in stack.env db.env app.env backup.env; do
  [ -f "$ENV_DIR/$f" ] || fail "falta $ENV_DIR/$f (ejecuta deploy/scripts/env-init.sh)"
done
for s in db/POSTGRES_PASSWORD app/APP_DATABASE_URL app/APP_WORKER_DATABASE_URL app/APP_AUTH_HMAC_SECRET \
         migrate/DATABASE_PRODUCTION_URL migrate/DATABASE_ADMIN_URL backup/PGPASSWORD; do
  [ -s "$SECRETS_DIR/$s" ] || fail "falta el secreto $SECRETS_DIR/$s (ejecuta deploy/scripts/env-init.sh)"
done
# Obligatorios en producción: el API no arranca sin ellos (DEC-066, DEC-124).
for s in APP_RESEND_API_KEY APP_META_WHATSAPP_ACCESS_TOKEN; do
  [ -s "$SECRETS_DIR/app/$s" ] || fail "el secreto app/$s está vacío (guárdalo con deploy/scripts/secret-set.sh app $s)"
done
[ -n "$(get APP_META_WHATSAPP_PHONE_NUMBER_ID "$ENV_DIR/app.env")" ] \
  || fail "APP_META_WHATSAPP_PHONE_NUMBER_ID está vacío en $ENV_DIR/app.env"
if [ "$(get APP_META_WHATSAPP_MODE "$ENV_DIR/app.env")" != text ]; then
  [ -n "$(get APP_META_WHATSAPP_TEMPLATE_NAME "$ENV_DIR/app.env")" ] \
    || fail "APP_META_WHATSAPP_TEMPLATE_NAME está vacío en $ENV_DIR/app.env"
fi
# Red compartida con otros proyectos de la VPS (DEC-176). Es externa a esta pila: se crea
# si falta y nunca se borra aquí, porque otras pilas pueden estar usándola.
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null \
  || fail "no se pudo crear la red edge"
"${compose[@]}" config -q || fail "compose.yaml no es válido con los entornos actuales"

# --- 1b. Imágenes -----------------------------------------------------------
# Ningún comando posterior debe consumir stdin (docker compose run/exec lo harían, y bajo
# `ssh host bash -s` se tragarían el script).
exec </dev/null
# Sin registro: si falta una imagen, compose intentaría descargarla y fallaría a medias.
images="$("${compose[@]}" --profile tools config --images | sort -u)"
for img in $images; do
  docker image inspect "$img" >/dev/null 2>&1 \
    || fail "no está la imagen $img en el Docker del host: constrúyela con el job barberia/deploy de Jenkins"
done

# --- 2. Base de datos -------------------------------------------------------
log "levantando PostgreSQL"
"${compose[@]}" up -d --wait --wait-timeout 120 db
psql_db() { "${compose[@]}" exec -T -u postgres db psql -U postgres -d nava -v ON_ERROR_STOP=1 -Atq "$@"; }
atlas() { "${compose[@]}" --profile tools run --rm -T migrate "$@"; }

if [ "$migrate" = 1 ]; then
  bootstrapped="$(psql_db -c "SELECT to_regclass('atlas_schema_revisions.atlas_schema_revisions') IS NOT NULL")"
  if [ "$bootstrapped" != t ]; then
    # Primera instalación: las tres primeras migraciones con el administrador y
    # traspaso del historial de Atlas a barberia_migrator (si no, quien lo creó
    # —postgres— sería su único dueño y el migrador no podría anotar el progreso).
    log "bootstrap: primeras tres migraciones como administrador"
    atlas migrate apply --config file:///atlas-bootstrap.hcl --env bootstrap --to-version 20260811145252
    psql_db -c "ALTER SCHEMA atlas_schema_revisions OWNER TO barberia_migrator; ALTER TABLE atlas_schema_revisions.atlas_schema_revisions OWNER TO barberia_migrator;"
  fi

  # --- 3. Respaldo previo verificado ----------------------------------------
  log "respaldo previo a la migración"
  "${compose[@]}" run --rm -T --no-deps --entrypoint with-secrets backup backup.sh \
    || fail "el respaldo previo falló: no se migra ni se despliega"

  # --- 4. Migraciones -------------------------------------------------------
  log "estado de migraciones (antes)"
  show atlas migrate status --env production
  log "simulación de migraciones"
  show atlas migrate apply --env production --dry-run
  log "aplicando migraciones"
  show atlas migrate apply --env production \
    || fail "la migración falló: la aplicación en ejecución no se tocó"
  show atlas migrate status --env production
else
  log "--no-migrate: se omiten bootstrap, respaldo y migraciones"
fi

# --- 5. Aplicación ----------------------------------------------------------
log "arrancando API, worker, web y respaldos"
"${compose[@]}" up -d --wait --wait-timeout 240 --remove-orphans api worker web backup \
  || { "${compose[@]}" ps; "${compose[@]}" logs --tail=60 api worker web; fail "los servicios no quedaron sanos"; }

# --- 6. Pruebas de humo -----------------------------------------------------
log "pruebas de humo"
inside() { "${compose[@]}" exec -T web wget -q -O - "$1"; }
inside http://api:8080/health >/dev/null || fail "GET /health falló"
inside http://api:8080/health/db >/dev/null || fail "GET /health/db falló (el API no alcanza PostgreSQL)"
# La app vive en agenda.$DOMAIN (DEC-183); DOMAIN es el dominio raíz de la familia NAVA.
domain="agenda.$(get DOMAIN "$ENV_DIR/stack.env")"; port="$(get HTTPS_PORT "$ENV_DIR/stack.env")"; port="${port:-443}"
ok=0; insecure=()
[ "$domain" = agenda.localhost ] && insecure=(-k)   # CA interna de Caddy en pruebas locales
for _ in 1 2 3 4 5 6; do
  if curl -fsS "${insecure[@]}" -o /dev/null --max-time 8 --resolve "$domain:$port:127.0.0.1" "https://$domain:$port/health" 2>/dev/null; then ok=1; break; fi
  sleep 10
done
if [ "$ok" = 1 ]; then log "HTTPS público verificado en https://$domain"
else log "AVISO: HTTPS de $domain aún no verificado (¿DNS apuntando a este servidor? Caddy reintenta solo)"; fi

# --- Cierre -----------------------------------------------------------------
prev="$(cat "$BASE_DIR/current-tag" 2>/dev/null || true)"
[ -z "$prev" ] || [ "$prev" = "$sha" ] || echo "$prev" >"$BASE_DIR/previous-tag"
echo "$sha" >"$BASE_DIR/current-tag"
echo "$db_tag" >"$BASE_DIR/current-db-tag"
ln -sfn "$(dirname "$here")" "$BASE_DIR/current"

# Conserva las 3 versiones más recientes y limpia imágenes sin uso de más de 7 días.
# shellcheck disable=SC2012
mapfile -t old < <(ls -1dt "$BASE_DIR"/releases/*/ 2>/dev/null | tail -n +4 || true)
for d in "${old[@]}"; do rm -rf "$d"; done
docker image prune -af --filter "until=168h" >/dev/null
log "OK: versión ${sha:0:12} desplegada"
