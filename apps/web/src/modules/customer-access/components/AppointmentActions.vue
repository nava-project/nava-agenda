<script setup lang="ts">
// Paso 03 «Tu turno» del acceso con código (issue #647): quien escribió el código vino a
// cambiar la hora o a cancelar, así que aquí ve su turno en una línea y esas dos acciones,
// sin saltar a la pantalla completa de «Mi turno» (la de la confirmación).
//
// Lee el turno con la misma credencial de 60 minutos (HU-105). «Cambiar la hora» lleva a la
// pantalla de HU-104; «Cancelar turno» se confirma aquí mismo con las reglas de HU-099. Las
// dos se ofrecen según la pista local; el servidor sigue decidiendo y su rechazo prevalece.
// v2 (DEC-188, 2c): el pase compacto y dos filas de acción, como las filas del catálogo.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import { getCustomerAppointment } from '../api/getCustomerAppointmentApi'
import { useAppointmentCancel } from '../composables/useAppointmentCancel'
import AppointmentCancellation from './AppointmentCancellation.vue'
import { calendarLeaf } from '../model/appointmentMoment'
import { timezoneLabel } from '@/shared/time/timezoneName'
import { cancellationAvailability } from '../model/cancellationAvailability'
import { rescheduleAvailability } from '../model/rescheduleAvailability'
import type {
  CancelAppointmentInput,
  CustomerAppointment,
} from '../model/customerAppointmentOutcome'

interface Props {
  /** Credencial de 60 minutos que emitió la verificación del código. */
  token: string
  /** Slug de la página de reservas, para ofrecer reservar de nuevo tras cancelar. */
  slug: string
  /** `cancel` abre directo la confirmación (enlace de Odin para cancelar, HU-106). */
  initialAction?: 'cancel'
}
const props = defineProps<Props>()
/** `cancelled`: la página cambia su título; el panel ya muestra el desenlace. */
const emit = defineEmits<{ cancelled: []; modeChange: [mode: 'menu' | 'cancel'] }>()

type State =
  | { status: 'loading' }
  | { status: 'ready'; appointment: CustomerAppointment }
  | { status: 'not-found' }
  | { status: 'error'; requestId?: string; network: boolean }

const state = ref<State>({ status: 'loading' })
const mode = ref<'menu' | 'cancel'>(props.initialAction === 'cancel' ? 'cancel' : 'menu')
const justCancelled = ref(false)
const nowMs = ref(Date.now())
const root = ref<HTMLElement | null>(null)
// La página ajusta su título a lo que se está haciendo (elegir o confirmar la cancelación).
watch(mode, (value) => emit('modeChange', value))

let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  state.value = { status: 'loading' }
  const outcome = await getCustomerAppointment(props.token)
  if (seq !== loadSeq) return
  nowMs.value = Date.now()
  switch (outcome.kind) {
    case 'success':
      state.value = { status: 'ready', appointment: outcome.appointment }
      return
    case 'not-found':
      state.value = { status: 'not-found' }
      return
    case 'network-error':
      state.value = { status: 'error', network: true }
      return
    case 'unexpected-error':
      state.value = { status: 'error', network: false, requestId: outcome.requestId }
  }
}
onMounted(() => void load())
watch(
  () => props.token,
  () => {
    mode.value = 'menu'
    justCancelled.value = false
    void load()
  },
)

const appointment = computed(() =>
  state.value.status === 'ready' ? state.value.appointment : null,
)
const v = computed(() => buildVocabularyFromTerms(appointment.value?.vocabulary ?? null))
const isCancelled = computed(() => !!appointment.value?.status.startsWith('cancelled'))

const summary = computed(() => {
  const a = appointment.value
  if (!a) return null
  return {
    leaf: calendarLeaf(a.startsAt, a.timezone),
    start: formatTimeInTimezone(a.startsAt, a.timezone),
    end: formatTimeInTimezone(a.endsAt, a.timezone),
    zone: timezoneLabel(a.timezone),
  }
})

const reschedule = computed(() => {
  const a = appointment.value
  if (!a) return null
  const availability = rescheduleAvailability(a, nowMs.value)
  if (availability.mode === 'available') {
    return {
      available: true as const,
      href: `/mi-turno/${encodeURIComponent(props.token)}/reprogramar`,
      hint:
        availability.remaining === 1
          ? 'Elige otro día u hora. Te queda 1 cambio.'
          : `Elige otro día u hora. Puedes cambiarla hasta ${availability.remaining} veces.`,
    }
  }
  if (availability.reason === 'limit-reached') {
    return { available: false as const, hint: 'Ya usaste los cambios de hora de este turno.' }
  }
  return {
    available: false as const,
    hint: `Ya pasó el plazo para cambiar la hora. Contacta directamente ${v.value.toTheBusiness}.`,
  }
})

