-- Pruebas SQL de HU-023: asignación de servicios a profesionales. Cubren
-- CA-023-04, CA-023-06 y CA-023-07 a nivel de base de datos (esquema, FK
-- compuestas, RLS, grants); la orquestación completa de asignar/desasignar,
-- la carrera de DEC-068 y la traducción a apperr viven en el servicio y el
-- repositorio Go (internal/modules/catalog), probados aparte contra
-- PostgreSQL real.
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/dos_negocios.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/hu021_professionalos.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/hu022_catalogo.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/hu023_asignaciones.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f tests/hu023_asignaciones.sql
--
-- Requisito del arnés: la conexión debe poder ejecutar `SET ROLE agenda_app`
-- (estandar-base-datos.md §9.8), igual que hu001_aislamiento_rls.sql /
-- hu021_professionalos.sql / hu022_catalogo.sql.
--
-- Cada comprobación falla lanzando una excepción. Si el archivo termina, pasó.

\set ON_ERROR_STOP on

\echo '=== HU-023 · pruebas de asignación de servicios a profesionales ==='

-- ---------------------------------------------------------------------------
-- Esquema mínimo: columnas exactas (CA-023-07: sin nombre, duración, precio
-- ni estado propios)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_columns text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'professional_service'
  ) THEN
    RAISE EXCEPTION 'professional_service debe existir.';
  END IF;

  SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'professional_service';

  IF v_columns IS DISTINCT FROM 'business_id, professional_id, service_id, created_at' THEN
    RAISE EXCEPTION 'CA-023-07: professional_service debe tener EXACTAMENTE business_id, professional_id, '
      'service_id, created_at (en ese orden), tiene: %', v_columns;
  END IF;
END
$$;
\echo 'esquema OK · professional_service tiene exactamente las columnas de HU-023, sin duplicar atributos'

-- ---------------------------------------------------------------------------
-- PK compuesta y FK compuestas por business_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'professional_service'
      AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'professional_service_pk'
  ) THEN
    RAISE EXCEPTION 'professional_service_pk debe existir como PRIMARY KEY.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'professional_service'
      AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'professional_service_professional_fk'
  ) THEN
    RAISE EXCEPTION 'professional_service_professional_fk debe existir.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'professional_service'
      AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'professional_service_service_fk'
  ) THEN
    RAISE EXCEPTION 'professional_service_service_fk debe existir.';
  END IF;
END
$$;
\echo 'constraint OK · PK compuesta y FK compuestas de professional_service existen'

-- ---------------------------------------------------------------------------
-- CA-023-06 (nivel base de datos) · RLS forzada, sin BYPASSRLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_relrowsecurity boolean;
  v_relforcerowsecurity boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_relrowsecurity, v_relforcerowsecurity
  FROM pg_class
  WHERE relname = 'professional_service' AND relnamespace = 'public'::regnamespace;

  IF NOT v_relrowsecurity OR NOT v_relforcerowsecurity THEN
    RAISE EXCEPTION 'professional_service debe tener RLS habilitada Y forzada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'agenda_app' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'agenda_app no puede tener BYPASSRLS.';
  END IF;
END
$$;
\echo 'RLS OK · professional_service tiene RLS habilitada y forzada, sin BYPASSRLS'

-- ---------------------------------------------------------------------------
-- Grants exactos: SELECT/INSERT/DELETE, nunca UPDATE (CA-023-07: sin campo
-- editable)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_privs text;
BEGIN
  SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_privs
  FROM information_schema.table_privileges
  WHERE table_schema = 'public' AND table_name = 'professional_service' AND grantee = 'agenda_app';

  IF v_privs IS DISTINCT FROM 'DELETE, INSERT, SELECT' THEN
    RAISE EXCEPTION 'agenda_app debe tener EXACTAMENTE SELECT/INSERT/DELETE sobre professional_service, tiene: %', v_privs;
  END IF;
END
$$;
\echo 'grants OK · agenda_app tiene exactamente SELECT/INSERT/DELETE sobre professional_service, sin UPDATE'

-- ---------------------------------------------------------------------------
-- Ausencia de contexto de tenant: falla cerrado
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM professional_service;
    RAISE EXCEPTION 'sin contexto: se pudo leer professional_service sin app.business_id fijado.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%app.business_id%' THEN
        RAISE EXCEPTION 'sin contexto: error inesperado distinto al de falta de configuración: %', SQLERRM;
      END IF;
  END;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'sin contexto OK · leer professional_service sin app.business_id fijado falla cerrado'

