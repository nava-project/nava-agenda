// Pista local de la reprogramación del cliente (HU-104, DEC-178) para decidir qué
// ofrecer antes de llamar al API. Usa el reloj del dispositivo, así que es solo una
// pista: la decisión real es del servidor y su rechazo siempre prevalece.
import type { CustomerAppointment } from './customerAppointmentOutcome'

export type RescheduleAvailability =
  /** Se puede cambiar la hora hasta `deadlineMs` (inclusive). */
  | { mode: 'available'; remaining: number; deadlineMs: number }
  | { mode: 'unavailable'; reason: 'not-confirmed' | 'window-closed' | 'limit-reached' }

/**
 * Misma regla que el servidor:
 * - solo un turno `confirmed`;
 * - hasta `startsAt - plazo` inclusive, el mismo plazo de la cancelación;
 * - con plazo 0, nunca (no hay reprogramación tardía);
 * - como máximo las reprogramaciones que indique `rescheduleRemaining`.
 */
export function rescheduleAvailability(
  appointment: Pick<
    CustomerAppointment,
    'status' | 'startsAt' | 'cancellationDeadlineMinutes' | 'rescheduleRemaining'
  >,
  nowMs: number,
): RescheduleAvailability {
  if (appointment.status !== 'confirmed') return { mode: 'unavailable', reason: 'not-confirmed' }
  const deadlineMs =
    Date.parse(appointment.startsAt) - appointment.cancellationDeadlineMinutes * 60_000
  if (appointment.cancellationDeadlineMinutes <= 0 || nowMs > deadlineMs) {
    return { mode: 'unavailable', reason: 'window-closed' }
  }
  if (appointment.rescheduleRemaining <= 0) return { mode: 'unavailable', reason: 'limit-reached' }
  return { mode: 'available', remaining: appointment.rescheduleRemaining, deadlineMs }
}
