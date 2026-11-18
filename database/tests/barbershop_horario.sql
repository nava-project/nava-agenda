-- Pruebas SQL de DEC-182 / HU-107: horario de atención del local
-- (business_opening_hour y business.closed_on_holidays). Cubren a nivel de
-- base de datos el default, las restricciones (día ISO, cierre posterior a la
-- apertura, 24:00 como medianoche, minutos enteros, apertura repetida), que
-- agenda_app no puede modificar filas y el aislamiento RLS entre dos
-- barberías. El solape parcial y el reemplazo de la semana viven en el servicio
-- Go (internal/modules/shops).
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/dos_professionalias.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f tests/business_horario.sql
--
-- Requisito del arnés: la conexión debe poder ejecutar `SET ROLE agenda_app`
-- (estandar-base-datos.md §9.8). Todo se revierte con ROLLBACK.
--
-- Cada comprobación falla lanzando una excepción. Si el archivo termina, pasó.

\set ON_ERROR_STOP on

\echo '=== DEC-182 · pruebas del horario de atención del local ==='

-- ---------------------------------------------------------------------------
-- Default: sin horario y abierto en festivos
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  IF (SELECT closed_on_holidays FROM business WHERE id = '11111111-1111-1111-1111-111111111111') IS NOT FALSE THEN
    RAISE EXCEPTION 'closed_on_holidays debe ser false por defecto.';
  END IF;
  IF EXISTS (SELECT 1 FROM business_opening_hour) THEN
    RAISE EXCEPTION 'una barbería existente no debe tener horario.';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'default OK · sin horario, abierto en festivos'

-- ---------------------------------------------------------------------------
-- Tramos válidos: jornada partida y hasta medianoche (CA-107-01)
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time) VALUES
    ('11111111-1111-1111-1111-111111111111', 1, '09:00', '12:00'),
    ('11111111-1111-1111-1111-111111111111', 1, '14:00', '19:00'),
    ('11111111-1111-1111-1111-111111111111', 5, '20:00', '24:00'),
    ('11111111-1111-1111-1111-111111111111', 6, '00:00', '02:00');
  IF (SELECT count(*) FROM business_opening_hour) <> 4 THEN
    RAISE EXCEPTION 'debían guardarse los cuatro tramos.';
  END IF;
  UPDATE business SET closed_on_holidays = true WHERE id = '11111111-1111-1111-1111-111111111111';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_app debe poder cambiar closed_on_holidays de su barbería.';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'tramos OK · jornada partida, hasta 24:00 y festivos cerrados'

-- ---------------------------------------------------------------------------
-- Restricciones (CA-107-02)
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT * FROM (VALUES
      (0::smallint, '09:00'::time, '10:00'::time, 'día 0'),
      (8::smallint, '09:00'::time, '10:00'::time, 'día 8'),
      (1::smallint, '10:00'::time, '10:00'::time, 'cierre igual a la apertura'),
      (1::smallint, '19:00'::time, '09:00'::time, 'cierre antes de la apertura'),
      (1::smallint, '09:00:30'::time, '10:00'::time, 'segundos en la apertura'),
      (1::smallint, '09:00'::time, '10:00:15'::time, 'segundos en el cierre')
    ) AS t(weekday, opens, closes, label)
  LOOP
    BEGIN
      INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
        VALUES ('11111111-1111-1111-1111-111111111111', bad.weekday, bad.opens, bad.closes);
      RAISE EXCEPTION 'se aceptó un tramo inválido: %', bad.label;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
    VALUES ('11111111-1111-1111-1111-111111111111', 2, '09:00', '12:00');
  BEGIN
    INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
      VALUES ('11111111-1111-1111-1111-111111111111', 2, '09:00', '13:00');
    RAISE EXCEPTION 'se aceptó una apertura repetida en el mismo día.';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'restricciones OK · día ISO, cierre > apertura, minutos enteros, apertura única'

-- ---------------------------------------------------------------------------
-- agenda_app no modifica filas: guardar es reemplazar la semana
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
  VALUES ('11111111-1111-1111-1111-111111111111', 3, '09:00', '18:00');

DO $$
BEGIN
  BEGIN
    UPDATE business_opening_hour SET closes_time = '20:00';
    RAISE EXCEPTION 'agenda_app no debe poder hacer UPDATE en business_opening_hour.';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  DELETE FROM business_opening_hour;
  IF EXISTS (SELECT 1 FROM business_opening_hour) THEN
    RAISE EXCEPTION 'agenda_app debe poder borrar el horario de su barbería.';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'privilegios OK · sin UPDATE, con DELETE + INSERT'

-- ---------------------------------------------------------------------------
-- Aislamiento RLS entre dos barberías (CA-107-03)
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
  VALUES ('11111111-1111-1111-1111-111111111111', 4, '08:00', '17:00');

SET LOCAL app.business_id = '22222222-2222-2222-2222-222222222222';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_opening_hour) THEN
    RAISE EXCEPTION 'la barbería B ve el horario de la barbería A.';
  END IF;

  DELETE FROM business_opening_hour WHERE business_id = '11111111-1111-1111-1111-111111111111';

  BEGIN
    INSERT INTO business_opening_hour (business_id, iso_weekday, opens_time, closes_time)
      VALUES ('11111111-1111-1111-1111-111111111111', 4, '18:00', '20:00');
    RAISE EXCEPTION 'la barbería B insertó un tramo en el horario de la barbería A.';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  IF (SELECT count(*) FROM business_opening_hour) <> 1 THEN
    RAISE EXCEPTION 'el DELETE de la barbería B no debía tocar el horario de la barbería A.';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'RLS OK · ninguna barbería ve, borra ni inserta el horario de otra'
