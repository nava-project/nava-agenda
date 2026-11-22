#!/usr/bin/env bash
# Detiene el Jenkins LOCAL de evaluación.
#
#   tools/ci/local/down.sh            detiene Jenkins y conserva sus datos (builds, logs)
#   tools/ci/local/down.sh --borrar   además borra sus datos, los contenedores de checks
#                                     que hayan quedado y el volumen de caché de los checks
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NAVA_REPO="$(cd "$here/../../.." && pwd)"
export NAVA_JENKINS_HOME="${NAVA_JENKINS_HOME:-$HOME/.nava-jenkins-local}"

docker compose -f "$here/compose.yaml" down --remove-orphans

if [ "${1:-}" = --borrar ]; then
  ids="$(docker ps -aq --filter label=nava-ci=1)"
  [ -n "$ids" ] && docker rm -f -v $ids >/dev/null
  docker volume rm nava-ci-cache >/dev/null 2>&1 || true
  # Los datos son del UID 1000: se borran desde un contenedor.
  if [ -d "$NAVA_JENKINS_HOME" ]; then
    docker run --rm -v "$(dirname "$NAVA_JENKINS_HOME"):/padre" alpine:3.20 \
      rm -rf "/padre/$(basename "$NAVA_JENKINS_HOME")"
  fi
  echo "Jenkins local detenido y sus datos borrados."
else
  echo "Jenkins local detenido. Sus datos siguen en $NAVA_JENKINS_HOME."
fi
