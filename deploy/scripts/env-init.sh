#!/usr/bin/env bash
# Prepara la configuración y los secretos que usa Docker Compose en el VPS.
#
# CONFIGURACIÓN (sin secretos) en /srv/barberia/env/, cargada con `env_file`:
#   stack.env    interpolación de compose (dominio, registro, rutas, puertos)
#   db.env       usuario y nombre de la base
#   app.env      API y worker (entorno, proxies, proveedores no sensibles)
#   backup.env   servicio de respaldos
#
# SECRETOS en /srv/barberia/secrets/<servicio>/<NOMBRE>, un archivo por secreto
# (modo 600, carpetas 700). Docker monta cada carpeta en /run/secrets del servicio
# correspondiente y `with-secrets` exporta cada archivo como variable de entorno:
#   db/      POSTGRES_PASSWORD, NAVA_{MIGRATOR,APP,WORKER,BACKUP}_PASSWORD
#   app/     APP_DATABASE_URL, APP_WORKER_DATABASE_URL, APP_AUTH_HMAC_SECRET, y los
#            de proveedores (Resend, Meta, Google)
#   migrate/ DATABASE_PRODUCTION_URL, DATABASE_ADMIN_URL
#   backup/  PGPASSWORD (+ cualquier credencial de rclone que añadas)
#
# Es idempotente y NO sobrescribe: un archivo existente se conserva y sus
# contraseñas se reutilizan para generar los que falten. Los secretos que solo el
# propietario puede dar (Resend, Meta, Google) se crean vacíos; se completan con
# `secret-set.sh`, que no deja el valor en el historial ni en `ps`.
#
# Uso: env-init.sh --domain nava.wtf --acme-email correo@dominio
set -euo pipefail
umask 077

ENV_DIR="${NAVA_ENV_DIR:-/srv/barberia/env}"
SECRETS_DIR="${NAVA_SECRETS_DIR:-/srv/barberia/secrets}"
BACKUP_DIR="${NAVA_BACKUP_DIR:-/srv/barberia/backups}"
REGISTRY="${NAVA_REGISTRY:-ghcr.io/bcaceres19}"
DOMAIN=""
ACME_EMAIL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?falta el valor de --domain}"; shift 2 ;;
    --acme-email) ACME_EMAIL="${2:?falta el valor de --acme-email}"; shift 2 ;;
    --registry) REGISTRY="${2:?falta el valor de --registry}"; shift 2 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

# Los contenedores que leen secretos corren con el UID 1001 (compose.yaml): los
# archivos deben ser de ese usuario. Es el UID de `deploy` en el VPS.
if [ "$(id -u)" != 1001 ]; then
  echo "AVISO: este usuario tiene UID $(id -u), no 1001; los contenedores no podrán leer los secretos." >&2
fi

mkdir -p "$ENV_DIR" "$BACKUP_DIR" "$SECRETS_DIR"/{db,app,migrate,backup}
chmod 700 "$ENV_DIR" "$BACKUP_DIR" "$SECRETS_DIR" "$SECRETS_DIR"/{db,app,migrate,backup}

# Lee KEY de un archivo .env existente (vacío si no existe o no la tiene).
get() { [ -f "$2" ] && grep -m1 "^$1=" "$2" | cut -d= -f2- || true; }
# Lee el contenido de un secreto existente.
sget() { [ -f "$1" ] && cat "$1" || true; }
random() { openssl rand -hex "${1:-24}"; }

# Si ya hay un stack.env, el dominio y el correo salen de ahí.
[ -n "$DOMAIN" ] || DOMAIN="$(get DOMAIN "$ENV_DIR/stack.env")"
[ -n "$ACME_EMAIL" ] || ACME_EMAIL="$(get ACME_EMAIL "$ENV_DIR/stack.env")"
[ -n "$DOMAIN" ] && [ -n "$ACME_EMAIL" ] || {
  echo "Falta --domain y/o --acme-email (primera ejecución)." >&2
  exit 2
}

write_config() { # write_config <archivo> ; contenido por stdin
  local f="$ENV_DIR/$1"
  if [ -e "$f" ]; then echo "  = $1 ya existe (se conserva)"; cat >/dev/null
  else cat >"$f"; chmod 600 "$f"; echo "  + $1 creado"; fi
}

# write_secret <carpeta> <NOMBRE> <valor|"">: crea el archivo solo si no existe.
write_secret() {
  local f="$SECRETS_DIR/$1/$2"
  if [ -e "$f" ]; then echo "  = $1/$2 ya existe (se conserva)"
  else printf '%s' "$3" >"$f"; chmod 600 "$f"; echo "  + $1/$2 creado"; fi
}

# Contraseñas: se reutilizan si ya existen, para que los demás archivos queden
# coherentes con la base ya inicializada.
pw() { local v; v="$(sget "$SECRETS_DIR/db/$1")"; printf '%s' "${v:-$(random)}"; }
PG_PW="$(pw POSTGRES_PASSWORD)"
MIG_PW="$(pw NAVA_MIGRATOR_PASSWORD)"
APP_PW="$(pw NAVA_APP_PASSWORD)"
WRK_PW="$(pw NAVA_WORKER_PASSWORD)"
BAK_PW="$(pw NAVA_BACKUP_PASSWORD)"

