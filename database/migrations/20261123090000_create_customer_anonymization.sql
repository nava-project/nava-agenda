-- Propósito
--   Issue #693 (DEC-185): la anonimización de clientes 24 meses después de su
--   última actividad deja de existir solo en el modelo de referencia y pasa a
--   producción, como promete la política de privacidad publicada.
--     * `business.personal_data_retention_months`: plazo por negocio, 24 por
--       defecto y nunca mayor (DEC-025: ampliarlo exige base legal documentada y
--       otra migración, no basta con cambiar el número).
--     * `retention_claim_due_customers` y `customer_anonymize`: las funciones de
--       `DEC-054` (fórmula de última actividad, marcador literal) con los nombres
--       de `DEC-183`, más la dirección del domicilio (`DEC-185`).
--     * `customer_anonymize_expired`: el lote del worker; reclama y anonimiza en
--       UNA transacción (DEC-053) y deja una fila por negocio en
--       `customer_anonymization_run`.
--     * `customer_anonymize_request`: la solicitud individual del titular, que la
--       ejecuta el operador (sin GRANT a ningún rol de aplicación).
--     * `customer_anonymization_run`: registro de lo anonimizado, sin datos
--       personales (RN-DAT-02).
--     * `appointment_home_service_ck` admite la dirección anonimizada.
--
-- Reglas y decisiones
--   RN-DAT-01 a RN-DAT-03, RN-HIS-02 (el historial se redacta, nunca se borra),
--   RN-TEN-01 (RLS), DEC-025, DEC-042, DEC-049, DEC-053, DEC-054, DEC-131,
--   DEC-183, DEC-185, DEC-036 (roll-forward), DEC-040 (solo agenda_worker
--   ejecuta el lote).
--
-- Qué NO toca (DEC-185)
--   * `professional_review`: estrellas y comentario se conservan; ya se publican
--     sin el nombre del cliente.
--   * Eventos ya publicados en Google Calendar: son del calendario del
--     profesional; no se encola ninguna sincronización (ningún trigger de
--     `appointment` lo hace: la cola la llena el API).
--   * `idempotency_record.response_body`: su TTL (≤ 1 día) es menor que el plazo
--     mínimo (1 mes), ver DEC-054 punto 4.
--   * Retos y ventanas con HMAC del contacto: se purgan en minutos u horas.
--
-- Clasificación de datos
--   `customer_anonymization_run`: técnico (negocio, motivo, cuántos, cuándo). Sin
--   identificador de cliente ni dato personal. Se conserva como evidencia de
--   cumplimiento; no vence.
--
-- Riesgo y recuperación
--   `ALTER TABLE business ADD COLUMN … DEFAULT 24` no reescribe la tabla
--   (PostgreSQL ≥ 11). El CHECK nuevo de `appointment` se crea NOT VALID y se
--   valida después: la validación solo toma SHARE UPDATE EXCLUSIVE. Ninguna fila
--   cambia en esta migración; la primera anonimización real la hace el worker
--   cuando un cliente vence (no antes de 2028-11-06 en producción). Roll-forward
--   (DEC-036): revertir es otra migración que elimine las funciones; los datos
--   ya anonimizados no se recuperan, por diseño.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointment' AND column_name = 'business_id'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261121090000_rename_to_business_professional.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business'
      AND column_name = 'personal_data_retention_months'
  ) THEN
    RAISE EXCEPTION 'La retención por negocio ya existe: esta migración no puede aplicarse dos veces.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1 · Plazo por negocio
-- ---------------------------------------------------------------------------

ALTER TABLE business
  ADD COLUMN personal_data_retention_months integer NOT NULL DEFAULT 24,
  ADD CONSTRAINT business_retention_months_ck CHECK (
    personal_data_retention_months BETWEEN 1 AND 24
  );

COMMENT ON COLUMN business.personal_data_retention_months IS
  'Plazo de conservación de los datos personales de los clientes, contado desde su última '
  'actividad (DEC-025, DEC-042). 24 meses por defecto y como máximo: ampliarlo exige base '
  'legal documentada y una migración que mueva este CHECK (DEC-185).';

-- ---------------------------------------------------------------------------
-- 2 · La dirección del domicilio puede quedar anonimizada
-- ---------------------------------------------------------------------------
-- La modalidad (`is_home_service`) es un hecho operativo y se conserva; la
-- dirección y las coordenadas son del cliente. Anonimizada, la dirección lleva
-- el marcador literal y las coordenadas quedan nulas: ninguna dirección real
-- cumple las dos cosas a la vez con coordenadas ausentes.

