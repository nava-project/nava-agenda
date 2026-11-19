// Único punto del módulo que llama a
// `GET /public/businesses/{slug}/services/{serviceId}/availability` (DEC-162).
// Traduce la respuesta a `ListPublicServiceAvailabilityOutcome`: la página no ve
// `Problem`, `status` crudo ni cabeceras. Mismo mapeo que
// `listPublicAvailabilityApi.ts`: 404 uniforme para un enlace inválido; un
// servicio ajeno o sin profesionales llega como 200 con `slots: []`.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { ListPublicServiceAvailabilityOutcome } from '../model/publicServiceAvailabilityOutcome'

export async function listPublicServiceAvailability(
  slug: string,
  serviceId: string,
): Promise<ListPublicServiceAvailabilityOutcome> {
  try {
    const { data, error, response } = await httpClient.GET(
      '/public/businesses/{slug}/services/{serviceId}/availability',
      { params: { path: { slug, serviceId } } },
    )
    if (response.ok && data) {
      return {
        kind: 'success',
        availability: {
          slots: data.slots.map((slot) => ({
            professionalId: slot.professionalId,
            startsAt: slot.startsAt,
          })),
          durationMinutes: data.durationMinutes,
          timezone: data.timezone,
          slotGridMinutes: data.slotGridMinutes,
        },
      }
    }
    if (response.status === 404) return { kind: 'not-found' }
    return { kind: 'unexpected-error', requestId: isProblem(error) ? error.requestId : undefined }
  } catch {
    return { kind: 'network-error' }
  }
}
