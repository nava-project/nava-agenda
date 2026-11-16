-- Propósito
--   Issue #613 (DEC-175): el recordatorio al cliente (HU-131) sale también por
--   WhatsApp con la plantilla aprobada de Meta (`nava_recordatorio_turno`),
--   sobre la misma cola de avisos (`appointment_notice`): mismo lease, mismo
--   worker, misma evidencia por intento. Esta migración solo amplía lo que esa
--   cola asumía.
--
-- Reglas y decisiones
--   RN-REC-01 (un solo recordatorio vigente por canal, regenerado al mover el
--   turno), RN-REC-02/03 (se decide con el estado vigente al enviar), RN-REC-04
--   (evidencia por intento, sin contacto), RN-REC-05, RN-DAT-02, RN-TEN-01,
--   DEC-027, DEC-040, DEC-144, DEC-174 y DEC-175.
--
-- Cambios
--   1. `kind` admite `reminder_whatsapp`: el recordatorio por WhatsApp es una
--      fila propia, para que cada canal tenga su intento, su reintento y su
--      causa de omisión sin depender del otro.
--   2. El índice único de pendientes pasa a ser «uno por turno y clase», con
--      tres clases: aviso de cambio, recordatorio por correo y recordatorio por
--      WhatsApp. Ninguno sustituye a otro.
--   3. `appointment_notice_attempt.channel` admite `whatsapp` y `notice_finish`
--      registra el canal según la clase del aviso.
--   4. `notice_context` devuelve además el teléfono del cliente y el nombre del
--      barbero (para la plantilla) y separa la cobertura por clase: entre
--      recordatorios solo cubre uno de la MISMA clase y para el mismo instante.
--
-- Datos existentes
--   Ninguna fila cambia: no existe todavía ningún `reminder_whatsapp`.
--
-- Riesgo
--   El índice se recrea (cola pequeña) y `notice_context` cambia su retorno
--   (DROP + CREATE). Igual que en 20261105120000, la API que usa el índice nuevo
--   (cláusula ON CONFLICT) debe desplegarse justo después: entre la migración y
--   el reinicio de la API, crear o mover un turno puede fallar unos segundos.
--
-- Recuperación
--   Roll-forward (DEC-036). Con filas `reminder_whatsapp`, eliminarlas antes de
--   restaurar el CHECK, el índice y las funciones anteriores.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'barbershop' AND column_name = 'reminder_lead_minutes'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261117120000_add_reminder_lead_minutes.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;
END
$$;

ALTER TABLE appointment_notice DROP CONSTRAINT appointment_notice_kind_ck;
ALTER TABLE appointment_notice
  ADD CONSTRAINT appointment_notice_kind_ck
  CHECK (kind IN ('cancelled_by_barber', 'rescheduled', 'reminder', 'reminder_whatsapp'));

ALTER TABLE appointment_notice_attempt DROP CONSTRAINT appointment_notice_attempt_channel_ck;
ALTER TABLE appointment_notice_attempt
  ADD CONSTRAINT appointment_notice_attempt_channel_ck CHECK (channel IN ('email', 'whatsapp'));

DROP INDEX appointment_notice_pending_uk;
CREATE UNIQUE INDEX appointment_notice_pending_uk
  ON appointment_notice (
    appointment_id,
    (CASE WHEN kind IN ('reminder', 'reminder_whatsapp') THEN kind ELSE 'change' END)
  ) WHERE status = 'pending';

COMMENT ON INDEX appointment_notice_pending_uk IS
  'Como máximo un aviso de cambio, un recordatorio por correo y uno por WhatsApp pending por turno '
  '(RN-REC-01: sin duplicados).';

DROP FUNCTION notice_context(uuid, uuid);

