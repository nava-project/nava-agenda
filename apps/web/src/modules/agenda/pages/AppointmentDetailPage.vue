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
import { timezoneLabel } from '@/shared/time/timezoneName'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, type LocationQueryRaw } from 'vue-router'
import { useToast, useVocabulary } from '@/shared/composables'
import {
  AppointmentTicket,
  BaseAlert,
  BaseBadge,
  BaseButton,
  BaseDialog,
  BrassMonogram,
  DiamondLoader,
  PhoneDisplay,
  type AppointmentTicketState,
} from '@/shared/ui'
import { ticketMoment } from '@/shared/time/ticketMoment'
import {
  formatFullDateInTimezone,
  formatInstantInTimezone,
  formatTimeInTimezone,
} from '@/shared/time/formatInstant'
import {
  formatCivilDateFull,
  formatCivilDateShort,
  getCivilDateInTimezone,
  minutesSinceCivilMidnight,
} from '@/shared/time/civilDate'
import { formatClock } from '@/shared/model/openingHours'
import ManualStartPicker from '../components/ManualStartPicker.vue'
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
import {
  historyChangeValue,
  historyEventLabel,
  historyFieldLabel,
} from '../model/appointmentDetail'
import { formatMoney } from '@/shared/model/money'
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

// v2 (DEC-188): como en la agenda del día, un `confirmed` se lee por la hora:
// «En curso» mientras ocurre y «Por registrar» cuando terminó sin resultado.
// Se evalúa al cargar, sin reloj en vivo.
const timePhase = computed((): 'in-progress' | 'to-record' | null => {
  if (!detail.value || detail.value.status !== 'confirmed') return null
  const now = Date.now()
  if (now >= new Date(detail.value.endsAt).getTime()) return 'to-record'
  if (now >= new Date(detail.value.startsAt).getTime()) return 'in-progress'
  return null
})

// El estado tal como está guardado, sin la lectura por la hora: la corrección
// de resultado habla del estado registrado, no de «Por registrar».
const recordedStatusLabel = computed(() =>
  detail.value ? appointmentStatusLabel(detail.value.status, v.value) : '',
)

const statusLabel = computed(() => {
  if (!detail.value) return ''
  if (timePhase.value === 'in-progress') return 'En curso'
  if (timePhase.value === 'to-record') return 'Por registrar'
  return appointmentStatusLabel(detail.value.status, v.value)
})
// Mismo mapa que DailyAgendaPage.vue: cancelled_by_professional ya tiene el
// tratamiento terminal 'danger' que el atlas asigna a un turno cancelado
// (nava-docs/agenda/10-backlog/evidence/.../detalle-turno-eventos/10-turno-cancelado.png),
// reutilizado tal cual en vez de inventar un color nuevo para HU-066.
const statusBadgeVariant = computed(() =>
  detail.value ? APPOINTMENT_STATUS_BADGE_VARIANT[detail.value.status] : 'neutral',
)
// Tono de la ficha: el mismo reparto de colores por estado que la agenda diaria
// (pendiente, completado, no asistió, cancelado), con la palabra de estado como
// señal además del color.
const STATUS_TONE: Record<AppointmentStatus, string> = {
  confirmed: 'pending',
  completed: 'completed',
  no_show: 'no-show',
  cancelled_by_customer: 'cancelled',
  cancelled_by_professional: 'cancelled',
}
const statusTone = computed(() => {
  if (!detail.value) return 'pending'
  if (timePhase.value === 'in-progress') return 'current'
  if (timePhase.value === 'to-record') return 'to-record'
  return STATUS_TONE[detail.value.status]
})
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
  // «No asistió»: el rombo de la familia, hueco y cruzado (#757), no el ⊗ genérico.
  absent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 20.5 12 12 20.5 3.5 12Z"></path><path d="M9.5 9.5l5 5"></path></svg>`,
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

// DEC-193 (#854): un `no_show` ocupa la agenda solo hasta el minuto de la marca.
// El dato es del servidor (`occupiedUntil`); aquí solo se dice en palabras, nunca
// solo con color. Sin el dato (respuesta anterior al campo) no se afirma nada.
const noShowOccupancyLabel = computed(() => {
  const d = detail.value
  const zone = businessTimezone.value
  if (!d || !zone || d.status !== 'no_show' || !d.occupiedUntil) return ''
  const until = Date.parse(d.occupiedUntil)
  if (until <= Date.parse(d.startsAt)) {
    return 'No llegó a ocupar su franja: quedó libre entera para otro turno.'
  }
  if (until < Date.parse(d.endsAt)) {
    return `Ocupó de ${formatTimeInTimezone(d.startsAt, zone)} a ${formatTimeInTimezone(d.occupiedUntil, zone)}; el resto de la franja quedó libre para otro turno.`
  }
  return 'Ocupó su franja completa.'
})

// La tarjeta de turno (DEC-189, #757): la misma que el cliente se lleva, ahora en
// el panel. El sello dice el estado como lo lee la agenda («En curso», «Por
// registrar»); el rótulo de latón, de dónde salió el turno.
const TICKET_STATE: Record<AppointmentStatus, AppointmentTicketState> = {
  confirmed: 'confirmed',
  completed: 'completed',
  no_show: 'no-show',
  cancelled_by_customer: 'cancelled',
  cancelled_by_professional: 'cancelled',
}
const ORIGIN_LABEL: Record<AppointmentDetail['origin'], string> = {
  public: 'Reserva en línea',
  manual: 'Agendado en el panel',
}
const ticket = computed(() => {
  if (!detail.value || !businessTimezone.value) return null
  const d = detail.value
  const zone = businessTimezone.value
  const m = ticketMoment(d.startsAt, d.endsAt, zone)
  // El Sol sobre la regla mientras ocurre: el mismo instante con el que se leyó la fase.
  const now =
    timePhase.value === 'in-progress'
      ? minutesSinceCivilMidnight(
          new Date().toISOString(),
          getCivilDateInTimezone(zone, new Date(d.startsAt)),
          zone,
        )
      : null
  return {
    state: TICKET_STATE[d.status],
    stateLabel: statusLabel.value,
    businessName: ORIGIN_LABEL[d.origin],
    serviceName: d.serviceName,
    meta: `${d.durationMinutes} min · ${formatMoney(d.priceAmount, d.currency)}`,
    weekday: m.weekday,
    month: m.month,
    day: m.day,
    time: m.time,
    timeNote: `hasta ${m.endTime} · ${timezoneLabel(zone)}`,
    professionalName: d.professionalFullName,
    professionalLabel: v.value.Professional,
    ruler: {
      from: m.from,
      to: m.to,
      at: m.at,
      now,
      label: `El turno en el día: ${m.weekday.toLocaleLowerCase('es-CO')} ${m.day}, de ${m.time} a ${m.endTime}.`,
    },
  }
})

