-- Propósito
--   DEC-169 (issue #585): ventana de reserva pública propia y opcional por
--   barbero. Cada fila guarda la anticipación mínima, la ventana máxima y el
--   paso de rejilla de UN barbero; la ausencia de fila significa que el
--   barbero hereda los valores vigentes de `barbershop` (HU-093). El plazo y
--   la política de cancelación siguen siendo solo de la barbería.
--
-- Reglas y decisiones
--   RN-DIS-04 (anticipación mínima y ventana máxima), RN-DIS-06 (paso de
--   rejilla), RN-TEN-01, DEC-024 (esquema compartido con RLS), DEC-035
--   (estándar de base de datos), DEC-036 (Atlas, migración inmutable),
--   DEC-083 (rangos de anticipación y ventana), DEC-133 (rejilla entera de 1
--   a 60), DEC-169 (configuración propia por barbero).
--
-- Diseño
--   Tabla aparte y no columnas anulables en `barber`: la ficha del equipo no
--   se mezcla con la política pública y "propia o heredada" es la existencia
--   de la fila, no tres nulos que deberían ir siempre juntos (DEC-169,
--   alternativas descartadas). Los tres valores son obligatorios en la fila:
--   no hay herencia parcial campo a campo.
--
-- Qué NO hace esta migración
--   No copia los valores de la barbería a ningún barbero: todos empiezan
--   heredando. No cambia `barbershop`, citas, bloqueos ni la cancelación.
--
-- Condición de seguridad
--   Se ejecuta con `barberia_migrator`, que hereda los privilegios de
--   `barberia_owner` por membresía. La tabla queda propiedad de
--   `barberia_owner`, con RLS forzada y políticas por tenant para
--   `barberia_app` (mismo patrón que barber_photo).
--
-- Plan de avance
--   Una corrección posterior se hace con otra migración, nunca editando esta
--   (DEC-036). Sin archivo `down`: roll-forward. Retirar la capacidad es
--   borrar la tabla en otra migración; los barberos volverían a heredar.

-- ---------------------------------------------------------------------------
-- 1. Precondiciones
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'barber'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20260823130000_create_barber.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'barbershop' AND column_name = 'slot_grid_minutes'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20260911060000_add_barbershop_booking_policy.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'barber_booking_policy'
  ) THEN
    RAISE EXCEPTION 'barber_booking_policy ya existe: esta migración no puede aplicarse dos veces.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberia_owner') THEN
    RAISE EXCEPTION
      'Esta migración depende de 20260811145252_harden_roles_and_definer_functions.sql '
      '(rol barberia_owner); esa migración debe estar aplicada antes.';
  END IF;

  -- La FK compuesta por tenant necesita el `UNIQUE (barbershop_id, id)` que
  -- `barber` declaró en HU-021.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_barbershop_id_id_uk'
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de barber_barbershop_id_id_uk '
      '(20260823130000_create_barber.sql); esa restricción debe existir antes.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Tabla `barber_booking_policy`
-- ---------------------------------------------------------------------------

