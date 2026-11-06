#!/usr/bin/env bash
# Genera los archivos de entorno que Docker Compose carga con `env_file`.
#
# Un archivo por servicio, fuera del repositorio, modo 600:
#   stack.env    interpolación de compose (dominio, registro, puertos)
#   db.env       PostgreSQL y contraseñas de los roles
#   app.env      API y worker (DSN, secretos, proveedores)
#   migrate.env  Atlas (rol migrador y administrador del bootstrap)
#   backup.env   servicio de respaldos
#
# Es idempotente y NO sobrescribe: un archivo existente se conserva tal cual y
# sus contraseñas se reutilizan para generar los que falten. Los valores que solo
# el propietario puede dar (Resend, Meta, Google) quedan vacíos; `deploy.sh` se
# niega a desplegar mientras falten los obligatorios.
#
# Uso: env-init.sh --domain nava.wtf --acme-email correo@dominio
set -euo pipefail
umask 077

ENV_DIR="${NAVA_ENV_DIR:-/srv/barberia/env}"
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

mkdir -p "$ENV_DIR" "$BACKUP_DIR"
chmod 700 "$ENV_DIR" "$BACKUP_DIR"

# Lee KEY de un archivo .env existente (vacío si no existe o no la tiene).
get() { [ -f "$2" ] && grep -m1 "^$1=" "$2" | cut -d= -f2- || true; }
secret() { openssl rand -hex "${1:-24}"; }
created=()

# Si ya hay un stack.env, el dominio y el correo salen de ahí.
[ -n "$DOMAIN" ] || DOMAIN="$(get DOMAIN "$ENV_DIR/stack.env")"
[ -n "$ACME_EMAIL" ] || ACME_EMAIL="$(get ACME_EMAIL "$ENV_DIR/stack.env")"
[ -n "$DOMAIN" ] && [ -n "$ACME_EMAIL" ] || {
  echo "Falta --domain y/o --acme-email (primera ejecución)." >&2
  exit 2
}

# Contraseñas: se reutilizan si db.env ya existe, para que los demás archivos
# queden coherentes con la base ya inicializada.
db_env="$ENV_DIR/db.env"
PG_PW="$(get POSTGRES_PASSWORD "$db_env")";       PG_PW="${PG_PW:-$(secret)}"
MIG_PW="$(get NAVA_MIGRATOR_PASSWORD "$db_env")"; MIG_PW="${MIG_PW:-$(secret)}"
APP_PW="$(get NAVA_APP_PASSWORD "$db_env")";      APP_PW="${APP_PW:-$(secret)}"
WRK_PW="$(get NAVA_WORKER_PASSWORD "$db_env")";   WRK_PW="${WRK_PW:-$(secret)}"
BAK_PW="$(get NAVA_BACKUP_PASSWORD "$db_env")";   BAK_PW="${BAK_PW:-$(secret)}"

write_new() { # write_new <archivo> ; contenido por stdin
  local f="$ENV_DIR/$1"
  if [ -e "$f" ]; then
    echo "  = $1 ya existe (se conserva)"
    cat >/dev/null
  else
    cat >"$f"
    chmod 600 "$f"
    created+=("$1")
    echo "  + $1 creado"
  fi
}

echo "Entornos en $ENV_DIR"

write_new stack.env <<EOF
# Interpolación de compose. IMAGE_TAG lo fija deploy.sh en cada despliegue.
NAVA_REGISTRY=$REGISTRY
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
NAVA_ENV_DIR=$ENV_DIR
NAVA_BACKUP_DIR=$BACKUP_DIR
HTTP_PORT=80
HTTPS_PORT=443
EOF

write_new db.env <<EOF
POSTGRES_USER=postgres
POSTGRES_DB=nava
POSTGRES_PASSWORD=$PG_PW
NAVA_MIGRATOR_PASSWORD=$MIG_PW
NAVA_APP_PASSWORD=$APP_PW
NAVA_WORKER_PASSWORD=$WRK_PW
NAVA_BACKUP_PASSWORD=$BAK_PW
EOF

