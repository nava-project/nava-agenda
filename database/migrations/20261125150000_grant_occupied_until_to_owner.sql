-- Propósito
--   Issue #854 (DEC-193), seguimiento de 20261125090000. La exclusión
--   `appointment_professional_interval_excl` evalúa `appointment_occupied_until`.
--   PostgreSQL construye y reconstruye ese índice (CREATE, REINDEX, ANALYZE y
--   autovacuum) como DUEÑO DE LA TABLA, no como quien ejecuta la sentencia.
--   La función es de `agenda_migrator` y, por el default de
--   20260811145252, sin EXECUTE para PUBLIC; 20261125090000 solo se lo dio a
--   `agenda_app` y `agenda_worker`.
--
--   Donde `appointment` es de `agenda_owner` (la BD local de desarrollo, o una
--   restauración que deje ese dueño), crear o reconstruir la exclusión falla con
--   42501. En producción la tabla es de `agenda_migrator` y no pasó (deploy 90).
--   Este GRANT quita la dependencia del dueño de la tabla en cualquier entorno.
--
-- Seguridad
--   La función es IMMUTABLE, SECURITY INVOKER, sin acceso a tablas: un CASE
--   sobre sus cuatro argumentos. `agenda_owner` ya administra la tabla; darle
--   EXECUTE no le abre nada nuevo.
--
-- Idempotencia y bloqueo
--   GRANT de un privilegio ya concedido no falla ni cambia nada: la BD local,
--   que lo recibió a mano al reconciliarse (#854, comentario de la opción (a)),
--   aplica esta migración sin efecto. Solo toca el catálogo de la función; no
--   bloquea `appointment`.
--
-- Plan de avance
--   Roll-forward (DEC-036): una corrección posterior va en otra migración.

GRANT EXECUTE ON FUNCTION appointment_occupied_until(text, timestamptz, timestamptz, timestamptz)
  TO agenda_owner;
