<script setup lang="ts">
// Página coordinadora de la lectura del turno del cliente por token
// (HU-098, CA-098-01 a CA-098-06). Sin mockup asignado: identidad guiada
// dentro de NAVA / Tailored Grid (DEC-078). Posee estado y reintento; no
// conoce la forma RFC 9457 del contrato (eso queda dentro de
// `api/getCustomerAppointmentApi.ts`). Cancelar el turno es HU-099 (T5). Fuera de
// alcance a propósito: cuenta, portal, edición y reprogramación.
//
// Issue #573: es la continuación del recorrido de reserva, así que vive sobre la
// misma tinta animada (DEC-111) y presenta el turno como el boleto de la
// confirmación. La franja de tiempo y la cuenta regresiva solo leen
// `startsAt`/`endsAt`; no deciden nada de la política.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ProfessionalAvatar, BaseAlert, BaseButton, NavaWordmark, PageState } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import { NAVA_PRIVACY_URL, NAVA_TERMS_URL } from '@/shared/model/navaSite'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import { BookingBackdrop } from '@/modules/public-booking'
import { getCustomerAppointment } from '../api/getCustomerAppointmentApi'
import { createReview } from '../api/createReviewApi'
import AppointmentCancellation from '../components/AppointmentCancellation.vue'
import AppointmentReview from '../components/AppointmentReview.vue'
import { useAppointmentCancel } from '../composables/useAppointmentCancel'
import {
  appointmentPhase,
  appointmentProgress,
  calendarLeaf,
  countdownLabel,
  timezoneCity,
} from '../model/appointmentMoment'
import {
  APPOINTMENT_STATUS_BADGE_VARIANT,
  appointmentStatusLabel,
  type CancelAppointmentInput,
  type CustomerAppointment,
  type ReviewInput,
} from '../model/customerAppointmentOutcome'
import { rescheduleAvailability } from '../model/rescheduleAvailability'

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

