-- Propósito
--   HU-105 (DEC-178): reto de un solo uso con el que una persona sin el enlace de
--   su turno entra a cambiar la hora. Crea `customer_access_challenge`: cada
--   solicitud de código deja una fila, con o sin cliente detrás, y la
--   verificación consume una sola vez el código vigente.
--
-- Reglas y decisiones
--   RN-DAT-01 y RN-DAT-02 (nada sensible en logs: el código se guarda solo como
--   HMAC y el contacto y la IP solo como HMAC), RN-TEN-01 (una barbería nunca ve
--   los retos de otra: RLS), DEC-062 (misma política de código que el reto del
--   personal: 6 dígitos, HMAC con secreto de despliegue, intentos acotados),
--   DEC-178 (10 minutos, 5 intentos, un solo uso, 3 solicitudes por contacto cada
--   15 minutos y un límite por IP, respuesta uniforme).
--
-- Decisiones de diseño
--   * Una fila por SOLICITUD, también cuando el contacto no corresponde a ningún
--     cliente con un turno futuro confirmado (`customer_id` y `code_hash` NULL).
--     Si solo contaran las solicitudes que sí envían, el límite de 3 por contacto
--     respondería 429 únicamente a contactos reales y delataría cuáles lo son
--     (CA-105-01 y CA-105-03).
--   * El límite por contacto y por IP se calcula sobre esta misma tabla
--     (`created_at` dentro de la ventana), sin una tabla de contadores aparte.
--     Es por barbería: como `barberia_app` solo ve su tenant, repartir solicitudes
--     entre barberías no diluye el límite de cada una.
--   * No hay `DELETE` para `barberia_app`. El worker purga los vencidos con
--     `customer_access_challenge_purge_expired`.
--
-- Condición de seguridad
--   Se ejecuta con `barberia_migrator`, que hereda los privilegios de
--   `barberia_owner`. La función de purga es `SECURITY DEFINER` con
--   `search_path=''` y se concede solo a `barberia_worker`.
--
-- Plan de avance
--   Una corrección posterior se hace con otra migración, nunca editando esta
--   (DEC-036). No existe archivo `down`: el mecanismo normal es roll-forward.

-- ---------------------------------------------------------------------------
-- 1. Precondiciones
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberia_owner')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberia_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberia_worker') THEN
    RAISE EXCEPTION
      'Esta migración depende de 20260811145252_harden_roles_and_definer_functions.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20260827110000_create_appointment_core.sql (customer); '
      'esa migración debe estar aplicada antes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_access_challenge'
  ) THEN
    RAISE EXCEPTION 'customer_access_challenge ya existe: esta migración no puede aplicarse dos veces.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. `customer_access_challenge`
-- ---------------------------------------------------------------------------

