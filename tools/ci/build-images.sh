#!/usr/bin/env bash
# Construye las imágenes de NAVA (backend, web y base) en el Docker de la VPS (DEC-177).
#
# No hay registro intermedio: Jenkins construye en el mismo Docker que ejecuta la pila,
# así que deploy.sh usa las imágenes locales (--no-pull). Los nombres conservan el
# prefijo del registro (NAVA_REGISTRY, por defecto ghcr.io/bcaceres19) para que
# compose.yaml y las versiones anteriores sigan resolviéndose igual.
#
# Uso:
#   build-images.sh check   <contexto>          valida que las tres imágenes construyen
#   build-images.sh release <contexto> <sha>    etiqueta backend/web con el SHA y la base
#                                               con su hash de contenido; escribe
#                                               DB_TAG=<tag> en <contexto>/.nava-release
# <contexto> es un checkout del repositorio (en `release`, exactamente en <sha>).
#
# La imagen de la base se versiona por contenido (deploy/db, deploy/backup y su
# Dockerfile) y NUNCA se reconstruye si su etiqueta ya existe: otra compilación del
# mismo contenido daría otro ID de imagen y compose recrearía PostgreSQL sin motivo.
# La clave de NAVEGADOR de Google Maps (pública por diseño, restringida por dominio)
# llega en VITE_GOOGLE_MAPS_BROWSER_KEY y solo se usa en la imagen web.
set -euo pipefail

mode="${1:?uso: build-images.sh check|release <contexto> [sha]}"
ctx="$(cd "${2:?falta el contexto}" && pwd)"
registry="${NAVA_REGISTRY:-ghcr.io/bcaceres19}"

build() { # <nombre> <dockerfile> <etiqueta> [build-args...]
  local name="$1" file="$2" tag="$3"; shift 3
  echo "== imagen $name → $tag"
  docker build -f "$ctx/$file" -t "$tag" \
    --label "org.opencontainers.image.revision=$(git -C "$ctx" rev-parse HEAD)" \
    "$@" "$ctx"
}
maps=(--build-arg "VITE_GOOGLE_MAPS_BROWSER_KEY=${VITE_GOOGLE_MAPS_BROWSER_KEY:-}")

case "$mode" in
  check)
    build backend deploy/docker/backend.Dockerfile nava-ci-check/backend:latest
    build web deploy/docker/web.Dockerfile nava-ci-check/web:latest "${maps[@]}"
    build db deploy/docker/db.Dockerfile nava-ci-check/db:latest
    ;;
  release)
    sha="${3:?falta el sha}"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "sha inválido: $sha" >&2; exit 2; }
    [ "$(git -C "$ctx" rev-parse HEAD)" = "$sha" ] || { echo "el contexto no está en $sha" >&2; exit 2; }
    # Misma fórmula que usaba el workflow de GitHub: no cambia la etiqueta en producción.
    db_tag="$(git -C "$ctx" rev-parse "$sha:deploy/db" "$sha:deploy/backup" "$sha:deploy/docker/db.Dockerfile" | sha1sum | cut -c1-12)"
    for name in backend web; do
      tag="$registry/nava-agenda-$name:$sha"
      if docker image inspect "$tag" >/dev/null 2>&1; then echo "== imagen $name ya existe ($tag)"; continue; fi
      extra=(); [ "$name" = web ] && extra=("${maps[@]}")
      build "$name" "deploy/docker/$name.Dockerfile" "$tag" "${extra[@]}"
    done
    tag="$registry/nava-agenda-db:$db_tag"
    if docker image inspect "$tag" >/dev/null 2>&1; then echo "== imagen db ya existe ($tag)"
    else build db deploy/docker/db.Dockerfile "$tag"; fi
    echo "DB_TAG=$db_tag" >"$ctx/.nava-release"
    ;;
  *) echo "modo desconocido: $mode" >&2; exit 2 ;;
esac
