<script setup lang="ts">
// Página coordinadora de la lectura del turno del cliente por token
// (HU-098, CA-098-01 a CA-098-06). Sin mockup asignado: identidad guiada
// dentro de NAVA / Tailored Grid (DEC-078). Posee estado y reintento; no
// conoce la forma RFC 9457 del contrato (eso queda dentro de
// `api/getCustomerAppointmentApi.ts`). Cancelar el turno es HU-099 (T5). Fuera de
// alcance a propósito: cuenta, portal, edición y reprogramación.
//
// v2 «La luz del día» (DEC-188, 2c): es la continuación de la reserva, así que usa
// su marco (el negocio arriba, NAVA firma al pie), sus pantallas de estado y el
// mismo pase de la cita que el cliente vio al confirmar. La cuenta regresiva y el
// progreso solo leen `startsAt`/`endsAt`; no deciden nada de la política.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppointmentTicket, BaseAlert, type AppointmentTicketState } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import {
  BookingStateScreen,
  PublicFrame,
  buildCalendarFile,
  downloadCalendarFile,
} from '@/modules/public-booking'
import { getCustomerAppointment } from '../api/getCustomerAppointmentApi'
import { createReview } from '../api/createReviewApi'
import AppointmentCancellation from '../components/AppointmentCancellation.vue'
import AppointmentReview from '../components/AppointmentReview.vue'
import { useAppointmentCancel } from '../composables/useAppointmentCancel'
import { appointmentPhase, countdownLabel } from '../model/appointmentMoment'
import { timezoneLabel } from '@/shared/time/timezoneName'
import { minutesInWords } from '@/shared/time/durationWords'
import { getCivilDateInTimezone, minutesSinceCivilMidnight } from '@/shared/time/civilDate'
import { ticketMoment } from '@/shared/time/ticketMoment'
import {
  appointmentStatusLabel,
  type CancelAppointmentInput,
  type CustomerAppointment,
  type ReviewInput,
} from '../model/customerAppointmentOutcome'
import { rescheduleAvailability } from '../model/rescheduleAvailability'
import '../styles/myTurnV2.css'

interface Props {
  /** Credencial en claro del enlace, tal como llega del parámetro de ruta
   * `:token` (app/router, `props: true`). No confiada: el servidor la
   * hashea y la vuelve a resolver desde cero (CA-098-02); nunca se registra
   * ni se persiste en este componente más allá de reenviarla al API. */
  token: string
  /** `cancel` (HU-106, `?accion=cancelar`): llegó desde el enlace de Odin para cancelar, así
   * que al cargar el turno la cancelación recibe el foco y queda a la vista. */
  focus?: 'cancel'
}
const props = defineProps<Props>()

type ScreenState =
  | { status: 'loading' }
  | { status: 'success'; appointment: CustomerAppointment }
  | { status: 'not-found' }
  | { status: 'network-error' }
  | { status: 'unexpected-error'; requestId?: string }

const screenState = ref<ScreenState>({ status: 'loading' })
// Reloj del dispositivo al cargar: solo alimenta la pista local de la política de
// cancelación; la decisión real es del servidor (HU-099).
const nowMs = ref(Date.now())

// Solo vale la respuesta de la última carga: si el token cambia con la pantalla montada
// (F-RQ-CU-01, #442), la de un token anterior no pinta su turno bajo la URL del nuevo.
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  screenState.value = { status: 'loading' }
  const outcome = await getCustomerAppointment(props.token)
  if (seq !== loadSeq) return
  nowMs.value = Date.now()
  switch (outcome.kind) {
    case 'success':
      screenState.value = { status: 'success', appointment: outcome.appointment }
      return
    case 'not-found':
      screenState.value = { status: 'not-found' }
      return
    case 'network-error':
      screenState.value = { status: 'network-error' }
      return
    case 'unexpected-error':
      screenState.value = { status: 'unexpected-error', requestId: outcome.requestId }
  }
}

