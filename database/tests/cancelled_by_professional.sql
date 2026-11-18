-- Pruebas SQL del issue #661 (DEC-183): la migración
-- 20261122090000_rename_cancelled_by_professional.sql lleva el estado
-- `cancelled_by_barber`, el evento `appointment_cancelled_by_barber` y el aviso
-- `cancelled_by_barber` al vocabulario `…_professional` en TODOS los negocios, sin
-- tocar las demás filas ni el `updated_at` de los turnos.
--
-- Como el esquema ya tiene la migración aplicada, la prueba reconstruye dentro de
-- una transacción el estado anterior (los CHECK viejos y filas con los valores
-- viejos en dos negocios), vuelve a ejecutar el archivo de la migración tal cual y
-- comprueba el resultado. Todo se revierte con ROLLBACK.
--
-- Uso (desde la raíz del repositorio, tras testdata/dos_negocios.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/cancelled_by_professional.sql
--
-- Requisito del arnés: superusuario (local/CI efímero), igual que quien aplica las
-- migraciones en CI. Cada comprobación falla lanzando una excepción.

\set ON_ERROR_STOP on

\echo '=== Issue #661 · estado y eventos cancelled_by_professional ==='

-- ---------------------------------------------------------------------------
-- El esquema vigente solo admite el vocabulario nuevo
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'appointment_status_ck'))
       NOT LIKE '%cancelled_by_professional%'
     OR pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'appointment_cancellation_reason_ck'))
       NOT LIKE '%cancelled_by_professional%'
     OR pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'appointment_history_event_type_ck'))
       NOT LIKE '%appointment_cancelled_by_professional%'
     OR pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'appointment_notice_kind_ck'))
       NOT LIKE '%cancelled_by_professional%' THEN
    RAISE EXCEPTION 'los CHECK deben nombrar el valor nuevo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN ('appointment_status_ck', 'appointment_cancellation_reason_ck',
                      'appointment_history_event_type_ck', 'appointment_notice_kind_ck')
      AND pg_get_constraintdef(oid) LIKE '%by_barber%'
  ) THEN
    RAISE EXCEPTION 'ningún CHECK debe admitir el valor viejo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%cancelled_by_barber%'
  ) THEN
    RAISE EXCEPTION 'ninguna función debe nombrar cancelled_by_barber.';
  END IF;
END
$$;
\echo 'esquema OK · los CHECK y las funciones solo conocen cancelled_by_professional'

-- ---------------------------------------------------------------------------
-- Estado anterior a la migración, en dos negocios
-- ---------------------------------------------------------------------------
BEGIN;
RESET ROLE;

ALTER TABLE appointment DROP CONSTRAINT appointment_status_ck;
ALTER TABLE appointment DROP CONSTRAINT appointment_cancellation_reason_ck;
ALTER TABLE appointment_history DROP CONSTRAINT appointment_history_event_type_ck;
ALTER TABLE appointment_notice DROP CONSTRAINT appointment_notice_kind_ck;
ALTER TABLE appointment ADD CONSTRAINT appointment_status_ck CHECK (
  status IN ('confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_barber', 'no_show'));
ALTER TABLE appointment ADD CONSTRAINT appointment_cancellation_reason_ck CHECK (
  cancellation_reason IS NULL
  OR (status IN ('cancelled_by_customer', 'cancelled_by_barber') AND char_length(cancellation_reason) <= 500));
ALTER TABLE appointment_history ADD CONSTRAINT appointment_history_event_type_ck CHECK (
  event_type IN ('appointment_created', 'appointment_rescheduled', 'appointment_service_changed',
                 'appointment_completed', 'appointment_cancelled_by_customer',
                 'appointment_cancelled_by_barber', 'appointment_no_show', 'appointment_status_corrected'));
ALTER TABLE appointment_notice ADD CONSTRAINT appointment_notice_kind_ck
  CHECK (kind IN ('cancelled_by_barber', 'rescheduled', 'reminder', 'reminder_whatsapp'));

INSERT INTO professional (id, business_id, full_name) VALUES
  ('c6610001-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Profesional 661 A'),
  ('c6610001-0000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Profesional 661 B');
INSERT INTO service (id, business_id, name, duration_minutes, price_amount, price_currency) VALUES
  ('c6610002-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Servicio 661 A', 30, 20000.00, 'COP'),
  ('c6610002-0000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Servicio 661 B', 30, 20000.00, 'COP');
INSERT INTO customer (id, business_id, full_name, email) VALUES
  ('c6610003-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Cliente 661 A', 'cliente661.a@ejemplo.test'),
  ('c6610003-0000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Cliente 661 B', 'cliente661.b@ejemplo.test');