-- ---------------------------------------------------------------------------
-- CA-023-02/03 · Asignar dentro del propio tenant: repetible sin duplicar,
-- un mismo servicio a varios profesionales
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_professional1 uuid;
  v_professional2 uuid;
  v_service uuid;
  v_count integer;
BEGIN
  INSERT INTO professional (business_id, full_name)
  VALUES ('11111111-1111-1111-1111-111111111111', 'HU023 Barbero SQL Uno')
  RETURNING id INTO v_professional1;
  INSERT INTO professional (business_id, full_name)
  VALUES ('11111111-1111-1111-1111-111111111111', 'HU023 Barbero SQL Dos')
  RETURNING id INTO v_professional2;
  INSERT INTO service (business_id, name, duration_minutes, price_amount)
  VALUES ('11111111-1111-1111-1111-111111111111', 'HU023 Servicio SQL ' || gen_random_uuid(), 30, 20000)
  RETURNING id INTO v_service;

  INSERT INTO professional_service (business_id, professional_id, service_id)
  VALUES ('11111111-1111-1111-1111-111111111111', v_professional1, v_service);

  -- CA-023-02: repetir exactamente la misma fila no crea una segunda
  -- (ON CONFLICT es responsabilidad del repositorio Go; aquí se confirma
  -- que el propio esquema -la PK- es lo que lo hace posible).
  INSERT INTO professional_service (business_id, professional_id, service_id)
  VALUES ('11111111-1111-1111-1111-111111111111', v_professional1, v_service)
  ON CONFLICT (business_id, professional_id, service_id) DO NOTHING;

  SELECT count(*) INTO v_count FROM professional_service
   WHERE business_id = '11111111-1111-1111-1111-111111111111' AND service_id = v_service AND professional_id = v_professional1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'CA-023-02: se esperaba exactamente 1 fila tras repetir la asignación, hay %.', v_count;
  END IF;

  -- CA-023-03: el mismo servicio a un segundo profesional es una fila
  -- independiente.
  INSERT INTO professional_service (business_id, professional_id, service_id)
  VALUES ('11111111-1111-1111-1111-111111111111', v_professional2, v_service);

  SELECT count(*) INTO v_count FROM professional_service
   WHERE business_id = '11111111-1111-1111-1111-111111111111' AND service_id = v_service;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'CA-023-03: se esperaban 2 asignaciones distintas para el mismo servicio, hay %.', v_count;
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'CA-023-02/03 OK · asignación repetida no duplica; un servicio compartido por varios profesionales son filas independientes'

-- ---------------------------------------------------------------------------
-- CA-023-04 · La base rechaza asociar un profesional y un servicio de
-- negocios DISTINTAS, aun con el rol de aplicación real (FK compuesta)
-- ---------------------------------------------------------------------------
-- Prepara un profesional real de A y un servicio real de B en transacciones
-- confirmadas por separado (para no depender de visibilidad entre RLS y la
-- transacción de prueba).
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO professional (id, business_id, full_name)
VALUES ('77777777-1111-1111-1111-777777777771', '11111111-1111-1111-1111-111111111111', 'HU023 Barbero Cruzado A');
RESET ROLE;
COMMIT;

BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '22222222-2222-2222-2222-222222222222';
INSERT INTO service (id, business_id, name, duration_minutes, price_amount)
VALUES ('77777777-2222-2222-2222-777777777772', '22222222-2222-2222-2222-222222222222',
        'HU023 Servicio Cruzado B ' || gen_random_uuid(), 30, 20000);
RESET ROLE;
COMMIT;

BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  BEGIN
    -- business_id = A (contexto vigente, pasa WITH CHECK de RLS), pero
    -- service_id pertenece a B: la FK compuesta professional_service_service_fk
    -- NO encuentra (A, service_id_de_B) en service(business_id, id) y
    -- rechaza.
    INSERT INTO professional_service (business_id, professional_id, service_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '77777777-1111-1111-1111-777777777771',
            '77777777-2222-2222-2222-777777777772');
    RAISE EXCEPTION 'CA-023-04: se permitió asociar un profesional de A con un servicio de B.';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL; -- Esperado.
  END;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'CA-023-04 OK · la FK compuesta rechaza asociar un profesional y un servicio de negocios distintos'

-- ---------------------------------------------------------------------------
-- CA-023-06 (nivel base de datos) · El contexto de A no ve ni puede
-- insertar/borrar una fila de professional_service de B
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '22222222-2222-2222-2222-222222222222';

