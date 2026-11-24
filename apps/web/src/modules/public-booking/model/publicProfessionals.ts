// Profesionales públicos del servicio que «Día y hora» acaba de leer, a mano
// para «Tus datos» (#820). Allí solo se usan para el resumen (nombre y foto);
// sin ellos, el renglón «Con …» llegaba tarde y empujaba la tarjeta. «Tus
// datos» los sigue pidiendo frescos: esto solo evita el salto al llegar.
import type { PublicProfessional } from './publicProfessionalListOutcome'

const bySlugAndService = new Map<string, PublicProfessional[]>()

const keyFor = (slug: string, serviceId: string) => `${slug}\u0000${serviceId}`

export function rememberPublicProfessionals(
  slug: string,
  serviceId: string,
  professionals: PublicProfessional[],
): void {
  bySlugAndService.set(keyFor(slug, serviceId), professionals)
}

/** Los últimos profesionales leídos para el servicio, o `null` si aún no. */
export function publicProfessionalsFor(
  slug: string,
  serviceId: string,
): PublicProfessional[] | null {
  return bySlugAndService.get(keyFor(slug, serviceId)) ?? null
}

/** Solo para pruebas: olvida lo leído. */
export function resetPublicProfessionalsCache(): void {
  bySlugAndService.clear()
}
