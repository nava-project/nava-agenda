// Pedir el código para entrar al turno (HU-105): único punto que llama a
// `POST /public/businesses/{slug}/customer-access/challenge`. La página nunca ve
// `Problem` ni el `status` crudo.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { RequestAccessCodeOutcome } from '../model/customerAccessOutcome'

/** Espera por defecto si el servidor no manda `Retry-After` (la ventana es de 15 min). */
const DEFAULT_RETRY_AFTER_SECONDS = 60

function retryAfterSeconds(response: Response): number {
  const seconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS
}

/**
 * - 202: enviado (o no: la respuesta no lo revela, CA-105-01);
 * - 429: demasiados códigos pedidos;
 * - 400/422: contacto con forma inválida;
 * - 404: la barbería del enlace no existe o no está publicada.
 */
export async function requestAccessCode(
  slug: string,
  contact: string,
): Promise<RequestAccessCodeOutcome> {
  try {
    const { data, error, response } = await httpClient.POST(
      '/public/businesses/{slug}/customer-access/challenge',
      { params: { path: { slug } }, body: { contact } },
    )
    if (response.status === 202 && data) {
      return {
        kind: 'sent',
        expiresInSeconds: data.expiresInSeconds,
        resendAfterSeconds: data.resendAfterSeconds,
      }
    }
    switch (response.status) {
      case 429:
        return { kind: 'rate-limited', retryAfterSeconds: retryAfterSeconds(response) }
      case 400:
      case 422:
        return { kind: 'invalid-contact' }
      case 404:
        return { kind: 'barbershop-not-found' }
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