// Reloj de presentación: mueve la cuenta regresiva y el progreso del turno en curso.
// Va aparte de `nowMs` para no cambiar la pista de cancelación mientras se lee.
const clockMs = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void load()
  clockTimer = setInterval(() => {
    clockMs.value = Date.now()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

// Con `focus="cancel"` (el «Cancelar» del correo) la cancelación llega ya abierta y su
// bloque sube a la vista; el foco va a su título. No va al motivo: en un celular el teclado
// taparía la consecuencia («No se puede deshacer…»), que es lo primero que hay que leer
// (mismo criterio que AppointmentCancellation con `startOpen`). Una sola vez por carga.
const cancelSlot = ref<HTMLElement | null>(null)
let cancelFocused = false
watch(
  () => screenState.value.status,
  async (status) => {
    if (status !== 'success' || props.focus !== 'cancel' || cancelFocused) return
    await nextTick()
    const section = cancelSlot.value?.querySelector<HTMLElement>('section')
    const title = section?.querySelector<HTMLElement>('h2')
    if (!section || !title) return
    cancelFocused = true
    title.tabIndex = -1
    title.focus({ preventScroll: true })
    const reduced =
      document.documentElement.dataset.motion === 'reduced' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    section.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
  },
)
// El componente se reutiliza al cambiar de token dentro de la SPA: sin esto no recargaba.
watch(() => props.token, load)

// Entrada a «Cambiar la hora» (HU-104): solo se ofrece cuando la pista local dice
// que procede; la pantalla dedicada y el servidor vuelven a decidir. Enlace simple,
// sin RouterLink, por el mismo motivo que el pie: la página se prueba sin router.
const reschedule = computed(() => {
  if (screenState.value.status !== 'success') return null
  const availability = rescheduleAvailability(screenState.value.appointment, nowMs.value)
  if (availability.mode !== 'available') return null
  return {
    href: `/mi-turno/${encodeURIComponent(props.token)}/reprogramar`,
    remaining:
      availability.remaining === 1
        ? 'Te queda 1 cambio de hora'
        : `Puedes cambiarla hasta ${availability.remaining} veces`,
  }
})

// Reseña del turno (HU-100, DEC-128): la página posee el envío; el componente solo
// presenta el formulario. Un `409` significa que el turno ya no admite reseña (la
// calificó otra pestaña, o cambió de estado): se recarga para mostrar lo vigente.
const reviewSubmitting = ref(false)
const reviewError = ref('')

async function submitReview(input: ReviewInput) {
  if (screenState.value.status !== 'success' || reviewSubmitting.value) return
  reviewSubmitting.value = true
  reviewError.value = ''
  const outcome = await createReview(props.token, input)
  reviewSubmitting.value = false

  switch (outcome.kind) {
    case 'success':
      screenState.value = {
        status: 'success',
        appointment: { ...screenState.value.appointment, canReview: false, review: outcome.review },
      }
      return
    case 'not-reviewable':
    case 'not-found':
      reviewError.value = 'Este turno ya no admite una reseña.'
      await load()
      return
    case 'validation-error':
      reviewError.value = 'Revisa la calificación y el comentario e inténtalo de nuevo.'
      return
    case 'network-error':
      reviewError.value = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
      return
    case 'unexpected-error':
      reviewError.value = outcome.requestId
        ? `No pudimos guardar tu reseña. Si continúa, comparte este código con soporte: ${outcome.requestId}.`
        : 'No pudimos guardar tu reseña. Inténtalo de nuevo en unos segundos.'
  }
}

// Cancelación del turno (HU-099, T5): el envío y la clave de idempotencia viven en
// `useAppointmentCancel`, compartido con el paso 03 del acceso con código (#647).
const justCancelled = ref(false)
const cancelledNotice = ref<HTMLElement | null>(null)
const {
  submitting: cancelSubmitting,
  error: cancelError,
  rejection: cancelRejection,
  notice: cancelNotice,
  submit: sendCancel,
} = useAppointmentCancel(() => props.token, {
  async onCancelled(appointment) {
    justCancelled.value = true
    screenState.value = { status: 'success', appointment }
    await nextTick()
    cancelledNotice.value?.focus()
  },
  onChanged: load,
  onNotFound() {
    screenState.value = { status: 'not-found' }
  },
})

function submitCancel(input: CancelAppointmentInput) {
  if (screenState.value.status !== 'success') return
  void sendCancel(screenState.value.appointment, input)
}

const retry = () => {
  void load()
}

// Vocabulario del negocio del turno (DEC-119): hasta que el servidor responde, o si
// no responde, valen los valores iniciales.
const v = computed(() =>
  buildVocabularyFromTerms(
    screenState.value.status === 'success' ? screenState.value.appointment.vocabulary : null,
  ),
)

// DEC-136: el enlace sigue vivo tras cancelar y muestra el turno cancelado, sin
// política de cancelación ni acciones.
const isCancelled = computed(
  () =>
    screenState.value.status === 'success' &&
    screenState.value.appointment.status.startsWith('cancelled'),
)

const statusLabel = computed(() =>
  screenState.value.status === 'success'
    ? appointmentStatusLabel(screenState.value.appointment.status, v.value)
    : '',
)

// CA-098-04: hora y política se muestran en la zona del negocio, nunca
// en la del dispositivo (mismo criterio que formatInstantInTimezone en
// public-booking/pages/PublicBusinessEntryPage.vue).
const moment = computed(() => {
  if (screenState.value.status !== 'success') return null
  const { appointment: a } = screenState.value
  const phase = appointmentPhase(a.startsAt, a.endsAt, clockMs.value)
  return {
    zone: timezoneLabel(a.timezone),
    phase,
    countdown: countdownLabel(a.startsAt, a.endsAt, a.timezone, clockMs.value),
  }
})

// La tarjeta de turno (DEC-189): la misma de la confirmación, quieta. El sello
// dice el estado en corto; la línea de encima, la cuenta o el estado completo.
const TICKET_STATE: Record<string, AppointmentTicketState> = {
  confirmed: 'confirmed',
  completed: 'completed',
  no_show: 'no-show',
  cancelled_by_customer: 'cancelled',
  cancelled_by_professional: 'cancelled',
}
const ticket = computed(() => {
  if (screenState.value.status !== 'success' || !moment.value) return null
  const { appointment: a } = screenState.value
  const m = ticketMoment(a.startsAt, a.endsAt, a.timezone)
  // Sin horario del local en esta respuesta, la regla muestra el día con su
  // contexto (ticketMoment); en curso, el Sol marca «ahora».
  const now =
    isConfirmed.value && moment.value.phase === 'in-progress'
      ? minutesSinceCivilMidnight(
          new Date(clockMs.value).toISOString(),
          getCivilDateInTimezone(a.timezone, new Date(a.startsAt)),
          a.timezone,
        )
      : null
  return {
    state: TICKET_STATE[a.status] ?? 'confirmed',
    weekday: m.weekday,
    month: m.month,
    day: m.day,
    time: m.time,
    timeNote: `hasta ${m.endTime} · ${moment.value.zone}`,
    meta: `${a.durationMinutes} min`,
    ruler: {
      from: m.from,
      to: m.to,
      at: m.at,
      now,
      label: `Tu turno en el día: ${m.weekday.toLocaleLowerCase('es-CO')} ${m.day}, de ${m.time} a ${m.endTime}.`,
    },
  }
})

const isConfirmed = computed(
  () =>
    screenState.value.status === 'success' && screenState.value.appointment.status === 'confirmed',
)

// cancellationPolicyLabel resume la política VIGENTE (HU-093) sin afirmar
// una acción que HU-098 no ofrece todavía (la cancelación es HU-099):
// nunca implica que la falta de respuesta cancele el turno (RN-CNF-02).
const cancellationPolicyLabel = computed(() => {
  if (screenState.value.status !== 'success') return ''
  const { appointment } = screenState.value
  if (!appointment.lateCancellationClientAllowed) {
    return `Puedes cancelar sin costo hasta ${minutesInWords(appointment.cancellationDeadlineMinutes)} antes de tu turno. Pasado ese plazo, contacta directamente ${v.value.toTheBusiness}.`
  }
  const reasonNote = appointment.lateCancellationReasonRequired ? ' indicando el motivo' : ''
  return `Puedes cancelar hasta ${minutesInWords(appointment.cancellationDeadlineMinutes)} antes sin costo, o después${reasonNote} conforme a la política ${v.value.ofTheBusiness}.`
})

// Enlace que no abre: no se distingue vencido, usado o incompleto (CA-098-02).
const NOT_FOUND = {
  headline: 'No pudimos abrir ese enlace',
  body: 'Puede haber vencido o estar incompleto. Ábrelo de nuevo desde el correo de tu reserva.',
}

const requestId = computed(() =>
  screenState.value.status === 'unexpected-error' ? screenState.value.requestId : undefined,
)

// «Añadir a mi calendario» (DEC-188): el mismo .ics que en la confirmación, hecho en el
// navegador y sin la credencial del enlace (DEC-089). Solo para un turno que aún viene.
const calendarSaved = ref(false)
function addToCalendar() {
  if (screenState.value.status !== 'success') return
  const a = screenState.value.appointment
  downloadCalendarFile(
    buildCalendarFile({
      uid: `${a.startsAt}-${encodeURIComponent(a.serviceName)}@agenda.nava.wtf`,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      summary: `${a.serviceName}, ${a.businessName}`,
      location: null,
      description: `${a.serviceName} con ${a.professionalName}. El enlace para consultar o cambiar tu turno está en tu correo.`,
    }),
  )
  calendarSaved.value = true
}
</script>

<template>
  <PublicFrame
    :business-name="screenState.status === 'success' ? screenState.appointment.businessName : ''"
    caption="Tu turno"
  >
    <BookingStateScreen
      v-if="screenState.status !== 'success'"
      :status="screenState.status"
      title="Tu turno"
      loading-headline="Buscando tu turno…"
      :request-id="requestId"
      :not-found="NOT_FOUND"
      @retry="retry"
    />

    <main v-else class="bk-page mt">
      <!-- Encima de la tarjeta, una sola línea: la cuenta («En 2 días») o, si el
           turno ya no está confirmado, su estado completo. -->
      <p class="mt__meta" role="status">
        {{ isConfirmed && moment ? moment.countdown : statusLabel }}
      </p>
      <h1 class="bk-title mt__title">Tu turno</h1>
      <!-- La tarjeta de turno (DEC-189). La credencial del enlace nunca se dibuja (DEC-089). -->
      <AppointmentTicket
        v-if="ticket"
        class="mt__ticket"
        v-bind="ticket"
        :business-name="screenState.appointment.businessName"
        :service-name="screenState.appointment.serviceName"
        :professional-name="screenState.appointment.professionalName"
        :professional-label="v.Professional"
        label="Detalle del turno"
      >
        <p class="mt__attendee">
          <span class="mt__attendee-label">Persona atendida</span>
          {{ screenState.appointment.attendeeName }}
        </p>
      </AppointmentTicket>
      <div class="mt__notes">
        <BaseAlert v-if="cancelNotice" variant="warning" role="status">{{
          cancelNotice
        }}</BaseAlert>
        <div
          v-if="justCancelled"
          ref="cancelledNotice"
          class="customer-appointment__cancelled"
          tabindex="-1"
        >
          <BaseAlert variant="success" role="status">
            Cancelaste tu turno. El horario quedó libre.
          </BaseAlert>
        </div>
        <BaseAlert v-else-if="isCancelled" variant="neutral" role="status">
          Este turno está cancelado. El horario quedó libre.
        </BaseAlert>
      </div>

      <!-- Lo que se puede hacer con un turno que aún viene: la acción principal es
           la única con el acento lleno. -->
      <div v-if="isConfirmed && moment?.phase === 'upcoming' && !justCancelled" class="mt-actions">
        <template v-if="reschedule">
          <a
            class="bk-cta mt-actions__main customer-appointment__reschedule"
            :href="reschedule.href"
            aria-describedby="mt-change-hint"
            >Cambiar la hora</a
          >
          <p id="mt-change-hint" class="mt-actions__hint">{{ reschedule.remaining }}.</p>
        </template>
        <button type="button" class="mt-button" @click="addToCalendar">
          {{ calendarSaved ? 'Descargado: ábrelo para añadirlo' : 'Añadir a mi calendario' }}
        </button>
      </div>

      <div v-if="screenState.appointment.status === 'confirmed'" ref="cancelSlot" class="mt-block">
        <!-- La política solo orienta mientras el turno sigue confirmado. -->
        <p class="mt-block__policy" role="status">{{ cancellationPolicyLabel }}</p>
        <AppointmentCancellation
          :appointment="screenState.appointment"
          :vocabulary="v"
          :now-ms="nowMs"
          :submitting="cancelSubmitting"
          :rejection="cancelRejection"
          :error-message="cancelError"
          :start-open="props.focus === 'cancel'"
          @submit="submitCancel"
        />
      </div>

      <AppointmentReview
        :can-review="screenState.appointment.canReview"
        :review="screenState.appointment.review"
        :professional-name="screenState.appointment.professionalName"
        :submitting="reviewSubmitting"
        :error-message="reviewError"
        @submit="submitReview"
      />
    </main>
  </PublicFrame>
</template>
