#!/usr/bin/env bash
# Check "Frontend: formato, lint y tipos" del CI en Jenkins (DEC-177, #625).
# Requiere web-deps.sh. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza
# tools/ci/run.sh, en paralelo con web-test.sh.
#
# El build de producción (`pnpm run build`) no se repite aquí: lo ejecuta
# deploy/docker/web.Dockerfile en la etapa de imágenes, que tools/ci/plan.sh activa siempre
# que cambia apps/web (y en main, siempre). Compilarlo dos veces solo quitaba CPU a vitest.
#
# Prettier y ESLint guardan una caché por contenido en node_modules/.cache del workspace:
# al reconstruir la misma rama o PR solo revisan los archivos que cambiaron. La clave es el
# contenido del archivo y la configuración, así que nunca omite un archivo modificado.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
echo "== format"
pnpm run format --cache --cache-strategy content
echo "== lint"
pnpm run lint --cache --cache-strategy content --cache-location node_modules/.cache/eslint/
echo "== typecheck"
pnpm run typecheck
