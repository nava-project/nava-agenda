// Ventana de reserva propia de un profesional (DEC-169): anticipación mínima,
// ventana máxima y rejilla. Un profesional sin ventana propia hereda la del
// negocio; el plazo y la cancelación no son por profesional.

/** Los tres valores de una ventana de reserva (del negocio o propia). */
export interface BookingWindowValues {
  minAdvanceMinutes: number
  maxAdvanceDays: number
  slotGridMinutes: number
}

export interface ProfessionalBookingWindow extends BookingWindowValues {
  professionalId: string
}

/**
 * Días por delante de una ventana propia (DEC-172). La ventana propia no tiene un
 * tope de días que el dueño elija: dura hasta que se apaga y el cliente reserva
 * con ese profesional hasta el máximo que el sistema calcula (90 días, el mismo techo
 * de la ventana del negocio, DEC-083), porque la disponibilidad se calcula de
 * una vez para toda la ventana.
 */
export const PROFESSIONAL_WINDOW_MAX_DAYS = 90

/** Lo mínimo que el panel necesita de cada profesional para elegirlo. */
export interface ProfessionalWindowOption {
  id: string
  fullName: string
  photoUrl: string | null
}

export function sameWindow(a: BookingWindowValues, b: BookingWindowValues): boolean {
  return (
    a.minAdvanceMinutes === b.minAdvanceMinutes &&
    a.maxAdvanceDays === b.maxAdvanceDays &&
    a.slotGridMinutes === b.slotGridMinutes
  )
}