// Con `focus="cancel"` la sección de cancelación recibe el foco una sola vez, cuando el turno
// ya se pintó: así quien llega a cancelar no tiene que buscarla al fondo de la página.
const cancelSlot = ref<HTMLElement | null>(null)
let cancelFocused = false
watch(
  () => screenState.value.status,
  async (status) => {
    if (status !== 'success' || props.focus !== 'cancel' || cancelFocused) return
    await nextTick()
    const title = cancelSlot.value?.querySelector<HTMLElement>('h2')
    if (!title) return
    cancelFocused = true
    title.tabIndex = -1
    title.focus()
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
// El tono del estado sigue la misma tabla que la insignia (RN-CNF-02): `confirmed` es
// información, nunca advertencia. El texto del estado siempre lo acompaña.
const statusTone = computed(() =>
  screenState.value.status === 'success'
    ? APPOINTMENT_STATUS_BADGE_VARIANT[screenState.value.appointment.status]
    : 'neutral',
)

// CA-098-04: hora y política se muestran en la zona del negocio, nunca
// en la del dispositivo (mismo criterio que formatInstantInTimezone en
// public-booking/pages/PublicBusinessEntryPage.vue).
const moment = computed(() => {
  if (screenState.value.status !== 'success') return null
  const { appointment: a } = screenState.value
  const phase = appointmentPhase(a.startsAt, a.endsAt, clockMs.value)
  return {
    leaf: calendarLeaf(a.startsAt, a.timezone),
    start: formatTimeInTimezone(a.startsAt, a.timezone),
    end: formatTimeInTimezone(a.endsAt, a.timezone),
    city: timezoneCity(a.timezone),
    phase,
    progress: appointmentProgress(a.startsAt, a.endsAt, clockMs.value),
    countdown: countdownLabel(a.startsAt, a.endsAt, a.timezone, clockMs.value),
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
    return `Puedes cancelar sin costo hasta ${appointment.cancellationDeadlineMinutes} minutos antes de tu turno. Pasado ese plazo, contacta directamente ${v.value.toTheBusiness}.`
  }
  const reasonNote = appointment.lateCancellationReasonRequired ? ' indicando el motivo' : ''
  return `Puedes cancelar hasta ${appointment.cancellationDeadlineMinutes} minutos antes sin costo, o después${reasonNote} conforme a la política ${v.value.ofTheBusiness}.`
})

const unexpectedErrorMessage = computed(() => {
  const state = screenState.value
  if (state.status !== 'unexpected-error') return ''
  return state.requestId
    ? `Inténtalo de nuevo. Si continúa, comparte este código con soporte: ${state.requestId}.`
    : 'Inténtalo de nuevo en unos segundos.'
})
</script>

<template>
  <div class="customer-appointment">
    <BookingBackdrop />

    <header class="customer-appointment__masthead">
      <NavaWordmark variant="inverted" size="sm" />
      <span class="customer-appointment__caption">Tu turno</span>
    </header>

    <main
      v-if="screenState.status !== 'success'"
      class="customer-appointment__main customer-appointment__main--state"
    >
      <!-- Encabezado accesible pero visualmente oculto: PageState solo aporta
           un <h2>; esta pantalla pública no tiene ningún otro <h1>, así que
           lo provee aquí (page-has-heading-one, axe-core). -->
      <h1 class="visually-hidden">Tu turno</h1>
      <PageState
        v-if="screenState.status === 'loading'"
        variant="loading"
        headline="Buscando tu turno…"
        role="status"
      />
      <PageState
        v-else-if="screenState.status === 'not-found'"
        variant="danger"
        status-label="Error"
        headline="No pudimos abrir ese enlace"
        role="alert"
      >
        <template #default
          >Puede haber vencido, haberse usado para cancelar, o estar escrito de forma incompleta.
          Revisa el correo de confirmación y vuelve a intentarlo.</template
        >
        <template #action>
          <BaseButton variant="secondary" @click="retry">Reintentar</BaseButton>
        </template>
      </PageState>
      <PageState
        v-else-if="screenState.status === 'network-error'"
        variant="warning"
        status-label="Atención"
        headline="No pudimos conectar"
        role="alert"
      >
        <template #default>Revisa tu conexión e inténtalo de nuevo.</template>
        <template #action>
          <BaseButton variant="primary" @click="retry">Reintentar</BaseButton>
        </template>
      </PageState>
      <PageState
        v-else
        variant="danger"
        status-label="Error"
        headline="Ocurrió un error inesperado"
        role="alert"
      >
        <template #default>{{ unexpectedErrorMessage }}</template>
        <template #action>
          <BaseButton variant="primary" @click="retry">Reintentar</BaseButton>
        </template>
      </PageState>
    </main>

    <main v-else class="customer-appointment__main">
      <div class="customer-appointment__intro">
        <p class="customer-appointment__eyebrow">Tu turno en</p>
        <h1 class="customer-appointment__title">{{ screenState.appointment.businessName }}</h1>
        <div class="customer-appointment__status-row">
          <p
            class="customer-appointment__status"
            :class="[
              `customer-appointment__status--${statusTone}`,
              { 'customer-appointment__status--live': isConfirmed && moment?.phase !== 'ended' },
            ]"
            role="status"
          >
            <span class="customer-appointment__status-dot" aria-hidden="true"></span>
            {{ statusLabel }}
          </p>
          <p v-if="isConfirmed && moment" class="customer-appointment__countdown">
            {{ moment.countdown }}
          </p>
        </div>
      </div>

      <!-- El boleto: lo mismo que la persona vio al confirmar, ahora como lectura
           viva. La credencial del enlace nunca se dibuja (DEC-089). -->
      <article
        v-if="moment"
        class="ticket"
        :class="[`ticket--${statusTone}`, { 'ticket--closed': !isConfirmed }]"
        aria-label="Detalle del turno"
      >
        <div class="ticket__main">
          <p class="ticket__label">Servicio</p>
          <p class="ticket__service">{{ screenState.appointment.serviceName }}</p>
          <p class="ticket__meta">{{ screenState.appointment.durationMinutes }} min</p>
        </div>

        <div class="ticket__tear" aria-hidden="true"></div>

        <div class="ticket__stub">
          <div class="ticket__when">
            <span class="ticket__leaf" aria-hidden="true">
              <span class="ticket__leaf-month">{{ moment.leaf.month }}</span>
              <span class="ticket__leaf-day">{{ moment.leaf.day }}</span>
            </span>
            <p class="ticket__date">
              <span class="ticket__weekday">{{ moment.leaf.weekday }}</span>
              <span class="ticket__long-date">{{ moment.leaf.longDate }}</span>
            </p>
          </div>

          <!-- Franja de tiempo: inicio, regla con la duración y fin. En curso, el
               latón avanza hasta el momento actual. -->
          <div
            class="ticket__span"
            :class="{ 'ticket__span--live': isConfirmed && moment.phase === 'in-progress' }"
            :style="{ '--progress': isConfirmed ? moment.progress : 0 }"
          >
            <span class="ticket__time">{{ moment.start }}</span>
            <span class="visually-hidden"> hasta </span>
            <span class="ticket__ruler" aria-hidden="true">
              <span class="ticket__ruler-fill"></span>
              <span class="ticket__ruler-mark"></span>
            </span>
            <span class="ticket__time ticket__time--end">{{ moment.end }}</span>
          </div>
          <p class="ticket__zone">Hora de {{ moment.city }}</p>

          <div class="ticket__people">
            <div class="ticket__person">
              <ProfessionalAvatar
                size="option"
                :full-name="screenState.appointment.professionalName"
              />
              <p class="ticket__person-text">
                <span class="ticket__label">{{ v.Professional }}</span>
                <span class="ticket__person-name">{{
                  screenState.appointment.professionalName
                }}</span>
              </p>
            </div>
            <div class="ticket__person">
              <p class="ticket__person-text">
                <span class="ticket__label">Persona atendida</span>
                <span class="ticket__person-name">{{ screenState.appointment.attendeeName }}</span>
              </p>
            </div>
          </div>
        </div>

        <span class="ticket__bars" aria-hidden="true"></span>
      </article>

      <div class="customer-appointment__notes">
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
        <BaseAlert v-else-if="isCancelled" variant="warning" role="status">
          Este turno está cancelado. El horario quedó libre.
        </BaseAlert>
        <!-- La política solo orienta mientras el turno sigue confirmado: en uno ya
             completado o ausente no hay nada que cancelar. -->
        <div v-else-if="isConfirmed" class="customer-appointment__policy" role="status">
          <p class="customer-appointment__policy-label">Política de cancelación</p>
          <p class="customer-appointment__policy-text">{{ cancellationPolicyLabel }}</p>
        </div>
      </div>

      <a
        v-if="reschedule && !justCancelled"
        class="customer-appointment__reschedule"
        :href="reschedule.href"
      >
        <span class="customer-appointment__reschedule-text">
          <span class="customer-appointment__reschedule-title">¿No puedes a esa hora?</span>
          <span class="customer-appointment__reschedule-hint"
            >Cambia el día o la hora. {{ reschedule.remaining }}.</span
          >
        </span>
        <span class="customer-appointment__reschedule-action">
          Cambiar la hora<span class="customer-appointment__reschedule-arrow" aria-hidden="true"
            >→</span
          >
        </span>
      </a>

      <div v-if="screenState.appointment.status === 'confirmed'" ref="cancelSlot">
        <AppointmentCancellation
          :appointment="screenState.appointment"
          :vocabulary="v"
          :now-ms="nowMs"
          :submitting="cancelSubmitting"
          :rejection="cancelRejection"
          :error-message="cancelError"
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

    <!-- Firma secundaria: el negocio lleva la jerarquía principal (§3.2). Enlaces
         simples, sin RouterLink: la página se monta y se prueba sin router. -->
    <footer class="customer-appointment__footer">
      <span>Turnos con</span>
      <NavaWordmark variant="inverted" size="sm" />
      <nav class="customer-appointment__legal" aria-label="Documentos legales">
        <a :href="NAVA_PRIVACY_URL">Privacidad</a>
        <a :href="NAVA_TERMS_URL">Condiciones</a>
      </nav>
    </footer>
  </div>
</template>

<style scoped>
/*
 * «Mi turno» sobre la tinta de la reserva pública (issue #573, DEC-111): el
 * mismo lienzo, latón y serif editorial, con el turno como boleto. Colores solo
 * de tokens; lo nuevo se mezcla con `color-mix`. Todo el movimiento es
 * `transform`/`opacity`/`clip-path` y termina en su estado normal (`backwards`),
 * así que con movimiento reducido la pantalla ya está compuesta.
 */
.customer-appointment {
  --mt-text: var(--color-on-strong);
  --mt-muted: var(--color-on-strong-muted);
  --mt-soft: var(--color-on-strong-soft);
  --mt-brass: var(--color-brand-accent-surface);
  --mt-on-brass: var(--color-brand-accent-text);
  --mt-line: color-mix(in srgb, var(--mt-text) 14%, transparent);
  --mt-line-strong: color-mix(in srgb, var(--mt-text) 30%, transparent);
  --mt-wash: color-mix(in srgb, var(--mt-brass) 15%, transparent);
  --mt-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  --mt-tone: var(--color-info-on-strong);

  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  overflow-x: clip;
  font-family: var(--font-sans);
  color: var(--mt-text);
  background-color: var(--color-surface-strong);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Cabecera ───────────────────────────────────────────────────────────── */

.customer-appointment__masthead {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 640px;
  min-height: var(--control-height);
  padding: var(--space-3) var(--space-4) 0;
  margin: 0 auto;
  animation: mt-fade 0.8s ease backwards;
}

.customer-appointment__masthead :deep(.nava-wordmark) {
  font-size: 26px;
  letter-spacing: 0.08em;
}

.customer-appointment__caption,
.customer-appointment__eyebrow,
.ticket__label,
.customer-appointment__policy-label {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.customer-appointment__caption {
  color: var(--mt-muted);
}

/* ── Columna ────────────────────────────────────────────────────────────── */

.customer-appointment__main {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 640px;
  padding: var(--space-8) var(--space-4) var(--space-12);
  margin: 0 auto;
}

.customer-appointment__main--state {
  justify-content: center;
  padding-top: 0;
}

/* ── Encabezado del turno ───────────────────────────────────────────────── */

.customer-appointment__intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.customer-appointment__eyebrow {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  color: var(--mt-brass);
}

.customer-appointment__eyebrow::before {
  content: '';
  width: 28px;
  height: 1px;
  background-color: currentcolor;
  transform-origin: left;
  animation: mt-grow 0.8s var(--mt-ease) 0.25s backwards;
}

.customer-appointment__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(40px, 11vw, 64px);
  font-weight: 400;
  line-height: 1.02;
  letter-spacing: -0.015em;
  overflow-wrap: anywhere;
  color: var(--mt-text);
  animation: mt-wipe 1s cubic-bezier(0.65, 0, 0.2, 1) 0.12s backwards;
}

.customer-appointment__status-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  animation: mt-rise 0.7s var(--mt-ease) 0.35s backwards;
}

.customer-appointment__status {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: 32px;
  padding: 0 var(--space-3);
  margin: 0;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--mt-tone);
  background-color: color-mix(in srgb, var(--mt-tone) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--mt-tone) 55%, transparent);
  border-radius: 2px;
}

