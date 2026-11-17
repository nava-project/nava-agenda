#!/usr/bin/env bash
# Check "Frontend (formato, lint, tipos, build)" del CI en Jenkins (DEC-177, #625).
# Requiere web-deps.sh. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza
# tools/ci/run.sh, en paralelo con web-test.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
for script in format lint typecheck; do
  echo "== $script"
  pnpm run "$script"
done
# `pnpm run build` es `vue-tsc -b && vite build`: la comprobación de tipos acaba de correr
# (mismo `vue-tsc -b`), así que aquí solo se empaqueta.
echo "== build (vite)"
pnpm exec vite build
