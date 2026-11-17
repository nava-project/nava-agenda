#!/usr/bin/env bash
# Check "Frontend: pruebas" (vitest) del CI en Jenkins (DEC-177, #625).
# Requiere web-deps.sh. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza
# tools/ci/run.sh, en paralelo con web-static.sh y el resto de checks.
#
# Hardware de la VPS (DEC-177): sus vCPU son ~2 veces más lentas que las de los runners de
# GitHub (SettingsPage.test.ts tardaba 158 s con un proceso frente a 77 s), y las pruebas
# más pesadas de jsdom + axe rondan los 5 s por defecto de vitest aun sin concurrencia. Se
# da el mismo presupuesto en proporción, 10 s por prueba; ninguna aserción cambia.
#
# Pool de hilos en vez de procesos (#625): medido en la VPS sobre la suite completa con 2
# trabajadores, 314 s frente a 351 s; cada archivo sigue aislado en su propio entorno. Con
# todos los checks a la vez, 4 trabajadores (uno por vCPU) dan 216 s frente a 236 s con 3, y
# la prueba más lenta sigue en ~5 s, la mitad del límite.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../apps/web"
workers="${VITEST_MAX_WORKERS:-4}"
echo "== test:unit (pool=threads, $workers trabajadores)"
pnpm run test:unit --pool=threads --maxWorkers="$workers" --minWorkers=1 --testTimeout=10000
