-- Pruebas SQL de DEC-169: ventana de reserva propia por barbero
-- (barber_booking_policy). Cubren a nivel de base de datos los rangos, la
-- coherencia anticipación < ventana, la unicidad por barbero, la FK compuesta
-- por tenant y el aislamiento RLS entre dos barberías. Validar y decidir qué
-- se escribe vive en el servicio Go (internal/modules/shops).
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/dos_barberias.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f tests/barber_booking_policy.sql
--
-- Requisito del arnés: la conexión debe poder ejecutar `SET ROLE barberia_app`
-- (estandar-base-datos.md §9.8). Todo se revierte con ROLLBACK.
--
-- Cada comprobación falla lanzando una excepción. Si el archivo termina, pasó.

\set ON_ERROR_STOP on

\echo '=== DEC-169 · pruebas de barber_booking_policy ==='

-- ---------------------------------------------------------------------------
-- Estructura: RLS forzada y sin borrado en cascada
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'barber_booking_policy' AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'barber_booking_policy debe tener RLS habilitada y forzada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'barber_booking_policy_barber_fk' AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'barber_booking_policy_barber_fk no puede borrar en cascada.';
  END IF;
END
$$;
\echo 'estructura OK · RLS forzada, FK sin cascada'

-- ---------------------------------------------------------------------------
-- Rangos, coherencia y unicidad dentro de un tenant
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE barberia_app;
SET LOCAL app.barbershop_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO barber (id, barbershop_id, full_name) VALUES
  ('d1690001-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Barbero con ventana propia'),
  ('d1690001-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Barbero que hereda');

-- Valores en los límites de DEC-083/DEC-133: aceptados.
INSERT INTO barber_booking_policy (barbershop_id, barber_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
VALUES ('11111111-1111-1111-1111-111111111111', 'd1690001-0000-4000-8000-000000000001', 0, 90, 1);
UPDATE barber_booking_policy SET min_advance_minutes = 1440, max_advance_days = 2, slot_grid_minutes = 60
WHERE barber_id = 'd1690001-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_case record;
  v_rejected boolean;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('anticipación negativa',            -1,   3, 15),
      ('anticipación mayor que 1440',    1441,   3, 15),
      ('ventana de 0 días',                60,   0, 15),
      ('ventana mayor que 90',             60,  91, 15),
      ('rejilla de 0',                     60,   3,  0),
      ('rejilla mayor que 60',             60,   3, 61),
      ('anticipación igual a la ventana', 1440,  1, 15)
    ) AS t(label, min_advance, max_days, grid)
  LOOP
    v_rejected := false;
    BEGIN
      UPDATE barber_booking_policy
      SET min_advance_minutes = v_case.min_advance,
          max_advance_days    = v_case.max_days,
          slot_grid_minutes   = v_case.grid
      WHERE barber_id = 'd1690001-0000-4000-8000-000000000001';
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'la base debió rechazar: %', v_case.label;
    END IF;
  END LOOP;

  v_rejected := false;
  BEGIN
    INSERT INTO barber_booking_policy (barbershop_id, barber_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
    VALUES ('11111111-1111-1111-1111-111111111111', 'd1690001-0000-4000-8000-000000000001', 30, 3, 20);
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'un barbero no puede tener dos configuraciones propias.';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO barber_booking_policy (barbershop_id, barber_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
    VALUES ('11111111-1111-1111-1111-111111111111', 'd1690001-0000-4000-8000-0000000000ff', 30, 3, 20);
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'la configuración exige un barbero existente de la misma barbería.';
  END IF;
END
$$;
\echo 'rangos, coherencia, unicidad y FK OK'

-- Volver a heredar es borrar la fila; el barbero sigue existiendo.
DELETE FROM barber_booking_policy WHERE barber_id = 'd1690001-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM barber_booking_policy WHERE barber_id = 'd1690001-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'borrar la configuración propia debe dejar al barbero heredando.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM barber WHERE id = 'd1690001-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'volver a heredar no puede afectar al barbero.';
  END IF;
END
$$;
\echo 'volver a heredar OK'

-- Deja una configuración para la prueba de aislamiento.
INSERT INTO barber_booking_policy (barbershop_id, barber_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
VALUES ('11111111-1111-1111-1111-111111111111', 'd1690001-0000-4000-8000-000000000001', 30, 7, 40);

-- ---------------------------------------------------------------------------
-- Aislamiento: la barbería B no ve, no modifica, no borra ni crea filas de A
-- ---------------------------------------------------------------------------
SET LOCAL app.barbershop_id = '22222222-2222-2222-2222-222222222222';

DO $$
DECLARE
  v_count integer;
  v_rejected boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM barber_booking_policy
  WHERE barbershop_id = '11111111-1111-1111-1111-111111111111';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'la barbería B no debe ver configuraciones de A (vio %).', v_count;
  END IF;

  UPDATE barber_booking_policy SET slot_grid_minutes = 5
  WHERE barber_id = 'd1690001-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'la barbería B no debe modificar configuraciones de A.';
  END IF;

  DELETE FROM barber_booking_policy WHERE barber_id = 'd1690001-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'la barbería B no debe borrar configuraciones de A.';
  END IF;

  BEGIN
    INSERT INTO barber_booking_policy (barbershop_id, barber_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
    VALUES ('11111111-1111-1111-1111-111111111111', 'd1690001-0000-4000-8000-000000000002', 30, 3, 20);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'la barbería B no debe crear configuraciones en A.';
  END IF;

  -- Ni siquiera con su propio barbershop_id puede apuntar a un barbero de A:
  -- la FK compuesta lo impide.
  v_rejected := false;
  BEGIN
    INSERT INTO barber_booking_policy (barbershop_id, barber_id, min_advance_minutes, max_advance_days, slot_grid_minutes)
    VALUES ('22222222-2222-2222-2222-222222222222', 'd1690001-0000-4000-8000-000000000002', 30, 3, 20);
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'la barbería B no debe asociar su configuración a un barbero de A.';
  END IF;
END
$$;

SET LOCAL app.barbershop_id = '11111111-1111-1111-1111-111111111111';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM barber_booking_policy
    WHERE barber_id = 'd1690001-0000-4000-8000-000000000001' AND slot_grid_minutes = 40
  ) THEN
    RAISE EXCEPTION 'la configuración de A debe seguir intacta tras los intentos de B.';
  END IF;
END
$$;
\echo 'aislamiento entre barberías OK'

ROLLBACK;

\echo '=== DEC-169 · todas las pruebas pasaron ==='
