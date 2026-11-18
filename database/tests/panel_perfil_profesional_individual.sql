-- Pruebas SQL del issue #294 (DEC-115): perfil del panel del negocio.
-- Cubren a nivel de base de datos el default `shop`, la lista cerrada de
-- perfiles, que cambiar de perfil no toca a los profesionales y el aislamiento RLS
-- entre dos negocios. La orquestación del PATCH vive en el servicio Go
-- (internal/modules/shops), no aquí.
--
-- Uso:
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f testdata/dos_negocios.sql
--   psql "$DATABASE_TEST_URL" -v ON_ERROR_STOP=1 -f tests/panel_perfil_professionalo_individual.sql
--
-- Requisito del arnés: la conexión debe poder ejecutar `SET ROLE agenda_app`
-- (estandar-base-datos.md §9.8), igual que brand_marca_vocabulario.sql.
--
-- Cada comprobación falla lanzando una excepción. Si el archivo termina, pasó.

\set ON_ERROR_STOP on

\echo '=== Issue #294 · pruebas del perfil del panel ==='

-- ---------------------------------------------------------------------------
-- Columna NOT NULL con el default que reproduce el panel anterior
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_col record;
BEGIN
  SELECT is_nullable, column_default INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'business'
    AND column_name = 'panel_profile';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business.panel_profile debe existir.';
  END IF;
  IF v_col.is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'business.panel_profile debe ser NOT NULL.';
  END IF;
  IF v_col.column_default <> '''shop''::text' THEN
    RAISE EXCEPTION 'business.panel_profile: default % distinto de shop.', v_col.column_default;
  END IF;
END
$$;
\echo 'columna OK · panel_profile NOT NULL con default shop'

-- ---------------------------------------------------------------------------
-- Un negocio existente lee `shop`; cambiar de perfil es reversible y no toca
-- a los profesionales (un independiente sigue siendo un negocio con uno solo).
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_profile text;
  v_professionals_before integer;
  v_professionals_after integer;
BEGIN
  SELECT panel_profile INTO v_profile FROM business
   WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_profile <> 'shop' THEN
    RAISE EXCEPTION 'el negocio existente debe leer shop (leyó %).', v_profile;
  END IF;

  SELECT count(*) INTO v_professionals_before FROM professional;

  UPDATE business SET panel_profile = 'solo'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  SELECT panel_profile INTO v_profile FROM business
   WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_profile <> 'solo' THEN
    RAISE EXCEPTION 'el perfil solo no se guardó (leyó %).', v_profile;
  END IF;

  UPDATE business SET panel_profile = 'shop'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  SELECT panel_profile INTO v_profile FROM business
   WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_profile <> 'shop' THEN
    RAISE EXCEPTION 'volver a shop no se guardó (leyó %).', v_profile;
  END IF;

  SELECT count(*) INTO v_professionals_after FROM professional;
  IF v_professionals_after <> v_professionals_before THEN
    RAISE EXCEPTION 'cambiar de perfil alteró a los profesionales (% → %).', v_professionals_before, v_professionals_after;
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'perfil OK · default shop, cambio reversible y sin efecto sobre los profesionales'

-- ---------------------------------------------------------------------------
-- CHECK: cualquier valor fuera de la lista cerrada se rechaza en la base
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_value text;
BEGIN
  FOREACH v_value IN ARRAY ARRAY['', 'Solo', 'SHOP', 'individual', 'team', ' solo']
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE business SET panel_profile = %L WHERE id = %L',
        v_value, '11111111-1111-1111-1111-111111111111');
      RAISE EXCEPTION 'se aceptó panel_profile = % (esperaba business_panel_profile_ck).', v_value;
    EXCEPTION
      WHEN check_violation THEN
        NULL; -- Esperado.
    END;
  END LOOP;
END
$$;

RESET ROLE;
ROLLBACK;
\echo 'CHECK OK · un perfil fuera de la lista cerrada se rechaza'

-- ---------------------------------------------------------------------------
-- RLS: un tenant no lee ni modifica el perfil de otro
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE agenda_app;
SET LOCAL app.business_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_rows integer;
  v_visible integer;
BEGIN
  UPDATE business SET panel_profile = 'solo'
   WHERE id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'RLS: el tenant A modificó el perfil del tenant B (% filas).', v_rows;
  END IF;

  SELECT count(*) INTO v_visible FROM business
   WHERE id = '22222222-2222-2222-2222-222222222222';
  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'RLS: el tenant A puede leer el perfil del tenant B.';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;

-- El negocio B conserva su perfil inicial tras el intento anterior.
DO $$
DECLARE
  v_profile text;
BEGIN
  SELECT panel_profile INTO v_profile FROM business
   WHERE id = '22222222-2222-2222-2222-222222222222';
  IF v_profile <> 'shop' THEN
    RAISE EXCEPTION 'el perfil del tenant B cambió a % tras el intento del tenant A.', v_profile;
  END IF;
END
$$;
\echo 'RLS OK · el tenant A no lee ni escribe el perfil del tenant B'

\echo '=== Issue #294 · todas las pruebas pasaron ==='
