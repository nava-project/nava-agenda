// Lo que la Agenda necesita antes de pedir el día: los profesionales y la zona
// horaria del negocio (#822, F2/F6). Se pedían de nuevo en cada entrada a la
// Agenda y la pantalla se quedaba con solo su título mientras llegaban. Ahora
// lo último leído en esta sesión dibuja la pantalla al instante y se relee
// por detrás.
//
// Nunca sirve datos de otra sesión ni datos viejos tras un cambio:
// - `app` lo olvida cada vez que la sesión deja de estar autenticada (cerrar
//   sesión, 401, entrar con otra cuenta u otro negocio), y la clave es el
//   negocio de la sesión;
// - cualquier escritura con éxito sobre profesionales o sobre la
//   configuración del negocio (zona horaria) lo olvida (`agendaContextInvalidation`).
import type { Middleware } from 'openapi-fetch'
import type { ProfessionalSummary } from './appointment'

export interface AgendaContext {
  professionals: ProfessionalSummary[]
  timezone: string
}

let remembered: { businessId: string; context: AgendaContext } | null = null

/** Lo último leído para el negocio de la sesión, o `null`. */
export function knownAgendaContext(businessId: string | null): AgendaContext | null {
  if (!businessId || remembered?.businessId !== businessId) return null
  return remembered.context
}

export function rememberAgendaContext(businessId: string | null, context: AgendaContext): void {
  remembered = businessId ? { businessId, context } : null
}

export function forgetAgendaContext(): void {
  remembered = null
}

// Rutas cuyas escrituras cambian lo que la Agenda guarda: profesionales (alta,
// edición, baja, foto), el perfil propio del profesional individual («Mi
// perfil», DEC-115) y la configuración del negocio (zona horaria).
const AFFECTING_PATHS = ['/private/professionals', '/private/me/professional', '/private/settings']

/** Middleware del cliente HTTP que `app` instala: olvida lo guardado tras una
 * escritura con éxito que pueda cambiarlo. */
export const agendaContextInvalidation: Middleware = {
  onResponse({ request, schemaPath, response }) {
    if (request.method === 'GET' || !response.ok) return undefined
    if (AFFECTING_PATHS.some((p) => schemaPath === p || schemaPath.startsWith(`${p}/`)))
      forgetAgendaContext()
    return undefined
  },
}
