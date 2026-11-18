#!/usr/bin/env bash
# Guarda o reemplaza un secreto del Jenkins de la VPS (DEC-177) sin exponerlo. Como root.
#
# El valor NUNCA se pasa como argumento (quedaría en el historial y en `ps`): se lee
# de la entrada estándar. En una terminal pide el valor sin eco; con una tubería lo
# toma tal cual, sin el salto de línea final.
#
#   sudo bash jenkins-secret-set.sh GITHUB_TOKEN               # pide el valor sin eco
#   gh auth token | ssh nava-vps 'sudo bash .../jenkins-secret-set.sh GITHUB_TOKEN'
#
# Jenkins lee los secretos al arrancar: aplícalo con `sudo bash jenkins-up.sh --restart`.
set -euo pipefail
umask 077

secrets=/srv/jenkins/secrets
name="${1:?uso: jenkins-secret-set.sh <NOMBRE>}"
[ "$(id -u)" = 0 ] || { echo "ejecútalo con sudo" >&2; exit 1; }
[[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "nombre inválido: $name" >&2; exit 2; }
[ -d "$secrets" ] || { echo "no existe $secrets (ejecuta jenkins-init.sh)" >&2; exit 1; }

if [ -t 0 ]; then
  read -rsp "Valor de $name (sin eco): " value; echo >&2
else
  value="$(cat)"
fi
[ -n "$value" ] || { echo "valor vacío: no se guarda nada" >&2; exit 1; }

# Escritura atómica con permisos restrictivos desde el primer byte.
tmp="$(mktemp "$secrets/.tmp.XXXXXX")"
printf '%s' "$value" >"$tmp"
chown 1000:1000 "$tmp"; chmod 600 "$tmp"
mv "$tmp" "$secrets/$name"
echo "Secreto $name guardado (${#value} caracteres)." >&2