CREATE TABLE barber_booking_policy (
  barbershop_id       uuid        NOT NULL,
  barber_id           uuid        NOT NULL,
  min_advance_minutes integer     NOT NULL,
  max_advance_days    integer     NOT NULL,
  slot_grid_minutes   integer     NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Una configuración por barbero: la PK impide una segunda fila y sirve de
  -- índice para toda consulta (siempre por barbero dentro de su tenant, o
  -- todas las de un tenant por su prefijo).
  CONSTRAINT barber_booking_policy_pk PRIMARY KEY (barbershop_id, barber_id),

  -- FK compuesta por barbershop_id: impide asociar la configuración a un
  -- barbero de otra barbería AUN con SQL directo bajo el rol de aplicación
  -- (RN-TEN-01). Sin cascada: un barbero no se borra físicamente.
  CONSTRAINT barber_booking_policy_barber_fk FOREIGN KEY (barbershop_id, barber_id)
                                             REFERENCES barber (barbershop_id, id)
                                             ON DELETE RESTRICT,

  -- Mismos rangos que `barbershop` (DEC-083, DEC-133): el servicio los valida
  -- antes; los CHECK son la última defensa.
  CONSTRAINT barber_booking_policy_min_advance_minutes_ck CHECK (min_advance_minutes BETWEEN 0 AND 1440),
  CONSTRAINT barber_booking_policy_max_advance_days_ck    CHECK (max_advance_days BETWEEN 1 AND 90),
  CONSTRAINT barber_booking_policy_slot_grid_minutes_ck   CHECK (slot_grid_minutes BETWEEN 1 AND 60),
  -- La anticipación mínima no puede alcanzar ni superar toda la ventana, o
  -- ninguna franja del barbero quedaría reservable (mismo criterio que
  -- barbershop_min_advance_vs_window_ck).
  CONSTRAINT barber_booking_policy_min_advance_vs_window_ck CHECK (
    min_advance_minutes < max_advance_days * 1440
  )
);

COMMENT ON TABLE barber_booking_policy IS
  'Ventana de reserva pública propia y opcional de un barbero (DEC-169): anticipación mínima, '
  'ventana máxima y paso de rejilla. Sin fila, el barbero hereda los valores de barbershop. '
  'Propietario funcional: módulo shops (configuración de reserva). Clasificación: configuración, '
  'sin datos personales. Retención: mientras la barbería la mantenga; volver a heredar borra la fila.';

COMMENT ON COLUMN barber_booking_policy.min_advance_minutes IS
  'Anticipación mínima en minutos para reservar públicamente con este barbero (RN-DIS-04). Rango '
  '[0, 1440] (DEC-083). No aplica a la creación manual.';

COMMENT ON COLUMN barber_booking_policy.max_advance_days IS
  'Ventana máxima en días para reservar públicamente con este barbero (RN-DIS-04). Rango [1, 90] '
  '(DEC-083). No aplica a la creación manual.';

COMMENT ON COLUMN barber_booking_policy.slot_grid_minutes IS
  'Paso en minutos de la rejilla de franjas de este barbero (RN-DIS-06). Entero de 1 a 60 '
  '(DEC-133). No aplica a la creación manual.';

CREATE TRIGGER barber_booking_policy_set_updated_at
  BEFORE UPDATE ON barber_booking_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seguridad a nivel de fila
-- ---------------------------------------------------------------------------

ALTER TABLE barber_booking_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_booking_policy FORCE  ROW LEVEL SECURITY;

-- Rol administrativo: FORCE ROW LEVEL SECURITY también alcanza al
-- propietario (estandar-base-datos.md §9.5, mismo patrón que barber_photo).
CREATE POLICY barber_booking_policy_all_admin_policy ON barber_booking_policy
  FOR ALL TO barberia_owner
  USING (true) WITH CHECK (true);

CREATE POLICY barber_booking_policy_select_tenant_policy ON barber_booking_policy
  FOR SELECT TO barberia_app
  USING (barbershop_id = current_setting('app.barbershop_id')::uuid);

CREATE POLICY barber_booking_policy_insert_tenant_policy ON barber_booking_policy
  FOR INSERT TO barberia_app
  WITH CHECK (barbershop_id = current_setting('app.barbershop_id')::uuid);

CREATE POLICY barber_booking_policy_update_tenant_policy ON barber_booking_policy
  FOR UPDATE TO barberia_app
  USING      (barbershop_id = current_setting('app.barbershop_id')::uuid)
  WITH CHECK (barbershop_id = current_setting('app.barbershop_id')::uuid);

CREATE POLICY barber_booking_policy_delete_tenant_policy ON barber_booking_policy
  FOR DELETE TO barberia_app
  USING (barbershop_id = current_setting('app.barbershop_id')::uuid);

-- ---------------------------------------------------------------------------
-- 4. Privilegios del rol de aplicación
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE barber_booking_policy TO barberia_app;
