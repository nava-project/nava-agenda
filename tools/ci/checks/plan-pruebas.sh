#!/usr/bin/env bash
# Check «Pruebas unitarias · Plan de Pruebas (CP)» del CI en Jenkins (#784, #787).
#
# Corre las pruebas unitarias dedicadas a los casos del Plan de Pruebas PP-NAVA-001
# (Ingeniería de Software III): las de Go se llaman TestCP0XX_* y las de Vitest viven en
# archivos *.cp.test.ts con un describe('CP-0XX …'). No necesita PostgreSQL ni
# credenciales. Deja en reports/plan-pruebas/:
#   go-junit.xml, web-junit.xml   resultados en JUnit, que publica el paso `junit`
#   cobertura/resumen.txt         cobertura unitaria por paquete crítico (CP-NF07)
#   cobertura/go.out, go.html     perfil de cobertura de Go y su vista HTML
#   pnpm-audit.txt                auditoría de dependencias del frontend (CP-NF07)
# Bloquea (la etapa queda en rojo y no hay imágenes ni despliegue) si falla una prueba CP,
# si falla cualquier prueba unitaria de un paquete crítico o si alguno queda por debajo del
# umbral de cobertura de CP-NF07 (85 %). La auditoría de pnpm se informa sin bloquear: sus
# hallazgos están en dependencias de desarrollo y se atienden aparte.
#
# Requiere web-deps.sh. Corre dentro de la imagen tools/ci/ci.Dockerfile; lo lanza
# tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
out=reports/plan-pruebas
rm -rf "$out"
mkdir -p "$out/cobertura"
root="$PWD"

# Umbral y paquetes críticos de CP-NF07. No se baja el umbral ni se quita un paquete para
# que la etapa pase: se suben con pruebas.
threshold=85
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

echo "== Cobertura unitaria de los paquetes críticos (CP-NF07, umbral ${threshold} %)"
(
  cd apps/api
  go test -count=1 -cover -coverprofile="$root/$out/cobertura/go.out" "${critical[@]}" \
    | tee "$root/$out/cobertura/go-test.txt"
  go tool cover -html="$root/$out/cobertura/go.out" -o "$root/$out/cobertura/go.html"
) || status=1
# El resumen se arma en un subshell (tubería a tee): el veredicto se lee del archivo.
{
  echo "Cobertura unitaria por paquete crítico (umbral CP-NF07: ${threshold} %)"
  for pkg in "${critical[@]}"; do
    name="${pkg#./internal/}"
    name="${name%/}"
    pct="$(sed -nE "s#^ok[[:space:]]+nava-agenda/internal/${name}[[:space:]].*coverage: ([0-9.]+)% of statements.*#\1#p" \
      "$out/cobertura/go-test.txt")"
    if [ -z "$pct" ]; then
      printf '%-32s %8s  %s\n' "$name" "sin dato" "FALLA (sus pruebas no pasaron)"
    elif awk -v p="$pct" -v u="$threshold" 'BEGIN { exit !(p >= u) }'; then
      printf '%-32s %6s %%  %s\n' "$name" "$pct" "cumple"
    else
      printf '%-32s %6s %%  %s\n' "$name" "$pct" "FALLA (por debajo de ${threshold} %)"
    fi
  done
  echo "Aislamiento (RLS por tenant) se prueba con PostgreSQL real en las etapas Go y Atlas + suites SQL."
} | tee "$out/cobertura/resumen.txt"
if grep -q "FALLA" "$out/cobertura/resumen.txt"; then
  echo "CP-NF07: algún paquete crítico no cumple el umbral de ${threshold} % (ver arriba)."
  status=1
fi

echo "== pnpm audit (CP-NF07, informativa)"
(cd apps/web && pnpm audit --audit-level=high) >"$out/pnpm-audit.txt" 2>&1 &&
  echo "sin vulnerabilidades altas o críticas" ||
  echo "pnpm audit reporta hallazgos o no pudo consultar el registro: ver $out/pnpm-audit.txt"

exit "$status"