// El final del historial (#758): mientras el turno no ha ocurrido o está en curso,
// la línea de tiempo termina en el propio turno, que es lo último que pasará; si
// ya pasó, cierra con un rombo. Solo con el historial completo (sin más páginas),
// para no dejar el turno delante de eventos que aún no se cargaron.
type HistoryEnd = { kind: 'upcoming' | 'now'; title: string; meta: string } | { kind: 'close' }

const historyEnd = computed((): HistoryEnd | null => {
  if (!detail.value || !businessTimezone.value) return null
  if (historyItems.value.length === 0 || historyNextCursor.value) return null
  const d = detail.value
  const m = ticketMoment(d.startsAt, d.endsAt, businessTimezone.value)
  if (d.status === 'confirmed' && timePhase.value === null) {
    const day = `${m.weekday} ${m.day} ${m.month}`.toLocaleLowerCase('es-CO')
    return { kind: 'upcoming', title: 'El turno', meta: `Próximo · ${day} · ${m.time}` }
  }
  if (timePhase.value === 'in-progress') {
    return { kind: 'now', title: 'En curso', meta: `hasta ${m.endTime}` }
  }
  return { kind: 'close' }
})

// Llegada (#758): la primera vez que la tarjeta tiene datos, la página corre un
// guion finito (~900 ms, solo transform y opacity; el CSS lo apaga con
// movimiento reducido). El rombo de la regla sale del borde izquierdo: la
// distancia se mide una vez, porque depende del ancho real de la regla.
const rootEl = ref<HTMLElement | null>(null)
const arriving = ref(false)
let arrivedOnce = false
let arriveTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => ticket.value !== null,
  async (hasTicket) => {
    if (!hasTicket || arrivedOnce) return
    arrivedOnce = true
    arriving.value = true
    await nextTick()
    const mark = rootEl.value?.querySelector<HTMLElement>('.day-ruler__mark--mine')
    if (mark) mark.style.setProperty('--arrive-mark-from', `${-mark.offsetLeft}px`)
    arriveTimer = setTimeout(() => {
      arriving.value = false
    }, 1400)
  },
)

onBeforeUnmount(() => clearTimeout(arriveTimer))

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

// El boleto de «Reprogramar» (#776): lo que hay ahora frente a lo que quedará,
// todo en 12 h como el resto del panel, con la hora en serif y «a. m.»/«p. m.»
// en menor, igual que el resumen de «Nuevo turno».
function splitClock(label: string): { clock: string; suffix: string } {
  const space = label.indexOf(' ')
  return space < 0
    ? { clock: label, suffix: '' }
    : { clock: label.slice(0, space), suffix: label.slice(space + 1) }
}

const rescheduleNow = computed(() => {
  if (!detail.value || !businessTimezone.value) return null
  const zone = businessTimezone.value
  const civil = getCivilDateInTimezone(zone, new Date(detail.value.startsAt))
  return {
    ...splitClock(formatClock(civilTimeInTimezone(detail.value.startsAt, zone))),
    until: formatClock(civilTimeInTimezone(detail.value.endsAt, zone)),
    date: formatCivilDateFull(civil),
    // En móvil, una sola línea: el pie ya repite la nueva hora.
    short: formatCivilDateShort(civil, getCivilDateInTimezone(zone)),
  }
})

const rescheduleNew = computed(() => {
  if (!detail.value || !rescheduleTime.value || !rescheduleDate.value) return null
  return {
    ...splitClock(formatClock(rescheduleTime.value)),
    until: formatClock(addMinutesToTimeString(rescheduleTime.value, detail.value.durationMinutes)),
    date: formatCivilDateFull(rescheduleDate.value),
  }
})

// La fecha corta del pie («mañana», «dom 23 nov»), relativa al día de hoy en la
// zona del negocio.
const rescheduleFootDate = computed(() =>
  rescheduleDate.value && businessTimezone.value
    ? formatCivilDateShort(rescheduleDate.value, getCivilDateInTimezone(businessTimezone.value))
    : '',
)

// El error del instante va junto a las horas, como en «Nuevo turno» (#773).
const rescheduleFieldError = computed(() => {
  if (rescheduleStatus.value === 'conflict')
    return rescheduleErrorDetail.value ?? 'Esa hora ya se ocupó. Elige otra.'
  if (rescheduleStatus.value === 'validation-error')
    return rescheduleErrorDetail.value ?? 'Revisa la nueva fecha y hora.'
  return undefined
})

const reschedulePicker = ref<InstanceType<typeof ManualStartPicker> | null>(null)

// Elegir otra hora resuelve el error del instante anterior. Soltar la hora
// tomada tras un 409 (la relectura del día) no lo borra: el aviso sigue
// diciendo por qué hay que elegir otra.
watch(rescheduleTime, (time) => {
  if (!time) return
  if (rescheduleStatus.value === 'conflict' || rescheduleStatus.value === 'validation-error')
    rescheduleStatus.value = 'idle'
})

