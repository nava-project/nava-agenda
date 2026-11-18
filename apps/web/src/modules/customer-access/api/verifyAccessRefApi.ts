// Canjear el código de un enlace de Odin por el acceso a ese turno (HU-106): único
// punto que llama a `POST /public/businesses/{slug}/customer-access/verify-ref`.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { VerifyAccessRefOutcome } from '../model/customerAccessOutcome'

/**
 * - 200: acceso concedido, con el propósito para el que se pidió;
 * - 401: código o enlace no válido, sin decir por qué (CA-106-05);
 * - 400/422: el código no tiene 6 dígitos;
 * - 404: el negocio del enlace no existe o no está publicada.
 */
export async function verifyAccessRef(
  slug: string,
  accessRef: string,
  code: string,
): Promise<VerifyAccessRefOutcome> {
  try {
    const { data, error, response } = await httpClient.POST(
      '/public/businesses/{slug}/customer-access/verify-ref',
      { params: { path: { slug } }, body: { accessRef, code } },
    )
    if (response.ok && data) {
      return { kind: 'granted', accessToken: data.accessToken, purpose: data.purpose }
    }
    switch (response.status) {
      case 401:
        return { kind: 'invalid-code' }
      case 400:
      case 422:
        return { kind: 'invalid-input' }
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