.customer-appointment__status--success {
  --mt-tone: var(--color-success-on-strong);
}

.customer-appointment__status--warning {
  --mt-tone: var(--color-warning-on-strong);
}

.customer-appointment__status--danger {
  --mt-tone: var(--color-danger-on-strong);
}

.customer-appointment__status--neutral {
  --mt-tone: var(--color-on-strong-muted);
}

/* El rombo del estado: late mientras el turno sigue por delante. */
.customer-appointment__status-dot {
  position: relative;
  width: 8px;
  height: 8px;
  background-color: currentcolor;
  transform: rotate(45deg);
}

.customer-appointment__status--live .customer-appointment__status-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  background-color: currentcolor;
  animation: mt-ping 2.2s cubic-bezier(0, 0, 0.2, 1) 1.2s infinite;
}

.customer-appointment__countdown {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--mt-soft);
}

/* ── Boleto ─────────────────────────────────────────────────────────────── */

.ticket {
  position: relative;
  overflow: hidden;
  background-color: color-mix(in srgb, #000 26%, var(--color-surface-strong));
  background-image: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--mt-brass) 8%, transparent),
    transparent 180px
  );
  border: 1px solid var(--mt-line);
  border-top: 2px solid var(--mt-brass);
  border-radius: 4px;
  box-shadow:
    0 36px 60px -30px rgb(0 0 0 / 80%),
    0 0 0 1px color-mix(in srgb, var(--mt-brass) 6%, transparent);
  transform-origin: 50% 0;
  animation: mt-drop 0.95s cubic-bezier(0.2, 0.8, 0.2, 1) 0.45s backwards;
}

