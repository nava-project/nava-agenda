#!/usr/bin/env bash
# Check "OpenAPI (lint + bundle)" del CI en Jenkins (DEC-177).
# Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
echo "== pnpm install (lockfile inmutable)"
pnpm install --frozen-lockfile
for script in openapi:check-config openapi:lint openapi:bundle; do
  echo "== $script"
  pnpm run "$script"
done