ALTER TABLE appointment DROP CONSTRAINT appointment_home_service_ck;

ALTER TABLE appointment
  ADD CONSTRAINT appointment_home_service_ck
  CHECK (
    (is_home_service
       AND service_address IS NOT NULL
       AND btrim(service_address) <> ''
       AND char_length(service_address) <= 200
       AND service_address <> 'Cliente anonimizado'
       AND service_latitude  IS NOT NULL AND service_latitude  BETWEEN -90 AND 90
       AND service_longitude IS NOT NULL AND service_longitude BETWEEN -180 AND 180)
    OR
    -- IS NOT DISTINCT FROM y no `=`: con la dirección en NULL, `=` da NULL y un
    -- CHECK que evalúa a NULL deja pasar la fila (domicilio sin dirección).
    (is_home_service
       AND service_address IS NOT DISTINCT FROM 'Cliente anonimizado'
       AND service_latitude  IS NULL
       AND service_longitude IS NULL)
    OR
    (NOT is_home_service
       AND service_address IS NULL
       AND service_latitude IS NULL
       AND service_longitude IS NULL)
  ) NOT VALID;

ALTER TABLE appointment VALIDATE CONSTRAINT appointment_home_service_ck;

COMMENT ON CONSTRAINT appointment_home_service_ck ON appointment IS
  'DEC-131 y DEC-185: a domicilio con dirección y coordenadas completas, a domicilio '
  'anonimizado (marcador literal y coordenadas nulas) o en el local sin dirección.';

-- ---------------------------------------------------------------------------
-- 3 · Registro de lo anonimizado
-- ---------------------------------------------------------------------------

CREATE TABLE customer_anonymization_run (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id          uuid        NOT NULL,
  reason               text        NOT NULL,
  customers_anonymized integer     NOT NULL,
  ran_at               timestamptz NOT NULL,

  CONSTRAINT customer_anonymization_run_pk PRIMARY KEY (id),
  CONSTRAINT customer_anonymization_run_business_id_fk
    FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE RESTRICT,
  CONSTRAINT customer_anonymization_run_reason_ck CHECK (reason IN ('expired', 'request')),
  CONSTRAINT customer_anonymization_run_count_ck  CHECK (customers_anonymized > 0)
);

COMMENT ON TABLE customer_anonymization_run IS
  'Registro de anonimizaciones (DEC-185): una fila por lote del worker y negocio (reason '
  '= expired) o por solicitud del titular (reason = request), con cuántos clientes y '
  'cuándo. Propietario funcional: plataforma. Clasificación: técnico, sin datos personales '
  'ni identificador de cliente. Retención: indefinida, como evidencia de cumplimiento. '
  'Solo la escriben customer_anonymize_expired y customer_anonymize_request.';

CREATE INDEX idx_customer_anonymization_run_business_ran_at
  ON customer_anonymization_run (business_id, ran_at);

ALTER TABLE customer_anonymization_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_anonymization_run FORCE  ROW LEVEL SECURITY;

CREATE POLICY customer_anonymization_run_all_admin_policy ON customer_anonymization_run
  FOR ALL TO agenda_owner USING (true) WITH CHECK (true);

-- DDL-AUT-01: sin GRANT ni política para agenda_app o agenda_worker; todo acceso
-- de escritura es por las funciones de abajo.

-- ---------------------------------------------------------------------------
-- 4 · Reclamo de clientes vencidos (DEC-042, DEC-054 punto 1)
-- ---------------------------------------------------------------------------
-- Corre en la MISMA transacción que la anonimización (DEC-053): el efecto es una
-- escritura en esta base, no una llamada de red, así que `FOR UPDATE OF c SKIP
-- LOCKED` basta y no hace falta lease.