/* Cinta métrica de latón en el borde superior. */
.ticket::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 14px;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--mt-brass) 1px, transparent 1px),
    linear-gradient(to right, var(--mt-brass) 1px, transparent 1px);
  background-repeat: repeat-x;
  background-size:
    12px 7px,
    60px 14px;
  opacity: 0.42;
  mask-image: linear-gradient(to right, transparent, #000 14%, #000 86%, transparent);
}

/* Un destello de latón cruza el boleto una sola vez al aterrizar. */
.ticket::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(
    105deg,
    transparent 40%,
    color-mix(in srgb, var(--mt-brass) 20%, transparent) 50%,
    transparent 60%
  );
  transform: translateX(-110%);
  animation: mt-shine 1.4s ease-in-out 1.3s;
}

/* Un turno cerrado cambia de material, no de peso (§6.7): contorno sin relleno. */
.ticket--closed {
  background-color: transparent;
  background-image: none;
  border-top-color: var(--mt-line-strong);
  box-shadow: none;
}

.ticket--closed::before {
  opacity: 0.18;
}

.ticket__main {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-8) var(--space-5) var(--space-5);
}

.ticket__label {
  color: var(--mt-brass);
}

.ticket__service {
  margin: var(--space-1) 0 0;
  font-family: var(--font-display);
  font-size: clamp(32px, 8.5vw, 44px);
  line-height: 1.05;
  overflow-wrap: anywhere;
  color: var(--mt-text);
}

