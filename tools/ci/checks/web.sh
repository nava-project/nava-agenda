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
# Hardware de la VPS (DEC-177): sus vCPU son ~2 veces más lentas que las de los runners de
# GitHub (SettingsPage.test.ts: 158 s con un proceso frente a 77 s), y las pruebas más
# pesadas de jsdom + axe rondan los 5 s por defecto de vitest aun sin concurrencia. Se da el
# mismo presupuesto en proporción, 10 s por prueba; ninguna aserción cambia. Dos procesos
# tardan lo mismo que uno; con tres (el valor por defecto aquí) se estorban entre sí.
echo "== test:unit"
pnpm run test:unit --maxWorkers="${VITEST_MAX_WORKERS:-2}" --minWorkers=1 --testTimeout=10000
echo "== build"
pnpm run build
