-- Propósito
--   HU-106 (DEC-179): Odin, desde WhatsApp, pide un código atado a UN turno y a
--   UN propósito (cancelar o reprogramar). Amplía `customer_access_challenge`
--   con el turno, el propósito y la referencia opaca (`accessRef`) que Odin
--   pone en el enlace; verificarla da el mismo acceso de 60 minutos de HU-105,
--   pero solo a ese turno.
--
-- Reglas y decisiones
--   RN-DAT-01 y RN-DAT-02 (la referencia se guarda solo como SHA-256), RN-TEN-01
--   (la clave foránea es compuesta con la barbería y RLS ya cubre la tabla),
--   DEC-178 (código de 10 minutos, 5 intentos, un solo uso) y DEC-179.
--
-- Decisiones de diseño
--   * Las tres columnas nuevas van juntas o ninguna: una fila de la pantalla
--     general (HU-105) las deja en NULL y su verificación las excluye, así que
--     un código pedido por Odin no sirve en la verificación general ni al revés.
--   * `access_ref_hash` es único: la referencia es un secreto de 256 bits y su
--     hash identifica el reto sin guardarla.
--   * Solo una fila con cliente puede llevar turno: una solicitud sin cliente
--     (señuelo) nunca lo tiene.
--   * No cambia ningún privilegio: `barberia_app` ya inserta y actualiza, y la
--     purga del worker ya cubre las filas por `expires_at`.
--
-- Plan de avance
--   Una corrección posterior se hace con otra migración, nunca editando esta
--   (DEC-036). No existe archivo `down`: el mecanismo normal es roll-forward.
--   Es solo aditiva: tres columnas NULL y restricciones sobre una tabla recién
--   creada y casi vacía, sin reescribir filas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_access_challenge'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261119120000_create_customer_access_challenge.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_access_challenge'
      AND column_name = 'appointment_id'
  ) THEN
    RAISE EXCEPTION 'customer_access_challenge.appointment_id ya existe: esta migración no puede aplicarse dos veces.';
  END IF;
END
$$;

ALTER TABLE customer_access_challenge
  ADD COLUMN appointment_id   uuid,
  ADD COLUMN purpose          text,
  ADD COLUMN access_ref_hash  text;

ALTER TABLE customer_access_challenge
  ADD CONSTRAINT customer_access_challenge_barbershop_id_appointment_id_fk
    FOREIGN KEY (barbershop_id, appointment_id)
    REFERENCES appointment (barbershop_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT customer_access_challenge_purpose_ck
    CHECK (purpose IS NULL OR purpose IN ('cancel', 'reschedule')),
  -- DDL-VAL-01: SHA-256 en hexadecimal minúscula de 64 caracteres.
  ADD CONSTRAINT customer_access_challenge_access_ref_hash_ck
    CHECK (access_ref_hash IS NULL OR access_ref_hash ~ '^[0-9a-f]{64}$'),
  -- Turno, propósito y referencia van juntos, y solo con un cliente detrás.
  ADD CONSTRAINT customer_access_challenge_appointment_scope_ck CHECK (
    (appointment_id IS NULL AND purpose IS NULL AND access_ref_hash IS NULL)
    OR (appointment_id IS NOT NULL AND purpose IS NOT NULL AND access_ref_hash IS NOT NULL
        AND customer_id IS NOT NULL)
  );

COMMENT ON COLUMN customer_access_challenge.appointment_id IS
  'Turno al que da acceso el reto cuando lo pidió Odin (HU-106). NULL en la pantalla general (HU-105).';
COMMENT ON COLUMN customer_access_challenge.purpose IS
  'Para qué se pidió el acceso: cancel o reprogramar (reschedule). NULL en la pantalla general.';
COMMENT ON COLUMN customer_access_challenge.access_ref_hash IS
  'SHA-256 de la referencia opaca del enlace (accessRef). Clasificación: secreto; la referencia en '
  'claro solo viaja a Odin y al enlace del cliente.';

CREATE UNIQUE INDEX customer_access_challenge_access_ref_hash_uk
  ON customer_access_challenge (access_ref_hash)
  WHERE access_ref_hash IS NOT NULL;
-- La clave foránea compuesta hacia appointment necesita su propio índice (DDL-PER-02).
CREATE INDEX idx_customer_access_challenge_shop_appointment
  ON customer_access_challenge (barbershop_id, appointment_id)
  WHERE appointment_id IS NOT NULL;
