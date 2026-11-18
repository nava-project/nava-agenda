// Único punto del módulo `integrations` que llama al cliente HTTP tipado
// (docs/03-desarrollo/estandar-frontend-vue.md §6). Traduce las respuestas
// reales de /private/integrations/google-calendar a los outcomes discriminados
// que las páginas consumen; ningún componente ve `Problem`, `status` HTTP crudo
// ni cabeceras. Nunca maneja tokens: el flujo OAuth ocurre entre el navegador,
// Google y el API.
import { httpClient } from '@/shared/api/httpClient'
import type {
  GoogleCalendarCallbackResult,
  GoogleCalendarConnection,
} from '../model/googleCalendar'
import type {
  CompleteCallbackOutcome,
  DisconnectOutcome,
  FetchConnectionOutcome,
  LinkSoleProfessionalOutcome,
  StartConnectOutcome,
  SyncNowOutcome,
  UpdateReminderOutcome,
} from '../model/googleCalendarOutcome'

interface ConnectionWire {
  enabled: boolean
  professionalLinked: boolean
  status: GoogleCalendarConnection['status']
  accountEmail: string | null
  reminderMinutes: number | null
  connectedAt: string | null
  lastSyncedAt: string | null
  pendingSyncJobs: number
  failedSyncJobs: number
}

function toConnection(data: ConnectionWire): GoogleCalendarConnection {
  return {
    enabled: data.enabled,
    professionalLinked: data.professionalLinked,
    status: data.status,
    accountEmail: data.accountEmail,
    reminderMinutes: data.reminderMinutes,
    connectedAt: data.connectedAt,
    lastSyncedAt: data.lastSyncedAt,
    pendingSyncJobs: data.pendingSyncJobs,
    failedSyncJobs: data.failedSyncJobs,
  }
}

export async function fetchConnection(): Promise<FetchConnectionOutcome> {
  try {
    const { data, response } = await httpClient.GET('/private/integrations/google-calendar')
    if (response.ok && data) return { kind: 'success', connection: toConnection(data) }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function startConnect(): Promise<StartConnectOutcome> {
  try {
    const { data, response } = await httpClient.POST(
      '/private/integrations/google-calendar/connect',
    )
    if (response.ok && data) return { kind: 'success', authorizationUrl: data.authorizationUrl }
    if (response.status === 409) return { kind: 'unavailable' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

/** Reenvía a la API lo que Google agregó a la URL de retorno. */
export async function completeCallback(params: {
  state: string
  code?: string
  error?: string
}): Promise<CompleteCallbackOutcome> {
  try {
    const { data, response } = await httpClient.POST(
      '/private/integrations/google-calendar/callback',
      {
        body: {
          state: params.state,
          ...(params.code ? { code: params.code } : {}),
          ...(params.error ? { error: params.error } : {}),
        },
      },
    )
    if (response.ok && data) {
      return { kind: 'success', result: data.result as GoogleCalendarCallbackResult }
    }
    if (response.status === 400) return { kind: 'invalid' }
    if (response.status === 409) return { kind: 'unavailable' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function syncNow(): Promise<SyncNowOutcome> {
  try {
    const { data, response } = await httpClient.POST('/private/integrations/google-calendar/sync')
    if (response.ok && data) {
      return {
        kind: 'success',
        pendingSyncJobs: data.pendingSyncJobs,
        failedSyncJobs: data.failedSyncJobs,
      }
    }
    if (response.status === 404) return { kind: 'not-connected' }
    if (response.status === 409) return { kind: 'unavailable' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function disconnect(): Promise<DisconnectOutcome> {
  try {
    const { response } = await httpClient.DELETE('/private/integrations/google-calendar')
    if (response.ok) return { kind: 'success' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

/** `minutes` null usa los recordatorios predeterminados del calendario. */
export async function updateReminder(minutes: number | null): Promise<UpdateReminderOutcome> {
  try {
    const { data, response } = await httpClient.PATCH('/private/integrations/google-calendar', {
      body: { reminderMinutes: minutes },
    })
    if (response.ok && data) return { kind: 'success', connection: toConnection(data) }
    if (response.status === 422) return { kind: 'validation-error' }
    if (response.status === 404) return { kind: 'not-connected' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

/**
 * Independiente (DEC-155): vincula al usuario con su única ficha de profesional usando
 * el mismo autovínculo de DEC-100 (`PUT /private/me/professional`, que siempre actúa sobre
 * el usuario autenticado). Solo procede si el negocio tiene exactamente una ficha;
 * con varias no adivina cuál es y devuelve `not-applicable`.
 */
export async function linkSoleProfessional(): Promise<LinkSoleProfessionalOutcome> {
  try {
    const list = await httpClient.GET('/private/professionals', { params: { query: {} } })
    if (!list.response.ok || !list.data) return { kind: 'unexpected-error' }
    const { items, nextCursor } = list.data
    const [only] = items
    if (items.length !== 1 || nextCursor !== null || !only) return { kind: 'not-applicable' }

    const { response } = await httpClient.PUT('/private/me/professional', {
      body: { professionalId: only.id },
    })
    if (response.ok) return { kind: 'success' }
    // 404/409: la ficha ya no existe o pertenece a otro usuario; sigue el flujo manual.
    if (response.status === 404 || response.status === 409) return { kind: 'not-applicable' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}
