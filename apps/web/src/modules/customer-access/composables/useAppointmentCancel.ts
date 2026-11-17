// Envío de la cancelación del turno del cliente (HU-099, T5), compartido por «Mi turno» y el
// paso 03 del acceso con código (issue #647). Posee la clave de idempotencia y traduce el
// resultado a mensajes; quien lo usa decide qué pintar con cada desenlace.
//
// La clave se reutiliza solo al reintentar la MISMA intención (mismo motivo) tras un fallo de
// red o una respuesta inesperada; cualquier otra cosa es un intento nuevo con clave nueva
// (RN-IDE-01, DEC-043).
import { ref } from 'vue'
import { cancelCustomerAppointment } from '../api/cancelCustomerAppointmentApi'
import { newIdempotencyKey } from '../model/idempotencyKey'
import type {
  CancelAppointmentInput,
  CancellationRejection,
  CustomerAppointment,
} from '../model/customerAppointmentOutcome'

export interface AppointmentCancelHandlers {
  /** El turno quedó cancelado: recibe el turno ya marcado como cancelado por el cliente. */
  onCancelled: (appointment: CustomerAppointment) => void | Promise<void>
  /** El turno cambió mientras tanto: hay que volver a leerlo. */
  onChanged: () => void | Promise<void>
  /** La credencial ya no resuelve un turno. */
  onNotFound: () => void
}

export function useAppointmentCancel(token: () => string, handlers: AppointmentCancelHandlers) {
  const submitting = ref(false)
  const error = ref('')
  const rejection = ref<CancellationRejection>(null)
  const notice = ref('')
  let lastAttempt: { reason: string | null; key: string } | null = null

  function attemptKey(reason: string | null): string {
    if (lastAttempt && lastAttempt.reason === reason) return lastAttempt.key
    lastAttempt = { reason, key: newIdempotencyKey() }
    return lastAttempt.key
  }

  async function submit(appointment: CustomerAppointment, input: CancelAppointmentInput) {
    if (submitting.value) return
    submitting.value = true
    error.value = ''
    rejection.value = null
    const outcome = await cancelCustomerAppointment(
      token(),
      appointment.versionToken,
      attemptKey(input.reason),
      input,
    )
    submitting.value = false

    switch (outcome.kind) {
      case 'success':
        lastAttempt = null
        await handlers.onCancelled({
          ...appointment,
          status: 'cancelled_by_customer',
          canReview: false,
        })
        return
      case 'window-closed':
      case 'reason-required':
        lastAttempt = null
        rejection.value = outcome.kind
        return
      case 'validation-error':
        error.value = 'Revisa el motivo e inténtalo de nuevo.'
        return
      case 'changed':
        lastAttempt = null
        notice.value =
          'Tu turno cambió mientras tanto, así que no lo cancelamos. Esto es lo que figura ahora.'
        await handlers.onChanged()
        return
      case 'idempotency-in-progress':
        error.value = 'Tu cancelación sigue en curso. Espera unos segundos e inténtalo de nuevo.'
        return
      case 'not-found':
        lastAttempt = null
        handlers.onNotFound()
        return
      case 'network-error':
        error.value = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
        return
      case 'unexpected-error':
        error.value = outcome.requestId
          ? `No pudimos cancelar tu turno. Si continúa, comparte este código con soporte: ${outcome.requestId}.`
          : 'No pudimos cancelar tu turno. Inténtalo de nuevo en unos segundos.'
    }
  }

  /** Limpia el error y el rechazo, p. ej. al cerrar el formulario sin cancelar. */
  function reset() {
    error.value = ''
    rejection.value = null
  }

  return { submitting, error, rejection, notice, submit, reset }
}