-- Por negocio: un turno cancelado por el profesional (…0a/…0b) y otro cancelado
-- por el cliente (…1a/…1b), que la migración no debe tocar. El updated_at fijo
-- (un INSERT no dispara set_updated_at) comprueba que la migración no lo mueve.
INSERT INTO appointment (
  id, business_id, professional_id, service_id, customer_id, attendee_name,
  starts_at, ends_at, status, origin, cancellation_reason, resolved_at,
  service_name_snapshot, duration_minutes_snapshot, price_amount_snapshot, price_currency_snapshot,
  created_at, updated_at
) VALUES
  ('c6610004-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'c6610001-0000-4000-8000-00000000000a',
   'c6610002-0000-4000-8000-00000000000a', 'c6610003-0000-4000-8000-00000000000a', 'Cliente 661 A',
   '2099-02-07T10:00:00Z', '2099-02-07T10:30:00Z', 'cancelled_by_barber', 'manual', 'Imprevisto', '2026-01-05T15:00:00Z',
   'Servicio 661 A', 30, 20000.00, 'COP', '2026-01-05T14:00:00Z', '2026-01-05T15:00:00Z'),
  ('c6610004-0000-4000-8000-00000000001a', '11111111-1111-1111-1111-111111111111', 'c6610001-0000-4000-8000-00000000000a',
   'c6610002-0000-4000-8000-00000000000a', 'c6610003-0000-4000-8000-00000000000a', 'Cliente 661 A',
   '2099-02-08T10:00:00Z', '2099-02-08T10:30:00Z', 'cancelled_by_customer', 'manual', NULL, '2026-01-05T15:00:00Z',
   'Servicio 661 A', 30, 20000.00, 'COP', '2026-01-05T14:00:00Z', '2026-01-05T15:00:00Z'),
  ('c6610004-0000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', 'c6610001-0000-4000-8000-00000000000b',
   'c6610002-0000-4000-8000-00000000000b', 'c6610003-0000-4000-8000-00000000000b', 'Cliente 661 B',
   '2099-02-07T10:00:00Z', '2099-02-07T10:30:00Z', 'cancelled_by_barber', 'manual', NULL, '2026-01-05T15:00:00Z',
   'Servicio 661 B', 30, 20000.00, 'COP', '2026-01-05T14:00:00Z', '2026-01-05T15:00:00Z'),
  ('c6610004-0000-4000-8000-00000000001b', '22222222-2222-2222-2222-222222222222', 'c6610001-0000-4000-8000-00000000000b',
   'c6610002-0000-4000-8000-00000000000b', 'c6610003-0000-4000-8000-00000000000b', 'Cliente 661 B',
   '2099-02-08T10:00:00Z', '2099-02-08T10:30:00Z', 'cancelled_by_customer', 'manual', NULL, '2026-01-05T15:00:00Z',
   'Servicio 661 B', 30, 20000.00, 'COP', '2026-01-05T14:00:00Z', '2026-01-05T15:00:00Z');

