#!/usr/bin/env bash
# Decide qué checks del CI necesita un commit (DEC-177, #625). Corre en el controlador de
# Jenkins, en el workspace, antes de los checks.
#
#   tools/ci/plan.sh          escribe .ci-plan/<check> por cada check que hay que correr
#   tools/ci/plan.sh record   tras un CI en verde: marca el árbol de git como verificado
#
# Dos reglas, de más a menos fuerte:
#
# 1. Árbol ya verificado. El resultado de los checks depende solo del contenido del
#    repositorio, que identifica el hash del árbol de git (no el del commit). Si un CI
#    completo ya pasó con ese mismo árbol, no se repite. Es el caso del squash-merge de un
#    PR al día con main: el commit de main tiene exactamente el árbol que el PR ya probó.
#
# 2. Solo lo afectado. Se compara con la base (en un PR, el main con el que Jenkins lo
#    fusiona; en main, el commit anterior) y cada archivo cambiado activa los checks que lo
#    leen. Un archivo que no encaja en ninguna regla, o un cambio del propio CI, activa
#    todos: ante la duda se prueba de más, nunca de menos. En main solo se aplica si el
#    commit anterior está verificado, para que lo omitido esté cubierto por ese CI.
#
# Un árbol se registra como verificado si todos los checks corrieron o si lo omitido estaba
# cubierto por una base verificada. Registro: $JENKINS_HOME/nava-ci-green/<árbol>.
set -euo pipefail

plan=.ci-plan
store="${CI_GREEN_DIR:-${JENKINS_HOME:?}/nava-ci-green}"
all_checks=(go openapi database deploy web images)

tree="$(git rev-parse 'HEAD^{tree}')"
verified() { [ -n "$1" ] && [ -e "$store/$1" ]; }

if [ "${1:-}" = record ]; then
  [ -e "$plan/.recordable" ] || { echo "plan parcial sin base verificada: el árbol no se registra"; exit 0; }
  mkdir -p "$store"
  date -u +%FT%TZ >"$store/$tree"
  # Solo se conserva lo reciente: un árbol viejo ya no vuelve a aparecer.
  find "$store" -type f -mtime +30 -delete
  echo "árbol ${tree:0:12} verificado"
  exit 0
fi

rm -rf "$plan"; mkdir -p "$plan"
run() { for c in "$@"; do : >"$plan/$c"; done; }
summary() { echo "$*" | tee "$plan/.summary"; }

if verified "$tree"; then
  summary "árbol ${tree:0:12} ya verificado por un CI anterior: sin checks"
  : >"$plan/.recordable"
  exit 0
fi

# Base: en un PR con estrategia de fusión, HEAD es el merge y su primer padre es main; en
# main (squash), el commit anterior.
base=""
if [ "$(git rev-list --parents -n 1 HEAD | wc -w)" -ge 2 ]; then base="$(git rev-parse HEAD^1)"; fi
on_main=0; [ "${BRANCH_NAME:-}" = main ] && on_main=1
base_tree=""; [ -n "$base" ] && base_tree="$(git rev-parse "$base^{tree}")"

everything() { run "${all_checks[@]}"; : >"$plan/.recordable"; summary "todos los checks: $1"; exit 0; }
[ -n "$base" ] || everything "sin commit base"
if [ "$on_main" = 1 ] && ! verified "$base_tree"; then everything "el commit anterior de main no está verificado"; fi

declare -A need=()
while IFS= read -r f; do
  case "$f" in
    Jenkinsfile|tools/ci/*|.gitattributes)
      everything "cambia el propio CI o el checkout ($f)" ;;
    # Solo documentación y material de agentes: ningún check lo lee.
    docs/*|.agents/*|.claude/*|.github/*|tools/ai/*|tools/mockups/*|tools/qa/*|respuesta-manuales/*|.gitignore) ;;
    *.md|*.docx|*.txt)
      case "$f" in */*) everything "documento dentro de código ($f)" ;; esac ;;
    apps/web/*) need[web]=1; need[images]=1 ;;
    apps/api/*) need[go]=1; need[images]=1 ;;
    # Las pruebas de contrato de Go leen la especificación.
    api/*) need[openapi]=1; need[go]=1 ;;
    package.json|pnpm-lock.yaml|redocly.yaml) need[openapi]=1 ;;
    # Go aplica las migraciones y el testdata antes de sus pruebas.
    database/*) need[database]=1; need[go]=1 ;;
    deploy/*) need[deploy]=1; need[images]=1 ;;
    *) everything "archivo sin regla ($f)" ;;
  esac
done < <(git diff --name-only --no-renames "$base" HEAD)

[ "${#need[@]}" -gt 0 ] && run "${!need[@]}"
# Lo omitido queda cubierto si la base estaba verificada.
verified "$base_tree" && : >"$plan/.recordable"
if [ "${#need[@]}" -eq 0 ]; then
  summary "solo documentación frente a ${base:0:12}: sin checks"
else
  summary "checks afectados frente a ${base:0:12}: $(printf '%s\n' "${!need[@]}" | sort | xargs)"
fi