.ticket__meta {
  margin: var(--space-1) 0 0;
  font-variant-numeric: tabular-nums;
  color: var(--mt-soft);
}

/* Perforación: línea de puntos con una muesca a cada lado. */
.ticket__tear {
  position: relative;
  height: 0;
  margin: 0 var(--space-3);
  border-top: 2px dashed var(--mt-line-strong);
}

.ticket__tear::before,
.ticket__tear::after {
  content: '';
  position: absolute;
  top: -12px;
  width: 22px;
  height: 22px;
  background-color: var(--color-surface-strong);
  border: 1px solid var(--mt-line);
  border-radius: 50%;
}

.ticket__tear::before {
  left: -24px;
}

.ticket__tear::after {
  right: -24px;
}

.ticket__stub {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-6) var(--space-5);
}

.ticket__when {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

/* Hoja de calendario: banda de latón con el mes y el día en grande. */
.ticket__leaf {
  display: grid;
  flex: none;
  width: 68px;
  overflow: hidden;
  text-align: center;
  border: 1px solid var(--mt-brass);
  border-radius: 3px;
  animation: mt-pop 0.6s cubic-bezier(0.3, 1.5, 0.5, 1) 1s backwards;
}

.ticket__leaf-month {
  padding: 3px 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mt-on-brass);
  background-color: var(--mt-brass);
}

