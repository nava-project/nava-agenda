-- Propósito
--   Issue #661 (DEC-183): el contrato HTTP deja de nombrar barberos. Dos valores
--   guardados que el API devuelve tal cual cambian con él:
--     * estado de turno `cancelled_by_barber` → `cancelled_by_professional`;
--     * evento de historial `appointment_cancelled_by_barber` →
--       `appointment_cancelled_by_professional`.
--   El tipo de aviso al cliente `cancelled_by_barber` (cola `appointment_notice`)
--   pasa también a `cancelled_by_professional`: el despachador lo compara con el
--   estado del turno y ambos deben hablar el mismo vocabulario.
--
-- Reglas y decisiones
--   DEC-183, DEC-041 (vocabulario en inglés y snake_case), DEC-014/RN-HIS-02
--   (historial append-only para el API), DEC-036 (roll-forward), RN-TEN-01.
--
-- Qué hace
--   1. Quita los CHECK que nombran el valor viejo: `appointment_status_ck`,
--      `appointment_cancellation_reason_ck`, `appointment_history_event_type_ck`
--      y `appointment_notice_kind_ck`.
--   2. Reescribe las filas existentes de todos los negocios: el estado de
--      `appointment`, el `event_type` de `appointment_history`, los valores
--      anterior/nuevo del campo `status` en `appointment_history_change` y el
--      `kind` de `appointment_notice` (enviados o pendientes).
--   3. Vuelve a crear los CHECK con el valor nuevo y los mismos nombres.
--   Corre con el rol que migra, que hereda las políticas `*_all_admin_policy`
--   (FOR ALL) pese a la RLS forzada: el UPDATE alcanza a todos los tenants. El
--   API no puede editar el historial (sin privilegio UPDATE); esta migración sí,
--   porque renombrar un valor no es corregir un hecho: el turno sigue cancelado
--   por quien lo atiende.
--   Los disparadores `*_set_updated_at` se apagan durante el UPDATE: cambiar el
--   nombre del valor no es una modificación del turno ni del aviso.
--
-- Qué NO hace
--   Ninguna función guarda estos valores en su cuerpo (se comprobó contra el
--   esquema tras 20261121090000), así que no se recrea ninguna. Las migraciones
--   anteriores conservan el valor viejo: son inmutables.
--
-- Clasificación de datos
--   Sin datos nuevos. Cambia texto de vocabulario, no datos personales.
--
-- Riesgo y recuperación
--   Toma ACCESS EXCLUSIVE breve sobre appointment, appointment_history,
--   appointment_history_change y appointment_notice (DROP/ADD CONSTRAINT) y
--   reescribe solo las filas con el valor viejo. Los CHECK nuevos se validan al
--   crearse: recorren la tabla, que en este despliegue es pequeña. El API
--   anterior escribe el valor viejo y dejaría de poder cancelar en cuanto se
--   aplique; el despliegue arranca el API nuevo justo después, como en
--   20261121090000. Roll-forward (DEC-036): revertir es otra migración con el
--   UPDATE inverso.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261121090000_rename_to_business_professional.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;
END
$$;

-- 1. Restricciones que nombran el valor viejo
ALTER TABLE appointment DROP CONSTRAINT appointment_status_ck;
ALTER TABLE appointment DROP CONSTRAINT appointment_cancellation_reason_ck;
ALTER TABLE appointment_history DROP CONSTRAINT appointment_history_event_type_ck;
ALTER TABLE appointment_notice DROP CONSTRAINT appointment_notice_kind_ck;

-- 2. Filas existentes, de todos los negocios
ALTER TABLE appointment DISABLE TRIGGER appointment_set_updated_at;
UPDATE appointment
   SET status = 'cancelled_by_professional'
 WHERE status = 'cancelled_by_barber';
ALTER TABLE appointment ENABLE TRIGGER appointment_set_updated_at;

UPDATE appointment_history
   SET event_type = 'appointment_cancelled_by_professional'
 WHERE event_type = 'appointment_cancelled_by_barber';

UPDATE appointment_history_change
   SET previous_value = 'cancelled_by_professional'
 WHERE field_name = 'status' AND previous_value = 'cancelled_by_barber';

UPDATE appointment_history_change
   SET new_value = 'cancelled_by_professional'
 WHERE field_name = 'status' AND new_value = 'cancelled_by_barber';

ALTER TABLE appointment_notice DISABLE TRIGGER appointment_notice_set_updated_at;
UPDATE appointment_notice
   SET kind = 'cancelled_by_professional'
 WHERE kind = 'cancelled_by_barber';
ALTER TABLE appointment_notice ENABLE TRIGGER appointment_notice_set_updated_at;

-- 3. Las mismas restricciones con el valor nuevo
ALTER TABLE appointment ADD CONSTRAINT appointment_status_ck CHECK (
  status IN ('confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_professional', 'no_show')
);

ALTER TABLE appointment ADD CONSTRAINT appointment_cancellation_reason_ck CHECK (
  cancellation_reason IS NULL
  OR (
    status IN ('cancelled_by_customer', 'cancelled_by_professional')
    AND char_length(cancellation_reason) <= 500
  )
);

ALTER TABLE appointment_history ADD CONSTRAINT appointment_history_event_type_ck CHECK (
  event_type IN (
    'appointment_created',
    'appointment_rescheduled',
    'appointment_service_changed',
    'appointment_completed',
    'appointment_cancelled_by_customer',
    'appointment_cancelled_by_professional',
    'appointment_no_show',
    'appointment_status_corrected'
  )
);

ALTER TABLE appointment_notice ADD CONSTRAINT appointment_notice_kind_ck
  CHECK (kind IN ('cancelled_by_professional', 'rescheduled', 'reminder', 'reminder_whatsapp'));