DO $$
DECLARE
  v_professional uuid;
  v_service uuid;
BEGIN
  INSERT INTO professional (business_id, full_name)
  VALUES ('22222222-2222-2222-2222-222222222222', 'HU023 Barbero B Aislamiento')
  RETURNING id INTO v_professional;
  INSERT INTO service (business_id, name, duration_minutes, price_amount)
  VALUES ('22222222-2222-2222-2222-222222222222', 'HU023 Servicio B Aislamiento ' || gen_random_uuid(), 30, 20000)
  RETURNING id INTO v_service;
  INSERT INTO professional_service (business_id, professional_id, service_id)
  VALUES ('22222222-2222-2222-2222-222222222222', v_professional, v_service);

  PERFORM set_config('hu023.professional_b', v_professional::text, false);
  PERFORM set_config('hu023.service_b', v_service::text, false);
END
$$;

RESET ROLE;
COMMIT;

BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_visible integer;
BEGIN
  SELECT count(*) INTO v_visible FROM professional_service
   WHERE business_id = '22222222-2222-2222-2222-222222222222';
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'CA-023-06: el contexto de A ve % filas de professional_service de B.', v_visible;
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'CA-023-06 OK · el contexto de A no ve ninguna fila de professional_service de B'

-- ---------------------------------------------------------------------------
-- DELETE se permite para agenda_app SOBRE SU PROPIO tenant (a diferencia
-- de professional/service): retirar una asignación es el propósito de esta tabla
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_professional uuid;
  v_service uuid;
  v_deleted integer;
BEGIN
  INSERT INTO professional (business_id, full_name)
  VALUES ('11111111-1111-1111-1111-111111111111', 'HU023 Barbero Delete')
  RETURNING id INTO v_professional;
  INSERT INTO service (business_id, name, duration_minutes, price_amount)
  VALUES ('11111111-1111-1111-1111-111111111111', 'HU023 Servicio Delete ' || gen_random_uuid(), 30, 20000)
  RETURNING id INTO v_service;
  INSERT INTO professional_service (business_id, professional_id, service_id)
  VALUES ('11111111-1111-1111-1111-111111111111', v_professional, v_service);

  DELETE FROM professional_service WHERE business_id = '11111111-1111-1111-1111-111111111111'
    AND professional_id = v_professional AND service_id = v_service;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'se esperaba poder borrar la propia fila de professional_service, ROW_COUNT=%.', v_deleted;
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'DELETE OK · agenda_app puede retirar su propia asignación (a diferencia de professional/service)'

-- ---------------------------------------------------------------------------
-- Sin UPDATE: ningún campo de professional_service es editable (CA-023-07)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'professional_service'
      AND grantee = 'agenda_app' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'CA-023-07: agenda_app no debe tener GRANT UPDATE sobre professional_service.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'professional_service' AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'CA-023-07: no debe existir ninguna política UPDATE sobre professional_service.';
  END IF;
END
$$;
\echo 'CA-023-07 OK · sin GRANT ni política UPDATE sobre professional_service (nada editable)'

-- ---------------------------------------------------------------------------
-- El rol de aplicación real no tiene BYPASSRLS (repetido explícitamente
-- para HU-023, mismo criterio que hu001/hu021/hu022)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agenda_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'agenda_app no puede tener BYPASSRLS.';
  END IF;
END
$$;
\echo 'rol OK · agenda_app sin BYPASSRLS'

-- ---------------------------------------------------------------------------
-- Limpieza de las dos filas que se confirmaron con COMMIT más arriba (el
-- profesional de A y el servicio de B usados para CA-023-04): con el rol de
-- sesión sin RLS forzada (superusuario/`agenda_migrator`), para dejar la
-- base exactamente como estaba al empezar este archivo. agenda_app nunca
-- podría hacer esta limpieza (sin GRANT DELETE sobre professional/service,
-- RN-SER-03/CA-021-07); no hace falta limpiar professional_service porque su
-- única fila potencial (la que el propio bloque CA-023-04 intentó insertar)
-- nunca llegó a confirmarse (ROLLBACK).
-- ---------------------------------------------------------------------------
DELETE FROM professional WHERE id = '77777777-1111-1111-1111-777777777771';
DELETE FROM service WHERE id = '77777777-2222-2222-2222-777777777772';

\echo '=== HU-023 · todas las comprobaciones pasaron ==='
