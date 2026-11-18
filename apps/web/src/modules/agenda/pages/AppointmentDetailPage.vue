<script setup lang="ts">
// Detalle e historial de un turno (HU-064) más reprogramación T2 (HU-065),
// cancelación T6 (HU-066), cierre manual T4/T7 (HU-067) y corrección
// auditada T8 (HU-068): persona atendida, cliente que reservó con su
// contacto opcional y nota, servicio snapshot (DEC-004), precio, estado e
// historial inmutable paginado, siguiendo la plantilla P0 "Detalle de
// turno" (estandar-diseno-visual.md §10). "Volver" conserva la
// fecha/profesional de origen (HU-063) mediante `route.query`; tras
// reprogramar con éxito, la fecha se actualiza a la del nuevo inicio para no
// dejar la fecha vieja presentada como vigente. Fuera de alcance a
// propósito: T3 o cualquier cambio de estado distinto de los seis comandos
// ya implementados. Cada comando confirmado añade un aviso emergente
// (DEC-095); el resultado persistente es el estado y el historial del turno.
import { computed, onMounted, ref } from 'vue'
import { useRoute, type LocationQueryRaw } from 'vue-router'
import { useToast, useVocabulary } from '@/shared/composables'
import { BaseAlert, BaseBadge, BaseButton, BaseDialog, BaseInput } from '@/shared/ui'
import {
  formatFullDateInTimezone,
  formatInstantInTimezone,
  formatTimeInTimezone,
} from '@/shared/time/formatInstant'
import { getCivilDateInTimezone } from '@/shared/time/civilDate'
import {
  cancelAppointmentByProfessional,
  completeAppointment,
  correctAppointmentStatus,
  fetchAppointmentDetail,
  fetchAppointmentHistory,
  fetchBusinessTimezone,
  markAppointmentNoShow,
  rescheduleAppointment,
} from '../api/appointmentsApi'
import { mapsLinkUrl } from '@/shared/model/mapEmbed'
import { newIdempotencyKey } from '../model/idempotencyKey'
import type { AppointmentDetail, HistoryEntry } from '../model/appointmentDetail'
import { historyEventLabel, historyFieldLabel } from '../model/appointmentDetail'
import {
  APPOINTMENT_STATUS_BADGE_VARIANT,
  appointmentStatusLabel,
  isTerminalStatus,
  type AppointmentStatus,
} from '../model/dailyAgenda'

type PageStatus = 'loading' | 'ready' | 'not-found' | 'error'
type HistoryStatus = 'loading' | 'ready' | 'error'
type RescheduleStatus =
  | 'idle'
  | 'saving'
  | 'version-conflict'
  | 'invalid-state'
  | 'conflict'
  | 'idempotency-conflict'
  | 'validation-error'
  | 'network-error'
  | 'unexpected-error'

const route = useRoute()

const appointmentId = computed(() => String(route.params.appointmentId ?? ''))

// backDate/backProfessionalId inician con la fecha/profesional de origen (HU-063) y
// SOLO backDate cambia después, tras reprogramar con éxito (§3.5 del
// trabajo requerido): "Volver" siempre regresa a donde el turno vigente
// realmente está, nunca a una fecha que dejó de mostrarlo.
const toast = useToast()
// Palabras del negocio (DEC-110).
const v = useVocabulary()
const backDate = ref<string | null>(typeof route.query.date === 'string' ? route.query.date : null)
const backProfessionalId = ref<string | null>(
  typeof route.query.professionalId === 'string' ? route.query.professionalId : null,
)
const backQuery = computed<LocationQueryRaw>(() => ({
  ...(backDate.value ? { date: backDate.value } : {}),
  ...(backProfessionalId.value ? { professionalId: backProfessionalId.value } : {}),
}))

const pageStatus = ref<PageStatus>('loading')
const detail = ref<AppointmentDetail | null>(null)
const businessTimezone = ref<string | null>(null)

const historyStatus = ref<HistoryStatus>('loading')
const historyItems = ref<HistoryEntry[]>([])
const historyNextCursor = ref<string | null>(null)
const historyLoadingMore = ref(false)

const statusLabel = computed(() =>
  detail.value ? appointmentStatusLabel(detail.value.status, v.value) : '',
)
// Mismo mapa que DailyAgendaPage.vue: cancelled_by_professional ya tiene el
// tratamiento terminal 'danger' que el atlas asigna a un turno cancelado
// (docs/10-backlog/evidence/.../detalle-turno-eventos/10-turno-cancelado.png),
// reutilizado tal cual en vez de inventar un color nuevo para HU-066.
const statusBadgeVariant = computed(() =>
  detail.value ? APPOINTMENT_STATUS_BADGE_VARIANT[detail.value.status] : 'neutral',
)
// Tono de la ficha: el mismo reparto de colores por estado que la agenda diaria
// (pendiente, completado, no se presentó, cancelado), con la palabra de estado como
// señal además del color.
const STATUS_TONE: Record<AppointmentStatus, string> = {
  confirmed: 'pending',
  completed: 'completed',
  no_show: 'no-show',
  cancelled_by_customer: 'cancelled',
  cancelled_by_professional: 'cancelled',
}
const statusTone = computed(() => (detail.value ? STATUS_TONE[detail.value.status] : 'pending'))
// Un turno terminal cambia de material (contorno sobre tinta), no de peso (§6.7).
const isTerminal = computed(() => !!detail.value && isTerminalStatus(detail.value.status))
const attendeeInitials = computed(() => {
  if (!detail.value) return ''
  return detail.value.attendeeName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('')
})

// El atlas usa una fotografía editorial, pero ese activo no pertenece al
// contrato de la cita. El monograma conserva la jerarquía sin inventar una
// imagen ni exponer un dato adicional.
const FACT_ICONS: Record<string, string> = {
  time: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>`,
  attendee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="3.5"></circle><path d="M4.5 21c.6-4.2 3.5-6.5 7.5-6.5s6.9 2.3 7.5 6.5"></path></svg>`,
  service: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3c3 3 4 6 4 9s-1 6-4 9"></path><path d="M18 3c-3 3-4 6-4 9s1 6 4 9"></path><path d="M8.5 8.5 15.5 15.5"></path><path d="M15.5 8.5 8.5 15.5"></path></svg>`,
  professional: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="3.5"></circle><path d="M4.5 21c.6-4.2 3.5-6.5 7.5-6.5s6.9 2.3 7.5 6.5"></path><path d="M3.5 12.5h3M17.5 12.5h3"></path></svg>`,
  contact: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>`,
  place: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"></path><circle cx="12" cy="10" r="2.3"></circle></svg>`,
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v12H9l-4 4V4Z"></path></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7"></path></svg>`,
  absent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6M15 9l-6 6"></path></svg>`,
}

function factIcon(name: keyof typeof FACT_ICONS): string {
  return FACT_ICONS[name]
}

function historyIcon(entry: HistoryEntry): string {
  return entry.eventType === 'appointment_rescheduled'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17.5V20h2.5L18 8.5 15.5 6 4 17.5Z"></path><path d="m14.5 7 2.5 2.5"></path></svg>`
    : FACT_ICONS.calendar
}

// Dirección del cliente en un turno a domicilio (DEC-131): el enlace abre el punto en
// Google Maps sin clave; si las coordenadas no fueran válidas solo queda el texto.
const homeServiceMapsUrl = computed(() =>
  detail.value?.homeService
    ? mapsLinkUrl(detail.value.homeService.latitude, detail.value.homeService.longitude)
    : null,
)

// Franja decorativa de la ficha: hora de inicio y de fin en la zona del negocio y la
// fecha civil de esa zona. La hora completa sigue dicha en la fila «Hora».
const timeSpan = computed(() => {
  if (!detail.value || !businessTimezone.value) return null
  const zone = businessTimezone.value
  return {
    start: formatTimeInTimezone(detail.value.startsAt, zone),
    end: formatTimeInTimezone(detail.value.endsAt, zone),
    date: formatFullDateInTimezone(zone, new Date(detail.value.startsAt)),
  }
})

const timeRangeLabel = computed(() => {
  if (!detail.value || !businessTimezone.value) return ''
  const start = formatInstantInTimezone(detail.value.startsAt, businessTimezone.value)
  const end = new Intl.DateTimeFormat('es-CO', {
    timeZone: businessTimezone.value,
    timeStyle: 'short',
  }).format(new Date(detail.value.endsAt))
  return `${start} – ${end}`
})

// Reprogramar turno (HU-065, T2) y cancelar turno (HU-066, T6): ambas
// acciones solo aplican sobre un turno `confirmed` (CA-066-08); ningún otro
// estado ofrece una acción propia todavía (T3/T8 no existen).
const canReschedule = computed(() => detail.value?.status === 'confirmed')
const canCancel = computed(() => detail.value?.status === 'confirmed')

// Cerrar turno como atendido (T4 manual) o no asistió (T7, HU-067):
// CA-067-08, "las acciones aparecen solo cuando el turno confirmed ya puede
// cerrarse" — a diferencia de reprogramar/cancelar, exige además que
// startsAt ya haya pasado. Comparación del lado del cliente, solo para
// mostrar/ocultar el botón (UX): el servidor vuelve a verificar la frontera
// exacta contra su propio reloj (CA-067-03) y responde 422 si se adelanta,
// nunca confiando en este cálculo.
const canCloseTurn = computed(() => {
  if (!detail.value || detail.value.status !== 'confirmed') return false
  return new Date(detail.value.startsAt).getTime() <= Date.now()
})

