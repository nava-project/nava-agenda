// Parámetro de query anterior a DEC-183 (#662): la agenda y el detalle del turno
// recibían `?barberId=`; hoy leen `?professionalId=`. Un enlace guardado con la forma
// vieja se reescribe a la nueva (mismo valor, misma ruta, mismo resto de query y
// ancla) en vez de perder la selección.
import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

const LEGACY_PARAM = 'barberId'

/** Destino con el parámetro nuevo, o `null` si `to` no trae el viejo. */
export function legacyQueryRedirect(to: RouteLocationNormalized): RouteLocationRaw | null {
  if (!(LEGACY_PARAM in to.query)) return null
  const { [LEGACY_PARAM]: legacy, ...rest } = to.query
  return {
    path: to.path,
    query: { ...rest, professionalId: rest.professionalId ?? legacy },
    hash: to.hash,
    replace: true,
  }
}
