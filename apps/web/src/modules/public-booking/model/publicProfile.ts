// Perfil público del negocio del enlace, compartido por el cascarón y la
// pantalla de entrada (HU-090, DEC-119). Las dos lo necesitan al abrir un enlace:
// la entrada para mostrar nombre y contacto, el cascarón para el vocabulario.
// Pedirlo dos veces sería un gasto y, si la red falla justo ahora, el cascarón
// «se llevaría» el fallo y la entrada nunca mostraría su error ni su botón de
// reintento. Por eso una petición en vuelo para el mismo enlace se comparte, y
// cualquier lectura exitosa —también la de un reintento de la entrada— deja el
// vocabulario disponible para todas las pantallas.
//
// No es estado de negocio: solo las palabras ya públicas del último perfil leído
// por enlace, que el cascarón vuelve a pedir cada vez que se abre.
import { reactive } from 'vue'
import type { BrandAccentKey, VocabularyTerms } from '@/shared/model'
import { resolveBusiness } from '../api/resolveBusinessApi'
import type { PublicBusinessProfile, ResolveBusinessOutcome } from './businessProfileOutcome'

const termsBySlug = reactive<Record<string, VocabularyTerms>>({})
const accentBySlug = reactive<Record<string, BrandAccentKey>>({})
// DEC-188: el cascarón v2 muestra el nombre del negocio y su franja de hoy.
const profileBySlug = reactive<Record<string, PublicBusinessProfile>>({})
const inFlight = new Map<string, Promise<ResolveBusinessOutcome>>()

/** Resuelve el enlace; llamadas simultáneas para el mismo enlace comparten una sola petición. */
export function loadPublicProfile(slug: string): Promise<ResolveBusinessOutcome> {
  const pending = inFlight.get(slug)
  if (pending) return pending
  const request = resolveBusiness(slug)
    .then((outcome) => {
      if (outcome.kind === 'success') {
        termsBySlug[slug] = outcome.profile.vocabulary
        accentBySlug[slug] = outcome.profile.brandAccent
        profileBySlug[slug] = outcome.profile
      }
      return outcome
    })
    .finally(() => inFlight.delete(slug))
  inFlight.set(slug, request)
  return request
}

/** Palabras del negocio del enlace, o `null` si aún no se leyeron. */
export function publicTermsFor(slug: string): VocabularyTerms | null {
  return termsBySlug[slug] ?? null
}

/** Color de marca del negocio del enlace (DEC-171), o `null` si aún no se leyó. */
export function publicAccentFor(slug: string): BrandAccentKey | null {
  return accentBySlug[slug] ?? null
}

/** Perfil completo del enlace, o `null` si aún no se leyó. */
export function publicProfileFor(slug: string): PublicBusinessProfile | null {
  return profileBySlug[slug] ?? null
}

/** Solo para pruebas: olvida lo leído. */
export function resetPublicProfileCache(): void {
  for (const key of Object.keys(termsBySlug)) delete termsBySlug[key]
  for (const key of Object.keys(accentBySlug)) delete accentBySlug[key]
  for (const key of Object.keys(profileBySlug)) delete profileBySlug[key]
  inFlight.clear()
}
