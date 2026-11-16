-- Propósito
--   Issue #603 (DEC-172): la ventana de reserva propia de un barbero deja de
--   tener un tope de días que el dueño elija. Dura hasta que se apaga y el
--   cliente reserva con ese barbero hasta el techo que el sistema calcula
--   (90 días, el mismo de la ventana de la barbería, DEC-083). El panel ya no
--   pide los días y envía siempre 90; esta migración lleva al mismo valor las
--   ventanas propias guardadas antes de este cambio.
--
-- Reglas y decisiones
--   RN-DIS-04, DEC-083, DEC-169, DEC-172; DEC-035/DEC-036 (Atlas, migración
--   inmutable).
--
-- Qué hace
--   Solo datos: UPDATE de max_advance_days a 90 en las filas existentes de
--   barber_booking_policy. No cambia columnas, CHECK, RLS ni privilegios: 90
--   ya cumple barber_booking_policy_max_advance_days_ck (1..90) y, con la
--   anticipación máxima de 1440 min, barber_booking_policy_min_advance_vs_window_ck.
--   Se ejecuta con el rol administrativo, que tiene su propia política FOR ALL
--   (barber_booking_policy_all_admin_policy) pese a la RLS forzada.
--
-- Bloqueo y recuperación
--   Toca a lo sumo una fila por barbero con ventana propia: bloqueo de fila
--   breve. Los días anteriores no se pueden recuperar, pero el panel ya no los
--   muestra ni los usa (DEC-172): no hay pérdida funcional.

UPDATE barber_booking_policy
   SET max_advance_days = 90
 WHERE max_advance_days <> 90;
