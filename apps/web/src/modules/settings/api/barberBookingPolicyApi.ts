// Único punto del módulo `settings` que llama al cliente HTTP tipado para la
// ventana de reserva por barbero (DEC-169). La lista de barberos se pide
// DIRECTAMENTE al cliente compartido (nunca a staffApi.ts, privado de su
// módulo; mismo criterio que barberServicesApi.ts).
import { barberPhotoUrl } from '@/shared/api'
import { httpClient } from '@/shared/api/httpClient'
import type { BarberBookingWindow, BookingWindowValues } from '../model/barberBookingPolicy'
import type {
  FetchBarberWindowsOutcome,
  RemoveBarberWindowOutcome,
  SaveBarberWindowOutcome,
} from '../model/barberBookingPolicyOutcome'

// El máximo que el contrato admite por página: un equipo de más de 50
// barberos queda fuera del alcance del selector (mismo criterio que
// Servicios por barbero).
const PICKER_LIMIT = 50

export async function fetchBarberWindows(): Promise<FetchBarberWindowsOutcome> {
  try {
    const [barbers, windows] = await Promise.all([
      httpClient.GET('/private/barbers', { params: { query: { limit: PICKER_LIMIT } } }),
      httpClient.GET('/private/settings/booking-policy/barbers'),
    ])
    if (barbers.response.ok && barbers.data && windows.response.ok && windows.data) {
      return {
        kind: 'success',
        barbers: barbers.data.items.map((b) => ({
          id: b.id,
          fullName: b.fullName,
          photoUrl: barberPhotoUrl(b),
        })),
        windows: windows.data.items.map(toWindow),
      }
    }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

/** Guarda la ventana propia del barbero (reemplazo completo, sin If-Match). */
export async function saveBarberWindow(
  barberId: string,
  values: BookingWindowValues,
): Promise<SaveBarberWindowOutcome> {
  try {
    const { data, response } = await httpClient.PUT(
      '/private/settings/booking-policy/barbers/{barberId}',
      {
        params: { path: { barberId } },
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

/** Quita la ventana propia: el barbero vuelve a heredar la de la barbería. */
export async function removeBarberWindow(barberId: string): Promise<RemoveBarberWindowOutcome> {
  try {
    const { response } = await httpClient.DELETE(
      '/private/settings/booking-policy/barbers/{barberId}',
      { params: { path: { barberId } } },
    )
    if (response.ok) return { kind: 'success' }
    return response.status === 404 ? { kind: 'not-found' } : { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

function toWindow(data: {
  barberId: string
  minAdvanceMinutes: number
  maxAdvanceDays: number
  slotGridMinutes: number
}): BarberBookingWindow {
  return {
    barberId: data.barberId,
    minAdvanceMinutes: data.minAdvanceMinutes,
    maxAdvanceDays: data.maxAdvanceDays,
    slotGridMinutes: data.slotGridMinutes,
  }
}