function onOpenReschedule() {
  if (!detail.value || !businessTimezone.value) return
  // La tira abre en el día del turno; la hora se elige de nuevo: la actual se ve
  // marcada en la rejilla, pero reprogramar a la misma hora no es un cambio.
  rescheduleDate.value = getCivilDateInTimezone(
    businessTimezone.value,
    new Date(detail.value.startsAt),
  )
  rescheduleTime.value = ''
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
      // Alguien tomó la hora entre la lectura y el envío: se relee ese día.
      void reschedulePicker.value?.refreshDay(rescheduleDate.value)
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

// DEC-193: al abrir «No vino» se fija si la franja todavía no termina; si no
// terminó, la confirmación dice que el resto queda libre. Lo decide el servidor
// con su reloj; esto solo anticipa la consecuencia.
const noShowFreesRest = ref(false)

function onOpenNoShow() {
  noShowFreesRest.value = !!detail.value && Date.now() < Date.parse(detail.value.endsAt)
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
  const destination = correctDestination.value
  const origin = detail.value.status
  const destOccupies = occupies(destination)
  const originOccupies = occupies(origin)
  // DEC-193: hacia `no_show`, el servidor corta en el minuto de la corrección;
  // si la franja ya terminó, no cambia nada. Desde un `no_show` que liberó parte
  // de su franja, `completed` la vuelve a ocupar entera.
  const beforeEnd = Date.now() < Date.parse(detail.value.endsAt)
  const freed =
    origin === 'no_show' &&
    !!detail.value.occupiedUntil &&
    Date.parse(detail.value.occupiedUntil) < Date.parse(detail.value.endsAt)
  if (destination === 'no_show' && beforeEnd) {
    return originOccupies
      ? 'El turno dejará de ocupar su franja desde este minuto; el resto quedará libre.'
      : 'El turno volverá a ocupar su franja hasta este minuto; el resto seguirá libre.'
  }
  if (destination === 'completed' && freed) {
    return 'El turno volverá a ocupar su franja entera. Si otro turno ya tomó el tramo liberado, primero hay que corregir ese turno.'
  }
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
    ref="rootEl"
    class="appointment-detail-page"
    :class="[
      `appointment-detail-page--${statusTone}`,
      { 'appointment-detail-page--arrive': arriving },
    ]"
    aria-labelledby="appointment-detail-page-title"
  >
    <p class="appointment-detail-page__back">
      <RouterLink :to="{ name: 'panel', query: backQuery }">← Volver a la agenda</RouterLink>
    </p>

    <!-- Carga (#741): como las demás rutas del panel desde #736, el sol grande
         centrado sobre un esqueleto con la forma real del detalle (cabecera,
         ficha e historial), en vez de una línea sobre la pantalla vacía. El
         esqueleto usa las mismas clases de cabecera, acciones, cuerpo e
         historial (#758): hereda la rejilla de cada ancho y los datos llegan sin
         reacomodo. -->
    <div
      v-if="pageStatus === 'loading'"
      class="appointment-detail-page__loading"
      role="status"
      aria-live="polite"
    >
      <DiamondLoader layout="overlay" label="Cargando el detalle del turno…" />
      <div class="appointment-detail-page__skeleton" aria-hidden="true">
        <div class="appointment-detail-page__hero">
          <span class="appointment-detail-page__skeleton-monogram" />
          <span class="appointment-detail-page__identity">
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--title"
            />
          </span>
          <span class="appointment-detail-page__actions">
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--button"
            />
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--button"
            />
          </span>
        </div>
        <div class="appointment-detail-page__body">
          <!-- La tarjeta: cabecera, troquel, hoja con la hora, regla y puntos guía. -->
          <div class="appointment-detail-page__skeleton-card">
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--kicker"
            />
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--service"
            />
            <span class="appointment-detail-page__skeleton-perforation" />
            <span class="appointment-detail-page__skeleton-when">
              <span class="appointment-detail-page__skeleton-leaf" />
              <span
                class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--time"
              />
            </span>
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--ruler"
            />
            <span class="appointment-detail-page__skeleton-perforation" />
            <span v-for="n in 4" :key="n" class="appointment-detail-page__skeleton-row">
              <span
                class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--label"
              />
              <span class="appointment-detail-page__skeleton-dots" />
              <span
                class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--value"
              />
            </span>
          </div>
          <div class="appointment-detail-page__history">
            <span
              class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--section"
            />
            <span class="appointment-detail-page__skeleton-events">
              <span v-for="n in 2" :key="n" class="appointment-detail-page__skeleton-event">
                <span class="appointment-detail-page__skeleton-diamond" />
                <span
                  class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--history"
                />
                <span
                  class="appointment-detail-page__skeleton-bar appointment-detail-page__skeleton-bar--meta"
                />
              </span>
            </span>
          </div>
        </div>
      </div>
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
        <BrassMonogram
          class="appointment-detail-page__avatar"
          :glyph="attendeeInitials"
          face="serif"
          pendant
        />
        <div class="appointment-detail-page__identity">
          <h1 id="appointment-detail-page-title" class="appointment-detail-page__title">
            {{ detail.attendeeName }}
          </h1>
          <p class="appointment-detail-page__status" role="status">
            <BaseBadge :variant="statusBadgeVariant" size="sm" :label="statusLabel">
              {{ statusLabel }}
            </BaseBadge>
          </p>
        </div>
        <div class="appointment-detail-page__actions">
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
        <AppointmentTicket
          v-if="ticket"
          class="appointment-detail-page__ticket"
          v-bind="ticket"
          label="Turno"
        >
          <dl class="appointment-detail-page__leaders">
            <div class="appointment-detail-page__leader">
              <dt>Persona atendida</dt>
              <dd>{{ detail.attendeeName }}</dd>
            </div>
            <div class="appointment-detail-page__leader">
              <dt>Cliente que reservó</dt>
              <dd>{{ detail.customerFullName }}</dd>
            </div>
            <div v-if="noShowOccupancyLabel" class="appointment-detail-page__leader">
              <dt>En la agenda</dt>
              <dd class="appointment-detail-page__occupancy">{{ noShowOccupancyLabel }}</dd>
            </div>
            <div v-if="detail.customerPhone" class="appointment-detail-page__leader">
              <dt>Teléfono</dt>
              <dd>
                <a
                  class="appointment-detail-page__contact"
                  :href="`tel:${detail.customerPhone}`"
                  :aria-label="`Llamar al ${detail.customerPhone}`"
                  ><PhoneDisplay :value="detail.customerPhone"
                /></a>
              </dd>
            </div>
            <div v-if="detail.customerEmail" class="appointment-detail-page__leader">
              <dt>Correo</dt>
              <dd>
                <a
                  class="appointment-detail-page__contact"
                  :href="`mailto:${detail.customerEmail}`"
                  :aria-label="`Escribir a ${detail.customerEmail}`"
                  >{{ detail.customerEmail }}</a
                >
              </dd>
            </div>
          </dl>
          <div v-if="detail.homeService" class="appointment-detail-page__block">
            <p class="appointment-detail-page__block-label">A domicilio</p>
            <p class="appointment-detail-page__block-value">{{ detail.homeService.address }}</p>
            <a
              v-if="homeServiceMapsUrl"
              class="appointment-detail-page__contact"
              :href="homeServiceMapsUrl"
              target="_blank"
              rel="noopener noreferrer"
              >Abrir en Google Maps (nueva pestaña)</a
            >
          </div>
          <div v-if="detail.customerNote" class="appointment-detail-page__block">
            <p class="appointment-detail-page__block-label">Nota del cliente</p>
            <p class="appointment-detail-page__block-value">{{ detail.customerNote }}</p>
          </div>
        </AppointmentTicket>

        <section
          class="appointment-detail-page__history"
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
            <DiamondLoader layout="inline" label="Cargando historial…" />
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

            <ol
              v-else
              class="appointment-detail-page__history-list"
              :class="{
                'appointment-detail-page__history-list--railed': historyEnd,
                'appointment-detail-page__history-list--upcoming': historyEnd?.kind === 'upcoming',
              }"
              aria-label="Eventos del turno"
            >
              <li
                v-for="entry in historyItems"
                :key="entry.id"
                class="appointment-detail-page__history-item"
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
                    {{
                      historyChangeValue(
                        change.fieldName,
                        change.previousValue,
                        v,
                        businessTimezone,
                      )
                    }}
                    →
                    {{ historyChangeValue(change.fieldName, change.newValue, v, businessTimezone) }}
                  </li>
                </ul>
              </li>
              <li
                v-if="historyEnd && historyEnd.kind !== 'close'"
                class="appointment-detail-page__history-item appointment-detail-page__history-end"
                :class="`appointment-detail-page__history-end--${historyEnd.kind}`"
              >
                <span
                  class="appointment-detail-page__history-icon"
                  aria-hidden="true"
                  v-html="factIcon('calendar')"
                />
                <div class="appointment-detail-page__history-main">
                  <span class="appointment-detail-page__history-event">{{ historyEnd.title }}</span>
                  <span class="appointment-detail-page__history-meta">{{ historyEnd.meta }}</span>
                </div>
              </li>
              <li
                v-else-if="historyEnd"
                class="appointment-detail-page__history-item appointment-detail-page__history-end appointment-detail-page__history-end--close"
                aria-hidden="true"
              >
                <span class="appointment-detail-page__history-icon" />
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
          id="reschedule-form"
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

          <div
            v-if="rescheduleNow"
            class="appointment-detail-page__reschedule-ticket"
            aria-live="polite"
          >
            <p class="appointment-detail-page__reschedule-line">
              <span class="appointment-detail-page__reschedule-label">Ahora</span>
              <span class="appointment-detail-page__reschedule-line-clock"
                >{{ rescheduleNow.clock
                }}<small v-if="rescheduleNow.suffix">&nbsp;{{ rescheduleNow.suffix }}</small></span
              >
              <span class="appointment-detail-page__reschedule-line-meta"
                >{{ rescheduleNow.short }} · hasta {{ rescheduleNow.until
                }}<template v-if="businessTimezone">
                  · {{ timezoneLabel(businessTimezone) }}</template
                ></span
              >
            </p>
            <p class="appointment-detail-page__reschedule-side">
              <span class="appointment-detail-page__reschedule-label">Ahora</span>
              <span class="appointment-detail-page__reschedule-clock">
                {{ rescheduleNow.clock
                }}<small v-if="rescheduleNow.suffix">&nbsp;{{ rescheduleNow.suffix }}</small>
              </span>
              <span class="appointment-detail-page__reschedule-date">
                {{ rescheduleNow.date }}<br />hasta {{ rescheduleNow.until }}
              </span>
            </p>
            <span class="appointment-detail-page__reschedule-rule" aria-hidden="true" />
            <p
              class="appointment-detail-page__reschedule-side appointment-detail-page__reschedule-side--new"
              :class="{ 'appointment-detail-page__reschedule-side--empty': !rescheduleNew }"
            >
              <span class="appointment-detail-page__reschedule-label">Nueva hora</span>
              <span class="appointment-detail-page__reschedule-clock">
                <template v-if="rescheduleNew"
                  >{{ rescheduleNew.clock
                  }}<small v-if="rescheduleNew.suffix"
                    >&nbsp;{{ rescheduleNew.suffix }}</small
                  ></template
                >
                <template v-else>--:--</template>
              </span>
              <span class="appointment-detail-page__reschedule-date">
                <template v-if="rescheduleNew"
                  >{{ rescheduleNew.date }}<br />hasta {{ rescheduleNew.until }}</template
                >
                <template v-else>Elige una hora libre abajo</template>
              </span>
            </p>
            <p v-if="businessTimezone" class="appointment-detail-page__reschedule-zone">
              {{ timezoneLabel(businessTimezone) }}
            </p>
          </div>

          <ManualStartPicker
            v-if="detail"
            ref="reschedulePicker"
            v-model:date="rescheduleDate"
            v-model:time="rescheduleTime"
            :professional-id="detail.professionalId"
            :service-id="detail.serviceId"
            :timezone="businessTimezone"
            :exclude-appointment-id="detail.id"
            :current="detail.startsAt"
            :active="isRescheduleOpen"
            :error="rescheduleFieldError"
            :disabled="rescheduleStatus === 'saving'"
            id-prefix="reschedule"
            date-label="Nueva fecha"
            time-label="Nueva hora"
          />
        </form>

        <!-- El pie queda fijo bajo la rejilla, que se desplaza: la hora elegida
             y las acciones siempre a la vista (#776). -->
        <template #footer>
          <p class="appointment-detail-page__reschedule-foot">
            <span class="appointment-detail-page__reschedule-foot-label">Nueva hora</span>
            <span
              v-if="rescheduleNew"
              class="appointment-detail-page__reschedule-foot-value"
              data-testid="reschedule-foot-value"
              >{{ rescheduleNew.clock
              }}<small v-if="rescheduleNew.suffix">&nbsp;{{ rescheduleNew.suffix }}</small>
              <span class="appointment-detail-page__reschedule-foot-date">{{
                rescheduleFootDate
              }}</span></span
            >
            <span v-else class="appointment-detail-page__reschedule-foot-empty">Sin elegir</span>
          </p>
          <div class="appointment-detail-page__reschedule-foot-actions">
            <BaseButton type="button" variant="secondary" @click="isRescheduleOpen = false">
              Cancelar
            </BaseButton>
            <BaseButton
              type="submit"
              form="reschedule-form"
              variant="primary"
              :loading="rescheduleStatus === 'saving'"
              :disabled="rescheduleStatus === 'saving' || !rescheduleDate || !rescheduleTime"
            >
              Confirmar
            </BaseButton>
          </div>
        </template>
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
            <li v-if="closeMode === 'no-show' && noShowFreesRest">
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
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
              Desde este minuto, el resto de la franja queda libre para otro turno.
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
            registrado como <strong>{{ recordedStatusLabel }}</strong
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
/* Detalle de turno sobre la tinta del cascarón (DEC-146, issue #471): cabecera
   editorial con el monograma de la familia, la tarjeta de turno compartida
   (DEC-189, #757) con sus filas de puntos guía y la línea de tiempo con marcas de
   latón. El estado vive en el sello de la tarjeta. */
.appointment-detail-page {
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

  /* La carga se coloca igual que el detalle, para que llegue sin moverse (#758). */
  .appointment-detail-page:has(> .appointment-detail-page__loading)
    > .appointment-detail-page__back {
    margin-top: auto;
  }

  .appointment-detail-page > .appointment-detail-page__loading {
    margin-bottom: auto;
    padding-bottom: var(--space-6);
  }
}

/* La tarjeta conserva su proporción (hasta 640 px) y el historial toma el resto. */
.appointment-detail-page__body {
  display: grid;
  grid-template-columns: minmax(0, 640px) minmax(280px, 1fr);
  gap: var(--space-12);
  /* El historial toma el alto de la tarjeta (#758); la tarjeta conserva el suyo. */
  align-items: stretch;
}

.appointment-detail-page__back {
  margin: 0;
}

.appointment-detail-page__back a {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  text-decoration: underline;
  text-transform: none;
  color: var(--color-text-primary);
  border-radius: var(--radius-sm);
  text-decoration-color: var(--color-brand-accent-surface);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.appointment-detail-page__back a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.appointment-detail-page__back a:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.appointment-detail-page__state {
  padding: var(--space-6);
  color: var(--color-on-strong-soft);
}

/* Esqueleto del detalle (#741): mismas medidas que la cabecera, la ficha y el
   historial reales; el pulso es un indicador de carga (dura lo que la
   petición) y se apaga con movimiento reducido. */
.appointment-detail-page__loading {
  position: relative;
}

.appointment-detail-page__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.appointment-detail-page__skeleton-monogram {
  flex: 0 0 68px;
  width: 68px;
  height: 68px;
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 55%, transparent);
  border-radius: 4px;
}

.appointment-detail-page__skeleton-bar--button {
  width: 188px;
  height: 44px;
  border-radius: var(--radius-md);
}

.appointment-detail-page__skeleton-bar--button + .appointment-detail-page__skeleton-bar--button {
  width: 148px;
}

.appointment-detail-page__skeleton-bar--ruler {
  width: 86%;
  height: 34px;
  margin-block: var(--space-3) var(--space-1);
}

.appointment-detail-page__skeleton-bar--meta {
  width: 52%;
  height: 12px;
}

.appointment-detail-page__skeleton-events {
  display: flex;
  flex-direction: column;
}

.appointment-detail-page__skeleton-event {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 72px;
  padding: 2px 0 var(--space-6) var(--space-8);
  border-left: 1px solid color-mix(in srgb, var(--color-on-strong) 14%, transparent);
}

.appointment-detail-page__skeleton-event:last-child {
  border-left-color: transparent;
}

.appointment-detail-page__skeleton-diamond {
  position: absolute;
  top: 3px;
  left: -9px;
  width: 17px;
  height: 17px;
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 55%, transparent);
  border-radius: 2px;
  transform: rotate(45deg);
}

.appointment-detail-page__skeleton-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-self: start;
  width: 100%;
  max-width: 640px;
  padding: 18px 22px;
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 55%, transparent);
  border-radius: 4px;
}

