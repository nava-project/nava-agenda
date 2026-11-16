#!/usr/bin/env bash
# Check "Frontend (lint, tipos, pruebas, build)" del CI en Jenkins (DEC-177).
# Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
echo "== pnpm install (lockfile inmutable)"
pnpm install --frozen-lockfile
for script in format lint typecheck test:unit build; do
  echo "== $script"
  pnpm run "$script"
done