INSERT INTO appointment_history (id, business_id, appointment_id, event_type, actor_type, reason, occurred_at) VALUES
  ('c6610005-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'c6610004-0000-4000-8000-00000000000a', 'appointment_cancelled_by_barber', 'system', NULL, '2026-01-05T15:00:00Z'),
  ('c6610005-0000-4000-8000-00000000001a', '11111111-1111-1111-1111-111111111111',
   'c6610004-0000-4000-8000-00000000001a', 'appointment_cancelled_by_customer', 'system', NULL, '2026-01-05T15:00:00Z'),
  ('c6610005-0000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'c6610004-0000-4000-8000-00000000000b', 'appointment_cancelled_by_barber', 'system', NULL, '2026-01-05T15:00:00Z'),
  -- Una corrección auditada que SALE de cancelled_by_barber: el valor anterior también cambia.
  ('c6610005-0000-4000-8000-00000000002b', '22222222-2222-2222-2222-222222222222',
   'c6610004-0000-4000-8000-00000000000b', 'appointment_status_corrected', 'system', 'Corrección de prueba',
   '2026-01-05T15:10:00Z');

INSERT INTO appointment_history_change (business_id, history_id, field_name, previous_value, new_value) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c6610005-0000-4000-8000-00000000000a', 'status', 'confirmed', 'cancelled_by_barber'),
  ('11111111-1111-1111-1111-111111111111', 'c6610005-0000-4000-8000-00000000001a', 'status', 'confirmed', 'cancelled_by_customer'),
  ('22222222-2222-2222-2222-222222222222', 'c6610005-0000-4000-8000-00000000000b', 'status', 'confirmed', 'cancelled_by_barber'),
  ('22222222-2222-2222-2222-222222222222', 'c6610005-0000-4000-8000-00000000002b', 'status', 'cancelled_by_barber', 'completed'),
  -- Un campo que no es `status` con el mismo texto no se toca.
  ('22222222-2222-2222-2222-222222222222', 'c6610005-0000-4000-8000-00000000002b', 'note', NULL, 'cancelled_by_barber');

INSERT INTO appointment_notice (business_id, appointment_id, kind, state_at, run_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c6610004-0000-4000-8000-00000000000a',
   'cancelled_by_barber', '2026-01-05 10:00:00-05', '2026-01-05 10:01:00-05'),
  ('22222222-2222-2222-2222-222222222222', 'c6610004-0000-4000-8000-00000000000b',
   'cancelled_by_barber', '2026-01-05 10:00:00-05', '2026-01-05 10:01:00-05'),
  ('22222222-2222-2222-2222-222222222222', 'c6610004-0000-4000-8000-00000000001b',
   'rescheduled', '2026-01-05 10:00:00-05', '2026-01-05 10:01:00-05');

-- ---------------------------------------------------------------------------
-- La migración, tal cual está versionada
-- ---------------------------------------------------------------------------
\ir ../migrations/20261122090000_rename_cancelled_by_professional.sql

DO $$
DECLARE
  v_count integer;
BEGIN
  -- Los dos negocios, no solo uno.
  SELECT count(*) INTO v_count FROM appointment
   WHERE id IN ('c6610004-0000-4000-8000-00000000000a', 'c6610004-0000-4000-8000-00000000000b')
     AND status = 'cancelled_by_professional'
     AND updated_at = '2026-01-05T15:00:00Z';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'los turnos cancelados por el profesional de ambos negocios deben pasar al valor nuevo sin mover updated_at (%).', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM appointment
   WHERE id IN ('c6610004-0000-4000-8000-00000000001a', 'c6610004-0000-4000-8000-00000000001b')
     AND status = 'cancelled_by_customer';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'los turnos cancelados por el cliente no deben cambiar.';
  END IF;

  IF (SELECT cancellation_reason FROM appointment WHERE id = 'c6610004-0000-4000-8000-00000000000a') <> 'Imprevisto' THEN
    RAISE EXCEPTION 'el motivo de cancelación se conserva.';
  END IF;

  SELECT count(*) INTO v_count FROM appointment_history
   WHERE id IN ('c6610005-0000-4000-8000-00000000000a', 'c6610005-0000-4000-8000-00000000000b')
     AND event_type = 'appointment_cancelled_by_professional';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'el evento del historial debe pasar al valor nuevo en ambos negocios (%).', v_count;
  END IF;
  IF (SELECT event_type FROM appointment_history WHERE id = 'c6610005-0000-4000-8000-00000000001a')
       <> 'appointment_cancelled_by_customer' THEN
    RAISE EXCEPTION 'los demás eventos no cambian.';
  END IF;

  SELECT count(*) INTO v_count FROM appointment_history_change
   WHERE history_id IN ('c6610005-0000-4000-8000-00000000000a', 'c6610005-0000-4000-8000-00000000000b')
     AND field_name = 'status' AND previous_value = 'confirmed' AND new_value = 'cancelled_by_professional';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'el valor nuevo del cambio de estado debe pasar al vocabulario nuevo (%).', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM appointment_history_change
     WHERE history_id = 'c6610005-0000-4000-8000-00000000002b' AND field_name = 'status'
       AND previous_value = 'cancelled_by_professional' AND new_value = 'completed'
  ) THEN
    RAISE EXCEPTION 'el valor anterior de una corrección también pasa al vocabulario nuevo.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM appointment_history_change
     WHERE history_id = 'c6610005-0000-4000-8000-00000000002b' AND field_name = 'note'
       AND new_value = 'cancelled_by_barber'
  ) THEN
    RAISE EXCEPTION 'solo cambia el campo status.';
  END IF;

  SELECT count(*) INTO v_count FROM appointment_notice
   WHERE appointment_id IN ('c6610004-0000-4000-8000-00000000000a', 'c6610004-0000-4000-8000-00000000000b')
     AND kind = 'cancelled_by_professional' AND status = 'pending';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'los avisos encolados de ambos negocios pasan al valor nuevo (%).', v_count;
  END IF;
  IF (SELECT kind FROM appointment_notice WHERE appointment_id = 'c6610004-0000-4000-8000-00000000001b')
       <> 'rescheduled' THEN
    RAISE EXCEPTION 'los demás avisos no cambian.';
  END IF;

  IF EXISTS (SELECT 1 FROM appointment WHERE status = 'cancelled_by_barber')
     OR EXISTS (SELECT 1 FROM appointment_history WHERE event_type = 'appointment_cancelled_by_barber')
     OR EXISTS (SELECT 1 FROM appointment_history_change
                 WHERE field_name = 'status' AND 'cancelled_by_barber' IN (previous_value, new_value))
     OR EXISTS (SELECT 1 FROM appointment_notice WHERE kind = 'cancelled_by_barber') THEN
    RAISE EXCEPTION 'no debe quedar ningún valor viejo.';
  END IF;

  -- Y el CHECK nuevo rechaza el valor viejo.
  BEGIN
    UPDATE appointment SET status = 'cancelled_by_barber'
     WHERE id = 'c6610004-0000-4000-8000-00000000000a';
    RAISE EXCEPTION 'el CHECK debió rechazar cancelled_by_barber.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

ROLLBACK;
\echo 'migración OK · dos negocios, historial y avisos al vocabulario nuevo; lo demás intacto'