.appointment-detail-page__skeleton-perforation {
  display: block;
  margin-inline: -22px;
  border-top: 1px dashed color-mix(in srgb, var(--color-brass-line) 55%, transparent);
}

.appointment-detail-page__skeleton-when {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.appointment-detail-page__skeleton-leaf {
  flex: none;
  width: 64px;
  height: 64px;
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 55%, transparent);
  border-radius: 3px;
}

.appointment-detail-page__skeleton-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.appointment-detail-page__skeleton-dots {
  flex: 1;
  height: 2px;
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--color-brass-line) 45%, transparent) 1px,
    transparent 1.3px
  );
  background-size: 6px 2px;
}

.appointment-detail-page__skeleton-bar {
  display: block;
  height: 14px;
  background-color: color-mix(in srgb, var(--color-on-strong) 14%, transparent);
  border-radius: var(--radius-sm);
  animation: appointment-detail-skeleton-pulse 1400ms ease-in-out infinite;
}

.appointment-detail-page__skeleton-bar--kicker {
  width: 38%;
}

.appointment-detail-page__skeleton-bar--title {
  width: 64%;
  height: 28px;
}

.appointment-detail-page__skeleton-bar--service {
  width: 48%;
  height: 24px;
}

.appointment-detail-page__skeleton-bar--time {
  width: 42%;
  height: 34px;
}