const cancelHint = computed(() => {
  const a = appointment.value
  if (!a) return ''
  const availability = cancellationAvailability(a, nowMs.value)
  switch (availability.mode) {
    case 'within-deadline':
      return `Sin costo hasta ${a.cancellationDeadlineMinutes} minutos antes. Liberas el horario.`
    case 'late-allowed':
      return availability.reasonRequired
        ? 'Ya pasó el plazo sin costo: puedes cancelar indicando el motivo.'
        : 'Ya pasó el plazo sin costo, pero aún puedes cancelar.'
    default:
      return `Ya no se puede cancelar desde aquí. Contacta directamente ${v.value.toTheBusiness}.`
  }
})

const {
  submitting: cancelSubmitting,
  error: cancelError,
  rejection: cancelRejection,
  notice: cancelNotice,
  submit: sendCancel,
  reset: resetCancel,
} = useAppointmentCancel(() => props.token, {
  async onCancelled(cancelled) {
    justCancelled.value = true
    mode.value = 'menu'
    state.value = { status: 'ready', appointment: cancelled }
    emit('cancelled')
    await nextTick()
    root.value?.querySelector<HTMLElement>('.actions__done')?.focus()
  },
  async onChanged() {
    mode.value = 'menu'
    await load()
  },
  onNotFound() {
    state.value = { status: 'not-found' }
  },
})

// Sin formulario (el plazo venció o el turno ya empezó) la sección no trae «Mantener mi turno»,
// así que la vuelta a las opciones la pone este panel.
const cancelUnavailable = computed(() => {
  const a = appointment.value
  if (!a) return false
  return (
    cancelRejection.value === 'window-closed' ||
    cancellationAvailability(a, nowMs.value).mode === 'unavailable'
  )
})

function submitCancel(input: CancelAppointmentInput) {
  if (appointment.value) void sendCancel(appointment.value, input)
}

async function openCancel() {
  resetCancel()
  mode.value = 'cancel'
}

async function backToMenu() {
  resetCancel()
  mode.value = 'menu'
  await nextTick()
  root.value?.querySelector<HTMLElement>('.actions__choice--cancel')?.focus()
}

const myTurnHref = computed(() => `/mi-turno/${encodeURIComponent(props.token)}`)
const bookAgainHref = computed(() => `/reservar/${encodeURIComponent(props.slug)}`)
</script>

<template>
  <div ref="root" class="actions">
    <p v-if="state.status === 'loading'" class="actions__loading" role="status">
      <span class="actions__pulse" aria-hidden="true" />Abriendo tu turno…
    </p>

    <BaseAlert v-else-if="state.status === 'not-found'" variant="danger" role="alert">
      Este acceso ya no sirve: puede haber vencido. Pide un código nuevo para seguir.
    </BaseAlert>

    <div v-else-if="state.status === 'error'" class="actions__error">
      <BaseAlert :variant="state.network ? 'warning' : 'danger'" role="alert">
        {{
          state.network
            ? 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
            : state.requestId
              ? `No pudimos abrir tu turno. Código de soporte: ${state.requestId}`
              : 'No pudimos abrir tu turno. Inténtalo de nuevo.'
        }}
      </BaseAlert>
      <button type="button" class="mt-button" @click="load">Reintentar</button>
    </div>

    <template v-else-if="appointment && summary">
      <!-- El turno en una línea: lo justo para reconocerlo antes de decidir. -->
      <article
        class="actions__ticket"
        :class="{ 'actions__ticket--off': isCancelled }"
        aria-labelledby="actions-ticket-when"
      >
        <div class="actions__ticket-body">
          <span v-if="isCancelled" class="actions__stamp">Cancelado</span>
          <h2 id="actions-ticket-when" class="actions__when">
            <span class="actions__weekday"
              >{{ summary.leaf.weekday }} {{ summary.leaf.day }} {{ summary.leaf.month }}</span
            ><span class="visually-hidden">,</span>
            <span class="actions__time">{{ summary.start }} – {{ summary.end }}</span>
          </h2>
          <p class="actions__what">
            {{ appointment.serviceName }} con {{ appointment.professionalName }}
          </p>
          <p class="actions__where">{{ appointment.businessName }} · {{ summary.zone }}</p>
        </div>
      </article>

      <BaseAlert v-if="cancelNotice" variant="warning" role="status">{{ cancelNotice }}</BaseAlert>

      <div v-if="justCancelled" class="actions__done" tabindex="-1" role="status">
        <p class="actions__done-title">Tu turno quedó cancelado</p>
        <p class="actions__done-text">Liberamos el horario. Si quieres volver, reserva de nuevo.</p>
        <a class="bk-link actions__done-link" :href="bookAgainHref">Reservar otro turno</a>
      </div>

      <p v-else-if="isCancelled" class="actions__note">
        Este turno ya está cancelado. Si quieres volver, reserva de nuevo.
      </p>

      <ul v-else-if="mode === 'menu'" class="actions__menu" aria-label="Qué hacer con tu turno">
        <li>
          <a v-if="reschedule?.available" class="actions__choice" :href="reschedule.href">
            <span class="actions__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </span>
            <span class="actions__text">
              <span class="actions__label">Cambiar la hora</span>
              <span class="actions__hint">{{ reschedule.hint }}</span>
            </span>
            <span class="actions__go" aria-hidden="true">→</span>
          </a>
          <div v-else class="actions__choice actions__choice--off">
            <span class="actions__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </span>
            <span class="actions__text">
              <span class="actions__label">Cambiar la hora</span>
              <span class="actions__hint">{{ reschedule?.hint }}</span>
            </span>
          </div>
        </li>
        <li>
          <button type="button" class="actions__choice actions__choice--cancel" @click="openCancel">
            <span class="actions__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M9 9l6 6M15 9l-6 6" />
              </svg>
            </span>
            <span class="actions__text">
              <span class="actions__label">Cancelar turno</span>
              <span class="actions__hint">{{ cancelHint }}</span>
            </span>
            <span class="actions__go" aria-hidden="true">→</span>
          </button>
        </li>
      </ul>

      <div v-else class="actions__cancel">
        <AppointmentCancellation
          :appointment="appointment"
          :vocabulary="v"
          :now-ms="nowMs"
          :submitting="cancelSubmitting"
          :rejection="cancelRejection"
          :error-message="cancelError"
          start-open
          @submit="submitCancel"
          @close="backToMenu"
        />
        <button v-if="cancelUnavailable" type="button" class="bk-link" @click="backToMenu">
          Volver a las opciones
        </button>
      </div>

      <a class="bk-link actions__full" :href="myTurnHref">Ver el detalle completo del turno</a>
    </template>
  </div>
