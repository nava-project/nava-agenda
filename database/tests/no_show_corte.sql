-- Pruebas SQL del issue #854 (DEC-193): un turno `no_show` ocupa la agenda solo
-- hasta el minuto en que se marca (`no_show_cut_at`), con el criterio único
-- `appointment_occupied_until` que usan la exclusión y las lecturas.
--
-- Cubre:
--   * el esquema: la exclusión conserva su nombre exacto (el API traduce su
--     violación a 409 comparando por nombre) y usa la función; la función es
--     IMMUTABLE; no hay CHECK que ate el corte al estado (migración expand);
--   * el API anterior sobre el esquema nuevo: un UPDATE a `no_show` sin corte
--     pasa y ocupa la franja entera;
--   * el corte: un turno que empieza justo en el corte entra; uno que empieza
--     un minuto antes choca; el corte en el inicio libera todo; el corte
--     después del fin no libera nada;
--   * revertir (T8): un `no_show` que vuelve a `completed` con el tramo ya
--     tomado viola la exclusión; un corte que queda en otro estado no cuenta;
--   * dos negocios: el corte de uno no cambia nada en el otro, y RLS sigue
--     aislando las filas.
--
-- Todo corre como agenda_app dentro de una transacción y se revierte con
-- ROLLBACK. Uso (desde la raíz del repositorio, tras testdata/hu060_citas.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/no_show_corte.sql

\set ON_ERROR_STOP on

\echo '=== Issue #854 · el no_show ocupa hasta el minuto de la marca (DEC-193) ==='

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'appointment_professional_interval_excl'
     AND conrelid = 'public.appointment'::regclass
     AND contype = 'x';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'falta la exclusión appointment_professional_interval_excl con ese nombre exacto.';
  END IF;
  IF v_def NOT LIKE '%appointment_occupied_until(status, starts_at, ends_at, no_show_cut_at)%'
     OR v_def NOT LIKE '%WHERE (occupies_schedule)%' THEN
    RAISE EXCEPTION 'la exclusión debe usar appointment_occupied_until y occupies_schedule: %', v_def;
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE proname = 'appointment_occupied_until') <> 'i' THEN
    RAISE EXCEPTION 'appointment_occupied_until debe ser IMMUTABLE.';
  END IF;
  -- 20261125150000: la exclusión se construye como dueño de la tabla, que puede
  -- ser agenda_owner (BD local, restauraciones). El GRANT debe ser explícito: en
  -- CI la función la crea el superusuario y PUBLIC conserva EXECUTE, lo que
  -- taparía su falta; en producción y en local PUBLIC no lo tiene.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.proname = 'appointment_occupied_until'
       AND a.grantee = 'agenda_owner'::regrole AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'agenda_owner debe tener EXECUTE explícito en appointment_occupied_until.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.appointment'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%no_show_cut_at%'
  ) THEN
    RAISE EXCEPTION 'ningún CHECK debe atar no_show_cut_at al estado (migración expand).';
  END IF;
END
$$;
\echo 'esquema OK · exclusión con su nombre, sobre appointment_occupied_until; sin CHECK del corte'

-- ---------------------------------------------------------------------------
-- La función, caso por caso
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  s timestamptz := '2027-06-01T10:00:00Z';
  e timestamptz := '2027-06-01T11:00:00Z';
BEGIN
  IF appointment_occupied_until('confirmed', s, e, NULL) <> e
     OR appointment_occupied_until('completed', s, e, '2027-06-01T10:10:00Z') <> e
     OR appointment_occupied_until('no_show', s, e, NULL) <> e
     OR appointment_occupied_until('no_show', s, e, '2027-06-01T10:10:00Z') <> '2027-06-01T10:10:00Z'
     OR appointment_occupied_until('no_show', s, e, '2027-06-01T09:00:00Z') <> s
     OR appointment_occupied_until('no_show', s, e, '2027-06-01T12:00:00Z') <> e THEN
    RAISE EXCEPTION 'appointment_occupied_until no devuelve lo esperado.';
  END IF;
END
$$;
\echo 'función OK · ends_at salvo no_show con corte, acotado a [starts_at, ends_at]'

BEGIN;

-- Inserta un turno de Q-2 (negocio Q) o de R-1 (negocio R) y devuelve su id.
CREATE FUNCTION pg_temp.turno(p_shop uuid, p_professional uuid, p_service uuid, p_customer uuid,
                              p_starts text, p_minutes int, p_name text)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO appointment (
    business_id, professional_id, service_id, customer_id, attendee_name,
    starts_at, ends_at, status, origin,
    service_name_snapshot, duration_minutes_snapshot, price_amount_snapshot, price_currency_snapshot
  ) VALUES (
    p_shop, p_professional, p_service, p_customer, p_name,
    p_starts::timestamptz, p_starts::timestamptz + make_interval(mins => p_minutes), 'confirmed', 'manual',
    'Corte de prueba', p_minutes, 20000.00, 'COP'
  ) RETURNING id
