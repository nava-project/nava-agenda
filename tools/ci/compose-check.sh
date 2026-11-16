#!/usr/bin/env bash
# Parte del check "Despliegue" del CI en Jenkins (DEC-177): compose.yaml de la pila de
# NAVA y de Jenkins son válidos. Los env_file y secretos viven fuera del repositorio;
# basta con que existan vacíos.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
touch "$tmp"/{db,app,backup}.env
IMAGE_TAG=ci DB_IMAGE_TAG=ci DOMAIN=example.test ACME_EMAIL=ci@example.test \
NAVA_ENV_DIR="$tmp" NAVA_SECRETS_DIR="$tmp" \
  docker compose -f "$root/deploy/compose.yaml" --profile tools config -q
echo "deploy/compose.yaml válido"
DOCKER_GID=990 docker compose -f "$root/deploy/jenkins/compose.yaml" config -q
echo "deploy/jenkins/compose.yaml válido"
