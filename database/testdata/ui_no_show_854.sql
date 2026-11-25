-- Solo datos sintéticos para el E2E de #854 (agenda-no-vino-libera-franja.spec.ts):
-- un «No vino» libera el resto de su franja y «Empezó ahora» la toma. Aplicar con rol
-- migrador SOLO en la BD local de pruebas o en CI, después de ui_horarios_766.sql (usa
-- su negocio A y su cuenta); ningún despliegue carga database/testdata.
-- Un profesional por proyecto de Playwright (escritorio y móvil corren en paralelo y
-- no deben pisarse), un servicio de 30 min asignado a ambos y una jornada de 24 h los
-- siete días: «Empezó ahora» cae dentro de la jornada a cualquier hora.
BEGIN;
INSERT INTO professional (id,business_id,full_name) VALUES ('854b0001-0000-4000-8000-000000000001','766a0001-0000-4000-8000-000000000001','No vino de prueba escritorio') ON CONFLICT (id) DO NOTHING;
INSERT INTO professional (id,business_id,full_name) VALUES ('854b0001-0000-4000-8000-000000000002','766a0001-0000-4000-8000-000000000001','No vino de prueba móvil') ON CONFLICT (id) DO NOTHING;
INSERT INTO service (id,business_id,name,duration_minutes,price_amount) VALUES ('854c0001-0000-4000-8000-000000000001','766a0001-0000-4000-8000-000000000001','Servicio de prueba 854',30,20000.00) ON CONFLICT (id) DO NOTHING;
INSERT INTO professional_service (business_id,professional_id,service_id) VALUES
  ('766a0001-0000-4000-8000-000000000001','854b0001-0000-4000-8000-000000000001','854c0001-0000-4000-8000-000000000001'),
  ('766a0001-0000-4000-8000-000000000001','854b0001-0000-4000-8000-000000000002','854c0001-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO working_hour (business_id,professional_id,iso_weekday,starts_time,duration_minutes)
SELECT '766a0001-0000-4000-8000-000000000001', p.id, d, '00:00', 1440
  FROM (VALUES ('854b0001-0000-4000-8000-000000000001'::uuid), ('854b0001-0000-4000-8000-000000000002'::uuid)) AS p(id),
       generate_series(1, 7) AS d
ON CONFLICT (business_id, professional_id, iso_weekday, starts_time) DO NOTHING;
COMMIT;
