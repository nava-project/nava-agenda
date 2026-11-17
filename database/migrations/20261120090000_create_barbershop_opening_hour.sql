-- Propósito
--   Issue #654 (HU-107, DEC-182): horario de atención propio del local, que el
--   dueño edita en Configuración y que el perfil público expone para la reserva
--   y para Odin («¿sigue abierto a las 6?»). Hasta ahora NAVA solo guardaba el
--   horario de cada barbero (`working_hour`), que es privado.
--
-- Reglas y decisiones
--   RN-TEN-01, DEC-020 (intervalos semiabiertos), DEC-070 (sin CASCADE),
--   DEC-182.
--
-- Modelo
--   1. `barbershop_opening_hour`: un tramo de apertura por fila, por día ISO de
--      la semana (1 = lunes … 7 = domingo, igual que `working_hour`). Varios
--      tramos en un día representan un cierre al mediodía; un día sin filas está
--      cerrado. El tramo es `[opens_time, closes_time)` dentro del mismo día:
--      `closes_time` admite `24:00` («hasta medianoche») y un horario que pasa
--      de medianoche se guarda como dos tramos (el resto en el día siguiente).
--      Se prefiere una hora de cierre explícita a `duration_minutes` porque es
--      lo que el dueño escribe y lo que el perfil público devuelve.
--   2. `barbershop.closed_on_holidays`: el local cierra los festivos colombianos.
--      Es un atributo del negocio, así que vive en su fila (3FN intacta).
--
--   El horario del local es informativo: no limita la disponibilidad, que sigue
--   saliendo del horario de cada barbero (DEC-182).
--
-- Qué NO hace esta migración
--   No impide el solape parcial entre dos tramos del mismo día que no comparten
--   `opens_time`: lo valida el servicio Go, que además reemplaza la semana
--   completa en una sola transacción. El UNIQUE cubre la repetición exacta.
--   Tampoco guarda cierres puntuales por fecha (fuera de alcance de HU-107).
--
-- Clasificación de datos
--   Negocio. No es un dato personal.
--
-- Riesgo y recuperación
--   Tabla nueva y vacía; ADD COLUMN con DEFAULT constante no reescribe
--   `barbershop`. Roll-forward (DEC-036): una corrección se hace con otra
--   migración.

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

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'barbershop_opening_hour'
  ) THEN
    RAISE EXCEPTION 'barbershop_opening_hour ya existe: esta migración no puede aplicarse dos veces.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberia_owner') THEN
    RAISE EXCEPTION
      'Esta migración depende de 20260811145252_harden_roles_and_definer_functions.sql '
      '(rol barberia_owner); esa migración debe estar aplicada antes.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. `barbershop.closed_on_holidays`
-- ---------------------------------------------------------------------------
ALTER TABLE barbershop
  ADD COLUMN closed_on_holidays boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN barbershop.closed_on_holidays IS
  'El local cierra los festivos colombianos (DEC-182): el perfil público muestra «hoy» cerrado '
  'en un festivo aunque barbershop_opening_hour tenga tramos para ese día de la semana.';

-- ---------------------------------------------------------------------------
-- 2. `barbershop_opening_hour`
-- ---------------------------------------------------------------------------
CREATE TABLE barbershop_opening_hour (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  barbershop_id uuid        NOT NULL,
  iso_weekday   smallint    NOT NULL,
  opens_time    time        NOT NULL,
  closes_time   time        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT barbershop_opening_hour_id_pk PRIMARY KEY (id),

  -- ON DELETE RESTRICT, no CASCADE (DEC-070): barbershop no tiene borrado
  -- físico; si una historia futura lo agrega, decidirá qué pasa con el horario.
  CONSTRAINT barbershop_opening_hour_barbershop_id_fk
    FOREIGN KEY (barbershop_id) REFERENCES barbershop (id) ON DELETE RESTRICT,

  -- ISO 8601: 1 = lunes … 7 = domingo, igual que working_hour.
  CONSTRAINT barbershop_opening_hour_iso_weekday_ck CHECK (iso_weekday BETWEEN 1 AND 7),

  -- Tramo semiabierto dentro del mismo día (DEC-020). `time` admite 24:00:00,
  -- que es «hasta medianoche»; abrir a las 24:00 no tiene sentido.
  CONSTRAINT barbershop_opening_hour_range_ck CHECK (closes_time > opens_time),

  -- Horas en minutos enteros: es lo que el dueño escribe y lo que el contrato
  -- devuelve (`HH:MM`).
  CONSTRAINT barbershop_opening_hour_whole_minutes_ck CHECK (
    date_part('second', opens_time) = 0 AND date_part('second', closes_time) = 0
  ),

  CONSTRAINT barbershop_opening_hour_shop_weekday_opens_uk
    UNIQUE (barbershop_id, iso_weekday, opens_time)
);

COMMENT ON TABLE barbershop_opening_hour IS
  'Tramo del horario de atención del local por día ISO de la semana (HU-107, DEC-182). '
  'Propietario funcional: barbería. Retención: mientras exista la barbería. Clasificación: '
  'negocio. Un día sin filas está cerrado; varios tramos en un día son un cierre al mediodía. '
  'Informativo: no limita la disponibilidad de los barberos.';
COMMENT ON COLUMN barbershop_opening_hour.opens_time IS
  'Hora civil de apertura, interpretada con barbershop.timezone (estandar-base-datos.md §5.5).';
COMMENT ON COLUMN barbershop_opening_hour.closes_time IS
  'Hora civil de cierre, excluida del tramo; 24:00 es medianoche. Un horario que pasa de '
  'medianoche se guarda como dos tramos.';

ALTER TABLE barbershop_opening_hour ENABLE ROW LEVEL SECURITY;
ALTER TABLE barbershop_opening_hour FORCE  ROW LEVEL SECURITY;

CREATE POLICY barbershop_opening_hour_all_admin_policy ON barbershop_opening_hour
  FOR ALL TO barberia_owner
  USING (true) WITH CHECK (true);

CREATE POLICY barbershop_opening_hour_select_tenant_policy ON barbershop_opening_hour
  FOR SELECT TO barberia_app
  USING (barbershop_id = current_setting('app.barbershop_id')::uuid);

CREATE POLICY barbershop_opening_hour_insert_tenant_policy ON barbershop_opening_hour
  FOR INSERT TO barberia_app
  WITH CHECK (barbershop_id = current_setting('app.barbershop_id')::uuid);

CREATE POLICY barbershop_opening_hour_delete_tenant_policy ON barbershop_opening_hour
  FOR DELETE TO barberia_app
  USING (barbershop_id = current_setting('app.barbershop_id')::uuid);

-- Sin UPDATE: guardar el horario reemplaza la semana completa (DELETE + INSERT
-- en una transacción), así que barberia_app no necesita modificar filas. El
-- índice del UNIQUE (barbershop_id, iso_weekday, opens_time) ya sirve la
-- lectura ordenada por barbería, así que no se crea otro.
GRANT SELECT, INSERT, DELETE ON TABLE barbershop_opening_hour TO barberia_app;
