// Canjear el código por el acceso a los turnos (HU-105): único punto que llama a
// `POST /public/businesses/{slug}/customer-access/verify`.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { VerifyAccessCodeOutcome } from '../model/customerAccessOutcome'

/**
 * - 200: acceso concedido (un `accessToken` por turno);
 * - 401: código no válido, sin decir por qué (CA-105-02);
 * - 400/422: contacto o código con forma inválida;
 * - 404: el negocio del enlace no existe o no está publicada.
 */
export async function verifyAccessCode(
  slug: string,
  contact: string,
  code: string,
): Promise<VerifyAccessCodeOutcome> {
  try {
    const { data, error, response } = await httpClient.POST(
      '/public/businesses/{slug}/customer-access/verify',
      { params: { path: { slug } }, body: { contact, code } },
    )
    if (response.ok && data) {
      return {
        kind: 'granted',
        grant: {
          timezone: data.timezone,
          appointments: data.appointments.map((a) => ({
            accessToken: a.accessToken,
            startsAt: a.startsAt,
            serviceName: a.serviceName,
            professionalName: a.professionalName,
          })),
        },
      }
    }
    switch (response.status) {
      case 401:
        return { kind: 'invalid-code' }
      case 400:
      case 422:
        return { kind: 'invalid-contact' }
      case 404:
        return { kind: 'business-not-found' }
      default:
        return {
          kind: 'unexpected-error',
          requestId: isProblem(error) ? error.requestId : undefined,
        }
    }
  } catch {
    return { kind: 'network-error' }
  }
}
