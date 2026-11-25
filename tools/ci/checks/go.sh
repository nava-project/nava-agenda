#!/usr/bin/env bash
# Check "Go (build, vet, test -race, govulncheck)" del CI en Jenkins (DEC-177).
# Corre dentro de la imagen tools/ci/ci.Dockerfile, en el espacio de red de un
# PostgreSQL efímero (localhost:5432, usuario postgres/postgres). Lo lanza tools/ci/run.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
psql_file() { psql -v ON_ERROR_STOP=1 -f "$1"; }

echo "== gofmt"
diff="$(cd apps/api && gofmt -l .)"
if [ -n "$diff" ]; then
  echo "Archivos sin formatear (gofmt -w antes de subir):"
  echo "$diff"
  exit 1
fi

echo "== go vet"
(cd apps/api && go vet ./...)

echo "== go build"
(cd apps/api && go build ./...)

# Lista explícita, en orden: cada migración nueva se añade aquí (y Atlas la valida en
# el check database). Es el esquema que usan las pruebas de integración de Go.
echo "== migraciones (esquema de prueba)"
for f in 20260807170000_create_tenant_foundation.sql \
         20260807170100_create_idempotency_record.sql \
         20260811145252_harden_roles_and_definer_functions.sql \
         20260811154100_harden_idempotency_concurrency.sql \
         20260811220000_harden_idempotency_fingerprint_format.sql \
         20260813120000_create_auth_credentials_and_sessions.sql \
         20260817180000_create_login_throttle_and_phone_challenge.sql \
         20260817190000_create_staff_recovery_code.sql \
         20260823120000_add_barbershop_contact_info.sql \
         20260823130000_create_barber.sql \
         20260824140000_create_service.sql \
         20260824150000_create_barber_service.sql \
         20260825160000_create_working_hour.sql \
         20260826090000_create_working_hour_override.sql \
         20260826100000_create_time_block.sql \
         20260827110000_create_appointment_core.sql \
         20260911045044_add_barbershop_public_slug.sql \
         20260911060000_add_barbershop_booking_policy.sql \
         20260915190000_create_appointment_access_token.sql \
         20260916120000_add_public_resolve_appointment_token_tenant.sql \
         20260919200000_add_auth_recovery_resolve_phone.sql \
         20260919210000_relax_auth_recovery_request_phone_requirement.sql \
         20260919220000_add_auth_phone_challenge_destination.sql \
         20260930120000_create_barber_photo.sql \
         20261003120000_add_barbershop_brand.sql \
         20261004120000_add_barbershop_panel_profile.sql \
         20261009120000_add_barber_staff_user_link.sql \
         20261009130000_create_google_calendar_connection.sql \
         20261010100000_create_google_calendar_sync.sql \
         20261010120000_drop_auth_phone_challenge_destination.sql \
         20261010130000_create_whatsapp_webhook.sql \
         20261026120000_add_barber_description.sql \
         20261029120000_relax_barbershop_slot_grid_check.sql \
         20261029130000_create_staff_user_role.sql \
         20261030120000_add_barbershop_location.sql \
         20261031120000_create_barber_review.sql \
         20261101120000_add_home_service.sql \
         20261102120000_add_google_place_id.sql \
         20261103120000_add_login_otp_channel.sql \
         20261104120000_create_appointment_notice.sql \
         20261105120000_add_appointment_reminder_kind.sql \
         20261115120000_create_barber_booking_policy.sql \
         20261116120000_barber_booking_policy_full_window.sql \
         20261117120000_add_reminder_lead_minutes.sql \
         20261118120000_add_whatsapp_reminder.sql \
         20261119120000_create_customer_access_challenge.sql \
         20261119130000_customer_access_challenge_appointment_ref.sql \
         20261119140000_customer_access_challenge_purpose_manage.sql \
         20261120090000_create_barbershop_opening_hour.sql \
         20261121090000_rename_to_business_professional.sql; do
  psql_file "database/migrations/$f"
done
# Los roles barberia_* pasan a agenda_* justo después de la migración que renombra el
# esquema (DEC-183, #660): lo hace el superusuario, no una migración. Las migraciones que
# se añadan después de 20261121090000 van en una segunda lista, tras este paso.
psql_file database/roles/rename_to_agenda.sql
for f in 20261122090000_rename_cancelled_by_professional.sql \
         20261123090000_create_customer_anonymization.sql \
         20261125090000_appointment_no_show_cut.sql \
         20261125150000_grant_occupied_until_to_owner.sql; do
  psql_file "database/migrations/$f"
done
psql -c "ALTER ROLE agenda_app PASSWORD 'app_test';"
psql -c "ALTER ROLE agenda_worker PASSWORD 'worker_test';"

echo "== testdata de dos negocios"
for f in database/testdata/dos_negocios.sql \
         database/testdata/staff_user_role_365.sql \
         database/testdata/empleado_restringido_605.sql \
         database/testdata/hu005_credenciales_sesiones.sql \
         database/testdata/hu007_reto_telefonico.sql \
         database/testdata/hu021_profesionales.sql \
         database/testdata/hu022_catalogo.sql \
         database/testdata/hu023_asignaciones.sql \
         database/testdata/hu040_horario.sql \
         database/testdata/hu041_excepciones.sql \
         database/testdata/hu042_bloqueos.sql \
         database/testdata/hu060_citas.sql \
         database/testdata/hu090_reserva_publica.sql \
         database/testdata/hu091_catalogo_publico.sql \
         database/testdata/hu092_seleccion_profesional.sql \
         database/testdata/hu093_politica_reserva.sql \
         database/testdata/hu094_disponibilidad.sql \
         database/testdata/hu098_acceso_turno.sql \
         database/testdata/hu105_acceso_codigo.sql \
         database/testdata/hu008_recuperacion_canal.sql \
         database/testdata/hu100_resenas.sql \
         database/testdata/dec162_agregados_publicos.sql; do
  psql_file "$f"
done

echo "== go test -race"
# -p 1: los paquetes con BD comparten una sola base y reclaman la misma cola global
# (`google_calendar_sync_job`); en paralelo se roban trabajos entre sí (#369).
#
# Caché de resultados (#625): Go reutiliza el resultado de una prueba si no cambian su
# código, los archivos que abre ni las variables de entorno que lee. El esquema de la base
# no es ninguna de esas cosas, así que su huella (migraciones, testdata y este script, que
# decide qué se carga) va en application_name dentro de la URL que leen las pruebas: si el
# esquema cambia, la URL cambia y las pruebas con base se vuelven a ejecutar.
schema="$(cat database/migrations/* database/testdata/* "${BASH_SOURCE[0]}" | sha1sum | cut -c1-12)"
(
  cd apps/api
  TEST_DATABASE_URL="postgres://agenda_app:app_test@localhost:5432/postgres?sslmode=disable&application_name=nava-ci-$schema" \
  TEST_WORKER_DATABASE_URL="postgres://agenda_worker:worker_test@localhost:5432/postgres?sslmode=disable&application_name=nava-ci-$schema" \
    go test -race -p 1 ./...
)

echo "== govulncheck"
(
  cd apps/api
  GOTOOLCHAIN=auto go install golang.org/x/vuln/cmd/govulncheck@latest
  GOTOOLCHAIN=auto "$(go env GOPATH)/bin/govulncheck" ./...
)
