-- Propósito
--   DEC-181 (issue #651): Odin puede pedir el código sin elegir entre cancelar y
--   reprogramar. El reto queda con el propósito `manage` y, tras el código, la
--   persona elige en el paso 03 «Tu turno». Amplía el CHECK de
--   `customer_access_challenge.purpose` para admitir ese valor.
--
-- Reglas y decisiones
--   DEC-179 (reto atado a un turno y a un propósito), DEC-180 (paso 03 con las dos
--   acciones) y DEC-181.
--
-- Decisiones de diseño
--   * Solo se amplía el conjunto de valores: `cancel` y `reschedule` siguen igual y
--     ninguna fila existente cambia.
--   * La restricción se crea NOT VALID y se valida en una segunda sentencia: la
--     validación solo toma SHARE UPDATE EXCLUSIVE y no bloquea las escrituras del
--     acceso por código mientras recorre la tabla.
--
-- Plan de avance
--   Una corrección posterior se hace con otra migración, nunca editando esta
--   (DEC-036). No existe archivo `down`: volver a la lista anterior exige que no
--   quede ninguna fila con `manage` (vencen a los 10 minutos y la purga del worker
--   las retira).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_access_challenge_purpose_ck'
      AND conrelid = 'public.customer_access_challenge'::regclass
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261119130000_customer_access_challenge_appointment_ref.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;
END
$$;

ALTER TABLE customer_access_challenge
  DROP CONSTRAINT customer_access_challenge_purpose_ck;

ALTER TABLE customer_access_challenge
  ADD CONSTRAINT customer_access_challenge_purpose_ck
    CHECK (purpose IS NULL OR purpose IN ('manage', 'cancel', 'reschedule')) NOT VALID;

ALTER TABLE customer_access_challenge
  VALIDATE CONSTRAINT customer_access_challenge_purpose_ck;

COMMENT ON COLUMN customer_access_challenge.purpose IS
  'Para qué se pidió el acceso: manage (la persona elige en el paso 03), cancel o '
  'reschedule. NULL en la pantalla general.';