$$;

-- Afirma que insertar ese turno viola la exclusión (409 en el API).
CREATE FUNCTION pg_temp.choca(p_shop uuid, p_professional uuid, p_service uuid, p_customer uuid,
                              p_starts text, p_minutes int, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.turno(p_shop, p_professional, p_service, p_customer, p_starts, p_minutes, 'Debe chocar');
  RAISE EXCEPTION '%', p_msg;
EXCEPTION
  WHEN exclusion_violation THEN NULL;
END
$$;

-- Clientes de prueba en los dos negocios (RLS: cada uno con su app.business_id).
SET ROLE agenda_app;
SET LOCAL app.business_id = 'c17a0002-c17a-c17a-c17a-c17a00020002';
INSERT INTO customer (id, business_id, full_name)
  VALUES ('85400000-0000-4000-8000-000000000002', 'c17a0002-c17a-c17a-c17a-c17a00020002', 'Cliente corte R');
SET LOCAL app.business_id = 'c17a0001-c17a-c17a-c17a-c17a00010001';
INSERT INTO customer (id, business_id, full_name)
  VALUES ('85400000-0000-4000-8000-000000000001', 'c17a0001-c17a-c17a-c17a-c17a00010001', 'Cliente corte Q');

DO $$
DECLARE
  q  uuid := 'c17a0001-c17a-c17a-c17a-c17a00010001';
  p  uuid := 'c17a1002-1002-1002-1002-100210021002';
  sv uuid := 'c17a5001-5001-5001-5001-500150015001';
  c  uuid := '85400000-0000-4000-8000-000000000001';
  v_id uuid;
  v_otro uuid;
BEGIN
  -- API anterior: marca no_show sin corte. Pasa y ocupa la franja entera.
  v_id := pg_temp.turno(q, p, sv, c, '2027-06-01T10:00:00Z', 60, 'API vieja');
  UPDATE appointment SET status = 'no_show', resolved_at = now() WHERE id = v_id;
  PERFORM pg_temp.choca(q, p, sv, c, '2027-06-01T10:30:00Z', 30,
    'API vieja: un no_show sin corte debe seguir ocupando su franja entera.');

  -- Corte a las 12:10 en un turno de 12:00 a 13:00: libre desde 12:10.
  v_id := pg_temp.turno(q, p, sv, c, '2027-06-01T12:00:00Z', 60, 'Corte 12:10');
  UPDATE appointment SET status = 'no_show', resolved_at = now(), no_show_cut_at = '2027-06-01T12:10:00Z'
   WHERE id = v_id;
  PERFORM pg_temp.choca(q, p, sv, c, '2027-06-01T12:09:00Z', 30,
    'corte 12:10: un turno que empieza 12:09 debe chocar.');
  v_otro := pg_temp.turno(q, p, sv, c, '2027-06-01T12:10:00Z', 30, 'Entra en el tramo liberado');

  -- Revertir (T8): el no_show vuelve a completed con el tramo ya tomado.
  BEGIN
    UPDATE appointment SET status = 'completed', resolved_at = now(), no_show_cut_at = NULL WHERE id = v_id;
    RAISE EXCEPTION 'T8: volver a completed con el tramo tomado debe violar la exclusión.';
  EXCEPTION
    WHEN exclusion_violation THEN NULL;
  END;

  -- Con el turno de 12:10 cancelado, revertir sí pasa y vuelve a ocupar entera.
  UPDATE appointment SET status = 'cancelled_by_professional', resolved_at = now() WHERE id = v_otro;
  UPDATE appointment SET status = 'completed', resolved_at = now(), no_show_cut_at = NULL WHERE id = v_id;
  PERFORM pg_temp.choca(q, p, sv, c, '2027-06-01T12:30:00Z', 30,
    'T8: un completed debe volver a ocupar su franja entera.');

  -- Un corte que queda en otro estado (API anterior corrigiendo) no cuenta.
  v_id := pg_temp.turno(q, p, sv, c, '2027-06-01T14:00:00Z', 60, 'Corte en otro estado');
  UPDATE appointment SET status = 'completed', resolved_at = now(), no_show_cut_at = '2027-06-01T14:05:00Z'
   WHERE id = v_id;
  PERFORM pg_temp.choca(q, p, sv, c, '2027-06-01T14:30:00Z', 30,
    'un corte en un turno completed no debe liberar nada.');

  -- Corte justo en el inicio: rango vacío, libera toda la franja.
  v_id := pg_temp.turno(q, p, sv, c, '2027-06-01T16:00:00Z', 60, 'Corte en el inicio');
  UPDATE appointment SET status = 'no_show', resolved_at = now(), no_show_cut_at = '2027-06-01T16:00:00Z'
   WHERE id = v_id;
  PERFORM pg_temp.turno(q, p, sv, c, '2027-06-01T16:00:00Z', 60, 'Ocupa toda la franja liberada');

  -- Corte después del fin (cierre del día): no libera nada.
  v_id := pg_temp.turno(q, p, sv, c, '2027-06-01T18:00:00Z', 60, 'Corte tras el fin');
  UPDATE appointment SET status = 'no_show', resolved_at = now(), no_show_cut_at = '2027-06-01T20:00:00Z'
   WHERE id = v_id;
  PERFORM pg_temp.choca(q, p, sv, c, '2027-06-01T18:59:00Z', 30,
    'un corte después del fin no debe liberar nada.');
END
$$;
\echo 'corte OK · API vieja ocupa entera; 12:10 entra y 12:09 choca; T8 da exclusión; inicio y después del fin'

-- ---------------------------------------------------------------------------
-- Dos negocios: el corte de Q no cambia nada en R, y RLS aísla las filas
-- ---------------------------------------------------------------------------
SET LOCAL app.business_id = 'c17a0002-c17a-c17a-c17a-c17a00020002';
DO $$
DECLARE
  r  uuid := 'c17a0002-c17a-c17a-c17a-c17a00020002';
  p  uuid := 'c17a2001-2001-2001-2001-200120012001';
  sv uuid := 'c17a5002-5002-5002-5002-500250025002';
  c  uuid := '85400000-0000-4000-8000-000000000002';
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM appointment WHERE no_show_cut_at IS NOT NULL) THEN
    RAISE EXCEPTION 'RLS: el negocio R no debe ver los cortes del negocio Q.';
  END IF;
  -- El mismo horario que en Q, en R: otro negocio, ningún choque.
  v_id := pg_temp.turno(r, p, sv, c, '2027-06-01T12:00:00Z', 45, 'Turno de R');
  UPDATE appointment SET status = 'no_show', resolved_at = now(), no_show_cut_at = '2027-06-01T12:10:00Z'
   WHERE id = v_id;
  PERFORM pg_temp.choca(r, p, sv, c, '2027-06-01T12:09:00Z', 1,
    'corte en R: el minuto 12:09 sigue ocupado.');
  PERFORM pg_temp.turno(r, p, sv, c, '2027-06-01T12:10:00Z', 35, 'Entra en R');
  IF (SELECT count(*) FROM appointment WHERE starts_at::date = '2027-06-01') <> 2 THEN
    RAISE EXCEPTION 'RLS: el negocio R solo debe ver sus dos turnos del día.';
  END IF;
