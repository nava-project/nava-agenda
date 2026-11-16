-- Propósito
--   Issue #611 (DEC-174): cada negocio elige con cuánta anticipación sale el
--   recordatorio al cliente (HU-131): 10, 20, 30, 40, 50 o 60 minutos. Hasta
--   ahora era fijo a 30 minutos (DEC-018, DEC-144).
--
-- Reglas y decisiones
--   RN-REC-01, RN-REC-05, RN-TEN-01, DEC-018, DEC-024, DEC-035/DEC-036,
--   DEC-144 y DEC-174.
--
-- Modelo
--   `barbershop.reminder_lead_minutes smallint NOT NULL DEFAULT 30` con un
--   `CHECK` sobre la lista cerrada. Es un atributo del negocio (una preferencia,
--   como `login_otp_channel`), así que vive en su fila: 3FN intacta, sin tabla
--   nueva. Las filas existentes toman 30, el valor que ya se aplicaba.
--
-- Qué NO hace esta migración
--   No toca `appointment_notice` ni sus funciones: la API programa con la
--   anticipación del negocio y, al cambiarla, mueve el `run_at` de los
--   recordatorios pendientes con los privilegios que `barberia_app` ya tiene
--   (UPDATE de `run_at` bajo RLS). Tampoco toca RLS: `barbershop` ya la tiene
--   forzada y `barberia_app` ya actualiza la fila de su negocio.
--
-- Clasificación de datos
--   No es un dato personal.
--
-- Riesgo y recuperación
--   ADD COLUMN con DEFAULT constante no reescribe la tabla. Roll-forward
--   (DEC-036): una corrección se hace con otra migración.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'barbershop' AND column_name = 'login_otp_channel'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261103120000_add_login_otp_channel.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'barbershop' AND column_name = 'reminder_lead_minutes'
  ) THEN
    RAISE EXCEPTION
      'barbershop.reminder_lead_minutes ya existe; esta migración no se puede aplicar dos veces.';
  END IF;
END
$$;

ALTER TABLE barbershop
  ADD COLUMN reminder_lead_minutes smallint NOT NULL DEFAULT 30,
  ADD CONSTRAINT barbershop_reminder_lead_minutes_ck
    CHECK (reminder_lead_minutes IN (10, 20, 30, 40, 50, 60));

COMMENT ON COLUMN barbershop.reminder_lead_minutes IS
  'Minutos antes del turno en que sale el recordatorio al cliente (DEC-174): 10, 20, 30, 40, 50 '
  'o 60. Por defecto 30 (DEC-018).';