write_new app.env <<EOF
# API y worker (apps/api/internal/platform/config). Valores literales: sin comillas.
APP_ENVIRONMENT=production
APP_HTTP_ADDR=:8080
APP_LOG_LEVEL=info
APP_DATABASE_URL=postgres://barberia_app:$APP_PW@db:5432/nava?sslmode=require
APP_WORKER_DATABASE_URL=postgres://barberia_worker:$WRK_PW@db:5432/nava?sslmode=require
APP_DATABASE_MAX_CONNS=20
APP_DATABASE_MIN_CONNS=2
# CONSERVAR: cambiarla invalida los HMAC ya guardados. Respáldala fuera del servidor.
APP_AUTH_HMAC_SECRET=$(secret 32)
# Único proxy de confianza: Caddy, con IP fija en la red interna (deploy/compose.yaml).
APP_TRUSTED_PROXIES=10.89.1.2/32
APP_PUBLIC_WEB_BASE_URL=https://$DOMAIN

# --- OBLIGATORIOS en producción: el API no arranca sin ellos (DEC-066, DEC-124) ---
OTP_PROVIDER=meta
APP_RESEND_API_KEY=
APP_RESEND_FROM_ADDRESS=no-responder@$DOMAIN
APP_META_WHATSAPP_API_VERSION=v24.0
APP_META_WHATSAPP_PHONE_NUMBER_ID=
APP_META_WHATSAPP_ACCESS_TOKEN=
APP_META_WHATSAPP_MODE=template
APP_META_WHATSAPP_TEMPLATE_NAME=
APP_META_WHATSAPP_LANGUAGE_CODE=es

# --- Opcionales ---
# Webhook de Meta (DEC-126): ambos o ninguno, mínimo 16 caracteres cada uno.
APP_META_WEBHOOK_VERIFY_TOKEN=
APP_META_APP_SECRET=
# Geocodificación y reseñas de Google (clave de SERVIDOR).
GOOGLE_MAPS_API_KEY=
# Google Calendar: o se configuran las cuatro o ninguna.
# URI de redirección a registrar en Google Cloud: https://$DOMAIN/panel/barberia/google-calendar/callback
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=
EOF

write_new migrate.env <<EOF
# Atlas (database/atlas.hcl, ambiente "production").
DATABASE_PRODUCTION_URL=postgres://barberia_migrator:$MIG_PW@db:5432/nava?sslmode=require
# Solo para el bootstrap de las tres primeras migraciones (DEC-040): requieren CREATEROLE.
DATABASE_ADMIN_URL=postgres://postgres:$PG_PW@db:5432/nava?sslmode=require
EOF

write_new backup.env <<EOF
PGHOST=db
PGPORT=5432
PGUSER=barberia_backup
PGPASSWORD=$BAK_PW
PGDATABASE=nava
PGSSLMODE=require
BACKUP_DIR=/backups
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_KEEP=7
BACKUP_HOUR_UTC=3
# Copia externa opcional: remoto de rclone (p. ej. b2:mi-bucket/nava) y su
# configuración por variables RCLONE_CONFIG_<REMOTO>_* (https://rclone.org/docs/).
BACKUP_RCLONE_REMOTE=
EOF

# Aviso de lo que sigue pendiente (sin imprimir ningún valor).
echo
pending=()
for k in APP_RESEND_API_KEY APP_META_WHATSAPP_PHONE_NUMBER_ID APP_META_WHATSAPP_ACCESS_TOKEN APP_META_WHATSAPP_TEMPLATE_NAME; do
  [ -n "$(get "$k" "$ENV_DIR/app.env")" ] || pending+=("$k")
done
if [ ${#pending[@]} -gt 0 ]; then
  echo "Falta completar en $ENV_DIR/app.env (obligatorio en producción):"
  printf '  - %s\n' "${pending[@]}"
else
  echo "Variables obligatorias completas."
fi
