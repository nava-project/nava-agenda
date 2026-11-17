#!/usr/bin/env bash
# Check "Frontend: formato, lint y tipos" del CI en Jenkins (DEC-177, #625).
# Requiere web-deps.sh. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza
# tools/ci/run.sh, en paralelo con web-test.sh.
#
# El build de producción (`pnpm run build`) no se repite aquí: lo ejecuta
# deploy/docker/web.Dockerfile en la etapa de imágenes, que tools/ci/plan.sh activa siempre
# que cambia apps/web (y en main, siempre). Compilarlo dos veces solo quitaba CPU a vitest.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
for script in format lint typecheck; do
  echo "== $script"
  pnpm run "$script"
done