CREATE TABLE customer_access_challenge (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  barbershop_id uuid        NOT NULL,
  -- NULL cuando el contacto no corresponde a un cliente con un turno futuro
  -- confirmado: la fila solo cuenta para el límite y nunca se envía ni se verifica.
  customer_id   uuid,
  channel       text        NOT NULL,
  contact_hash  text        NOT NULL,
  ip_hash       text        NOT NULL,
  code_hash     text,
  attempts      integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,

  CONSTRAINT customer_access_challenge_id_pk PRIMARY KEY (id),

  CONSTRAINT customer_access_challenge_barbershop_id_fk
    FOREIGN KEY (barbershop_id) REFERENCES barbershop (id) ON DELETE RESTRICT,
  CONSTRAINT customer_access_challenge_barbershop_id_customer_id_fk
    FOREIGN KEY (barbershop_id, customer_id)
    REFERENCES customer (barbershop_id, id) ON DELETE RESTRICT,

  CONSTRAINT customer_access_challenge_channel_ck CHECK (channel IN ('email', 'whatsapp')),
  -- DDL-VAL-01: hexadecimal minúscula de 64 caracteres (HMAC-SHA256), no solo longitud.
  CONSTRAINT customer_access_challenge_contact_hash_ck CHECK (contact_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_access_challenge_ip_hash_ck CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_access_challenge_code_hash_ck CHECK (
    code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'
  ),
  -- Una fila con cliente lleva código y una sin cliente no.
  CONSTRAINT customer_access_challenge_decoy_ck CHECK (
    (customer_id IS NULL) = (code_hash IS NULL)
  ),
  CONSTRAINT customer_access_challenge_attempts_ck CHECK (attempts >= 0),
  CONSTRAINT customer_access_challenge_expires_at_ck CHECK (expires_at > created_at),
  -- DDL-TMP-01: solo se consume un reto que tiene código, y no antes de crearse.
  CONSTRAINT customer_access_challenge_consumed_at_ck CHECK (
    consumed_at IS NULL OR (code_hash IS NOT NULL AND consumed_at >= created_at)
  )
);

COMMENT ON TABLE customer_access_challenge IS
  'Reto de un solo uso para entrar al turno sin el enlace (HU-105, DEC-178). Propietario funcional: '
  'barbería. Retención: hasta expires_at; el worker purga los vencidos. Clasificación: secreto. '
  'contact_hash, ip_hash y code_hash son HMAC-SHA256 con el secreto de despliegue (DEC-062): el '
  'contacto, la IP y el código nunca se guardan en claro. Una fila sin customer_id es un señuelo '
  'que solo cuenta para el límite, para que el 429 no delate qué contactos existen.';

COMMENT ON COLUMN customer_access_challenge.contact_hash IS
  'HMAC del contacto normalizado (correo en minúsculas o teléfono E.164). Sirve para el límite por '
  'contacto y para encontrar el reto al verificar.';

-- Límite por contacto y por IP: cuentan las solicitudes recientes de la barbería.
CREATE INDEX idx_customer_access_challenge_shop_contact_created
  ON customer_access_challenge (barbershop_id, contact_hash, created_at DESC);
CREATE INDEX idx_customer_access_challenge_shop_ip_created
  ON customer_access_challenge (barbershop_id, ip_hash, created_at DESC);
-- Purga del worker.
CREATE INDEX idx_customer_access_challenge_expires_at
  ON customer_access_challenge (expires_at);
-- La clave foránea compuesta hacia customer necesita su propio índice (DDL-PER-02).
CREATE INDEX idx_customer_access_challenge_shop_customer
  ON customer_access_challenge (barbershop_id, customer_id)
  WHERE customer_id IS NOT NULL;

ALTER TABLE customer_access_challenge ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_access_challenge FORCE  ROW LEVEL SECURITY;

CREATE POLICY customer_access_challenge_all_admin_policy ON customer_access_challenge
  FOR ALL TO barberia_owner USING (true) WITH CHECK (true);
CREATE POLICY customer_access_challenge_select_tenant_policy ON customer_access_challenge
  FOR SELECT TO barberia_app USING (barbershop_id = current_setting('app.barbershop_id')::uuid);
CREATE POLICY customer_access_challenge_insert_tenant_policy ON customer_access_challenge
  FOR INSERT TO barberia_app WITH CHECK (barbershop_id = current_setting('app.barbershop_id')::uuid);
CREATE POLICY customer_access_challenge_update_tenant_policy ON customer_access_challenge
  FOR UPDATE TO barberia_app
  USING      (barbershop_id = current_setting('app.barbershop_id')::uuid)
  WITH CHECK (barbershop_id = current_setting('app.barbershop_id')::uuid);

-- Sin DELETE para la aplicación: la purga es del worker, por la función de abajo.
GRANT SELECT, INSERT, UPDATE ON TABLE customer_access_challenge TO barberia_app;

-- ---------------------------------------------------------------------------
-- 3. Purga de retos vencidos (solo `barberia_worker`)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION customer_access_challenge_purge_expired(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'customer_access_challenge_purge_expired: p_limit fuera de rango (1-1000).';
  END IF;

  -- Se conserva una hora más allá del vencimiento: la ventana del límite por contacto
  -- y por IP es de 15 minutos y no debe perder filas que todavía cuentan.
  WITH due AS (
    SELECT id FROM public.customer_access_challenge
    WHERE expires_at <= pg_catalog.now() - interval '1 hour'
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.customer_access_challenge
  WHERE id IN (SELECT id FROM due);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL     ON FUNCTION customer_access_challenge_purge_expired(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION customer_access_challenge_purge_expired(integer) TO barberia_worker;

COMMENT ON FUNCTION customer_access_challenge_purge_expired(integer) IS
  'Mantenimiento del worker: purga en lote los retos vencidos hace más de una hora. Exclusivo de '
  'barberia_worker.';