.ticket__leaf-day {
  padding: 2px 0 6px;
  font-family: var(--font-display);
  font-size: 38px;
  line-height: 44px;
  color: var(--mt-text);
}

.ticket__date {
  display: grid;
  gap: 2px;
  min-width: 0;
  margin: 0;
}

.ticket__weekday {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 32px;
  color: var(--mt-text);
  text-transform: capitalize;
}

.ticket__long-date {
  overflow-wrap: anywhere;
  color: var(--mt-soft);
}

/* Franja de tiempo: las dos horas a los extremos y la regla de la duración. */
.ticket__span {
  display: grid;
  grid-template-columns: auto minmax(24px, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
}

.ticket__time {
  font-size: clamp(19px, 5.6vw, 28px);
  font-weight: 500;
  line-height: 1.15;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--mt-text);
}

.ticket__time--end {
  color: var(--mt-soft);
}

.ticket__ruler {
  position: relative;
  height: 14px;
  background-image:
    linear-gradient(to right, var(--mt-line-strong) 1px, transparent 1px),
    linear-gradient(var(--mt-line-strong), var(--mt-line-strong));
  background-repeat: repeat-x, no-repeat;
  background-position:
    0 3px,
    0 50%;
  background-size:
    10px 8px,
    100% 1px;
  transform-origin: left;
  animation: mt-grow 1s cubic-bezier(0.65, 0, 0.2, 1) 1.15s backwards;
}

.ticket__ruler::before,
.ticket__ruler::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  background-color: var(--mt-brass);
  transform: translateY(-50%) rotate(45deg);
}

.ticket__ruler::before {
  left: -3px;
}

.ticket__ruler::after {
  right: -3px;
}

.ticket__ruler-fill {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 2px;
  background-color: var(--mt-brass);
  transform: translateY(-50%) scaleX(var(--progress, 0));
  transform-origin: left;
  transition: transform 1.2s var(--mt-ease);
}

/* En curso: un rombo de latón marca «ahora» sobre la regla. */
.ticket__ruler-mark {
  position: absolute;
  top: 50%;
  left: calc(var(--progress, 0) * 100%);
  display: none;
  width: 11px;
  height: 11px;
  background-color: var(--mt-brass);
  box-shadow: 0 0 12px 2px color-mix(in srgb, var(--mt-brass) 60%, transparent);
  transform: translate(-50%, -50%) rotate(45deg);
  transition: left 1.2s var(--mt-ease);
}

.ticket__span--live .ticket__ruler-mark {
  display: block;
  animation: mt-glow 2.4s ease-in-out infinite;
}

/* Turno cerrado: la franja se tacha con una línea del color del estado. */
.ticket--closed .ticket__span {
  position: relative;
}

.ticket--closed .ticket__span::after {
  content: '';
  position: absolute;
  top: 50%;
  right: -4px;
  left: -4px;
  height: 2px;
  background-color: var(--mt-tone);
  transform-origin: left;
  animation: mt-grow 0.7s cubic-bezier(0.65, 0, 0.2, 1) 1.4s backwards;
}

.ticket--danger,
.ticket--neutral {
  --mt-tone: var(--color-danger-on-strong);
}

.ticket--warning {
  --mt-tone: var(--color-warning-on-strong);
}

.ticket--success .ticket__span::after {
  display: none;
}

.ticket--closed .ticket__time {
  color: var(--mt-muted);
}