CREATE OR REPLACE FUNCTION retention_claim_due_customers(p_limit integer, p_now timestamptz)
RETURNS TABLE (customer_id uuid, business_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'retention_claim_due_customers: p_limit fuera de rango (1-200).';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'retention_claim_due_customers: p_now no admite NULL.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.business_id
  FROM public.customer c
  JOIN public.business b ON b.id = c.business_id
  WHERE c.anonymized_at IS NULL
    AND GREATEST(
          c.created_at,
          (SELECT max(a.created_at) FROM public.appointment a
             WHERE a.business_id = c.business_id AND a.customer_id = c.id),
          (SELECT max(ah.occurred_at) FROM public.appointment_history ah
             JOIN public.appointment a
               ON a.business_id = ah.business_id AND a.id = ah.appointment_id
             WHERE a.business_id = c.business_id AND a.customer_id = c.id),
          (SELECT max(t.issued_at) FROM public.appointment_access_token t
             JOIN public.appointment a
               ON a.business_id = t.business_id AND a.id = t.appointment_id
             WHERE a.business_id = c.business_id AND a.customer_id = c.id)
        ) < p_now - pg_catalog.make_interval(months => b.personal_data_retention_months)
  -- Orden por creación, no por la actividad calculada: evita repetir el GREATEST
  -- solo para ordenar un lote pequeño que se reintenta en cada ciclo.
  ORDER BY c.created_at
  LIMIT p_limit
  FOR UPDATE OF c SKIP LOCKED;
END;
$$;

REVOKE ALL     ON FUNCTION retention_claim_due_customers(integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION retention_claim_due_customers(integer, timestamptz) TO agenda_worker;

COMMENT ON FUNCTION retention_claim_due_customers(integer, timestamptz) IS
  'Reclama clientes con datos personales vencidos por última actividad (DEC-042, DEC-054). '
  'Devuelve solo identificadores; p_limit 1-200. Se usa dentro de customer_anonymize_expired.';

-- ---------------------------------------------------------------------------
-- 5 · Anonimización de un cliente (DEC-049, DEC-054, DEC-185)
-- ---------------------------------------------------------------------------
-- Transaccional e idempotente: sobre un cliente ya anonimizado no hace nada
-- (guardado por `anonymized_at IS NULL` en el primer UPDATE). No valida que el
-- cliente esté vencido: lo decide quien la llama (el lote o la solicitud).

CREATE OR REPLACE FUNCTION customer_anonymize(
  p_business_id uuid,
  p_customer_id uuid,
  p_now         timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Marcador único y literal: customer_anonymized_ck y appointment_home_service_ck
  -- lo exigen tal cual.
  v_placeholder constant text := 'Cliente anonimizado';
  v_claimed     integer;
BEGIN
  IF p_business_id IS NULL OR p_customer_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'customer_anonymize: ningún argumento admite NULL.';
  END IF;

  UPDATE public.customer
  SET full_name = v_placeholder,
      phone = NULL,
      email = NULL,
      anonymized_at = p_now
  WHERE business_id = p_business_id
    AND id = p_customer_id
    AND anonymized_at IS NULL;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN false;  -- Ya anonimizado, o no existe: nada más que hacer.
  END IF;

  -- Persona atendida, nota y dirección del domicilio (DEC-049, DEC-185). La
  -- modalidad del turno se conserva.
  UPDATE public.appointment
  SET attendee_name     = v_placeholder,
      customer_note     = NULL,
      service_address   = CASE WHEN is_home_service THEN v_placeholder END,
      service_latitude  = NULL,
      service_longitude = NULL
  WHERE business_id = p_business_id
    AND customer_id = p_customer_id
    AND (attendee_name <> v_placeholder
         OR customer_note IS NOT NULL
         OR service_latitude IS NOT NULL
         OR service_address IS DISTINCT FROM CASE WHEN is_home_service THEN v_placeholder END);

  -- El motivo de una transición puede ser texto libre personal: se redacta,
  -- nunca se borra la fila (RN-HIS-02).
  UPDATE public.appointment_history ah
  SET reason = v_placeholder
  FROM public.appointment a
  WHERE ah.business_id = p_business_id
    AND ah.appointment_id = a.id
    AND a.business_id = p_business_id
    AND a.customer_id = p_customer_id
    AND ah.reason IS NOT NULL
    AND ah.reason <> v_placeholder;

  -- Solo los campos que identifican (DEC-054 punto 3, ampliado por DEC-185 con
  -- la dirección). Un cambio de estado, hora o servicio se conserva íntegro.
  UPDATE public.appointment_history_change ahc
  SET previous_value = CASE WHEN ahc.previous_value IS NOT NULL THEN v_placeholder END,
      new_value      = CASE WHEN ahc.new_value      IS NOT NULL THEN v_placeholder END
  FROM public.appointment_history ah
  JOIN public.appointment a
    ON a.business_id = ah.business_id AND a.id = ah.appointment_id
  WHERE ahc.business_id = p_business_id
    AND ahc.history_id = ah.id
    AND a.business_id = p_business_id
    AND a.customer_id = p_customer_id
    AND ahc.field_name IN ('attendee_name', 'customer_note',
                           'service_address', 'service_latitude', 'service_longitude')
    AND (ahc.previous_value IS DISTINCT FROM CASE WHEN ahc.previous_value IS NOT NULL THEN v_placeholder END
         OR ahc.new_value IS DISTINCT FROM CASE WHEN ahc.new_value IS NOT NULL THEN v_placeholder END);

  -- El enlace público ya no abre nada de un cliente anonimizado.
  UPDATE public.appointment_access_token t
  SET revoked_at = p_now
  FROM public.appointment a
  WHERE t.business_id = p_business_id
    AND t.appointment_id = a.id
    AND a.business_id = p_business_id
    AND a.customer_id = p_customer_id
    AND t.revoked_at IS NULL;

  RETURN true;
END;
$$;

REVOKE ALL     ON FUNCTION customer_anonymize(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION customer_anonymize(uuid, uuid, timestamptz) TO agenda_worker;

COMMENT ON FUNCTION customer_anonymize(uuid, uuid, timestamptz) IS
  'Anonimización completa de un cliente (DEC-025, DEC-049, DEC-054, DEC-185): customer, '
  'appointment (persona atendida, nota, dirección y coordenadas del domicilio), '
  'appointment_history.reason, appointment_history_change de campos personales y revocación de '
  'appointment_access_token. Conserva reseñas y no toca Google Calendar. Idempotente.';

-- ---------------------------------------------------------------------------
-- 6 · Lote del worker
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION customer_anonymize_expired(p_limit integer, p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_due        record;
  v_businesses uuid[] := '{}';
BEGIN
  -- retention_claim_due_customers valida p_limit y p_now.
  FOR v_due IN
    SELECT d.customer_id, d.business_id
    FROM public.retention_claim_due_customers(p_limit, p_now) d
  LOOP
    IF public.customer_anonymize(v_due.business_id, v_due.customer_id, p_now) THEN
      v_businesses := v_businesses || v_due.business_id;
    END IF;
  END LOOP;

  INSERT INTO public.customer_anonymization_run (business_id, reason, customers_anonymized, ran_at)
  SELECT b.business_id, 'expired', count(*)::integer, p_now
  FROM pg_catalog.unnest(v_businesses) AS b (business_id)
  GROUP BY b.business_id;

  RETURN pg_catalog.cardinality(v_businesses);
END;
$$;

REVOKE ALL     ON FUNCTION customer_anonymize_expired(integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION customer_anonymize_expired(integer, timestamptz) TO agenda_worker;

COMMENT ON FUNCTION customer_anonymize_expired(integer, timestamptz) IS
  'Lote del worker (DEC-185): reclama hasta p_limit clientes vencidos, los anonimiza en la misma '
  'transacción y registra una fila por negocio en customer_anonymization_run. Devuelve cuántos '
  'anonimizó; el worker repite mientras el lote venga lleno.';

-- ---------------------------------------------------------------------------
-- 7 · Solicitud individual del titular
-- ---------------------------------------------------------------------------
-- La ejecuta el operador tras verificar la identidad del titular (política de
-- privacidad, 15 días hábiles). Sin GRANT: ni el API ni el worker la invocan.

CREATE OR REPLACE FUNCTION customer_anonymize_request(
  p_business_id uuid,
  p_customer_id uuid,
  p_now         timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.customer_anonymize(p_business_id, p_customer_id, p_now) THEN
    RETURN false;
  END IF;

  INSERT INTO public.customer_anonymization_run (business_id, reason, customers_anonymized, ran_at)
  VALUES (p_business_id, 'request', 1, p_now);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION customer_anonymize_request(uuid, uuid, timestamptz) FROM PUBLIC;

COMMENT ON FUNCTION customer_anonymize_request(uuid, uuid, timestamptz) IS
  'Solicitud de eliminación del titular (DEC-185): anonimiza al cliente aunque no haya vencido y '
  'registra reason = request. Solo la ejecuta el operador; devuelve false si ya estaba anonimizado.';
