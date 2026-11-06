#!/usr/bin/env bash
# Guarda o reemplaza un secreto de Docker sin exponerlo.
#
# El valor NUNCA se pasa como argumento (quedaría en el historial y en `ps`): se lee
# de la entrada estándar. En una terminal pide el valor sin eco; con una tubería lo
# toma tal cual, sin el salto de línea final.
#
#   secret-set.sh app APP_RESEND_API_KEY              # pide el valor sin eco
#   printf '%s' "$VALOR" | secret-set.sh app NOMBRE   # desde una tubería
#
# Carpetas admitidas: `app` (API y worker) y `backup` (respaldos). Las contraseñas de
# PostgreSQL y las URL de migración las gestiona env-init.sh; rotarlas exige además
# cambiar el rol dentro de la base, y no se hace con este script.
set -euo pipefail
umask 077

SECRETS_DIR="${NAVA_SECRETS_DIR:-/srv/barberia/secrets}"
scope="${1:?uso: secret-set.sh <app|backup> <NOMBRE>}"
name="${2:?uso: secret-set.sh <app|backup> <NOMBRE>}"

case "$scope" in app | backup) ;; *) echo "carpeta no admitida: $scope (usa app o backup)" >&2; exit 2 ;; esac
[[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "nombre inválido: $name" >&2; exit 2; }
[ -d "$SECRETS_DIR/$scope" ] || { echo "no existe $SECRETS_DIR/$scope (ejecuta env-init.sh)" >&2; exit 1; }

if [ -t 0 ]; then
  read -rsp "Valor de $scope/$name (sin eco): " value; echo >&2
else
  value="$(cat)"
fi
[ -n "$value" ] || { echo "valor vacío: no se guarda nada" >&2; exit 1; }

# Escritura atómica con permisos restrictivos desde el primer byte.
tmp="$(mktemp "$SECRETS_DIR/$scope/.tmp.XXXXXX")"
printf '%s' "$value" >"$tmp"
chmod 600 "$tmp"
mv "$tmp" "$SECRETS_DIR/$scope/$name"
echo "Secreto $scope/$name guardado (${#value} caracteres)." >&2
echo "Aplícalo recreando el servicio: docker compose ... up -d --force-recreate api worker" >&2