.appointment-detail-page__skeleton-bar--label {
  flex: none;
  width: 24%;
  height: 12px;
}

.appointment-detail-page__skeleton-bar--value {
  flex: none;
  width: 30%;
}

.appointment-detail-page__skeleton-bar--section {
  width: 32%;
  height: 22px;
}

.appointment-detail-page__skeleton-bar--history {
  width: 86%;
}

@keyframes appointment-detail-skeleton-pulse {
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .appointment-detail-page__skeleton-bar {
    animation: none;
  }
}

:root[data-motion='reduced'] .appointment-detail-page__skeleton-bar {
  animation: none;
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
  border: 1px solid var(--color-border-control);
  transform: rotate(45deg);
  border-radius: 1px;
}

/* ── Cabecera ───────────────────────────────────────────────────────────── */

.appointment-detail-page__hero {
  display: flex;
  gap: var(--space-5);
  align-items: center;
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--rule);
}

/* Monograma de la familia (#757): el retrato de latón compartido
   (BrassMonogram, #799) con las iniciales en serif y el rombo asomando bajo el
   borde, recortado contra el lienzo. */
.appointment-detail-page__avatar {
  --monogram-size: 68px;
  --monogram-glyph-size: 30px;
  --monogram-pendant: 9px;
  --monogram-cutout: var(--color-canvas);
  --monogram-radius: 4px;
}

