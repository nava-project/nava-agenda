// El nombre del negocio de un enlace público, para la cabecera de las pantallas
// del cliente que viven fuera del cascarón de la reserva (el acceso a «Mi turno»
// con código, DEC-188). Reutiliza el perfil público ya leído por la reserva; si
// aún no está, lo pide una vez (lectura pública existente, sin contrato nuevo).
// Si falla, la cabecera queda sin nombre: la pantalla funciona igual.
import { computed, watch, type ComputedRef } from 'vue'
import { loadPublicProfile, publicProfileFor } from './publicProfile'

export function usePublicBusinessName(slug: () => string): ComputedRef<string> {
  watch(
    slug,
    (value) => {
      if (value && !publicProfileFor(value)) void loadPublicProfile(value).catch(() => undefined)
    },
    { immediate: true },
  )
  return computed(() => publicProfileFor(slug())?.name ?? '')
}
