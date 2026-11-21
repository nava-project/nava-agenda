#!/usr/bin/env bash
# Check «Pruebas unitarias · Plan de Pruebas (CP)» del CI en Jenkins (#784).
#
# Corre las pruebas unitarias dedicadas a los casos del Plan de Pruebas PP-NAVA-001
# (Ingeniería de Software III): las de Go se llaman TestCP0XX_* y las de Vitest viven en
# archivos *.cp.test.ts con un describe('CP-0XX …'). No necesita PostgreSQL ni
# credenciales. Deja en reports/plan-pruebas/:
#   go-junit.xml, web-junit.xml   resultados en JUnit, que publica el paso `junit`
#   cobertura/resumen.txt         cobertura unitaria por paquete crítico (CP-NF07)
#   cobertura/go.out, go.html     perfil de cobertura de Go y su vista HTML
#   pnpm-audit.txt                auditoría de dependencias del frontend (CP-NF07)
# La cobertura y la auditoría se informan sin bloquear todavía; el umbral de CP-NF07
# (≥ 85 %) llega en un cambio aparte. Lo que sí bloquea es cualquier prueba CP en rojo.
#
# Requiere web-deps.sh. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza
# tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
out=reports/plan-pruebas
rm -rf "$out"
mkdir -p "$out/cobertura"
root="$PWD"

# Paquetes críticos de CP-NF07 cuya cobertura se mide con pruebas unitarias.
critical=(
  ./internal/modules/booking/           # reservas
  ./internal/modules/publicbooking/     # reservas
  ./internal/modules/schedule/          # horarios
  ./internal/modules/availability/      # horarios
  ./internal/modules/auth/              # autenticación
  ./internal/modules/notification/      # notificaciones
  ./internal/modules/appointmentnotice/ # notificaciones
)

status=0

echo "== Go: pruebas CP (go test -race -run '^TestCP')"
(
  cd apps/api
  go install gotest.tools/gotestsum@v1.12.3
  "$(go env GOPATH)/bin/gotestsum" --format testname --junitfile "$root/$out/go-junit.xml" \
    -- -race -count=1 -run '^TestCP' ./...
) || status=1

echo "== Vitest: pruebas CP (*.cp.test.ts, describe 'CP-')"
(
  cd apps/web
  TZ=UTC pnpm exec vitest run cp.test -t 'CP-' --pool=threads --testTimeout=10000 \
    --reporter=default --reporter=junit --outputFile.junit="$root/$out/web-junit.xml"
) || status=1

echo "== Cobertura unitaria de los paquetes críticos (CP-NF07, informativa)"
(
  cd apps/api
  go test -count=1 -cover -coverprofile="$root/$out/cobertura/go.out" "${critical[@]}" \
    | tee "$root/$out/cobertura/go-test.txt"
  go tool cover -html="$root/$out/cobertura/go.out" -o "$root/$out/cobertura/go.html"
) || status=1
{
  echo "Cobertura unitaria por paquete crítico (meta CP-NF07: >= 85 %)"
  sed -nE 's#^ok[[:space:]]+nava-agenda/internal/([^[:space:]]+).*coverage: ([0-9.]+)% of statements.*#\1 \2#p' \
    "$out/cobertura/go-test.txt" |
    while read -r pkg pct; do
      meta=$(awk -v p="$pct" 'BEGIN { print (p >= 85 ? "cumple" : "por debajo") }')
      printf '%-32s %6s %%  %s\n' "$pkg" "$pct" "$meta"
    done
  echo "Aislamiento (RLS por tenant) se prueba con PostgreSQL real en las etapas Go y Atlas + suites SQL."
} | tee "$out/cobertura/resumen.txt"

echo "== pnpm audit (CP-NF07, informativa)"
(cd apps/web && pnpm audit --audit-level=high) >"$out/pnpm-audit.txt" 2>&1 &&
  echo "sin vulnerabilidades altas o críticas" ||
  echo "pnpm audit reporta hallazgos o no pudo consultar el registro: ver $out/pnpm-audit.txt"

exit "$status"
