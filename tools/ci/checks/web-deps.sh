#!/usr/bin/env bash
# Dependencias del frontend para los checks web-static y web-test del CI (DEC-177, #625).
# Se instalan una sola vez antes de que esos dos corran en paralelo sobre el mismo
# node_modules. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
echo "== pnpm install (lockfile inmutable)"
pnpm install --frozen-lockfile
