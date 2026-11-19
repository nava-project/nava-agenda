#!/usr/bin/env bash
# Ejecuta un check del CI dentro de la imagen de herramientas (DEC-177).
#
# Lo invoca el Jenkinsfile desde el controlador de Jenkins, que habla con el Docker del
# host. El workspace vive en la misma ruta dentro del controlador y en el host
# (/srv/jenkins/home), así que el Docker del host puede montarlo. Dentro del check se monta
# siempre en /workspace: las cachés de Go (pruebas incluidas) dependen de la ruta, y con una
# ruta fija un PR reutiliza lo que ya compiló y probó main (#625).
#
# Uso:
#   tools/ci/run.sh image                       construye la imagen si falta
#   tools/ci/run.sh <check> [--postgres]        corre tools/ci/checks/<check>.sh
#     --postgres  levanta un PostgreSQL 14 efímero (datos en tmpfs) y corre el check en
#                 su espacio de red: la base queda en localhost:5432 (postgres/postgres),
#                 igual que el `services: postgres` que usaba GitHub Actions.
#
# Los checks comparten la VPS con la producción: corren con prioridad de CPU baja
# (--cpu-shares 512 frente a 1024 de los servicios en vivo) y con memoria acotada. Sin
# cuota fija de CPU (--cpus): Node y Go dimensionan sus hilos por los núcleos del host, y
# una cuota menor los estrangula (las pruebas de vitest agotaban su timeout de 5 s).
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

# Go y las pruebas del frontend corren a la vez que el resto (#625). Son topes contra un
# check desbocado, no reservas: el pico real medido de todos juntos está en
# nava-docs/agenda/deploy/README.md (sección 5) y cabe en la memoria libre del VPS.
case "$check" in
  go)         limits=(--memory 3g) ;;
  web-test)   limits=(--memory 2560m) ;;
  web-static) limits=(--memory 2g) ;;
  *)          limits=(--memory 1g) ;;
esac

# Nombre único por ejecución: BUILD_TAG lo da Jenkins (p. ej. jenkins-agenda-ci-main-12).
name="nava-ci-$(printf '%s-%s' "${BUILD_TAG:-local-$$}" "$check" | tr -c 'a-zA-Z0-9_.-' '-' | cut -c1-100)"
cleanup() { docker rm -f -v "$name" "$name-pg" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 143' INT TERM

net=()
if [ "$postgres" = 1 ]; then
  docker run -d --name "$name-pg" --label nava-ci=1 \
    --cpu-shares 512 --memory 768m \
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
  -v "$root:/workspace" -w /workspace \
  -v nava-ci-cache:/cache \
  "${net[@]}" \
  "$tag" "tools/ci/checks/$check.sh"