.appointment-detail-page__identity {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.appointment-detail-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-title-page);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.005em;
  overflow-wrap: anywhere;
  color: var(--color-on-strong);
}

/* El estado se ve en el sello de la tarjeta (#757); aquí queda para el lector
   de pantalla, que lo anuncia junto al nombre. */
.appointment-detail-page__status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* Cancelado: el nombre tachado, como en la agenda del día. */
.appointment-detail-page--cancelled .appointment-detail-page__title {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
  text-decoration-color: var(--color-appt-cancelled);
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
  border-radius: var(--radius-lg);
}

.appointment-detail-page .appointment-detail-page__complete:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 88%, #fff);
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 88%, #fff);
}

.appointment-detail-page .appointment-detail-page__reschedule,
.appointment-detail-page .appointment-detail-page__no-show,
.appointment-detail-page .appointment-detail-page__correct {
  color: var(--color-text-primary);
  background-color: transparent;
  border-color: var(--color-border-control);
  border-bottom-color: var(--color-border-control);
  border-radius: var(--radius-lg);
}

.appointment-detail-page .appointment-detail-page__reschedule:hover:not(:disabled),
.appointment-detail-page .appointment-detail-page__no-show:hover:not(:disabled),
.appointment-detail-page .appointment-detail-page__correct:hover:not(:disabled) {
  background-color: var(--color-surface-muted);
  border-color: var(--color-text-primary);
  border-bottom-color: var(--color-text-primary);
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

/* ── Tarjeta del turno (#757) ──────────────────────────────────────────── */

/* La tarjeta de turno compartida (DEC-189) sobre el lienzo del panel. Las muescas
   del troquel se calan con el color de lo que hay detrás. */
.appointment-detail-page__ticket {
  --ticket-backdrop: var(--color-canvas);

  align-self: start;
  width: 100%;
  max-width: 640px;
}

/* Los datos de la persona y del contacto, con puntos guía como la carta y los
   correos (#747, #755): etiqueta, puntos de latón y valor. */
.appointment-detail-page__leaders {
  display: grid;
  padding: var(--space-3) 22px var(--space-2);
  margin: 0;
  border-top: 1px dashed var(--color-brass-line);
}

.appointment-detail-page__leader {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 0;
}

.appointment-detail-page__leader dt {
  flex: none;
  max-width: 55%;
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

.appointment-detail-page__leader::after {
  order: 1;
  flex: 1 1 24px;
  min-width: 24px;
  height: 2px;
  content: '';
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--color-brass-line) 80%, transparent) 1px,
    transparent 1.3px
  );
  background-repeat: repeat-x;
  background-size: 6px 2px;
  transform: translateY(-3px);
}

.appointment-detail-page__leader dd {
  order: 2;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  text-align: right;
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  color: var(--color-text-primary);
}

/* Lo largo (dirección, nota) va debajo de su etiqueta, sin puntos guía. */
.appointment-detail-page__block {
  display: grid;
  gap: 2px;
  padding: var(--space-2) 22px var(--space-3);
}

.appointment-detail-page__block p {
  margin: 0;
}

.appointment-detail-page__block-label {
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

.appointment-detail-page__block-value {
  font-size: 15px;
  line-height: 22px;
  overflow-wrap: anywhere;
  color: var(--color-text-primary);
}

/* Llamar, escribir y abrir el mapa: el subrayado de latón del enlace de la familia. */
.appointment-detail-page__contact {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--color-brass-line);
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
  border-radius: 2px;
}

/* El teléfono va partido en bandera, prefijo y número (PhoneDisplay, inline-flex):
   la decoración del enlace no atraviesa una caja atómica, así que la línea de
   latón la dibuja el propio número. */
.appointment-detail-page__contact :deep(.phone-display__number) {
  text-decoration: underline;
  text-decoration-color: var(--color-brass-line);
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}

.appointment-detail-page__contact:hover :deep(.phone-display__number) {
  text-decoration-color: var(--color-brass-body);
  text-decoration-thickness: 2px;
}

.appointment-detail-page__contact:hover {
  text-decoration-color: var(--color-brass-body);
  text-decoration-thickness: 2px;
}

/* El doble anillo de los botones de la familia, con el papel de la tarjeta por
   dentro (#758). */
.appointment-detail-page__contact:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .appointment-detail-page__contact {
    transition: text-decoration-color 160ms ease;
  }
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
  font-weight: 400;
  line-height: 1.1;
  color: var(--color-on-strong);
}

