-- Fixture de DEC-173 (issue #605): permisos del empleado restringido. Dos
-- barberías propias (E y F) para que ninguna otra prueba vea estos barberos.
--
-- Barbería E: empleado vinculado a su barbero (BE), otro barbero (BO), una
-- cuenta empresa y un empleado sin barbero vinculado; un servicio asignado a
-- ambos y un turno de cada barbero. Barbería F: un empleado con su barbero,
-- para comprobar que nada cruza de tenant.
--
-- Datos sintéticos: ningún nombre, teléfono ni correo real.
BEGIN;

INSERT INTO barbershop (id, name, timezone) VALUES
  ('605a0001-0000-4000-8000-000000000001', 'Barbería de prueba permisos E', 'America/Bogota'),
  ('605a0001-0000-4000-8000-000000000002', 'Barbería de prueba permisos F', 'America/Bogota')
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_user (id, barbershop_id, email, full_name, is_active) VALUES
  ('605e0001-0000-4000-8000-000000000001', '605a0001-0000-4000-8000-000000000001',
   'permisos.empleado@ejemplo.test', 'Empleado de prueba', true),
  ('605e0001-0000-4000-8000-000000000002', '605a0001-0000-4000-8000-000000000001',
   'permisos.empresa@ejemplo.test', 'Empresa de prueba', true),
  ('605e0001-0000-4000-8000-000000000003', '605a0001-0000-4000-8000-000000000001',
   'permisos.sin.barbero@ejemplo.test', 'Empleado sin barbero de prueba', true),
  ('605e0001-0000-4000-8000-000000000004', '605a0001-0000-4000-8000-000000000002',
   'permisos.empleado.f@ejemplo.test', 'Empleado de otra barbería de prueba', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_user_role (barbershop_id, staff_user_id, role) VALUES
  ('605a0001-0000-4000-8000-000000000001', '605e0001-0000-4000-8000-000000000001', 'empleado'),
  ('605a0001-0000-4000-8000-000000000001', '605e0001-0000-4000-8000-000000000002', 'empresa'),
  ('605a0001-0000-4000-8000-000000000001', '605e0001-0000-4000-8000-000000000003', 'empleado'),
  ('605a0001-0000-4000-8000-000000000002', '605e0001-0000-4000-8000-000000000004', 'empleado')
ON CONFLICT DO NOTHING;

INSERT INTO barber (id, barbershop_id, full_name, staff_user_id) VALUES
  ('605b0001-0000-4000-8000-000000000001', '605a0001-0000-4000-8000-000000000001',
   'Barbero propio de prueba', '605e0001-0000-4000-8000-000000000001'),
  ('605b0001-0000-4000-8000-000000000002', '605a0001-0000-4000-8000-000000000001',
   'Otro barbero de prueba', NULL),
  ('605b0001-0000-4000-8000-000000000003', '605a0001-0000-4000-8000-000000000002',
   'Barbero de otra barbería de prueba', '605e0001-0000-4000-8000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service (id, barbershop_id, name, description, duration_minutes, price_amount) VALUES
  ('605c0001-0000-4000-8000-000000000001', '605a0001-0000-4000-8000-000000000001',
   'Corte de prueba', 'Servicio sintético.', 30, 20000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO barber_service (barbershop_id, barber_id, service_id) VALUES
  ('605a0001-0000-4000-8000-000000000001', '605b0001-0000-4000-8000-000000000001', '605c0001-0000-4000-8000-000000000001'),
  ('605a0001-0000-4000-8000-000000000001', '605b0001-0000-4000-8000-000000000002', '605c0001-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO customer (id, barbershop_id, full_name, phone) VALUES
  ('605d0001-0000-4000-8000-000000000001', '605a0001-0000-4000-8000-000000000001',
   'Cliente de prueba permisos', '+573000000605')
ON CONFLICT (id) DO NOTHING;

INSERT INTO appointment (id, barbershop_id, barber_id, service_id, customer_id, attendee_name,
                         starts_at, ends_at, status, origin, service_name_snapshot,
                         duration_minutes_snapshot, price_amount_snapshot, price_currency_snapshot)
VALUES
  ('605f0001-0000-4000-8000-000000000001', '605a0001-0000-4000-8000-000000000001',
   '605b0001-0000-4000-8000-000000000001', '605c0001-0000-4000-8000-000000000001',
   '605d0001-0000-4000-8000-000000000001', 'Cliente de prueba permisos',
   '2030-01-10 15:00:00+00', '2030-01-10 15:30:00+00', 'confirmed', 'manual',
   'Corte de prueba', 30, 20000, 'COP'),
  ('605f0001-0000-4000-8000-000000000002', '605a0001-0000-4000-8000-000000000001',
   '605b0001-0000-4000-8000-000000000002', '605c0001-0000-4000-8000-000000000001',
   '605d0001-0000-4000-8000-000000000001', 'Cliente de prueba permisos',
   '2030-01-10 16:00:00+00', '2030-01-10 16:30:00+00', 'confirmed', 'manual',
   'Corte de prueba', 30, 20000, 'COP')
ON CONFLICT (id) DO NOTHING;

COMMIT;