echo "Configuración en $ENV_DIR"

write_config stack.env <<EOF
# Interpolación de compose. IMAGE_TAG y DB_IMAGE_TAG los fija deploy.sh en cada despliegue.
NAVA_REGISTRY=$REGISTRY
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
NAVA_ENV_DIR=$ENV_DIR
NAVA_SECRETS_DIR=$SECRETS_DIR
NAVA_BACKUP_DIR=$BACKUP_DIR
HTTP_PORT=80
HTTPS_PORT=443
EOF

write_config db.env <<EOF
POSTGRES_USER=postgres
POSTGRES_DB=nava
EOF

write_config app.env <<EOF
# API y worker (apps/api/internal/platform/config). SIN secretos: esos van en
# $SECRETS_DIR/app/. Valores literales, sin comillas.
APP_ENVIRONMENT=production
APP_HTTP_ADDR=:8080
APP_LOG_LEVEL=info
APP_DATABASE_MAX_CONNS=20
APP_DATABASE_MIN_CONNS=2
# Único proxy de confianza: Caddy, con IP fija en la red interna (deploy/compose.yaml).
APP_TRUSTED_PROXIES=10.89.1.2/32
APP_PUBLIC_WEB_BASE_URL=https://$DOMAIN

# --- OBLIGATORIOS en producción: el API no arranca sin ellos (DEC-066, DEC-124) ---
OTP_PROVIDER=meta
APP_RESEND_FROM_ADDRESS=no-responder@$DOMAIN
APP_META_WHATSAPP_API_VERSION=v24.0
APP_META_WHATSAPP_PHONE_NUMBER_ID=
APP_META_WHATSAPP_MODE=template
APP_META_WHATSAPP_TEMPLATE_NAME=
APP_META_WHATSAPP_LANGUAGE_CODE=es

# --- Opcionales ---
# Google Calendar: o se configuran las cuatro variables (client id, client secret,
# redirect URI y llave de cifrado; las dos últimas sensibles van en secretos) o ninguna.
# URI de redirección a registrar en Google Cloud: https://$DOMAIN/panel/barberia/google-calendar/callback
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_REDIRECT_URI=
EOF

write_config backup.env <<EOF
PGHOST=db
PGPORT=5432
PGUSER=barberia_backup
PGDATABASE=nava
PGSSLMODE=require
BACKUP_DIR=/backups
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_KEEP=7
BACKUP_HOUR_UTC=3
# Copia externa opcional: remoto de rclone (p. ej. b2:mi-bucket/nava). Sus credenciales
# se guardan como secretos en $SECRETS_DIR/backup/ (RCLONE_CONFIG_<REMOTO>_*).
BACKUP_RCLONE_REMOTE=
EOF

echo "Secretos en $SECRETS_DIR"
write_secret db POSTGRES_PASSWORD "$PG_PW"
write_secret db NAVA_MIGRATOR_PASSWORD "$MIG_PW"
write_secret db NAVA_APP_PASSWORD "$APP_PW"
write_secret db NAVA_WORKER_PASSWORD "$WRK_PW"
write_secret db NAVA_BACKUP_PASSWORD "$BAK_PW"

write_secret app APP_DATABASE_URL "postgres://barberia_app:$APP_PW@db:5432/nava?sslmode=require"
write_secret app APP_WORKER_DATABASE_URL "postgres://barberia_worker:$WRK_PW@db:5432/nava?sslmode=require"
# CONSERVAR: cambiarlo invalida los HMAC ya guardados. Respáldalo fuera del servidor.
write_secret app APP_AUTH_HMAC_SECRET "$(random 32)"
for name in APP_RESEND_API_KEY APP_META_WHATSAPP_ACCESS_TOKEN \
            APP_META_WEBHOOK_VERIFY_TOKEN APP_META_APP_SECRET GOOGLE_MAPS_API_KEY \
            GOOGLE_CALENDAR_CLIENT_SECRET GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY; do
  write_secret app "$name" ""
done

# Atlas: el rol migrador aplica las migraciones; el administrador solo hace el bootstrap
# de las tres primeras (DEC-040).
write_secret migrate DATABASE_PRODUCTION_URL "postgres://barberia_migrator:$MIG_PW@db:5432/nava?sslmode=require"
write_secret migrate DATABASE_ADMIN_URL "postgres://postgres:$PG_PW@db:5432/nava?sslmode=require"

write_secret backup PGPASSWORD "$BAK_PW"

# Aviso de lo que sigue pendiente (sin imprimir ningún valor).
echo
pending=()
for n in APP_RESEND_API_KEY APP_META_WHATSAPP_ACCESS_TOKEN; do
  [ -s "$SECRETS_DIR/app/$n" ] || pending+=("secreto app/$n   →  secret-set.sh app $n")
done
for k in APP_META_WHATSAPP_PHONE_NUMBER_ID APP_META_WHATSAPP_TEMPLATE_NAME; do
  [ -n "$(get "$k" "$ENV_DIR/app.env")" ] || pending+=("configuración $k en $ENV_DIR/app.env")
done
if [ ${#pending[@]} -gt 0 ]; then
  echo "Falta completar (obligatorio en producción):"
  printf '  - %s\n' "${pending[@]}"
else
  echo "Valores obligatorios completos."
fi
