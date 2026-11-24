// Catálogo público del enlace, compartido por la entrada y «Día y hora»
// (DEC-188). Igual que el perfil (publicProfile.ts): una petición en vuelo por
// enlace se comparte y una lectura exitosa queda a mano para el siguiente paso,
// así pasar de la entrada a la hora no vuelve a pedir el catálogo.
import { listPublicServices } from '../api/listPublicServicesApi'
import type { ListPublicServicesOutcome, PublicService } from './publicServiceListOutcome'

const servicesBySlug = new Map<string, PublicService[]>()
const inFlight = new Map<string, Promise<ListPublicServicesOutcome>>()

export function loadPublicServices(slug: string): Promise<ListPublicServicesOutcome> {
  const cached = servicesBySlug.get(slug)
  if (cached) return Promise.resolve({ kind: 'success', services: cached })
  const pending = inFlight.get(slug)
  if (pending) return pending
  const request = listPublicServices(slug)
    .then((outcome) => {
      if (outcome.kind === 'success') servicesBySlug.set(slug, outcome.services)
      return outcome
    })
    .finally(() => inFlight.delete(slug))
  inFlight.set(slug, request)
  return request
}

/** El catálogo ya leído del enlace, o `null` si aún no se leyó (#820). */
export function publicServicesFor(slug: string): PublicService[] | null {
  return servicesBySlug.get(slug) ?? null
}

/** Solo para pruebas: olvida lo leído. */
export function resetPublicServicesCache(): void {
  servicesBySlug.clear()
  inFlight.clear()
}