.ticket__zone {
  margin: calc(var(--space-3) * -1) 0 0;
  font-size: var(--font-size-body-sm);
  color: var(--mt-muted);
}

.ticket__people {
  display: grid;
  gap: var(--space-4);
  padding-top: var(--space-5);
  margin: 0;
  border-top: 1px solid var(--mt-line);
}

.ticket__person {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  animation: mt-rise 0.6s var(--mt-ease) backwards;
  animation-delay: 1.25s;
}

.ticket__person + .ticket__person {
  animation-delay: 1.35s;
}

.ticket__person-text {
  display: grid;
  gap: 2px;
  min-width: 0;
  margin: 0;
}

.ticket__person-name {
  font-size: var(--font-size-body-lg);
  font-weight: 500;
  overflow-wrap: anywhere;
  color: var(--mt-text);
}

/* Franja de barras decorativa al pie, como el código de un boleto. No codifica
   nada: la credencial del turno nunca se dibuja (DEC-089). */
.ticket__bars {
  display: block;
  height: 26px;
  margin: 0 var(--space-5) var(--space-5);
  opacity: 0.32;
  background-image: repeating-linear-gradient(
    90deg,
    var(--mt-text) 0 2px,
    transparent 2px 5px,
    var(--mt-text) 5px 6px,
    transparent 6px 10px,
    var(--mt-text) 10px 13px,
    transparent 13px 15px,
    var(--mt-text) 15px 16px,
    transparent 16px 21px
  );
  animation: mt-fade 1s ease 1.5s backwards;
}

/* ── Notas: política y avisos ───────────────────────────────────────────── */

.customer-appointment__notes {
  display: grid;
  gap: var(--space-3);
  animation: mt-rise 0.7s var(--mt-ease) 1.1s backwards;
}

.customer-appointment__cancelled:focus-visible {
  outline: 2px solid var(--mt-brass);
  outline-offset: 3px;
}

.customer-appointment__policy {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-1) 0 var(--space-1) var(--space-5);
  border-left: 2px solid var(--mt-brass);
}

.customer-appointment__policy-label {
  color: var(--mt-brass);
}

/* Entrada a «Cambiar la hora» (HU-104): una franja de latón tenue, más clara
   que la cancelación porque es el camino que conserva el turno. */
.customer-appointment__reschedule {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-5);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  color: var(--mt-text);
  text-decoration: none;
  background-color: var(--mt-wash);
  border: 1px solid color-mix(in srgb, var(--mt-brass) 45%, transparent);
  border-radius: 4px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  animation: mt-rise 0.7s var(--mt-ease) 1.15s backwards;
}

.customer-appointment__reschedule:hover {
  background-color: color-mix(in srgb, var(--mt-brass) 22%, transparent);
  border-color: var(--mt-brass);
}

.customer-appointment__reschedule:focus-visible {
  outline: 2px solid var(--mt-brass);
  outline-offset: 3px;
}

.customer-appointment__reschedule-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.customer-appointment__reschedule-title {
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 1.2;
}

.customer-appointment__reschedule-hint {
  font-size: var(--font-size-body-sm);
  color: var(--mt-soft);
}

.customer-appointment__reschedule-action {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: 44px;
  font-weight: 600;
  color: var(--mt-brass);
}

.customer-appointment__reschedule-arrow {
  transition: transform 0.2s var(--mt-ease);
}

.customer-appointment__reschedule:hover .customer-appointment__reschedule-arrow {
  transform: translateX(4px);
}

.customer-appointment__policy-text {
  margin: 0;
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--mt-soft);
}

/* ── Acciones sobre tinta (cancelación, reseña, reintento) ──────────────── */

.customer-appointment :deep(.base-button) {
  font-weight: 600;
}

