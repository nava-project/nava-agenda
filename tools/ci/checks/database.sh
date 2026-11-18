#!/usr/bin/env bash
# Check "Atlas + suites SQL contra el esquema aplicado" del CI en Jenkins (DEC-177).
# Corre dentro de la imagen tools/ci/ci.Dockerfile, en el espacio de red de un
# PostgreSQL efímero (localhost:5432, usuario postgres/postgres). Lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"
psql_file() { psql -v ON_ERROR_STOP=1 -f "$1"; }
suite() { local name="$1"; shift; echo "== $name"; "$@"; }

atlas version
(
  cd database
  echo "== atlas migrate validate"
  atlas migrate validate --env local
  echo "== atlas migrate apply (desde base vacía) hasta el renombrado del esquema"
  atlas migrate apply --env local --to-version 20261121090000
  # Los roles barberia_* pasan a agenda_* con el superusuario entre la migración que
  # renombra el esquema y las siguientes (DEC-183, #660; migraciones-atlas.md).
  echo "== roles barberia_* → agenda_*"
  psql -v ON_ERROR_STOP=1 -f roles/rename_to_agenda.sql
  echo "== atlas migrate apply (resto)"
  atlas migrate apply --env local
  echo "== atlas migrate apply (segunda vez, sin cambios esperados)"
  salida="$(atlas migrate apply --env local)"
  echo "$salida"
  grep -q "No migration files to execute" <<<"$salida"
)

echo "== contraseñas de agenda_app y agenda_worker"
psql -c "ALTER ROLE agenda_app PASSWORD 'app_test';"
psql -c "ALTER ROLE agenda_worker PASSWORD 'worker_test';"

echo "== testdata de dos barberías"
for f in database/testdata/dos_barberias.sql \
         database/testdata/staff_user_role_365.sql \
         database/testdata/hu005_credenciales_sesiones.sql \
         database/testdata/hu007_reto_telefonico.sql \
         database/testdata/hu021_barberos.sql \
         database/testdata/hu022_catalogo.sql \
         database/testdata/hu023_asignaciones.sql \
         database/testdata/hu040_horario.sql \
         database/testdata/hu041_excepciones.sql \
         database/testdata/hu042_bloqueos.sql \
         database/testdata/hu060_citas.sql; do
  psql_file "$f"
done

suite "Suite de aislamiento HU-001" psql_file database/tests/hu001_aislamiento_rls.sql
suite "Suite de credenciales y sesiones HU-005" psql_file database/tests/hu005_aislamiento_credenciales_sesiones.sql
suite "Suite de defensa contra abuso HU-007" psql_file database/tests/hu007_defensa_abuso.sql
suite "Suite de recuperación de acceso HU-008" psql_file database/tests/hu008_recuperacion_acceso.sql
suite "Suite de configuración de la barbería HU-020" psql_file database/tests/hu020_configuracion_barberia.sql
suite "Suite de marca y vocabulario de la barbería (DEC-110)" psql_file database/tests/brand_marca_vocabulario.sql
suite "Suite del perfil del panel de barbero individual (DEC-115)" psql_file database/tests/panel_perfil_barbero_individual.sql
suite "Suite de los roles del usuario (DEC-134)" psql_file database/tests/staff_user_role.sql
suite "Suite de las reseñas por barbero (DEC-128)" psql_file database/tests/barber_review.sql
suite "Suite del servicio a domicilio (DEC-131)" psql_file database/tests/appointment_domicilio.sql
suite "Suite del canal del código de acceso (DEC-139)" psql_file database/tests/login_otp_channel.sql
suite "Suite de la ficha de Google de la barbería (DEC-129)" psql_file database/tests/barbershop_google_place_id.sql
suite "Suite de la ubicación de la barbería (DEC-130)" psql_file database/tests/barbershop_ubicacion.sql
suite "Suite del horario de atención del local (DEC-182)" psql_file database/tests/barbershop_horario.sql
suite "Suite del vínculo barbero–usuario (DEC-100)" psql_file database/tests/barbero_vinculo_usuario.sql
suite "Suite de la descripción del barbero (DEC-127)" psql_file database/tests/barber_description.sql
suite "Suite de ventana de reserva por barbero DEC-169" psql_file database/tests/barber_booking_policy.sql
suite "Suite de la conexión con Google Calendar (DEC-099, DEC-102)" psql_file database/tests/google_calendar_conexion.sql
suite "Suite de la cola de publicación en Google Calendar (DEC-101, DEC-102)" psql_file database/tests/google_calendar_sync.sql
suite "Suite de la cola de avisos al cliente (DEC-142)" psql_file database/tests/appointment_notice.sql
suite "Suite del webhook de Meta WhatsApp (DEC-126)" psql_file database/tests/whatsapp_webhook.sql
suite "Suite de registro y listado de barberos HU-021" psql_file database/tests/hu021_barberos.sql
suite "Suite de catálogo básico de servicios HU-022" psql_file database/tests/hu022_catalogo.sql
suite "Suite de asignación de servicios a barberos HU-023" psql_file database/tests/hu023_asignaciones.sql
suite "Suite de ciclo de vida de servicios HU-024" psql_file database/tests/hu024_ciclo_vida.sql
suite "Suite de horario laboral HU-040" psql_file database/tests/hu040_horario.sql
suite "Suite de excepciones de jornada y festivos HU-041" psql_file database/tests/hu041_excepciones.sql
suite "Suite de bloqueos de agenda HU-042" psql_file database/tests/hu042_bloqueos.sql
suite "Suite del núcleo de citas HU-060" psql_file database/tests/hu060_citas.sql
suite "Suite del vocabulario cancelled_by_professional (DEC-183)" psql_file database/tests/cancelled_by_professional.sql
suite "Suite de idempotencia (secuencial, una conexión)" psql_file database/tests/idempotency_concurrency.sql
suite "Suite de idempotencia (dos conexiones reales)" env DATABASE_TEST_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable" bash database/tests/idempotency_concurrency_two_connections.sh
