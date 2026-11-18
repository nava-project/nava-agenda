-- Fixture propio de DEC-162: dos barberías DEDICADAS a las pruebas de los
-- agregados públicos de solo lectura (GET /public/barbershops/{slug}/barbers
-- y GET /public/barbershops/{slug}/services/{serviceId}/availability) en
-- publicbooking/postgres y cmd/api. Separadas de hu092/hu094 por el mismo
-- motivo que ellas: un conteo exacto de barberos/servicios elegibles no
-- debe depender del estado que dejen otras suites.
--
-- IDs '0162...' (mnemónico: DEC-162), distintos de los demás fixtures.
--
-- Barbería Uno (slug barberia-dec162-uno), anticipación mínima 0, ventana 7
-- días, rejilla 30 min:
--   barberos   Uno-1 (creado primero), Uno-2, Uno-3 (sin asignaciones) y
--              Uno-4 (solo asignado a un servicio INACTIVO);
--   servicios  S1 activo 30 min, S2 activo 45 min, S3 INACTIVO, S4 activo sin
--              ningún barbero;
--   asignación Uno-1: S1, S2, S3; Uno-2: S2; Uno-4: S3.
-- Uno-1 y Uno-2 trabajan 9:00-18:00 los siete días ISO (las pruebas corren en
-- tiempo real y "hoy" varía). Uno-1 vs Uno-2 comparten servicio S2, así que el
-- agregado de S2 trae franjas de ambos.
--
-- Barbería Dos (slug barberia-dec162-dos): un barbero, un servicio activo y su
-- jornada; solo existe para comprobar el aislamiento de tenant.
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/dec162_agregados_publicos.sql
--
-- Se ejecuta con el rol migrador (o superusuario en local/CI efímero, mismo
-- criterio que dos_professionalias.sql). Repetible: ON CONFLICT DO NOTHING.
--
-- Ningún dato de este archivo corresponde a una persona real (AGENTS.md).

BEGIN;

INSERT INTO business (
  id, name, timezone, public_slug,
  min_advance_minutes, max_advance_days, slot_grid_minutes
) VALUES
  ('01620001-0162-0162-0162-016200010001',
   'Barbería de prueba DEC-162 Uno', 'America/Bogota', 'barberia-dec162-uno',
   0, 7, 30),
  ('01620002-0162-0162-0162-016200020002',
   'Barbería de prueba DEC-162 Dos', 'America/Bogota', 'barberia-dec162-dos',
   0, 7, 30)
ON CONFLICT (id) DO NOTHING;

-- created_at explícito: el orden (created_at, id) de la respuesta no debe
-- depender del reloj de la inserción.
INSERT INTO professional (id, business_id, full_name, created_at) VALUES
  ('01620011-0162-0162-0162-016200110011',
   '01620001-0162-0162-0162-016200010001', 'Barbero DEC-162 Uno-1', '2026-01-01T10:00:00Z'),
  ('01620012-0162-0162-0162-016200120012',
   '01620001-0162-0162-0162-016200010001', 'Barbero DEC-162 Uno-2', '2026-01-01T11:00:00Z'),
  ('01620013-0162-0162-0162-016200130013',
   '01620001-0162-0162-0162-016200010001', 'Barbero DEC-162 Uno-3 sin asignación', '2026-01-01T12:00:00Z'),
  ('01620014-0162-0162-0162-016200140014',
   '01620001-0162-0162-0162-016200010001', 'Barbero DEC-162 Uno-4 solo servicio inactivo', '2026-01-01T13:00:00Z'),
  ('01620021-0162-0162-0162-016200210021',
   '01620002-0162-0162-0162-016200020002', 'Barbero DEC-162 Dos-1', '2026-01-01T10:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service (id, business_id, name, description, duration_minutes, price_amount, price_currency, is_active, deactivated_at, created_at) VALUES
  ('01620101-0162-0162-0162-016201010101',
   '01620001-0162-0162-0162-016200010001',
   'Servicio S1 activo DEC-162', NULL, 30, 35000.00, 'COP', true, NULL, '2026-01-01T09:00:00Z'),
  ('01620102-0162-0162-0162-016201020102',
   '01620001-0162-0162-0162-016200010001',
   'Servicio S2 activo DEC-162', NULL, 45, 50000.00, 'COP', true, NULL, '2026-01-01T09:10:00Z'),
  ('01620103-0162-0162-0162-016201030103',
   '01620001-0162-0162-0162-016200010001',
   'Servicio S3 inactivo DEC-162', NULL, 40, 40000.00, 'COP', false, '2026-02-01T00:00:00Z', '2026-01-01T09:20:00Z'),
  ('01620104-0162-0162-0162-016201040104',
   '01620001-0162-0162-0162-016200010001',
   'Servicio S4 sin barberos DEC-162', NULL, 20, 15000.00, 'COP', true, NULL, '2026-01-01T09:30:00Z'),
  ('01620201-0162-0162-0162-016202010201',
   '01620002-0162-0162-0162-016200020002',
   'Servicio Dos activo DEC-162', NULL, 30, 22000.00, 'COP', true, NULL, '2026-01-01T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO professional_service (business_id, professional_id, service_id) VALUES
  ('01620001-0162-0162-0162-016200010001', '01620011-0162-0162-0162-016200110011', '01620101-0162-0162-0162-016201010101'),
  ('01620001-0162-0162-0162-016200010001', '01620011-0162-0162-0162-016200110011', '01620102-0162-0162-0162-016201020102'),
  ('01620001-0162-0162-0162-016200010001', '01620011-0162-0162-0162-016200110011', '01620103-0162-0162-0162-016201030103'),
  ('01620001-0162-0162-0162-016200010001', '01620012-0162-0162-0162-016200120012', '01620102-0162-0162-0162-016201020102'),
  ('01620001-0162-0162-0162-016200010001', '01620014-0162-0162-0162-016200140014', '01620103-0162-0162-0162-016201030103'),
  ('01620002-0162-0162-0162-016200020002', '01620021-0162-0162-0162-016200210021', '01620201-0162-0162-0162-016202010201')
ON CONFLICT DO NOTHING;

-- Jornada 9:00-18:00 los siete días ISO.
INSERT INTO working_hour (business_id, professional_id, iso_weekday, starts_time, duration_minutes)
SELECT '01620001-0162-0162-0162-016200010001', b, d, '09:00', 540
  FROM generate_series(1, 7) AS d,
       (VALUES ('01620011-0162-0162-0162-016200110011'::uuid),
               ('01620012-0162-0162-0162-016200120012'::uuid)) AS t(b)
ON CONFLICT DO NOTHING;

INSERT INTO working_hour (business_id, professional_id, iso_weekday, starts_time, duration_minutes)
SELECT '01620002-0162-0162-0162-016200020002', '01620021-0162-0162-0162-016200210021', d, '09:00', 540
  FROM generate_series(1, 7) AS d
ON CONFLICT DO NOTHING;

COMMIT;
