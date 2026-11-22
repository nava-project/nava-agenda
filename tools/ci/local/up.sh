#!/usr/bin/env bash
# Levanta el Jenkins LOCAL de evaluación con el job «nava-agenda» ya creado.
#
# Uso (desde la raíz de la copia clonada):
#   tools/ci/local/up.sh
#
# Variables opcionales:
#   NAVA_JENKINS_PORT      puerto en 127.0.0.1 (8090)
#   NAVA_JENKINS_USER      usuario de Jenkins (admin)
#   NAVA_JENKINS_PASSWORD  contraseña de Jenkins (nava-local)
#   NAVA_RAMA              rama de la copia local que construye el job (main)
#   NAVA_JENKINS_HOME      datos de Jenkins ($HOME/.nava-jenkins-local)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"

command -v docker >/dev/null || { echo "Falta Docker: instálalo y vuelve a intentar." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker no responde: arráncalo o agrega tu usuario al grupo docker." >&2; exit 1; }
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "$repo no es una copia de git." >&2; exit 1; }

# El socket del Docker que estás usando (Docker en Linux, rootless o Docker Desktop).
sock="$(docker context inspect -f '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
sock="${sock#unix://}"
[ -S "$sock" ] || sock=/var/run/docker.sock
export NAVA_DOCKER_SOCK="$sock"
export NAVA_REPO="$repo"
export NAVA_JENKINS_HOME="${NAVA_JENKINS_HOME:-$HOME/.nava-jenkins-local}"
export NAVA_JENKINS_PORT="${NAVA_JENKINS_PORT:-8090}"
export NAVA_JENKINS_USER="${NAVA_JENKINS_USER:-admin}"
export NAVA_JENKINS_PASSWORD="${NAVA_JENKINS_PASSWORD:-nava-local}"
export NAVA_RAMA="${NAVA_RAMA:-main}"

# El controlador y los checks corren con el UID 1000 (como en la VPS): su carpeta de datos
# tiene que ser suya aunque tu usuario tenga otro UID.
mkdir -p "$NAVA_JENKINS_HOME"
docker run --rm -v "$NAVA_JENKINS_HOME:/home-jenkins" alpine:3.20 chown 1000:1000 /home-jenkins

echo "== construyendo y levantando Jenkins (la primera vez tarda unos minutos)"
docker compose -f "$here/compose.yaml" up -d --build --wait

url="http://localhost:$NAVA_JENKINS_PORT/job/nava-agenda/"
cat <<EOF

Jenkins listo.
  URL:        $url
  Usuario:    $NAVA_JENKINS_USER
  Contraseña: $NAVA_JENKINS_PASSWORD
  Job:        nava-agenda (rama $NAVA_RAMA de $repo)

Lanza un build con «Construir con parámetros» → «Construir».
Para detenerlo: tools/ci/local/down.sh   (con --borrar también elimina sus datos)
EOF
