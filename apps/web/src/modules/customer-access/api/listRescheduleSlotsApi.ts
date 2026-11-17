// Franjas para reprogramar el turno (HU-104): único punto que llama a
// `GET /customer/appointments/{token}/reschedule-slots`. La página nunca ve
// `Problem` ni el `status` crudo.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { ListRescheduleSlotsOutcome } from '../model/customerAppointmentOutcome'

/** 404 es el enlace inexistente, vencido o revocado (mismo criterio que la lectura). */
export async function listRescheduleSlots(token: string): Promise<ListRescheduleSlotsOutcome> {
  try {
    const { data, error, response } = await httpClient.GET(
      '/customer/appointments/{token}/reschedule-slots',
      { params: { path: { token } } },
    )
    if (response.ok && data) {
      return { kind: 'success', slots: { timezone: data.timezone, starts: [...data.starts] } }
    }
    if (response.status === 404) return { kind: 'not-found' }
    return { kind: 'unexpected-error', requestId: isProblem(error) ? error.requestId : undefined }
  } catch {
    return { kind: 'network-error' }
  }
}
