-- Fixture mínimo para database/tests/customer_anonymization.sql (issue #6).
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/dos_professionalias.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/customer_anonymization_fixture.sql
--
-- Solo un barbero y un servicio por barbería (A y B de dos_professionalias.sql):
-- cada escenario de la prueba crea y destruye sus propios `customer` y
-- `appointment` dentro de una transacción que revierte, así que no hace
-- falta fijar clientes ni citas aquí. Identificadores fijos e idempotente
-- (ON CONFLICT DO NOTHING), igual que dos_professionalias.sql.
--
-- Ningún dato de este archivo corresponde a una persona real (AGENTS.md).

BEGIN;

INSERT INTO professional (id, business_id, full_name) VALUES
  ('b1a00000-0000-0000-0000-00000000000a',
   '11111111-1111-1111-1111-111111111111',
   'Barbero de prueba de anonimización A'),
  ('b1b00000-0000-0000-0000-00000000000b',
   '22222222-2222-2222-2222-222222222222',
   'Barbero de prueba de anonimización B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service (id, business_id, name, duration_minutes, price_amount, price_currency) VALUES
  ('5e100000-0000-0000-0000-00000000000a',
   '11111111-1111-1111-1111-111111111111',
   'Corte de prueba de anonimización A', 30, 20000.00, 'COP'),
  ('5e100000-0000-0000-0000-00000000000b',
   '22222222-2222-2222-2222-222222222222',
   'Corte de prueba de anonimización B', 30, 20000.00, 'COP')
ON CONFLICT (id) DO NOTHING;

COMMIT;