.appointment-detail-page__history-list {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* El riel termina en el hito del turno o en el rombo de cierre (#758). Antes se
   estiraba hasta el final de la columna, a la altura de la tarjeta, y a 1440×900
   dejaba «Próximo» bajo el pliegue y detrás del dock (#799); ahora el tramo
   hacia un turno que aún no ocurre se alarga una medida fija, punteado en
   latón: es tiempo por venir, sin empujar el hito fuera de la vista. */
.appointment-detail-page__history-list--upcoming
  > .appointment-detail-page__history-item:nth-last-child(2) {
  border-left-style: dashed;
  border-left-color: var(--color-brass-line);
}

/* Solo a dos columnas: apilado, el historial ya va bajo la tarjeta y alargar
   el tramo solo alejaría más el hito. */
@media (min-width: 1024px) {
  .appointment-detail-page__history-list--upcoming
    > .appointment-detail-page__history-item:nth-last-child(2) {
    min-height: 112px;
  }
}

.appointment-detail-page__history-end {
  min-height: 0;
}

.appointment-detail-page__history-end .appointment-detail-page__history-event {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 400;
  line-height: 1.1;
}

.appointment-detail-page__history-end .appointment-detail-page__history-meta {
  color: var(--color-brass-text);
}

.appointment-detail-page__history-end--upcoming .appointment-detail-page__history-icon,
.appointment-detail-page__history-end--now .appointment-detail-page__history-icon {
  color: var(--color-brass-text);
  border-color: var(--color-brass-line);
}

.appointment-detail-page__history-end--upcoming .appointment-detail-page__history-icon {
  border-style: dashed;
}

.appointment-detail-page__history-end--close {
  height: 10px;
  padding: 0;
}

.appointment-detail-page__history-end--close .appointment-detail-page__history-icon {
  top: 0;
  left: -5px;
  width: 9px;
  height: 9px;
  background-color: var(--color-brass-line);
  border: 0;
  border-radius: 1px;
}

.appointment-detail-page__history-item {
  position: relative;
  min-height: 72px;
  padding: 0 0 var(--space-6) var(--space-8);
  border-left: 1px solid var(--color-border-subtle);
}

.appointment-detail-page__history-item:last-child {
  padding-bottom: 0;
  border-left-color: transparent;
}

/* Marca del evento: rombo de filete (#737); la más reciente va llena. */
.appointment-detail-page__history-icon {
  position: absolute;
  top: 3px;
  left: -12px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: 0;
  color: var(--color-text-secondary);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-control);
  border-radius: 3px;
  rotate: 45deg;
}

.appointment-detail-page__history-icon :deep(svg) {
  width: 15px;
  height: 15px;
  rotate: -45deg;
}

.appointment-detail-page__history-item:first-child .appointment-detail-page__history-icon {
  color: var(--color-brand-accent-text);
  background-color: var(--color-text-primary);
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

/* Cada cambio lleva el rombo de latón de la familia, no la viñeta ○ que el
   navegador pone a una lista anidada (#757). */
.appointment-detail-page__history-changes {
  padding: 0;
  margin: var(--space-2) 0 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong-soft);
  list-style: none;
}

.appointment-detail-page__history-changes li {
  position: relative;
  padding-left: 16px;
}

.appointment-detail-page__history-changes li::before {
  position: absolute;
  top: 0.62em;
  left: 2px;
  width: 6px;
  height: 6px;
  content: '';
  background: var(--color-brass-line);
  transform: rotate(45deg);
}

.appointment-detail-page__dialog-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-text-secondary);
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
  border-radius: var(--radius-md);
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
  background-color: var(--color-surface) !important;
  border: 1px solid var(--color-field-strong-border) !important;
  border-top: 1px solid var(--color-border-subtle) !important;
  box-shadow: 0 28px 60px -24px rgb(0 0 0 / 55%) !important;
  border-radius: 12px !important;
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

/* Letra y tamaño, los de BaseDialog: serif de la familia (#791). */
:global(.appointment-detail-page__ink-dialog .base-dialog__title) {
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

/* Boleto de «Reprogramar» (#776): papel con filete de latón, «Ahora» a la
   izquierda en tono menor y la nueva hora protagonista en serif, separadas por
   un filete con el rombo. Mismo lenguaje que el resumen de «Nuevo turno». */
.appointment-detail-page__reschedule-ticket {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 4px 20px;
  align-items: start;
  padding: 16px 18px 14px;
  background-color: color-mix(in srgb, var(--color-brass-line) 6%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 45%, transparent);
  border-radius: 4px;
}

.appointment-detail-page__reschedule-side {
  display: grid;
  gap: 4px;
  min-width: 0;
  margin: 0;
}

.appointment-detail-page__reschedule-label {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.appointment-detail-page__reschedule-side--new .appointment-detail-page__reschedule-label {
  color: var(--color-brass-text);
}

.appointment-detail-page__reschedule-clock {
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 400;
  line-height: 1.05;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.appointment-detail-page__reschedule-side--new .appointment-detail-page__reschedule-clock {
  font-size: 40px;
  color: var(--color-text-primary);
}

.appointment-detail-page__reschedule-side--empty .appointment-detail-page__reschedule-clock {
  color: var(--color-text-secondary);
}

.appointment-detail-page__reschedule-clock small {
  font-size: 0.45em;
  letter-spacing: 0;
}

.appointment-detail-page__reschedule-date {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.appointment-detail-page__reschedule-date::first-letter {
  text-transform: uppercase;
}

/* El filete vertical con el rombo de latón en medio. */
.appointment-detail-page__reschedule-rule {
  position: relative;
  align-self: stretch;
  width: 1px;
  background-color: color-mix(in srgb, var(--color-brass-line) 55%, transparent);
}

.appointment-detail-page__reschedule-rule::after {
  position: absolute;
  top: calc(50% - 5px);
  left: -4.5px;
  width: 10px;
  height: 10px;
  content: '';
  background-color: var(--color-surface);
  border: 1.5px solid var(--color-brass-line);
  rotate: 45deg;
}

.appointment-detail-page__reschedule-zone {
  grid-column: 1 / -1;
  margin: 8px 0 0;
  padding-top: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
  border-top: 1px dashed color-mix(in srgb, var(--color-brass-line) 40%, transparent);
}

/* La línea compacta de «Ahora» solo existe en móvil. */
.appointment-detail-page__reschedule-line {
  display: none;
}

/* En móvil el boleto se reduce a «Ahora» en una línea: el pie fijo ya repite la
   nueva hora, y la primera fila de horas queda a la vista sin desplazar. */
@media (max-width: 520px) {
  .appointment-detail-page__reschedule-ticket {
    display: block;
    padding: 10px 14px;
  }

  .appointment-detail-page__reschedule-ticket > :not(.appointment-detail-page__reschedule-line) {
    display: none;
  }

  .appointment-detail-page__reschedule-line {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    align-items: baseline;
    margin: 0;
  }

  .appointment-detail-page__reschedule-line-clock {
    font-family: var(--font-display);
    font-size: 22px;
    line-height: 1.1;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .appointment-detail-page__reschedule-line-clock small {
    font-size: 0.5em;
  }

  .appointment-detail-page__reschedule-line-meta {
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 18px;
    color: var(--color-text-secondary);
  }

  .appointment-detail-page__reschedule-line-meta::first-letter {
    text-transform: uppercase;
  }
}

/* Pie fijo de «Reprogramar» (#776): la nueva hora repetida en serif junto a las
   acciones, para no subir a revisar lo elegido. */
.appointment-detail-page__reschedule-foot {
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
  min-width: 0;
  margin: 0;
}

.appointment-detail-page__reschedule-foot-label {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-brass-text);
}

.appointment-detail-page__reschedule-foot-value {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
  line-height: 1.1;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.appointment-detail-page__reschedule-foot-value small {
  font-size: 0.5em;
}

.appointment-detail-page__reschedule-foot-date {
  margin-left: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-text-secondary);
}

.appointment-detail-page__reschedule-foot-empty {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 24px;
  color: var(--color-text-secondary);
}

.appointment-detail-page__reschedule-foot-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-3);
}

:global(.appointment-detail-page__ink-dialog .base-dialog__footer) {
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-field-strong-border) !important;
}

@media (max-width: 520px) {
  :global(.appointment-detail-page__ink-dialog .base-dialog__footer) {
    padding: var(--space-3) var(--space-4);
  }

  .appointment-detail-page__reschedule-foot-actions {
    flex: 1 1 100%;
  }

  .appointment-detail-page__reschedule-foot-actions > * {
    flex: 1 1 0;
  }
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

:root[data-app-theme='ivory'] .appointment-detail-page__ink-form :deep(.base-input) {
  color-scheme: light;
}

.appointment-detail-page__ink-form :deep(.base-input__label),
.appointment-detail-page__ink-form :deep(.base-input__required) {
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0;
  text-transform: none;
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
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-text-secondary);
  line-height: 16px;
}

.appointment-detail-page__cancel-name {
  font-family: var(--font-sans);
  font-size: 28px;
  line-height: 1.15;
  color: var(--color-on-strong);
  overflow-wrap: anywhere;
  font-weight: 600;
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
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-text-secondary);
  line-height: 16px;
}

.appointment-detail-page__cancel-time {
  font-family: var(--font-sans);
  font-size: var(--font-size-title-item);
  line-height: 1.2;
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
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
  animation: nava-wipe 180ms var(--motion-ease-out) backwards;
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
  color: var(--color-text-secondary);
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
  color: var(--color-text-primary);
  border-color: var(--color-border-control);
  border-bottom-color: var(--color-border-control);
}

.appointment-detail-page__ink-form
  :deep(.base-button--secondary:hover:not(:disabled):not(.base-button--loading)) {
  background-color: var(--color-surface-muted);
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
    --monogram-size: 56px;
    --monogram-glyph-size: 25px;
  }

  /* La serif necesita ~20 % más que la sans de antes para leerse igual (#726). */
  .appointment-detail-page__title {
    font-size: 30px;
    line-height: 1.05;
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

  .appointment-detail-page__skeleton {
    gap: var(--space-4);
  }

  .appointment-detail-page__skeleton-monogram {
    flex-basis: 56px;
    width: 56px;
    height: 56px;
  }

  .appointment-detail-page__skeleton-bar--button,
  .appointment-detail-page__skeleton-bar--button + .appointment-detail-page__skeleton-bar--button {
    width: 100%;
  }

  .appointment-detail-page__history {
    padding: var(--space-5) 0 0;
    border-top: 1px solid var(--rule);
    border-left: 0;
  }

  .appointment-detail-page__history-title {
    font-size: var(--font-size-title-item);
  }

  :global(.appointment-detail-page__ink-dialog .base-dialog__header) {
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  :global(.appointment-detail-page__ink-dialog .base-dialog__content) {
    padding: var(--space-4);
  }

  /* Dos botones del mismo ancho cuando caben; si no, uno bajo el otro. Con una
     rejilla 1fr 1fr, «Confirmar corrección» no se parte y, a 320 px o con la barra
     de desplazamiento que trae una alerta, empujaba «Volver» fuera del diálogo (#862). */
  .appointment-detail-page__dialog-actions > * {
    flex: 1 1 0;
    min-width: max-content;
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
}

@media (prefers-reduced-motion: reduce) {
  .appointment-detail-page__cancel-time-text::after {
    animation: none;
  }
}

:root[data-motion='reduced'] .appointment-detail-page__cancel-time-text::after {
  animation: none;
}
/* ── Llegada (#758) ─────────────────────────────────────────────────────────
   Una vez, cuando la tarjeta recibe sus datos (~900 ms, solo transform y
   opacity): la cabecera se asienta (0–320), la tarjeta sube (60–520), el rombo
   de la regla corre desde el borde hasta la hora (300–820), el sello aterriza
   (380–760) y las filas de puntos guía y los eventos del historial entran
   escalonados (440–920). Con movimiento reducido no existe: el primer cuadro ya
   es el final. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__hero {
    animation: detail-arrive-rise 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__ticket {
    animation: detail-arrive-ticket 460ms 60ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    :deep(.appointment-ticket__seal) {
    animation: detail-arrive-stamp 380ms 380ms cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    :deep(.day-ruler__mark--mine) {
    animation: detail-arrive-slide 520ms 300ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__leader,
  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__block {
    animation: detail-arrive-rise 300ms 440ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__leader:nth-child(2) {
    animation-delay: 500ms;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__leader:nth-child(3) {
    animation-delay: 560ms;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__leader:nth-child(4),
  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__block {
    animation-delay: 620ms;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__history-item {
    animation: detail-arrive-step 320ms 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__history-item:nth-child(2) {
    animation-delay: 560ms;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__history-item:nth-child(3) {
    animation-delay: 640ms;
  }

  :root:not([data-motion='reduced'])
    .appointment-detail-page--arrive
    .appointment-detail-page__history-item:nth-child(n + 4) {
    animation-delay: 600ms;
  }
}

@keyframes detail-arrive-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes detail-arrive-ticket {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}

@keyframes detail-arrive-step {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
}

/* `scale` y `rotate` sueltos se suman al giro propio del sello sin pisarlo;
   `translate` fija su borde (--ticket-seal-anchor) mientras crece, para que
   caiga hacia dentro de la tarjeta sin desbordar (#780). */
@keyframes detail-arrive-stamp {
  from {
    opacity: 0;
    scale: 1.6;
    rotate: -6deg;
    translate: calc(var(--ticket-seal-anchor, -1) * 30%) 0;
  }

  60% {
    opacity: 1;
    scale: 0.94;
    translate: calc(var(--ticket-seal-anchor, -1) * -3%) 0;
  }
}

/* `translate` suelto se suma al centrado y al giro del rombo. */
@keyframes detail-arrive-slide {
  from {
    opacity: 0;
    translate: var(--arrive-mark-from, 0) 0;
  }

  25% {
    opacity: 1;
  }
}
</style>