// Corregir resultado (HU-068, T8): CA-068-08, "la acción aparece solo en
// estados terminales" -- a diferencia de cerrar (canCloseTurn), no depende
// de startsAt: el servidor revalida la frontera temporal solo cuando el
// destino elegido vuelve a ocupar agenda (CA-068-04).
const canCorrect = computed(() => !!detail.value && isTerminalStatus(detail.value.status))

// CORRECTABLE_TERMINALS son los cuatro terminales válidos como destino de
// T8 (CA-068-01): `confirmed` nunca aparece como opción.
const CORRECTABLE_TERMINALS: AppointmentStatus[] = [
  'completed',
  'no_show',
  'cancelled_by_customer',
  'cancelled_by_professional',
]

// correctDestinationOptions excluye siempre el estado vigente: elegirlo de
// nuevo sería un no-op sin motivo real para el profesional (CA-068-02 lo
// permite del lado del servidor, pero la interfaz no lo ofrece).
const correctDestinationOptions = computed(() =>
  CORRECTABLE_TERMINALS.filter((status) => status !== detail.value?.status).map((status) => ({
    value: status,
    label: appointmentStatusLabel(status, v.value),
  })),
)

const isRescheduleOpen = ref(false)
const rescheduleDate = ref('')
const rescheduleTime = ref('')
const rescheduleStatus = ref<RescheduleStatus>('idle')
const rescheduleErrorDetail = ref<string | null>(null)
// Clave mutable de módulo (no `ref`), mismo criterio que
// NewAppointmentPage.vue: se reutiliza tal cual entre reintentos del MISMO
// intento (un doble toque reproduce la misma petición en vez de duplicarla)
// y solo se renueva al abrir el diálogo de nuevo, que es aquí el límite
// natural de "intento lógico" (el diálogo se cierra y reabre, a diferencia
// de un formulario de página completa).
let rescheduleIdempotencyKey = newIdempotencyKey()

function civilTimeInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// addMinutesToTimeString: aritmética pura de minutos sobre "HH:MM", sin
// Date/Intl/zona horaria. Es una vista previa barata para el profesional
// mientras escribe; el cómputo autoritativo del nuevo fin ocurre en el
// servidor contra duration_minutes_snapshot en la zona real del
// negocio, así que esta función nunca necesita ser exacta ante DST.
function addMinutesToTimeString(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number)
  if (hours === undefined || mins === undefined || Number.isNaN(hours) || Number.isNaN(mins)) {
    return ''
  }
  const totalMinutesInDay = 24 * 60
  const total =
    (((hours * 60 + mins + minutes) % totalMinutesInDay) + totalMinutesInDay) % totalMinutesInDay
  const endHours = Math.floor(total / 60)
  const endMins = total % 60
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`
}

const rescheduleNewEndLabel = computed(() => {
  if (!detail.value || !rescheduleTime.value) return ''
  return addMinutesToTimeString(rescheduleTime.value, detail.value.durationMinutes)
})

function onOpenReschedule() {
  if (!detail.value || !businessTimezone.value) return
  rescheduleDate.value = getCivilDateInTimezone(
    businessTimezone.value,
    new Date(detail.value.startsAt),
  )
  rescheduleTime.value = civilTimeInTimezone(detail.value.startsAt, businessTimezone.value)
  rescheduleStatus.value = 'idle'
  rescheduleErrorDetail.value = null
  rescheduleIdempotencyKey = newIdempotencyKey()
  isRescheduleOpen.value = true
}

function onRescheduleDialogClosed() {
  isRescheduleOpen.value = false
}

async function onSubmitReschedule() {
  if (!detail.value || rescheduleStatus.value === 'saving') return
  if (!rescheduleDate.value || !rescheduleTime.value) return

  rescheduleStatus.value = 'saving'
  rescheduleErrorDetail.value = null

  const startsAt = `${rescheduleDate.value}T${rescheduleTime.value}:00`
  const outcome = await rescheduleAppointment(
    appointmentId.value,
    { startsAt },
    detail.value.versionToken,
    rescheduleIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success': {
      isRescheduleOpen.value = false
      toast.success('Turno reprogramado', { detail: 'El turno quedó en el nuevo horario.' })
      if (businessTimezone.value) {
        backDate.value = getCivilDateInTimezone(businessTimezone.value, new Date(outcome.startsAt))
      }
      await loadPage()
      return
    }
    // 'not-found' aquí solo puede significar que el turno desapareció
    // mientras el diálogo estaba abierto (eliminado o de otro negocio):
    // la única salida coherente es la misma que un conflicto de versión,
    // recargar el detalle real.
    case 'not-found':
      rescheduleStatus.value = 'version-conflict'
      return
    case 'version-conflict':
      rescheduleStatus.value = 'version-conflict'
      return
    case 'invalid-state':
      rescheduleStatus.value = 'invalid-state'
      return
    case 'conflict':
      rescheduleErrorDetail.value = outcome.detail
      rescheduleStatus.value = 'conflict'
      return
    case 'validation-error':
      rescheduleErrorDetail.value = outcome.detail
      rescheduleStatus.value = 'validation-error'
      return
    case 'idempotency-conflict':
      rescheduleStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      rescheduleStatus.value = 'network-error'
      return
    case 'unexpected-error':
      rescheduleStatus.value = 'unexpected-error'
  }
}

// onReloadAfterConflict recarga el detalle real (versionToken/estado
// vigentes) tras un conflicto de versión o de estado: la intención del
// profesional (fecha/hora elegidas) no puede reenviarse contra datos obsoletos,
// así que cerrar y recargar es la única salida segura.
function onReloadAfterConflict() {
  isRescheduleOpen.value = false
  void loadPage()
}

// Cancelar turno (HU-066, T6): mismo criterio de diálogo de confirmación,
// clave de idempotencia por intento y recarga completa tras confirmar que
// ya usa reprogramar — sin mockup exacto (el diálogo se diseña dentro de
// NAVA), solo el tratamiento terminal del badge de estado reutiliza el del
// atlas.
type CancelStatus =
  | 'idle'
  | 'saving'
  | 'not-found'
  | 'version-conflict'
  | 'invalid-state'
  | 'idempotency-conflict'
  | 'network-error'
  | 'unexpected-error'

const isCancelOpen = ref(false)
const cancelStatus = ref<CancelStatus>('idle')
let cancelIdempotencyKey = newIdempotencyKey()

function onOpenCancel() {
  cancelStatus.value = 'idle'
  cancelIdempotencyKey = newIdempotencyKey()
  isCancelOpen.value = true
}

function onCancelDialogClosed() {
  isCancelOpen.value = false
}

async function onConfirmCancel() {
  if (!detail.value || cancelStatus.value === 'saving') return

  cancelStatus.value = 'saving'

  const outcome = await cancelAppointmentByProfessional(
    appointmentId.value,
    detail.value.versionToken,
    cancelIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      isCancelOpen.value = false
      toast.success('Turno cancelado', { detail: 'El cambio quedó registrado en el historial.' })
      await loadPage()
      return
    // 'not-found' aquí solo puede significar que el turno desapareció
    // mientras el diálogo estaba abierto (eliminado o de otro negocio):
    // la única salida coherente es la misma que un conflicto de versión,
    // recargar el detalle real.
    case 'not-found':
      cancelStatus.value = 'version-conflict'
      return
    case 'version-conflict':
      cancelStatus.value = 'version-conflict'
      return
    case 'invalid-state':
      cancelStatus.value = 'invalid-state'
      return
    case 'idempotency-conflict':
      cancelStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      cancelStatus.value = 'network-error'
      return
    case 'unexpected-error':
      cancelStatus.value = 'unexpected-error'
  }
}

function onReloadCancelAfterConflict() {
  isCancelOpen.value = false
  void loadPage()
}

// Cerrar turno como atendido (T4 manual) o no asistió (T7, HU-067): un solo
// diálogo compartido por ambos comandos (closeMode decide cuál), mismo
// criterio de confirmación explícita, clave de idempotencia por intento y
// recarga completa tras confirmar que ya usan reprogramar/cancelar — sin
// mockup exacto para el diálogo en sí (se diseña dentro de NAVA, igual que
// el de cancelar); el estado terminal resultante sí reutiliza el badge del
// atlas de detalle (statusBadgeVariant/statusLabel, sin cambios).
type CloseMode = 'complete' | 'no-show'
type CloseStatus =
  | 'idle'
  | 'saving'
  | 'version-conflict'
  | 'invalid-state'
  | 'idempotency-conflict'
  | 'validation-error'
  | 'network-error'
  | 'unexpected-error'

const isCloseOpen = ref(false)
const closeMode = ref<CloseMode>('complete')
const closeStatus = ref<CloseStatus>('idle')
const closeErrorDetail = ref<string | null>(null)
let closeIdempotencyKey = newIdempotencyKey()

const closeDialogTitle = computed(() =>
  closeMode.value === 'complete' ? 'Marcar como atendido' : 'Marcar que no asistió',
)
const closeConfirmLabel = computed(() =>
  closeMode.value === 'complete' ? 'Sí, marcar como atendido' : 'Sí, marcar que no asistió',
)

function onOpenComplete() {
  closeMode.value = 'complete'
  closeStatus.value = 'idle'
  closeErrorDetail.value = null
  closeIdempotencyKey = newIdempotencyKey()
  isCloseOpen.value = true
}

function onOpenNoShow() {
  closeMode.value = 'no-show'
  closeStatus.value = 'idle'
  closeErrorDetail.value = null
  closeIdempotencyKey = newIdempotencyKey()
  isCloseOpen.value = true
}

function onCloseDialogClosed() {
  isCloseOpen.value = false
}

async function onConfirmClose() {
  if (!detail.value || closeStatus.value === 'saving') return

  closeStatus.value = 'saving'

  const action = closeMode.value === 'complete' ? completeAppointment : markAppointmentNoShow
  const outcome = await action(appointmentId.value, detail.value.versionToken, closeIdempotencyKey)

  switch (outcome.kind) {
    case 'success':
      isCloseOpen.value = false
      toast.success(
        closeMode.value === 'complete'
          ? 'Turno marcado como atendido'
          : 'Turno marcado como no asistido',
        { detail: 'El cambio quedó registrado en el historial.' },
      )
      await loadPage()
      return
    // 'not-found' aquí solo puede significar que el turno desapareció
    // mientras el diálogo estaba abierto, mismo criterio que
    // onConfirmCancel.
    case 'not-found':
      closeStatus.value = 'version-conflict'
      return
    case 'version-conflict':
      closeStatus.value = 'version-conflict'
      return
    case 'invalid-state':
      closeStatus.value = 'invalid-state'
      return
    case 'validation-error':
      closeErrorDetail.value = outcome.detail
      closeStatus.value = 'validation-error'
      return
    case 'idempotency-conflict':
      closeStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      closeStatus.value = 'network-error'
      return
    case 'unexpected-error':
      closeStatus.value = 'unexpected-error'
  }
}

function onReloadCloseAfterConflict() {
  isCloseOpen.value = false
  void loadPage()
}

// Corregir resultado (HU-068, T8): un solo diálogo con destino explícito
// (select, CA-068-01) y motivo obligatorio (textarea, CA-068-02), mismo
// criterio de clave de idempotencia por intento y recarga completa tras
// confirmar que ya usan reprogramar/cancelar/cerrar -- sin mockup exacto
// para el diálogo en sí (se diseña dentro de NAVA, igual que el de
// cancelar/cerrar).
type CorrectStatus =
  | 'idle'
  | 'saving'
  | 'version-conflict'
  | 'invalid-state'
  | 'conflict'
  | 'idempotency-conflict'
  | 'validation-error'
  | 'network-error'
  | 'unexpected-error'

const isCorrectOpen = ref(false)
const correctStatus = ref<CorrectStatus>('idle')
const correctErrorDetail = ref<string | null>(null)
const correctDestination = ref<AppointmentStatus | ''>('')
const correctReason = ref('')
let correctIdempotencyKey = newIdempotencyKey()

function onOpenCorrect() {
  correctStatus.value = 'idle'
  correctErrorDetail.value = null
  correctDestination.value = ''
  correctReason.value = ''
  correctIdempotencyKey = newIdempotencyKey()
  isCorrectOpen.value = true
}

function onCorrectDialogClosed() {
  isCorrectOpen.value = false
}

const correctTrimmedReason = computed(() => correctReason.value.trim())

// correctConsequenceLabel resume, ANTES de confirmar, el efecto sobre
// agenda que el destino elegido tendría (CA-068-08, "resume la
// consecuencia"): mismo criterio de cálculo del lado del cliente que
// canCloseTurn, el servidor vuelve a verificarlo con la fila bloqueada
// (CA-068-04/05).
const correctConsequenceLabel = computed(() => {
  if (!detail.value || !correctDestination.value) return ''
  const occupies = (status: AppointmentStatus) => status === 'completed' || status === 'no_show'
  const destOccupies = occupies(correctDestination.value)
  const originOccupies = occupies(detail.value.status)
  if (destOccupies && !originOccupies) return 'El turno volverá a ocupar su franja en la agenda.'
  if (!destOccupies && originOccupies) return 'El turno dejará de ocupar su franja en la agenda.'
  return destOccupies
    ? 'El turno sigue ocupando la misma franja en la agenda.'
    : 'El turno sigue sin ocupar agenda.'
})

async function onSubmitCorrect() {
  if (!detail.value || correctStatus.value === 'saving') return
  if (!correctDestination.value || !correctTrimmedReason.value) return

  correctStatus.value = 'saving'

  const outcome = await correctAppointmentStatus(
    appointmentId.value,
    { status: correctDestination.value, reason: correctTrimmedReason.value },
    detail.value.versionToken,
    correctIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      isCorrectOpen.value = false
      toast.success('Resultado corregido', {
        detail: 'La corrección quedó registrada en el historial.',
      })
      await loadPage()
      return
    // 'not-found' aquí solo puede significar que el turno desapareció
    // mientras el diálogo estaba abierto, mismo criterio que
    // onConfirmClose.
    case 'not-found':
      correctStatus.value = 'version-conflict'
      return
    case 'version-conflict':
      correctStatus.value = 'version-conflict'
      return
    case 'invalid-state':
      correctStatus.value = 'invalid-state'
      return
    case 'conflict':
      correctErrorDetail.value = outcome.detail
      correctStatus.value = 'conflict'
      return
    case 'validation-error':
      correctErrorDetail.value = outcome.detail
      correctStatus.value = 'validation-error'
      return
    case 'idempotency-conflict':
      correctStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      correctStatus.value = 'network-error'
      return
    case 'unexpected-error':
      correctStatus.value = 'unexpected-error'
  }
}

function onReloadCorrectAfterConflict() {
  isCorrectOpen.value = false
  void loadPage()
}

async function loadPage() {
  pageStatus.value = 'loading'
  const [detailOutcome, timezoneOutcome] = await Promise.all([
    fetchAppointmentDetail(appointmentId.value),
    fetchBusinessTimezone(),
  ])
  businessTimezone.value = timezoneOutcome.kind === 'success' ? timezoneOutcome.timezone : null

  switch (detailOutcome.kind) {
    case 'success':
      detail.value = detailOutcome.detail
      pageStatus.value = 'ready'
      void loadHistory()
      return
    case 'not-found':
      pageStatus.value = 'not-found'
      return
    default:
      pageStatus.value = 'error'
  }
}

onMounted(loadPage)

function onRetryLoad() {
  void loadPage()
}

async function loadHistory(cursor?: string) {
  if (cursor) {
    historyLoadingMore.value = true
  } else {
    historyStatus.value = 'loading'
    historyItems.value = []
  }

  const outcome = await fetchAppointmentHistory(appointmentId.value, cursor)
  switch (outcome.kind) {
    case 'success':
      historyItems.value = cursor ? [...historyItems.value, ...outcome.items] : outcome.items
      historyNextCursor.value = outcome.nextCursor
      historyStatus.value = 'ready'
      break
    default:
      historyStatus.value = 'error'
  }
  historyLoadingMore.value = false
}

function onRetryHistory() {
  void loadHistory()
}

function onLoadMoreHistory() {
  if (historyNextCursor.value) void loadHistory(historyNextCursor.value)
}

function eventLabel(entry: HistoryEntry): string {
  return historyEventLabel(entry.eventType, v.value) ?? entry.eventType
}

function occurredAtLabel(entry: HistoryEntry): string {
  if (!businessTimezone.value) return ''
  return formatInstantInTimezone(entry.occurredAt, businessTimezone.value)
}
</script>

<template>
  <section
    class="appointment-detail-page"
    :class="`appointment-detail-page--${statusTone}`"
    aria-labelledby="appointment-detail-page-title"
  >
    <p class="appointment-detail-page__back">
      <RouterLink :to="{ name: 'panel', query: backQuery }">← Volver a la agenda</RouterLink>
    </p>

    <div
      v-if="pageStatus === 'loading'"
      class="appointment-detail-page__state"
      role="status"
      aria-live="polite"
    >
      <p>Cargando el detalle del turno…</p>
    </div>

    <BaseAlert
      v-else-if="pageStatus === 'not-found'"
      variant="warning"
      title="Este turno ya no está disponible"
      role="alert"
    >
      Puede haberse eliminado o pertenecer a {{ v.anotherBusiness }}.
    </BaseAlert>

    <BaseAlert
      v-else-if="pageStatus === 'error'"
      variant="warning"
      title="No pudimos cargar este turno"
      role="alert"
    >
      Revisa tu conexión e inténtalo de nuevo.
      <template #action>
        <BaseButton type="button" variant="secondary" @click="onRetryLoad">Reintentar</BaseButton>
      </template>
    </BaseAlert>

    <template v-else-if="detail">
      <header class="appointment-detail-page__hero">
        <div class="appointment-detail-page__avatar nv-pop" aria-hidden="true">
          {{ attendeeInitials }}
        </div>
        <div class="appointment-detail-page__identity">
          <p class="appointment-detail-page__eyebrow">Detalle del turno</p>
          <h1 id="appointment-detail-page-title" class="appointment-detail-page__title nv-wipe">
            {{ detail.attendeeName }}
          </h1>
          <p class="appointment-detail-page__status" role="status">
            <BaseBadge :variant="statusBadgeVariant" size="sm" :label="statusLabel">
              {{ statusLabel }}
            </BaseBadge>
          </p>
        </div>
        <div class="appointment-detail-page__actions nv-rise" style="--i: 3">
          <BaseButton
            v-if="canReschedule"
            type="button"
            variant="secondary"
            class="appointment-detail-page__reschedule"
            @click="onOpenReschedule"
          >
            <span
              class="appointment-detail-page__button-icon"
              aria-hidden="true"
              v-html="factIcon('calendar')"
            />
            Reprogramar turno
          </BaseButton>
          <BaseButton
            v-if="canCloseTurn"
            type="button"
            variant="primary"
            class="appointment-detail-page__complete"
            @click="onOpenComplete"
          >
            <span
              class="appointment-detail-page__button-icon"
              aria-hidden="true"
              v-html="factIcon('check')"
            />
            Marcar como atendido
          </BaseButton>
          <BaseButton
            v-if="canCloseTurn"
            type="button"
            variant="secondary"
            class="appointment-detail-page__no-show"
            @click="onOpenNoShow"
          >
            <span
              class="appointment-detail-page__button-icon"
              aria-hidden="true"
              v-html="factIcon('absent')"
            />
            Marcar que no asistió
          </BaseButton>
          <BaseButton
            v-if="canCancel"
            type="button"
            variant="danger"
            class="appointment-detail-page__cancel"
            @click="onOpenCancel"
          >
            Cancelar turno
          </BaseButton>
          <BaseButton
            v-if="canCorrect"
            type="button"
            variant="secondary"
            class="appointment-detail-page__correct"
            @click="onOpenCorrect"
          >
            <span
              class="appointment-detail-page__button-icon"
              aria-hidden="true"
              v-html="factIcon('note')"
            />
            Corregir resultado
          </BaseButton>
        </div>
      </header>

      <div class="appointment-detail-page__body">
        <div
          class="appointment-detail-page__sheet nv-rise"
          :class="{ 'appointment-detail-page__sheet--terminal': isTerminal }"
          style="--i: 2"
        >
          <div v-if="timeSpan" class="appointment-detail-page__span" aria-hidden="true">
            <p class="appointment-detail-page__span-date">
              {{ timeSpan.date
              }}<template v-if="businessTimezone"> · Zona {{ businessTimezone }}</template>
            </p>
            <div class="appointment-detail-page__span-row">
              <span class="appointment-detail-page__span-time">{{ timeSpan.start }}</span>
              <span class="appointment-detail-page__span-track">
                <i
                  class="appointment-detail-page__span-line appointment-detail-page__span-line--start"
                ></i>
                <span class="appointment-detail-page__span-length"
                  >{{ detail.durationMinutes }} min</span
                >
                <i
                  class="appointment-detail-page__span-line appointment-detail-page__span-line--end"
                ></i>
              </span>
              <span class="appointment-detail-page__span-time">{{ timeSpan.end }}</span>
            </div>
          </div>

          <dl class="appointment-detail-page__facts">
            <div class="appointment-detail-page__fact appointment-detail-page__fact--time">
              <dt>Hora</dt>
              <dd>
                {{ timeRangeLabel }}
                <span v-if="businessTimezone">· Zona {{ businessTimezone }}</span>
              </dd>
            </div>
            <div class="appointment-detail-page__fact">
              <dt>Persona atendida</dt>
              <dd>{{ detail.attendeeName }}</dd>
            </div>
            <div class="appointment-detail-page__fact appointment-detail-page__fact--service">
              <dt>Servicio</dt>
              <dd>
                {{ detail.serviceName }} · {{ detail.durationMinutes }} min ·
                {{ detail.priceAmount }}
                {{ detail.currency }}
              </dd>
            </div>
            <div class="appointment-detail-page__fact appointment-detail-page__fact--professional">
              <dt>{{ v.Professional }}</dt>
              <dd>{{ detail.professionalFullName }}</dd>
            </div>
            <div class="appointment-detail-page__fact">
              <dt>Cliente que reservó</dt>
              <dd>{{ detail.customerFullName }}</dd>
            </div>
            <div
              v-if="detail.customerPhone || detail.customerEmail"
              class="appointment-detail-page__fact"
            >
              <dt>Contacto</dt>
              <dd>
                <span v-if="detail.customerPhone">{{ detail.customerPhone }}</span>
                <span v-if="detail.customerPhone && detail.customerEmail"> · </span>
                <span v-if="detail.customerEmail">{{ detail.customerEmail }}</span>
              </dd>
            </div>
            <div
              v-if="detail.homeService"
              class="appointment-detail-page__fact appointment-detail-page__fact--wide"
            >
              <dt>A domicilio</dt>
              <dd>
                <span>{{ detail.homeService.address }}</span>
                <template v-if="homeServiceMapsUrl">
                  {{ ' ' }}·
                  <a :href="homeServiceMapsUrl" target="_blank" rel="noopener noreferrer"
                    >Abrir en Google Maps (nueva pestaña)</a
                  >
                </template>
              </dd>
            </div>
            <div
              v-if="detail.customerNote"
              class="appointment-detail-page__fact appointment-detail-page__fact--wide"
            >
              <dt>Nota del cliente</dt>
              <dd>{{ detail.customerNote }}</dd>
            </div>
          </dl>
        </div>

        <section
          class="appointment-detail-page__history nv-rise"
          style="--i: 4"
          aria-labelledby="appointment-history-title"
        >
          <h2 id="appointment-history-title" class="appointment-detail-page__history-title">
            Historial
          </h2>

          <div
            v-if="historyStatus === 'loading'"
            class="appointment-detail-page__state"
            role="status"
            aria-live="polite"
          >
            <p>Cargando historial…</p>
          </div>

          <BaseAlert
            v-else-if="historyStatus === 'error'"
            variant="warning"
            title="No pudimos cargar el historial"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo.
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onRetryHistory">
                Reintentar
              </BaseButton>
            </template>
          </BaseAlert>

          <template v-else>
            <p v-if="historyItems.length === 0" class="appointment-detail-page__empty">
              Sin eventos registrados todavía.
            </p>

            <ol v-else class="appointment-detail-page__history-list" aria-label="Eventos del turno">
              <li
                v-for="(entry, index) in historyItems"
                :key="entry.id"
                class="appointment-detail-page__history-item nv-rise"
                :style="{ '--i': Math.min(index, 8) + 5 }"
              >
                <span
                  class="appointment-detail-page__history-icon"
                  aria-hidden="true"
                  v-html="historyIcon(entry)"
                />
                <div class="appointment-detail-page__history-main">
                  <span class="appointment-detail-page__history-event">{{
                    eventLabel(entry)
                  }}</span>
                  <span class="appointment-detail-page__history-meta">
                    {{ occurredAtLabel(entry) }} · {{ entry.actorLabel }}
                  </span>
                </div>
                <p v-if="entry.reason" class="appointment-detail-page__history-reason">
                  {{ entry.reason }}
                </p>
                <ul
                  v-if="entry.changes.length > 0"
                  class="appointment-detail-page__history-changes"
                >
                  <li v-for="change in entry.changes" :key="change.fieldName">
                    {{ historyFieldLabel(change.fieldName, v) }}:
                    {{ change.previousValue ?? '—' }} →
                    {{ change.newValue ?? '—' }}
                  </li>
                </ul>
              </li>
            </ol>

            <BaseButton
              v-if="historyNextCursor"
              type="button"
              variant="secondary"
              :loading="historyLoadingMore"
              @click="onLoadMoreHistory"
            >
              Cargar más
            </BaseButton>
          </template>
        </section>
      </div>

      <BaseDialog
        v-model="isRescheduleOpen"
        title="Reprogramar turno"
        size="md"
        content-class="appointment-detail-page__ink-dialog appointment-detail-page__ink-dialog--wide"
        @close="onRescheduleDialogClosed"
      >
        <form
          class="appointment-detail-page__dialog-form appointment-detail-page__ink-form"
          novalidate
          @submit.prevent="onSubmitReschedule"
        >
          <BaseAlert
            v-if="rescheduleStatus === 'version-conflict'"
            variant="warning"
            title="Este turno cambió mientras lo editabas"
            role="alert"
          >
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="rescheduleStatus === 'invalid-state'"
            variant="warning"
            title="Este turno ya no se puede reprogramar"
            role="alert"
          >
            Su estado cambió mientras lo editabas.
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="rescheduleStatus === 'conflict'"
            variant="danger"
            title="No pudimos reprogramar el turno"
            role="alert"
          >
            {{ rescheduleErrorDetail }}
          </BaseAlert>
          <BaseAlert
            v-if="rescheduleStatus === 'validation-error'"
            variant="danger"
            title="Revisa la nueva fecha y hora"
            role="alert"
          >
            {{ rescheduleErrorDetail }}
          </BaseAlert>
          <BaseAlert
            v-if="rescheduleStatus === 'idempotency-conflict'"
            variant="danger"
            title="No pudimos completar el intento anterior"
            role="alert"
          >
            Inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert
            v-if="rescheduleStatus === 'network-error'"
            variant="warning"
            title="No pudimos conectar"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo. No perdiste lo que elegiste.
          </BaseAlert>
          <BaseAlert
            v-if="rescheduleStatus === 'unexpected-error'"
            variant="danger"
            title="Ocurrió un error inesperado"
            role="alert"
          >
            Inténtalo de nuevo en unos segundos. No perdiste lo que elegiste.
          </BaseAlert>

          <div class="appointment-detail-page__dialog-compare">
            <p class="appointment-detail-page__dialog-current">
              <strong>Horario actual</strong>
              {{ timeRangeLabel }}
              <span v-if="businessTimezone">Zona {{ businessTimezone }}</span>
            </p>
            <span class="appointment-detail-page__dialog-arrow" aria-hidden="true">→</span>
            <p
              v-if="rescheduleNewEndLabel"
              class="appointment-detail-page__dialog-preview appointment-detail-page__dialog-preview--new"
            >
              <strong>Vista previa</strong>
              {{ rescheduleTime }} – {{ rescheduleNewEndLabel }}
              <span v-if="businessTimezone">Zona {{ businessTimezone }}</span>
            </p>
          </div>

          <div class="appointment-detail-page__dialog-grid">
            <BaseInput
              v-model="rescheduleDate"
              type="date"
              name="rescheduleDate"
              label="Nueva fecha"
              required
              :disabled="rescheduleStatus === 'saving'"
            />
            <BaseInput
              v-model="rescheduleTime"
              type="time"
              name="rescheduleTime"
              label="Nueva hora"
              required
              :disabled="rescheduleStatus === 'saving'"
            />
          </div>

          <div class="appointment-detail-page__dialog-actions">
            <BaseButton type="button" variant="secondary" @click="isRescheduleOpen = false">
              Cancelar
            </BaseButton>
            <BaseButton
              type="submit"
              variant="primary"
              :loading="rescheduleStatus === 'saving'"
              :disabled="rescheduleStatus === 'saving'"
            >
              Confirmar
            </BaseButton>
          </div>
        </form>
      </BaseDialog>

      <BaseDialog
        v-model="isCancelOpen"
        title="Cancelar turno"
        size="md"
        content-class="appointment-detail-page__ink-dialog appointment-detail-page__ink-dialog--danger"
        @close="onCancelDialogClosed"
      >
        <div class="appointment-detail-page__dialog-form appointment-detail-page__ink-form">
          <BaseAlert
            v-if="cancelStatus === 'version-conflict'"
            variant="warning"
            title="Este turno cambió mientras lo revisabas"
            role="alert"
          >
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCancelAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="cancelStatus === 'invalid-state'"
            variant="warning"
            title="Este turno ya no se puede cancelar"
            role="alert"
          >
            Su estado cambió mientras lo revisabas.
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCancelAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="cancelStatus === 'idempotency-conflict'"
            variant="danger"
            title="No pudimos completar el intento anterior"
            role="alert"
          >
            Inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert
            v-if="cancelStatus === 'network-error'"
            variant="warning"
            title="No pudimos conectar"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert
            v-if="cancelStatus === 'unexpected-error'"
            variant="danger"
            title="Ocurrió un error inesperado"
            role="alert"
          >
            Inténtalo de nuevo en unos segundos.
          </BaseAlert>

          <div class="appointment-detail-page__cancel-ticket">
            <p class="appointment-detail-page__cancel-eyebrow">Turno que se cancelará</p>
            <p class="appointment-detail-page__cancel-name">{{ detail.attendeeName }}</p>
            <p v-if="timeSpan" class="appointment-detail-page__cancel-when">
              <span class="appointment-detail-page__cancel-date">{{ timeSpan.date }}</span>
              <span class="appointment-detail-page__cancel-time">
                <span class="appointment-detail-page__cancel-time-text">
                  {{ timeSpan.start }} – {{ timeSpan.end }}
                </span>
              </span>
            </p>
            <p v-else class="appointment-detail-page__cancel-when">
              <span class="appointment-detail-page__cancel-time">{{ timeRangeLabel }}</span>
            </p>
            <p class="appointment-detail-page__cancel-meta">
              {{ detail.serviceName }} · {{ detail.professionalFullName }} ·
              {{ detail.durationMinutes }} min
            </p>
          </div>
          <ul class="appointment-detail-page__cancel-effects">
            <li>
              <svg
                class="appointment-detail-page__cancel-effect-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="9" rx="1" />
                <path d="M8 11V8a4 4 0 0 1 7.5-2" />
              </svg>
              Si la hora es futura, la franja queda disponible de inmediato para otro turno.
            </li>
            <li>
              <svg
                class="appointment-detail-page__cancel-effect-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4 3 20h18L12 4Z" />
                <path d="M12 10v4M12 17v.5" />
              </svg>
              Esta acción no se puede deshacer desde aquí.
            </li>
          </ul>

          <div class="appointment-detail-page__dialog-actions">
            <BaseButton type="button" variant="secondary" @click="isCancelOpen = false">
              Volver
            </BaseButton>
            <BaseButton
              type="button"
              variant="danger"
              :loading="cancelStatus === 'saving'"
              :disabled="cancelStatus === 'saving'"
              @click="onConfirmCancel"
            >
              Sí, cancelar turno
            </BaseButton>
          </div>
        </div>
      </BaseDialog>

      <BaseDialog
        v-model="isCloseOpen"
        :title="closeDialogTitle"
        size="md"
        content-class="appointment-detail-page__ink-dialog"
        @close="onCloseDialogClosed"
      >
        <div class="appointment-detail-page__dialog-form appointment-detail-page__ink-form">
          <BaseAlert
            v-if="closeStatus === 'version-conflict'"
            variant="warning"
            title="Este turno cambió mientras lo revisabas"
            role="alert"
          >
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCloseAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="closeStatus === 'invalid-state'"
            variant="warning"
            title="Este turno ya tiene un resultado registrado"
            role="alert"
          >
            Su estado cambió mientras lo revisabas.
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCloseAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="closeStatus === 'validation-error'"
            variant="warning"
            title="Este turno todavía no comienza"
            role="alert"
          >
            {{ closeErrorDetail }}
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCloseAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="closeStatus === 'idempotency-conflict'"
            variant="danger"
            title="No pudimos completar el intento anterior"
            role="alert"
          >
            Inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert
            v-if="closeStatus === 'network-error'"
            variant="warning"
            title="No pudimos conectar"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert
            v-if="closeStatus === 'unexpected-error'"
            variant="danger"
            title="Ocurrió un error inesperado"
            role="alert"
          >
            Inténtalo de nuevo en unos segundos.
          </BaseAlert>

          <div
            class="appointment-detail-page__cancel-ticket appointment-detail-page__close-ticket"
            :class="
              closeMode === 'complete'
                ? 'appointment-detail-page__close-ticket--complete'
                : 'appointment-detail-page__close-ticket--no-show'
            "
          >
            <p class="appointment-detail-page__cancel-eyebrow">
              {{
                closeMode === 'complete'
                  ? 'Turno que se marcará como atendido'
                  : 'Turno que se marcará como no asistido'
              }}
            </p>
            <p class="appointment-detail-page__cancel-name">{{ detail.attendeeName }}</p>
            <p v-if="timeSpan" class="appointment-detail-page__cancel-when">
              <span class="appointment-detail-page__cancel-date">{{ timeSpan.date }}</span>
              <span class="appointment-detail-page__cancel-time"
                >{{ timeSpan.start }} – {{ timeSpan.end }}</span
              >
            </p>
            <p v-else class="appointment-detail-page__cancel-when">
              <span class="appointment-detail-page__cancel-time">{{ timeRangeLabel }}</span>
            </p>
            <p class="appointment-detail-page__cancel-meta">
              {{ detail.serviceName }} · {{ detail.professionalFullName }} ·
              {{ detail.durationMinutes }} min
            </p>
          </div>
          <ul class="appointment-detail-page__cancel-effects">
            <li>
              <svg
                class="appointment-detail-page__cancel-effect-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4 3 20h18L12 4Z" />
                <path d="M12 10v4M12 17v.5" />
              </svg>
              Esta acción no se puede deshacer desde aquí.
            </li>
          </ul>

          <div class="appointment-detail-page__dialog-actions">
            <BaseButton type="button" variant="secondary" @click="isCloseOpen = false">
              Volver
            </BaseButton>
            <BaseButton
              type="button"
              variant="primary"
              :loading="closeStatus === 'saving'"
              :disabled="closeStatus === 'saving'"
              @click="onConfirmClose"
            >
              {{ closeConfirmLabel }}
            </BaseButton>
          </div>
        </div>
      </BaseDialog>

      <BaseDialog
        v-model="isCorrectOpen"
        title="Corregir resultado"
        size="md"
        @close="onCorrectDialogClosed"
      >
        <form
          class="appointment-detail-page__dialog-form"
          novalidate
          @submit.prevent="onSubmitCorrect"
        >
          <BaseAlert
            v-if="correctStatus === 'version-conflict'"
            variant="warning"
            title="Este turno cambió mientras lo revisabas"
            role="alert"
          >
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCorrectAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="correctStatus === 'invalid-state'"
            variant="warning"
            title="Este turno todavía no tiene un resultado terminal"
            role="alert"
          >
            Su estado cambió mientras lo revisabas.
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onReloadCorrectAfterConflict">
                Recargar
              </BaseButton>
            </template>
          </BaseAlert>
          <BaseAlert
            v-if="correctStatus === 'conflict'"
            variant="danger"
            title="No pudimos corregir el resultado"
            role="alert"
          >
            {{ correctErrorDetail }}
          </BaseAlert>
          <BaseAlert
            v-if="correctStatus === 'validation-error'"
            variant="danger"
            title="Revisa el destino y el motivo"
            role="alert"
          >
            {{ correctErrorDetail }}
          </BaseAlert>
          <BaseAlert
            v-if="correctStatus === 'idempotency-conflict'"
            variant="danger"
            title="No pudimos completar el intento anterior"
            role="alert"
          >
            Inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert
            v-if="correctStatus === 'network-error'"
            variant="warning"
            title="No pudimos conectar"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo. No perdiste lo que elegiste.
          </BaseAlert>
          <BaseAlert
            v-if="correctStatus === 'unexpected-error'"
            variant="danger"
            title="Ocurrió un error inesperado"
            role="alert"
          >
            Inténtalo de nuevo en unos segundos. No perdiste lo que elegiste.
          </BaseAlert>

          <p class="appointment-detail-page__cancel-copy">
            El turno de <strong>{{ detail.attendeeName }}</strong> el {{ timeRangeLabel }} está
            registrado como <strong>{{ statusLabel }}</strong
            >. Esta corrección agrega un evento nuevo al historial; no borra ni edita el anterior.
          </p>

          <div class="appointment-detail-page__correct-field">
            <label class="appointment-detail-page__correct-label" for="correct-destination">
              Nuevo resultado
            </label>
            <select
              id="correct-destination"
              v-model="correctDestination"
              class="appointment-detail-page__correct-select"
              required
              :disabled="correctStatus === 'saving'"
            >
              <option value="" disabled>Elige un resultado</option>
              <option
                v-for="option in correctDestinationOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>

          <p v-if="correctConsequenceLabel" class="appointment-detail-page__correct-consequence">
            {{ correctConsequenceLabel }}
          </p>

          <div class="appointment-detail-page__correct-field">
            <label class="appointment-detail-page__correct-label" for="correct-reason">
              Motivo de la corrección
            </label>
            <textarea
              id="correct-reason"
              v-model="correctReason"
              class="appointment-detail-page__correct-textarea"
              rows="3"
              required
              maxlength="500"
              placeholder="Explica por qué el resultado registrado fue un error"
              :disabled="correctStatus === 'saving'"
            />
          </div>

          <div class="appointment-detail-page__dialog-actions">
            <BaseButton type="button" variant="secondary" @click="isCorrectOpen = false">
              Volver
            </BaseButton>
            <BaseButton
              type="submit"
              variant="primary"
              :loading="correctStatus === 'saving'"
              :disabled="correctStatus === 'saving' || !correctDestination || !correctTrimmedReason"
            >
              Confirmar corrección
            </BaseButton>
          </div>
        </form>
      </BaseDialog>
    </template>
  </section>
</template>

<style scoped>
/* Detalle de turno sobre la tinta del cascarón (DEC-146, issue #471): sustituye el
   lienzo marfil de la lámina #191 por el lenguaje del panel — cabecera editorial,
   ficha de pergamino con cinta métrica de latón y línea de tiempo con marcas de
   latón. Un turno terminal cambia de material (contorno sobre tinta), no de peso
   (§6.7). Los colores de estado son los de la agenda diaria. */
.appointment-detail-page {
  --tone: var(--color-pending-on-strong);
  --rule: color-mix(in srgb, var(--color-on-strong) 16%, transparent);

  display: flex;
  position: relative;
  flex-direction: column;
  gap: var(--space-6);
  min-height: 100%;
  padding: 20px 16px 24px;
  /* Transparente: la tinta y el fondo animado los pone el cascarón. */
  background: transparent;
}

.appointment-detail-page--completed {
  --tone: var(--color-success-on-strong);
}

.appointment-detail-page--no-show {
  --tone: var(--color-no-show-on-strong);
}

.appointment-detail-page--cancelled {
  --tone: var(--color-danger-on-strong);
}

@media (min-width: 1024px) {
  .appointment-detail-page {
    width: 100%;
    max-width: 1280px;
    margin-inline: auto;
    padding: 26px 40px 30px;
  }

  /* Con la pantalla alta el contenido no se queda pegado arriba: el enlace de
     regreso, la cabecera y la ficha forman un grupo que reparte el espacio
     sobrante por igual arriba y abajo (#477). */
  .appointment-detail-page:has(> .appointment-detail-page__body) > .appointment-detail-page__back {
    margin-top: auto;
  }

  .appointment-detail-page > .appointment-detail-page__body {
    margin-bottom: auto;
    padding-bottom: var(--space-6);
  }
}

.appointment-detail-page__body {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.8fr);
  gap: var(--space-12);
  align-items: start;
}

.appointment-detail-page__back {
  margin: 0;
}

.appointment-detail-page__back a {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-decoration: none;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
  border-radius: 2px;
}

.appointment-detail-page__back a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.appointment-detail-page__back a:focus-visible {
  outline: 2px solid var(--color-brand-accent-surface);
  outline-offset: 3px;
}

.appointment-detail-page__state {
  padding: var(--space-6);
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__empty {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) 0;
  margin: 0;
  color: var(--color-on-strong-muted);
}

/* Marca hueca: el primer evento todavía no existe. */
.appointment-detail-page__empty::before {
  content: '';
  flex: none;
  width: 9px;
  height: 9px;
  border: 1px solid var(--color-brand-accent-surface);
  transform: rotate(45deg);
}

/* ── Cabecera ───────────────────────────────────────────────────────────── */

.appointment-detail-page__hero {
  display: flex;
  gap: var(--space-5);
  align-items: center;
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--rule);
}

/* Retrato cuadrado con filete de latón y monograma (§6.7). */
.appointment-detail-page__avatar {
  display: grid;
  flex: 0 0 72px;
  place-items: center;
  width: 72px;
  height: 72px;
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
  color: var(--color-brand-accent-surface);
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-brand-accent-surface) 60%, transparent);
  border-radius: 2px;
}

.appointment-detail-page__identity {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.appointment-detail-page__eyebrow {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.appointment-detail-page__eyebrow::before {
  content: '';
  width: 28px;
  height: 1px;
  background-color: currentcolor;
}

.appointment-detail-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-title-page);
  font-weight: var(--font-weight-h1);
  line-height: 1.08;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  color: var(--color-on-strong);
}

.appointment-detail-page__status {
  display: inline-flex;
  align-items: center;
  margin: 0;
}

/* La palabra de estado lleva el color del estado, además del texto. */
.appointment-detail-page__status :deep(.base-badge) {
  color: var(--tone);
  background-color: color-mix(in srgb, var(--tone) 10%, transparent);
  border-color: color-mix(in srgb, var(--tone) 55%, transparent);
}

.appointment-detail-page__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: flex-end;
}

.appointment-detail-page .appointment-detail-page__reschedule,
.appointment-detail-page .appointment-detail-page__complete,
.appointment-detail-page .appointment-detail-page__no-show,
.appointment-detail-page .appointment-detail-page__cancel,
.appointment-detail-page .appointment-detail-page__correct {
  flex: 0 0 auto;
  min-width: 0;
}

/* Acciones sobre tinta: la principal en latón lleno; las demás con el filete de
   latón del resto del panel; cancelar con el color de peligro elevado. */
.appointment-detail-page .appointment-detail-page__complete {
  color: var(--color-brand-accent-text);
  background-color: var(--color-brand-accent-surface);
  border-color: var(--color-brand-accent-surface);
}

.appointment-detail-page .appointment-detail-page__complete:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 88%, #fff);
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 88%, #fff);
}

.appointment-detail-page .appointment-detail-page__reschedule,
.appointment-detail-page .appointment-detail-page__no-show,
.appointment-detail-page .appointment-detail-page__correct {
  color: var(--color-brand-accent-surface);
  background-color: transparent;
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 50%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.appointment-detail-page .appointment-detail-page__reschedule:hover:not(:disabled),
.appointment-detail-page .appointment-detail-page__no-show:hover:not(:disabled),
.appointment-detail-page .appointment-detail-page__correct:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 50%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.appointment-detail-page .appointment-detail-page__cancel {
  color: var(--color-danger-on-strong);
  background-color: transparent;
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.appointment-detail-page .appointment-detail-page__cancel:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.appointment-detail-page__button-icon {
  display: inline-flex;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
}

.appointment-detail-page__button-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

/* ── Ficha del turno ────────────────────────────────────────────────────── */

/* Superficies sobre tinta: la ficha usa los tokens que el modo Marfil ya redefine
   (`--color-on-strong*`, acento de marca), así que en Tinta es oscura, en Marfil
   clara y en Automático sigue al sistema, sin hoja de estilos paralela (§6.9).
   Un turno vigente lleva un velo tenue del color del texto; uno terminal cambia de
   material a contorno puro con el color del estado (§6.7). */
.appointment-detail-page__sheet {
  --sx-text: var(--color-on-strong);
  --sx-muted: var(--color-on-strong-soft);
  --sx-label: var(--color-brand-accent-surface);
  --sx-line: var(--rule);

  position: relative;
  min-width: 0;
  background-color: color-mix(in srgb, var(--color-on-strong) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-on-strong) 18%, transparent);
  border-left: 4px solid var(--tone);
  border-radius: 0 0 2px 2px;
}

.appointment-detail-page__sheet--terminal {
  background-color: transparent;
  border-color: color-mix(in srgb, var(--tone) 45%, transparent);
  border-left-color: var(--tone);
}

/* Cinta métrica de latón en el borde superior: marcas cada 10 px y una más larga
   cada 50, como la de la hoja de datos de la reserva pública. */
.appointment-detail-page__sheet::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 11px;
  pointer-events: none;
  background:
    linear-gradient(var(--sx-label), var(--sx-label)) top / 100% 1px no-repeat,
    repeating-linear-gradient(90deg, var(--sx-label) 0 1px, transparent 1px 10px) top / 100% 5px
      no-repeat,
    repeating-linear-gradient(90deg, var(--sx-label) 0 1px, transparent 1px 50px) top / 100% 10px
      no-repeat;
  transform-origin: left;
  animation: nava-wipe 1s cubic-bezier(0.65, 0, 0.2, 1) 0.35s backwards;
}

/* Franja de tiempo: inicio, regla con la duración y fin. Decorativa. */
.appointment-detail-page__span {
  padding: var(--space-8) var(--space-6) var(--space-4);
  border-bottom: 1px solid var(--sx-line);
}

.appointment-detail-page__span-date {
  margin: 0 0 var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sx-muted);
}

.appointment-detail-page__span-row {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.appointment-detail-page__span-time {
  flex: none;
  font-family: var(--font-display);
  font-size: var(--font-size-title-page);
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: lining-nums tabular-nums;
  color: var(--sx-text);
}

.appointment-detail-page__span-track {
  display: flex;
  flex: 1;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
}

.appointment-detail-page__span-line {
  position: relative;
  flex: 1;
  height: 1px;
  min-width: 12px;
  background-color: var(--sx-label);
  transform-origin: left;
  animation: nava-wipe 1.1s cubic-bezier(0.65, 0, 0.2, 1) 0.6s backwards;
}

.appointment-detail-page__span-line::before {
  content: '';
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  background-color: var(--sx-label);
  transform: translateY(-50%) rotate(45deg);
}

.appointment-detail-page__span-line--start::before {
  left: 0;
}

.appointment-detail-page__span-line--end::before {
  right: 0;
}

.appointment-detail-page__span-length {
  flex: none;
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sx-label);
}

/* Hechos en cuadrícula, con el rótulo sobre el valor: tres columnas en escritorio,
   dos en tablet y una en móvil. «Hora» ya la dice la franja de arriba; su fila queda
   solo para el lector de pantalla. */
.appointment-detail-page__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 var(--space-6);
  padding: var(--space-2) var(--space-6) var(--space-4);
  margin: 0;
}

.appointment-detail-page__fact {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  order: 3;
  min-width: 0;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--sx-line);
}

.appointment-detail-page__fact--service {
  grid-column: span 2;
  order: 1;
}

.appointment-detail-page__fact--professional {
  order: 2;
}

.appointment-detail-page__fact--wide {
  grid-column: 1 / -1;
  order: 4;
}

.appointment-detail-page__fact--time {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
  border: 0;
}

.appointment-detail-page__fact dt {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sx-label);
}

.appointment-detail-page__fact dd {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  overflow-wrap: anywhere;
  color: var(--sx-text);
}

.appointment-detail-page__fact dd a {
  color: inherit;
  text-underline-offset: 3px;
}

/* ── Historial: línea de tiempo ─────────────────────────────────────────── */

.appointment-detail-page__history {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
  padding-left: var(--space-6);
  border-left: 1px solid var(--rule);
}

.appointment-detail-page__history-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-title-section);
  font-weight: var(--font-weight-h2);
  line-height: 1.1;
  color: var(--color-on-strong);
}

.appointment-detail-page__history-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.appointment-detail-page__history-item {
  position: relative;
  min-height: 72px;
  padding: 0 0 var(--space-6) var(--space-8);
  border-left: 1px solid color-mix(in srgb, var(--color-brand-accent-surface) 45%, transparent);
}

.appointment-detail-page__history-item:last-child {
  padding-bottom: 0;
  border-left-color: transparent;
}

/* Marca del evento: cuadrado de filete de latón; la más reciente va llena. */
.appointment-detail-page__history-icon {
  position: absolute;
  top: 0;
  left: -15px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--color-brand-accent-surface);
  background-color: var(--color-surface-strong);
  border: 1px solid var(--color-brand-accent-surface);
  border-radius: 2px;
}

.appointment-detail-page__history-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.appointment-detail-page__history-item:first-child .appointment-detail-page__history-icon {
  color: var(--color-brand-accent-text);
  background-color: var(--color-brand-accent-surface);
}

.appointment-detail-page__history-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.appointment-detail-page__history-event {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-on-strong);
}

.appointment-detail-page__history-meta {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong-muted);
}

.appointment-detail-page__history-reason {
  margin: var(--space-2) 0 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__history-changes {
  padding-left: var(--space-4);
  margin: var(--space-2) 0 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__dialog-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.appointment-detail-page__dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: end;
}

.appointment-detail-page__dialog-current,
.appointment-detail-page__dialog-preview {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-primary);
}

.appointment-detail-page__dialog-current strong,
.appointment-detail-page__dialog-preview strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-caption);
}

.appointment-detail-page__dialog-current span,
.appointment-detail-page__dialog-preview span {
  color: var(--color-text-secondary);
}

.appointment-detail-page__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.appointment-detail-page__cancel-copy {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--color-text-primary);
}

/* Campo de corrección (HU-068, T8): mismo lenguaje visual que BaseInput
   (rótulo reglado en versalitas de latón, campo con filete y línea base de
   tinta) sobre elementos nativos select/textarea, que BaseInput no cubre —
   sin mockup exacto asignado, la composición se resuelve libremente dentro
   de NAVA/Tailored Grid (HU-068, "Pruebas obligatorias"). */
.appointment-detail-page__correct-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.appointment-detail-page__correct-label {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-brass);
}

.appointment-detail-page__correct-select,
.appointment-detail-page__correct-textarea {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--color-text-primary);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-bottom: var(--border-width-emphasis) solid var(--color-action-primary);
  border-radius: 2px;
  outline: none;
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
}

.appointment-detail-page__correct-select {
  height: var(--control-height);
}

.appointment-detail-page__correct-textarea {
  resize: vertical;
  min-height: 88px;
}

@media (prefers-reduced-motion: reduce) {
  .appointment-detail-page__correct-select,
  .appointment-detail-page__correct-textarea {
    transition: none;
  }
}

.appointment-detail-page__correct-select:hover:not(:disabled),
.appointment-detail-page__correct-textarea:hover:not(:disabled) {
  border-color: var(--color-text-secondary);
  border-bottom-color: var(--color-action-primary);
}

.appointment-detail-page__correct-select:focus-visible,
.appointment-detail-page__correct-textarea:focus-visible {
  border-color: var(--color-focus);
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.appointment-detail-page__correct-select:disabled,
.appointment-detail-page__correct-textarea:disabled {
  background-color: var(--color-surface-muted);
  border-color: var(--color-border-subtle);
  border-bottom-color: var(--color-border-subtle);
  color: var(--color-text-secondary);
  cursor: not-allowed;
  opacity: 0.64;
}

.appointment-detail-page__correct-consequence {
  margin: calc(var(--space-3) * -1) 0 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
}

/* Tarjeta de reprogramar sobre tinta (#479): centrada, con la superficie del modo activo
   (--color-surface-strong cambia con Tinta/Marfil, §6.9) y el mismo tratamiento que los
   diálogos del catálogo. Las reglas son globales porque BaseDialog se teletransporta a
   <body> y pierde el ancestro de ámbito; !important porque su propia regla tiene igual
   especificidad. Solo afecta a esta tarjeta (clase exclusiva de la pantalla). */
:global(.appointment-detail-page__ink-dialog.base-dialog) {
  width: min(100%, 520px) !important;
  background-color: var(--color-surface-strong) !important;
  border: 1px solid var(--color-field-strong-border) !important;
  border-top: 3px solid var(--color-brand-accent-surface) !important;
  box-shadow: 0 28px 60px -24px rgb(0 0 0 / 55%) !important;
}

:global(.appointment-detail-page__ink-dialog--wide.base-dialog) {
  width: min(100%, 620px) !important;
}

/* Cancelar: el filete superior y los acentos pasan al color de peligro (§6.7). */
:global(.appointment-detail-page__ink-dialog--danger.base-dialog) {
  border-top-color: var(--color-danger-on-strong) !important;
}

:global(.appointment-detail-page__ink-dialog.base-dialog .base-dialog__container) {
  max-width: none !important;
}

:global(.appointment-detail-page__ink-dialog .base-dialog__header) {
  padding: var(--space-5) var(--space-6) var(--space-4);
  border-bottom: 1px solid var(--color-field-strong-border) !important;
}

:global(.appointment-detail-page__ink-dialog .base-dialog__title) {
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
  font-weight: 400;
  color: var(--color-on-strong) !important;
}

:global(.appointment-detail-page__ink-dialog .base-dialog__close) {
  color: var(--color-on-strong-muted) !important;
}

:global(.appointment-detail-page__ink-dialog .base-dialog__close:hover) {
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent) !important;
  color: var(--color-on-strong) !important;
}

:global(.appointment-detail-page__ink-dialog .base-dialog__close:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus) !important;
}

:global(.appointment-detail-page__ink-dialog .base-dialog__content) {
  padding: var(--space-5) var(--space-6) var(--space-6);
}

/* Comparación: lo que hay ahora, una flecha y lo que quedará. */
.appointment-detail-page__dialog-compare {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  padding: var(--space-4);
  background: color-mix(in srgb, var(--color-on-strong) 5%, transparent);
  border: 1px solid var(--color-field-strong-border);
  border-left: 3px solid var(--color-brand-accent-surface);
}

.appointment-detail-page__dialog-compare .appointment-detail-page__dialog-current,
.appointment-detail-page__dialog-compare .appointment-detail-page__dialog-preview {
  color: var(--color-on-strong);
}

.appointment-detail-page__dialog-compare strong {
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.appointment-detail-page__dialog-compare span {
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__dialog-compare .appointment-detail-page__dialog-arrow {
  align-self: center;
  font-size: var(--font-size-title-item);
  line-height: 1;
  color: var(--color-brand-accent-surface);
}

/* Campos reglados sobre tinta, igual que Agenda y el catálogo. */
.appointment-detail-page__ink-form :deep(.base-input) {
  --input-bg: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  --input-border-color: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  --input-border-base-color: color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  --input-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);

  color: var(--color-on-strong);
  color-scheme: dark;
}

:global(:root[data-app-theme='ivory']) .appointment-detail-page__ink-form :deep(.base-input) {
  color-scheme: light;
}

.appointment-detail-page__ink-form :deep(.base-input__label),
.appointment-detail-page__ink-form :deep(.base-input__required) {
  color: var(--color-brand-accent-surface);
}

.appointment-detail-page__ink-form
  :deep(.base-input:hover:not(:disabled):not(.base-input--invalid)) {
  border-color: color-mix(in srgb, var(--color-on-strong) 26%, transparent);
}

.appointment-detail-page__ink-form :deep(.base-input:disabled) {
  opacity: 0.45;
  color: var(--color-on-strong-muted);
}

.appointment-detail-page__ink-form :deep(.base-button) {
  --btn-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);
}

.appointment-detail-page__ink-form :deep(.base-button--primary) {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

/* Resumen del turno a cancelar: una ficha con el horario tachado por una línea de peligro
   y las dos consecuencias como filas cortas con icono (#483). */
.appointment-detail-page__cancel-ticket {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-5);
  background: color-mix(in srgb, var(--color-on-strong) 5%, transparent);
  border: 1px solid var(--color-field-strong-border);
  border-left: 3px solid var(--color-danger-on-strong);
}

.appointment-detail-page__cancel-ticket p {
  margin: 0;
}

/* Cerrar turno (atendido / no asistió): la misma ficha que cancelar, con el color del estado
   que se va a registrar (los tintes levantados a tinta de la agenda). */
.appointment-detail-page__close-ticket--complete {
  border-left-color: var(--color-success-on-strong);
}

.appointment-detail-page__close-ticket--complete .appointment-detail-page__cancel-eyebrow {
  color: var(--color-success-on-strong);
}

.appointment-detail-page__close-ticket--no-show {
  border-left-color: var(--color-no-show-on-strong);
}

.appointment-detail-page__close-ticket--no-show .appointment-detail-page__cancel-eyebrow {
  color: var(--color-no-show-on-strong);
}

.appointment-detail-page__cancel-eyebrow {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-danger-on-strong);
}

.appointment-detail-page__cancel-name {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1.15;
  color: var(--color-on-strong);
  overflow-wrap: anywhere;
}

.appointment-detail-page__cancel-when {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  align-items: baseline;
  margin-top: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--color-field-strong-border);
}

.appointment-detail-page__cancel-date {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__cancel-time {
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
  line-height: 1.2;
  color: var(--color-on-strong-muted);
}

/* Línea de peligro que atraviesa el horario, como un turno tachado en la libreta. */
.appointment-detail-page__cancel-time-text {
  position: relative;
  display: inline-block;
}

.appointment-detail-page__cancel-time-text::after {
  content: '';
  position: absolute;
  inset: 52% -4px auto;
  height: 2px;
  background: var(--color-danger-on-strong);
  transform-origin: left;
  animation: nava-wipe 0.7s cubic-bezier(0.65, 0, 0.2, 1) 0.25s backwards;
}

.appointment-detail-page__cancel-meta {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__cancel-effects {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.appointment-detail-page__cancel-effects li {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-soft);
}

.appointment-detail-page__cancel-effect-icon {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  color: var(--color-brand-accent-surface);
}

.appointment-detail-page__cancel-effects
  li:last-child
  .appointment-detail-page__cancel-effect-icon {
  color: var(--color-danger-on-strong);
}

/* Acción destructiva: contorno y texto de peligro, sin relleno, como «Desactivar» del catálogo. */
.appointment-detail-page__ink-form :deep(.base-button--danger) {
  background-color: transparent;
  color: var(--color-danger-on-strong);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.appointment-detail-page__ink-form
  :deep(.base-button--danger:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 14%, transparent);
  filter: none;
}

.appointment-detail-page__ink-form :deep(.base-button--secondary) {
  background-color: transparent;
  color: var(--color-brand-accent-surface);
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 50%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.appointment-detail-page__ink-form
  :deep(.base-button--secondary:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 12%, transparent);
}

@media (max-width: 767px) {
  .appointment-detail-page {
    gap: var(--space-4);
  }

  .appointment-detail-page__back {
    display: none;
  }

  .appointment-detail-page__hero {
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .appointment-detail-page__avatar {
    flex-basis: 56px;
    width: 56px;
    height: 56px;
  }

  .appointment-detail-page__title {
    font-size: var(--font-size-h2);
    line-height: 1.12;
  }

  /* Hasta cuatro acciones pueden coexistir sobre un turno confirmado ya
     cerrable (CA-067-08): con etiquetas largas una grilla de dos columnas
     desborda a 320/360 px (BaseButton usa white-space: nowrap). Una sola
     columna en flujo normal, debajo del hero, evita el desborde para cualquier
     cantidad de acciones. */
  .appointment-detail-page__actions {
    display: grid;
    flex-basis: 100%;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .appointment-detail-page .appointment-detail-page__reschedule,
  .appointment-detail-page .appointment-detail-page__complete,
  .appointment-detail-page .appointment-detail-page__no-show,
  .appointment-detail-page .appointment-detail-page__cancel,
  .appointment-detail-page .appointment-detail-page__correct {
    width: 100%;
  }

  .appointment-detail-page__body {
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  .appointment-detail-page__span {
    padding: var(--space-8) var(--space-4) var(--space-4);
  }

  .appointment-detail-page__span-time {
    font-size: var(--font-size-title-item);
  }

  .appointment-detail-page__span-row {
    gap: var(--space-3);
  }

  .appointment-detail-page__facts {
    grid-template-columns: 1fr;
    padding: var(--space-1) var(--space-4) var(--space-3);
  }

  .appointment-detail-page__fact--service {
    grid-column: auto;
  }

  .appointment-detail-page__history {
    padding: var(--space-5) 0 0;
    border-top: 1px solid var(--rule);
    border-left: 0;
  }

  .appointment-detail-page__history-title {
    font-size: var(--font-size-title-item);
  }

  .appointment-detail-page__dialog-compare {
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }

  .appointment-detail-page__dialog-arrow {
    transform: rotate(90deg);
    justify-self: start;
  }

  .appointment-detail-page__dialog-grid {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  :global(.appointment-detail-page__ink-dialog .base-dialog__header) {
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  :global(.appointment-detail-page__ink-dialog .base-dialog__content) {
    padding: var(--space-4);
  }

  .appointment-detail-page__dialog-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  :global(.appointment-detail-page__ink-dialog .base-dialog__container) {
    max-height: calc(100vh / var(--ui-zoom, 1) - 20px);
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .appointment-detail-page {
    padding: 24px;
  }

  /* Hasta cuatro acciones ya no caben junto al retrato y la identidad en 768 px. */
  .appointment-detail-page__hero {
    flex-wrap: wrap;
  }

  .appointment-detail-page__actions {
    display: grid;
    flex-basis: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .appointment-detail-page__body {
    grid-template-columns: minmax(0, 1.3fr) minmax(240px, 0.7fr);
    gap: var(--space-8);
  }

  .appointment-detail-page__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .appointment-detail-page__dialog-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .appointment-detail-page__sheet::before,
  .appointment-detail-page__cancel-time-text::after,
  .appointment-detail-page__span-line {
    animation: none;
  }
}

:global(:root[data-motion='reduced']) .appointment-detail-page__sheet::before,
:global(:root[data-motion='reduced']) .appointment-detail-page__cancel-time-text::after,
:global(:root[data-motion='reduced']) .appointment-detail-page__span-line {
  animation: none;
}
</style>
