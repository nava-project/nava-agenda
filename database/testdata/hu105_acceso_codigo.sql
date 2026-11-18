-- Fixture propio de HU-105: dos negocios DEDICADAS a las pruebas del acceso al
-- turno con código (customeraccess/postgres y httpapi). Cada una lleva su
-- public_slug, porque el acceso se resuelve por slug, y están separadas de las
-- demás suites por el mismo motivo que hu098_acceso_turno.sql: una prueba de
-- aislamiento de tenant no debe depender del estado que dejen otras suites.
--
-- IDs '0105...' (mnemónico HU-105; dígitos hexadecimales válidos 0/1/5).
--
-- El cliente y el turno de cada prueba los crea la propia prueba con
-- booking/postgres.Repository.CreateInternal, igual que en HU-098.
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f database/testdata/hu105_acceso_codigo.sql
--
-- Se ejecuta con el rol migrador (o superusuario en local/CI efímero).
-- Ningún dato de este archivo corresponde a una persona real (AGENTS.md).

BEGIN;

INSERT INTO business (id, name, timezone, public_slug) VALUES
  ('01050001-0105-0105-0105-010500010001', 'Barbería de prueba HU-105 Uno', 'America/Bogota', 'hu105-uno'),
  ('01050002-0105-0105-0105-010500020002', 'Barbería de prueba HU-105 Dos', 'America/Bogota', 'hu105-dos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO professional (id, business_id, full_name) VALUES
  ('01050011-0105-0105-0105-010500110011', '01050001-0105-0105-0105-010500010001', 'Barbero HU-105 Uno'),
  ('01050021-0105-0105-0105-010500210021', '01050002-0105-0105-0105-010500020002', 'Barbero HU-105 Dos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service (id, business_id, name, duration_minutes, price_amount, price_currency) VALUES
  ('01050012-0105-0105-0105-010500120012', '01050001-0105-0105-0105-010500010001', 'Corte de prueba HU-105 Uno', 30, 20000.00, 'COP'),
  ('01050022-0105-0105-0105-010500220022', '01050002-0105-0105-0105-010500020002', 'Corte de prueba HU-105 Dos', 30, 20000.00, 'COP')
ON CONFLICT (id) DO NOTHING;

COMMIT;
