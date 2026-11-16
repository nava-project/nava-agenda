#!/usr/bin/env bash
# Construye y (re)arranca el Jenkins de la VPS (DEC-177). Como root (sudo), desde la
# carpeta deploy/jenkins copiada al servidor (ver deploy/jenkins/README.md).
#
#   sudo bash jenkins-up.sh             construye la imagen y aplica cambios
#   sudo bash jenkins-up.sh --restart   además reinicia (p. ej. tras cambiar un secreto)
#
# La configuración como código se aplica en cada arranque; un cambio de plugins o de
# casc/ exige reconstruir, que es lo que hace este script.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "ejecútalo con sudo" >&2; exit 1; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file=/srv/jenkins/stack.env
[ -f "$env_file" ] || { echo "falta $env_file (ejecuta jenkins-init.sh)" >&2; exit 1; }
for name in GITHUB_TOKEN MAPS_BROWSER_KEY; do
  [ -s "/srv/jenkins/secrets/$name" ] || { echo "falta el secreto $name (jenkins-secret-set.sh $name)" >&2; exit 1; }
done

docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
compose=(docker compose --env-file "$env_file" -f "$here/compose.yaml")
"${compose[@]}" build --pull
if [ "${1:-}" = --restart ]; then
  "${compose[@]}" up -d --force-recreate --wait --wait-timeout 300
else
  "${compose[@]}" up -d --wait --wait-timeout 300
fi
"${compose[@]}" ps
