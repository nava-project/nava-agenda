// Cliente de `GET /private/settings/public-link` (issue #304, DEC-117). La
// primera lectura de un negocio sin enlace lo genera en el servidor; este
// cliente solo lo lee, no hay editar ni regenerar.
import { httpClient } from '@/shared/api/httpClient'
import type { FetchPublicLinkOutcome } from '../model/publicLinkOutcome'

// Mismo formato que `business_public_slug_ck`: lo que no lo cumple no es un
// enlace que el servidor pudo emitir y no se muestra como si lo fuera.
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/

export async function fetchPublicLink(): Promise<FetchPublicLinkOutcome> {
  try {
    const { data, response } = await httpClient.GET('/private/settings/public-link')
    if (response.ok && data && SLUG_PATTERN.test(data.slug)) {
      return { kind: 'success', slug: data.slug }
    }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}