END
$$;
\echo 'dos negocios OK · el corte vale en cada negocio y RLS aísla las filas'

RESET ROLE;

-- 20261125150000: con la tabla en manos de agenda_owner (la BD local, o una
-- restauración que deje ese dueño), reconstruir la exclusión la evalúa como
-- agenda_owner. Sin su EXECUTE fallaba con 42501. Dentro de la transacción: el
-- cambio de dueño se revierte con el ROLLBACK.
-- Con la tabla vacía, REINDEX y ANALYZE no evalúan la expresión y pasarían sin
-- el GRANT: este bloque va DESPUÉS de los turnos que insertan los escenarios
-- anteriores, y lo exige.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM appointment WHERE occupies_schedule) THEN
    RAISE EXCEPTION 'la prueba del dueño necesita turnos que ocupen agenda antes del REINDEX y el ANALYZE.';
  END IF;
END
$$;
-- Sin EXECUTE para PUBLIC, como en producción y en local (default de 20260811145252).
REVOKE EXECUTE ON FUNCTION appointment_occupied_until(text, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC;
ALTER TABLE appointment OWNER TO agenda_owner;
REINDEX INDEX appointment_professional_interval_excl;
-- ANALYZE también evalúa la expresión como dueño de la tabla, y es lo que corre autovacuum.
ANALYZE appointment;
\echo 'dueño agenda_owner OK · REINDEX y ANALYZE de la exclusión sin depender del dueño de la tabla'

ROLLBACK;
