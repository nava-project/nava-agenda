#!/usr/bin/env bash
# Ejecuta un check del CI dentro de la imagen de herramientas (DEC-177).
#
# Lo invoca el Jenkinsfile desde el controlador de Jenkins, que habla con el Docker del
# host. El workspace vive en la misma ruta dentro del controlador y en el host
# (/srv/jenkins/home), por eso se monta tal cual en el contenedor del check.
#
# Uso:
#   tools/ci/run.sh image                       construye la imagen si falta
#   tools/ci/run.sh <check> [--postgres]        corre tools/ci/checks/<check>.sh
#     --postgres  levanta un PostgreSQL 14 efímero (datos en tmpfs) y corre el check en
#                 su espacio de red: la base queda en localhost:5432 (postgres/postgres),
#                 igual que el `services: postgres` que usaba GitHub Actions.
#
# Los checks corren con baja prioridad de CPU (--cpu-shares 512 frente a 1024 de la
# producción) y con límites propios, porque comparten la VPS con los servicios en vivo.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tag="nava-ci-tools:$(sha1sum "$root/tools/ci/ci.Dockerfile" | cut -c1-12)"
check="${1:?uso: run.sh image | run.sh <check> [--postgres]}"
postgres=0
[ "${2:-}" = --postgres ] && postgres=1

build_image() {
  docker image inspect "$tag" >/dev/null 2>&1 && return 0
  echo "Construyendo $tag"
  docker build --pull -t "$tag" -f "$root/tools/ci/ci.Dockerfile" "$root/tools/ci"
}

if [ "$check" = image ]; then build_image; exit 0; fi
[ -x "$root/tools/ci/checks/$check.sh" ] || { echo "check desconocido: $check" >&2; exit 2; }
build_image

case "$check" in
  go)       limits=(--cpus 2 --memory 3g) ;;
  web)      limits=(--cpus 1.5 --memory 2g) ;;
  database) limits=(--cpus 1 --memory 1g) ;;
  *)        limits=(--cpus 1 --memory 1g) ;;
esac

# Nombre único por ejecución: BUILD_TAG lo da Jenkins (p. ej. jenkins-barberia-ci-main-12).
name="nava-ci-$(printf '%s-%s' "${BUILD_TAG:-local-$$}" "$check" | tr -c 'a-zA-Z0-9_.-' '-' | cut -c1-100)"
cleanup() { docker rm -f -v "$name" "$name-pg" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 143' INT TERM

net=()
if [ "$postgres" = 1 ]; then
  docker run -d --name "$name-pg" --label nava-ci=1 \
    --cpu-shares 512 --cpus 1 --memory 768m \
    --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_PASSWORD=postgres \
    postgres:14 >/dev/null
  # Por TCP: el servidor temporal del init de la imagen solo escucha por socket, así que
  # esto no da por lista una base que todavía se va a reiniciar.
  for i in $(seq 1 60); do
    docker exec "$name-pg" pg_isready -q -h 127.0.0.1 -U postgres && break
    [ "$i" = 60 ] && { docker logs "$name-pg"; echo "PostgreSQL no arrancó" >&2; exit 1; }
    sleep 1
  done
  net=(--network "container:$name-pg")
fi

docker run --rm --init --name "$name" --label nava-ci=1 \
  --user 1000:1000 --security-opt label=disable \
  --cpu-shares 512 "${limits[@]}" \
  -v "$root:$root" -w "$root" \
  -v nava-ci-cache:/cache \
  "${net[@]}" \
  "$tag" "tools/ci/checks/$check.sh"