CREATE FUNCTION notice_context(p_notice_id uuid, p_claim_token uuid)
RETURNS TABLE (
  kind                 text,
  appointment_status   text,
  starts_at            timestamptz,
  appointment_state_at timestamptz,
  customer_email       text,
  attendee_name        text,
  service_name         text,
  barbershop_name      text,
  barbershop_timezone  text,
  already_covered      boolean,
  notice_state_at      timestamptz,
  customer_phone       text,
  barber_name          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT n.kind, a.status, a.starts_at, a.updated_at,
         cu.email, a.attendee_name, a.service_name_snapshot, b.name, b.timezone,
         EXISTS (
           SELECT 1 FROM public.appointment_notice o
            WHERE o.barbershop_id = n.barbershop_id AND o.appointment_id = n.appointment_id
              AND o.id <> n.id AND o.status = 'sent'
              AND CASE WHEN n.kind IN ('reminder', 'reminder_whatsapp')
                       THEN o.kind = n.kind AND o.covers_state_at = n.state_at
                       ELSE o.kind NOT IN ('reminder', 'reminder_whatsapp')
                            AND o.covers_state_at >= n.state_at END
         ),
         n.state_at,
         cu.phone,
         br.full_name
    FROM public.appointment_notice n
    JOIN public.appointment a ON a.barbershop_id = n.barbershop_id AND a.id = n.appointment_id
    JOIN public.customer cu ON cu.barbershop_id = a.barbershop_id AND cu.id = a.customer_id
    JOIN public.barber br ON br.barbershop_id = a.barbershop_id AND br.id = a.barber_id
    JOIN public.barbershop b ON b.id = n.barbershop_id
   WHERE n.id = p_notice_id AND n.claim_token = p_claim_token AND n.status = 'processing';
$$;

REVOKE ALL     ON FUNCTION notice_context(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION notice_context(uuid, uuid) TO barberia_worker;

COMMENT ON FUNCTION notice_context(uuid, uuid) IS
  'Datos mínimos para redactar y enviar UN aviso reclamado; exige su claim_token vigente, así que no '
  'sirve para leer citas arbitrarias. Incluye el correo, el teléfono y el nombre del cliente solo para '
  'ese envío (RN-DAT-02). notice_state_at es el estado que el aviso cubre: para un recordatorio, el '
  'instante del turno para el que se programó. Exclusivo de barberia_worker.';

-- notice_finish conserva firma, privilegios y comportamiento; solo el canal del
-- intento deja de ser siempre `email`.
CREATE OR REPLACE FUNCTION notice_finish(
  p_notice_id       uuid,
  p_claim_token     uuid,
  p_outcome         text,
  p_code            text DEFAULT NULL,
  p_retry_seconds   integer DEFAULT NULL,
  p_max_attempts    integer DEFAULT 5,
  p_covers_state_at timestamptz DEFAULT NULL,
  p_now             timestamptz DEFAULT pg_catalog.now()
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_notice  public.appointment_notice%ROWTYPE;
  v_attempt text;
BEGIN
  IF p_outcome NOT IN ('sent', 'skipped', 'retry', 'permanent') THEN
    RAISE EXCEPTION 'notice_finish: resultado inválido %.', p_outcome;
  END IF;

  SELECT * INTO v_notice
    FROM public.appointment_notice
   WHERE id = p_notice_id AND claim_token = p_claim_token AND status = 'processing'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_outcome = 'sent' THEN
    IF p_covers_state_at IS NULL THEN
      RAISE EXCEPTION 'notice_finish: sent exige p_covers_state_at.';
    END IF;
    v_attempt := 'sent';
    UPDATE public.appointment_notice
       SET status = 'sent', claim_token = NULL, lease_expires_at = NULL,
           outcome_code = NULL, covers_state_at = p_covers_state_at, finished_at = p_now
     WHERE id = v_notice.id;

  ELSIF p_outcome = 'skipped' THEN
    v_attempt := 'skipped';
    UPDATE public.appointment_notice
       SET status = 'skipped', claim_token = NULL, lease_expires_at = NULL,
           outcome_code = p_code, finished_at = p_now
     WHERE id = v_notice.id;

  ELSIF p_outcome = 'retry' AND v_notice.attempts < COALESCE(p_max_attempts, 5) THEN
    v_attempt := 'retry';
    UPDATE public.appointment_notice
       SET status = 'pending', claim_token = NULL, lease_expires_at = NULL,
           run_at = p_now + pg_catalog.make_interval(secs => COALESCE(p_retry_seconds, 60)),
           outcome_code = p_code
     WHERE id = v_notice.id;

  ELSE  -- 'permanent', o 'retry' con los intentos agotados
    v_attempt := 'failed';
    UPDATE public.appointment_notice
       SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
           outcome_code = p_code, finished_at = p_now
     WHERE id = v_notice.id;
  END IF;

  INSERT INTO public.appointment_notice_attempt
         (barbershop_id, notice_id, attempt_no, channel, outcome, error_code, created_at)
  VALUES (v_notice.barbershop_id, v_notice.id, v_notice.attempts,
          CASE WHEN v_notice.kind = 'reminder_whatsapp' THEN 'whatsapp' ELSE 'email' END, v_attempt,
          CASE WHEN v_attempt = 'sent' THEN NULL ELSE p_code END, p_now);

  RETURN true;
END;
$$;