.customer-appointment :deep(.base-button--primary) {
  color: var(--mt-on-brass);
  background-color: var(--mt-brass);
  border-color: var(--mt-brass);
  border-bottom-width: var(--border-width-emphasis);
  border-bottom-color: color-mix(in srgb, var(--mt-brass) 70%, #000);
}

.customer-appointment :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--mt-brass) 86%, #fff);
  border-color: color-mix(in srgb, var(--mt-brass) 86%, #fff);
  box-shadow: 0 10px 24px -12px color-mix(in srgb, var(--mt-brass) 70%, transparent);
}

.customer-appointment :deep(.base-button--secondary),
.customer-appointment :deep(.base-button--ghost) {
  color: var(--mt-brass);
  background-color: transparent;
  border-color: var(--mt-brass);
  border-bottom-width: var(--border-width-emphasis);
}

.customer-appointment
  :deep(.base-button--secondary:hover:not(:disabled):not(.base-button--loading)),
.customer-appointment :deep(.base-button--ghost:hover:not(:disabled):not(.base-button--loading)) {
  background-color: var(--mt-wash);
  border-color: var(--mt-brass);
}

.customer-appointment :deep(.base-button:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-on-strong);
}

.customer-appointment :deep(.appointment-cancel),
.customer-appointment :deep(.appointment-review) {
  animation: mt-rise 0.7s var(--mt-ease) 1.25s backwards;
}

/* ── Firma al pie ───────────────────────────────────────────────────────── */

.customer-appointment__footer {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: baseline;
  justify-content: center;
  padding: var(--space-5) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mt-muted);
}

.customer-appointment__footer :deep(.nava-wordmark) {
  font-size: 18px;
  letter-spacing: 0.08em;
}

.customer-appointment__legal {
  display: flex;
  flex-basis: 100%;
  gap: var(--space-1) var(--space-5);
  justify-content: center;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
}

.customer-appointment__legal a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: 13px;
  color: var(--mt-muted);
  text-underline-offset: 3px;
}

.customer-appointment__legal a:hover {
  color: var(--mt-text);
}

.customer-appointment__legal a:focus-visible {
  outline: 2px solid var(--mt-brass);
  outline-offset: 3px;
}

/* ── Anchos ─────────────────────────────────────────────────────────────── */

@media (min-width: 400px) {
  .ticket__span {
    gap: var(--space-3);
  }
}

@media (min-width: 560px) {
  .ticket__main {
    padding: var(--space-10) var(--space-8) var(--space-6);
  }

  .ticket__stub {
    padding: var(--space-6) var(--space-8) var(--space-8);
  }

  .ticket__bars {
    margin: 0 var(--space-8) var(--space-6);
  }

  .ticket__people {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 1024px) {
  .customer-appointment__main {
    padding-top: var(--space-12);
  }
}

/* ── Movimiento ─────────────────────────────────────────────────────────── */

@keyframes mt-fade {
  from {
    opacity: 0;
  }
}

@keyframes mt-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes mt-grow {
  from {
    transform: scaleX(0);
  }
}

@keyframes mt-wipe {
  from {
    clip-path: inset(0 100% 0 0);
    transform: translateY(8px);
  }
  to {
    clip-path: inset(0 0 0 0);
    transform: none;
  }
}

@keyframes mt-drop {
  from {
    opacity: 0;
    transform: translateY(-28px) rotate(-1.2deg) scale(0.97);
  }
  60% {
    opacity: 1;
    transform: translateY(5px) rotate(0.3deg) scale(1);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes mt-shine {
  to {
    transform: translateX(110%);
  }
}

@keyframes mt-pop {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
}

@keyframes mt-ping {
  from {
    opacity: 0.7;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(2.6);
  }
}

@keyframes mt-glow {
  50% {
    box-shadow: 0 0 20px 5px color-mix(in srgb, var(--mt-brass) 75%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .customer-appointment *,
  .customer-appointment *::before,
  .customer-appointment *::after,
  .customer-appointment :deep(*) {
    animation: none !important;
    transition: none !important;
  }

  .ticket::after {
    display: none;
  }
}
</style>
