// Ventana de reserva propia de un barbero (DEC-169): anticipación mínima,
// ventana máxima y rejilla. Un barbero sin ventana propia hereda la de la
// barbería; el plazo y la cancelación no son por barbero.

/** Los tres valores de una ventana de reserva (de la barbería o propia). */
export interface BookingWindowValues {
  minAdvanceMinutes: number
  maxAdvanceDays: number
  slotGridMinutes: number
}

export interface BarberBookingWindow extends BookingWindowValues {
  barberId: string
}

/** Lo mínimo que el panel necesita de cada barbero para elegirlo. */
export interface BarberWindowOption {
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
