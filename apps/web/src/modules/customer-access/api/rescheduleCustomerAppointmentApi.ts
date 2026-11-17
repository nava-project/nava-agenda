// Reprogramar el turno del cliente (HU-104, DEC-178): único punto que llama a
// `POST /customer/appointments/{token}/reschedule`. Traduce la respuesta a
// `RescheduleAppointmentOutcome`.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { RescheduleAppointmentOutcome } from '../model/customerAppointmentOutcome'

/**
 * Mapea por `status` y `code`, nunca por `detail`:
 * - 200: reprogramado;
 * - 409 `slot-conflict`: la hora se ocupó;
 * - 409 `idempotency-locked`: la misma clave sigue en curso;
 * - cualquier otro 409: el turno cambió;
 * - 422 `reschedule-window-closed` y `reschedule-limit-reached`: rechazos de
 *   política; cualquier otro 422 o un 400 es una entrada inválida;
 * - 404: el enlace ya no sirve.
 */
export async function rescheduleCustomerAppointment(
  token: string,
  versionToken: string,
  idempotencyKey: string,
  startsAt: string,
): Promise<RescheduleAppointmentOutcome> {
  try {
    const { data, error, response } = await httpClient.POST(
      '/customer/appointments/{token}/reschedule',
      {
        params: {
          path: { token },
          header: { 'Idempotency-Key': idempotencyKey, 'If-Match': versionToken },
        },
        body: { startsAt },
      },
    )

    if (response.ok && data)
      return { kind: 'success', startsAt: data.startsAt, endsAt: data.endsAt }

    const problem = isProblem(error) ? error : undefined
    switch (response.status) {
      case 404:
        return { kind: 'not-found' }
      case 409:
        if (problem?.code === 'slot-conflict') return { kind: 'slot-taken' }
        if (problem?.code === 'idempotency-locked') return { kind: 'idempotency-in-progress' }
        return { kind: 'changed' }
      case 422:
        if (problem?.code === 'reschedule-window-closed') return { kind: 'window-closed' }
        if (problem?.code === 'reschedule-limit-reached') return { kind: 'limit-reached' }
        return { kind: 'validation-error' }
      case 400:
        return { kind: 'validation-error' }
      default:
        return { kind: 'unexpected-error', requestId: problem?.requestId }
    }
  } catch {
    return { kind: 'network-error' }
  }
}
