// Disponibilidad pública de un servicio con TODOS sus profesionales en una sola
// respuesta (DEC-162, `GET /public/businesses/{slug}/services/{serviceId}/availability`).
// La v2 de la reserva (DEC-188) la usa para «Día y hora»: el profesional es un
// filtro sobre datos ya recibidos y «Cualquiera» es la unión, sin una llamada
// por profesional ni por día (RN-DIS-03: consultar no reserva).

/** Un inicio válido de un profesional concreto. */
export interface PublicServiceSlot {
  professionalId: string
  startsAt: string
}

export interface PublicServiceAvailabilityWindow {
  /** Ordenados por (`startsAt`, `professionalId`), tal como los entrega el servidor. */
  slots: PublicServiceSlot[]
  durationMinutes: number
  timezone: string
  slotGridMinutes: number
}

export type ListPublicServiceAvailabilityOutcome =
  | { kind: 'success'; availability: PublicServiceAvailabilityWindow }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
