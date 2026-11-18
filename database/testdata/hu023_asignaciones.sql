-- Fixture propio de HU-023: dos negocios DEDICADAS a las pruebas de
-- catalog/postgres.AssignmentRepository (asignar, desasignar, DEC-068,
-- aislamiento por tenant), separadas de dos_negocios.sql/
-- hu021_professionalos.sql/hu022_catalogo.sql para que un conteo exacto de
-- asignaciones no dependa del estado que dejen otras suites (settings,
-- auth, staff, catalog) sobre shopA-shopF.
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/hu023_asignaciones.sql
--
-- Se ejecuta con el rol migrador (o superusuario en local/CI efímero,
-- mismo criterio que dos_negocios.sql), el único con política
-- administrativa sobre business.
--
-- Ningún dato de este archivo corresponde a una persona real (AGENTS.md).

BEGIN;

INSERT INTO business (id, name, timezone) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Barbería de prueba G (asignaciones)', 'America/Bogota'),
  ('88888888-8888-8888-8888-888888888888', 'Barbería de prueba H (asignaciones)', 'America/Bogota')
ON CONFLICT (id) DO NOTHING;

COMMIT;