</template>

<style scoped>
/* v2 (DEC-188, 2c). El pase compacto, las acciones como filas del catálogo y el aviso
   de cancelado. Colores de tokens; la única acción con acento es la fila elegida al
   pasar, nunca «Cancelar». */
.actions {
  display: grid;
  gap: var(--space-4);
}

.actions__loading {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  font-size: 15px;
  color: var(--color-text-secondary);
}

.actions__pulse {
  width: 8px;
  height: 8px;
  background-color: var(--color-sun);
  border-radius: 50%;
  animation: actions-pulse 1.2s ease-in-out infinite;
}

.actions__error {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.actions__ticket {
  position: relative;
  padding: var(--space-4) var(--space-5);
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.actions__ticket::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  content: '';
  background-color: var(--bk-accent, var(--color-brand-accent-surface));
}

.actions__ticket--off::before {
  background-color: var(--color-border-control);
}

.actions__ticket-body {
  display: grid;
  gap: 2px;
}

.actions__ticket-body p {
  margin: 0;
}

.actions__stamp {
  justify-self: start;
  padding: 2px var(--space-2);
  margin-bottom: var(--space-1);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-inactive-text);
  background-color: var(--color-inactive-surface);
  border: 1px solid var(--color-inactive-border);
  border-radius: 999px;
}

.actions__when {
  display: grid;
  margin: 0;
  font-size: 15px;
  font-weight: 400;
}

.actions__weekday::first-letter {
  text-transform: uppercase;
}

.actions__time {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.actions__ticket--off .actions__time {
  color: var(--color-text-secondary);
  text-decoration: line-through;
}

.actions__what {
  margin-top: var(--space-2);
  font-size: 15px;
}

.actions__where {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.actions__menu {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.actions__choice {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: 72px;
  padding: var(--space-3) var(--space-4);
  font: inherit;
  color: var(--color-text-primary);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  transition:
    border-color var(--motion-duration-fast) ease,
    transform var(--motion-duration-fast) ease;
}

a.actions__choice:hover {
  border-color: var(--bk-accent, var(--color-brand-accent-surface));
}

.actions__choice--cancel:hover {
  border-color: var(--color-text-primary);
}

.actions__choice:hover .actions__go {
  transform: translateX(3px);
}

.actions__choice--off {
  cursor: default;
  background-color: transparent;
  border-style: dashed;
}

.actions__choice--off .actions__label,
.actions__choice--off .actions__icon {
  color: var(--color-text-secondary);
}

.actions__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--color-text-primary);
  background-color: var(--color-surface-muted);
  border-radius: 50%;
}

.actions__icon svg {
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.actions__text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.actions__label {
  font-size: 16px;
  font-weight: 600;
}

.actions__hint {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.actions__go {
  flex: none;
  color: var(--color-text-secondary);
  transition: transform var(--motion-duration-fast) ease;
}

.actions__done {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  padding: var(--space-4) var(--space-5);
  background-color: var(--color-success-surface);
  border: 1px solid var(--color-success-border);
  border-radius: var(--radius-lg);
}

.actions__done:focus {
  outline: none;
}

.actions__done:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.actions__done p {
  margin: 0;
}

.actions__done-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-success-text);
}

.actions__done-text,
.actions__note {
  margin: 0;
  font-size: 15px;
  color: var(--color-text-secondary);
}

.actions__cancel {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.actions__cancel > :first-child {
  justify-self: stretch;
}

.actions__full {
  justify-self: start;
}

@keyframes actions-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .actions__pulse,
  .actions__choice,
  .actions__go {
    animation: none;
    transition: none;
  }
}
</style>
