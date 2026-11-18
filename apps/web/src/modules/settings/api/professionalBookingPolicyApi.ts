// Único punto del módulo `settings` que llama al cliente HTTP tipado para la
// ventana de reserva por profesional (DEC-169). La lista de profesionales se pide
// DIRECTAMENTE al cliente compartido (nunca a staffApi.ts, privado de su
// módulo; mismo criterio que professionalServicesApi.ts).
import { professionalPhotoUrl } from '@/shared/api'
import { httpClient } from '@/shared/api/httpClient'
import type {
  ProfessionalBookingWindow,
  BookingWindowValues,
} from '../model/professionalBookingPolicy'
import type {
  FetchProfessionalWindowsOutcome,
  RemoveProfessionalWindowOutcome,
  SaveProfessionalWindowOutcome,
} from '../model/professionalBookingPolicyOutcome'

// El máximo que el contrato admite por página: un equipo de más de 50
// profesionales queda fuera del alcance del selector (mismo criterio que
// Servicios por profesional).
const PICKER_LIMIT = 50

export async function fetchProfessionalWindows(): Promise<FetchProfessionalWindowsOutcome> {
  try {
    const [professionals, windows] = await Promise.all([
      httpClient.GET('/private/professionals', { params: { query: { limit: PICKER_LIMIT } } }),
      httpClient.GET('/private/settings/booking-policy/professionals'),
    ])
    if (professionals.response.ok && professionals.data && windows.response.ok && windows.data) {
      return {
        kind: 'success',
        professionals: professionals.data.items.map((b) => ({
          id: b.id,
          fullName: b.fullName,
          photoUrl: professionalPhotoUrl(b),
        })),
        windows: windows.data.items.map(toWindow),
      }
    }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

/** Guarda la ventana propia del profesional (reemplazo completo, sin If-Match). */
export async function saveProfessionalWindow(
  professionalId: string,
  values: BookingWindowValues,
): Promise<SaveProfessionalWindowOutcome> {
  try {
    const { data, response } = await httpClient.PUT(
      '/private/settings/booking-policy/professionals/{professionalId}',
      {
        params: { path: { professionalId: professionalId } },
        body: {
          minAdvanceMinutes: values.minAdvanceMinutes,
          maxAdvanceDays: values.maxAdvanceDays,
          slotGridMinutes: values.slotGridMinutes,
        },
      },
    )
    if (response.ok && data) return { kind: 'success', window: toWindow(data) }
    switch (response.status) {
      case 400:
      case 422:
        return { kind: 'validation-error' }
      case 404:
        return { kind: 'not-found' }
      default:
        return { kind: 'unexpected-error' }
    }
  } catch {
    return { kind: 'network-error' }
  }
}

/** Quita la ventana propia: el profesional vuelve a heredar la del negocio. */
export async function removeProfessionalWindow(
  professionalId: string,
): Promise<RemoveProfessionalWindowOutcome> {
  try {
    const { response } = await httpClient.DELETE(
      '/private/settings/booking-policy/professionals/{professionalId}',
      { params: { path: { professionalId: professionalId } } },
    )
    if (response.ok) return { kind: 'success' }
    return response.status === 404 ? { kind: 'not-found' } : { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

function toWindow(data: {
  professionalId: string
  minAdvanceMinutes: number
  maxAdvanceDays: number
  slotGridMinutes: number
}): ProfessionalBookingWindow {
  return {
    professionalId: data.professionalId,
    minAdvanceMinutes: data.minAdvanceMinutes,
    maxAdvanceDays: data.maxAdvanceDays,
    slotGridMinutes: data.slotGridMinutes,
  }
}
