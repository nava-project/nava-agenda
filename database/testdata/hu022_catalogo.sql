-- Fixture propio de HU-022: dos negocios DEDICADAS a las pruebas de
-- catalog/postgres (alta, listado, aislamiento por tenant e idempotencia),
-- separadas de las de dos_negocios.sql y hu021_professionalos.sql para que un
-- conteo exacto de servicios en una página no dependa del estado que dejen
-- otras suites (settings, auth, staff) sobre shopA/shopB/shopC/shopD.
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/hu022_catalogo.sql
--
-- Se ejecuta con el rol migrador (o superusuario en local/CI efímero,
-- mismo criterio que dos_negocios.sql), el único con política
-- administrativa sobre business.
--
-- Ningún dato de este archivo corresponde a una persona real (AGENTS.md).

BEGIN;

INSERT INTO business (id, name, timezone) VALUES
  ('55555555-5555-5555-5555-555555555555', 'Barbería de prueba E (catalog)', 'America/Bogota'),
  ('66666666-6666-6666-6666-666666666666', 'Barbería de prueba F (catalog)', 'America/Bogota')
ON CONFLICT (id) DO NOTHING;

-- HU-029 (#456): usuario del panel que firma los eventos de historial que deja
-- aplicar un precio nuevo a los turnos futuros de un servicio del negocio E.
INSERT INTO staff_user (id, business_id, email, full_name, is_active) VALUES
  ('eeeeee01-eeee-4eee-8eee-eeeeeeeeee01', '55555555-5555-5555-5555-555555555555',
   'precio.e1@ejemplo.test', 'Usuario precio E1', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
