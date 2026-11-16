#!/usr/bin/env bash
# Check "Frontend (lint, tipos, pruebas, build)" del CI en Jenkins (DEC-177).
# Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
echo "== pnpm install (lockfile inmutable)"
pnpm install --frozen-lockfile
for script in format lint typecheck; do
  echo "== $script"
  pnpm run "$script"
done
# vitest abre por defecto un proceso por núcleo menos uno (3 en la VPS). Con las vCPU de la
# VPS, tres pruebas pesadas de jsdom + axe a la vez superan el timeout de 5 s; con dos
# tardan lo mismo que con una. Los runners privados de GitHub (2 vCPU) usaban uno.
echo "== test:unit"
pnpm run test:unit --maxWorkers="${VITEST_MAX_WORKERS:-2}" --minWorkers=1
echo "== build"
pnpm run build
