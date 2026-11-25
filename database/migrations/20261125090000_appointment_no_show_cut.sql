-- Propósito
--   Issue #854 (DEC-193): un turno marcado «No vino» deja de ocupar la agenda
--   desde el minuto en que se marca. Lo que queda de su franja vuelve a estar
--   libre para otro turno, en la agenda del personal y en la reserva pública.
--     * `appointment.no_show_cut_at`: el minuto de la marca (truncado en el
--       API con el mismo reloj que decidió que el turno ya empezó).
--     * `appointment_occupied_until(...)`: hasta cuándo ocupa de verdad la
--       franja. Es el criterio ÚNICO: lo usan la exclusión y las lecturas de
--       disponibilidad y del turno, así que no pueden divergir.
--     * `appointment_professional_interval_excl` pasa a usar
--       `[starts_at, appointment_occupied_until(...))` en vez de
--       `[starts_at, ends_at)`.
--
-- Función y no columna generada (medido, cuerpo del PR de #854)
--   Una columna `STORED` reescribe la tabla además de reconstruir el GiST:
--   con 200 000 turnos sintéticos, 8,9 s bajo ACCESS EXCLUSIVE frente a 4,2 s
--   de la función, que solo reconstruye el índice. La función es IMMUTABLE
--   (CASE, LEAST y GREATEST sobre sus argumentos), así que la admite la
--   exclusión. Cambiar su cuerpo exige reconstruir la exclusión en la misma
--   migración: un CREATE OR REPLACE solo dejaría el índice con valores viejos.
--
-- Reglas y decisiones
--   DEC-193, RN-CON-01 a RN-CON-03, RN-DIS-02, RN-DIS-05 (semiabierto),
--   estados-citas.md §4 y §11, DEC-036 (roll-forward), RN-TEN-01.
--
-- Convive con el API anterior (expand)
--   `agenda/deploy` aplica Atlas antes de arrancar el API nuevo: en esa ventana,
--   o si el despliegue se revierte, el API anterior escribe sobre este esquema.
--   Por eso no hay CHECK que ate `no_show_cut_at` al estado:
--     * un `no_show` sin corte (API anterior, o los que ya existen) ocupa la
--       franja entera, como hasta hoy; no se rellena nada;
--     * un corte que queda en un turno que ya no es `no_show` no cuenta: solo
--       la función decide, y el API nuevo lo pone a NULL al salir de `no_show`.
--   Un CHECK de estado, si hace falta, irá en una migración posterior cuando ya
--   no pueda correr el API anterior.
--
-- Qué NO hace
--   `starts_at` y `ends_at` no cambian: el turno conserva su hora original
--   (historial, reportes, Google Calendar). `occupies_schedule` tampoco: un
--   `no_show` sigue ocupando, aunque sea solo hasta el corte.
--
-- Clasificación de datos
--   Un instante operativo, sin datos personales.
--
-- Riesgo y recuperación
--   Toma ACCESS EXCLUSIVE sobre appointment: recrear la exclusión reconstruye
--   su índice GiST (4,2 s con 200 000 turnos, 0,8 s con 20 000; añadir la
--   columna nullable sin valor por omisión no reescribe la tabla).
--   `lock_timeout` hace que, si otra transacción retiene la tabla, la
--   migración falle a los 5 s en vez de encolar detrás a la agenda y la
--   reserva pública; el despliegue se reintenta. Atlas aplica el archivo en
--   UNA transacción, así que nunca hay un instante sin exclusión, y un aborto
--   no deja nada a medias. El nombre de la exclusión se conserva exacto: el API
--   traduce su violación a 409 comparando por nombre.
--   Roll-forward (DEC-036): revertir es otra migración que recrea la exclusión
--   sobre `ends_at`, quita la función y la columna.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointment_professional_interval_excl'
      AND conrelid = 'public.appointment'::regclass
  ) THEN
    RAISE EXCEPTION
      'Esta migración depende de 20261121090000_rename_to_business_professional.sql; '
      'esa migración debe estar aplicada antes.';
  END IF;
END
$$;

ALTER TABLE appointment ADD COLUMN no_show_cut_at timestamptz;

COMMENT ON COLUMN appointment.no_show_cut_at IS
  'Minuto en que el turno se marcó «No vino» (DEC-193), truncado por el API con el reloj de la '
  'guarda. NULL en cualquier otro estado y en los no_show anteriores a DEC-193 (ocupan entera). '
  'Solo cuenta a través de appointment_occupied_until.';

-- R2 de DEC-193: el corte nunca sale de la franja. Marcar justo en el inicio
-- deja un rango vacío (libera todo); marcar después del fin no libera nada.
-- SQL simple, sin SET: así el planificador puede integrarla en la consulta.
CREATE FUNCTION appointment_occupied_until(
  p_status text, p_starts_at timestamptz, p_ends_at timestamptz, p_no_show_cut_at timestamptz
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_status = 'no_show' AND p_no_show_cut_at IS NOT NULL
      THEN LEAST(GREATEST(p_no_show_cut_at, p_starts_at), p_ends_at)
    ELSE p_ends_at
  END
$$;

COMMENT ON FUNCTION appointment_occupied_until(text, timestamptz, timestamptz, timestamptz) IS
  'Criterio ÚNICO de hasta cuándo ocupa agenda un turno (DEC-193, estados-citas.md §11): '
  'ends_at, salvo un no_show con corte, que ocupa hasta el corte acotado a [starts_at, ends_at]. '
  'Lo usan la exclusión y las lecturas. Cambiar el cuerpo exige reconstruir la exclusión.';

-- Las funciones nuevas nacen sin EXECUTE para PUBLIC (20260811145252): el API
-- la evalúa al escribir (exclusión) y al leer; el worker lee turnos.
GRANT EXECUTE ON FUNCTION appointment_occupied_until(text, timestamptz, timestamptz, timestamptz)
  TO agenda_app, agenda_worker;

ALTER TABLE appointment DROP CONSTRAINT appointment_professional_interval_excl;

ALTER TABLE appointment
  ADD CONSTRAINT appointment_professional_interval_excl
  EXCLUDE USING gist (
    business_id     WITH =,
    professional_id WITH =,
    tstzrange(starts_at, appointment_occupied_until(status, starts_at, ends_at, no_show_cut_at), '[)') WITH &&
  ) WHERE (occupies_schedule);
