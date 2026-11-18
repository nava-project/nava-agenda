<script setup lang="ts">
// Paso 03 «Tu turno» del acceso con código (issue #647): quien escribió el código vino a
// cambiar la hora o a cancelar, así que aquí ve su turno en una línea y esas dos acciones,
// sin saltar a la pantalla completa de «Mi turno» (la de la confirmación).
//
// Lee el turno con la misma credencial de 60 minutos (HU-105). «Cambiar la hora» lleva a la
// pantalla de HU-104; «Cancelar turno» se confirma aquí mismo con las reglas de HU-099. Las
// dos se ofrecen según la pista local; el servidor sigue decidiendo y su rechazo prevalece.
// Sin mockup asignado: identidad guiada NAVA / Tailored Grid (DEC-078).
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert, BaseButton } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import { getCustomerAppointment } from '../api/getCustomerAppointmentApi'
import { useAppointmentCancel } from '../composables/useAppointmentCancel'
import AppointmentCancellation from './AppointmentCancellation.vue'
import { calendarLeaf, timezoneCity } from '../model/appointmentMoment'
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
    city: timezoneCity(a.timezone),
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
      <BaseButton variant="secondary" @click="load">Reintentar</BaseButton>
    </div>

    <template v-else-if="appointment && summary">
      <!-- El turno en una línea: lo justo para reconocerlo antes de decidir. -->
      <article class="actions__ticket" aria-labelledby="actions-ticket-when">
        <span class="actions__leaf" aria-hidden="true">
          <span class="actions__leaf-month">{{ summary.leaf.month }}</span>
          <span class="actions__leaf-day">{{ summary.leaf.day }}</span>
        </span>
        <div class="actions__ticket-body">
          <span v-if="isCancelled" class="actions__stamp">Cancelado</span>
          <h2 id="actions-ticket-when" class="actions__when">
            <span class="actions__weekday">{{ summary.leaf.weekday }}</span
            >,
            <span class="actions__time">{{ summary.start }} – {{ summary.end }}</span>
          </h2>
          <p class="actions__what">
            {{ appointment.serviceName }} con {{ appointment.professionalName }}
          </p>
          <p class="actions__where">{{ appointment.businessName }} · Hora de {{ summary.city }}</p>
        </div>
      </article>

      <BaseAlert v-if="cancelNotice" variant="warning" role="status">{{ cancelNotice }}</BaseAlert>

      <div v-if="justCancelled" class="actions__done" tabindex="-1" role="status">
        <p class="actions__done-title">Tu turno quedó cancelado</p>
        <p class="actions__done-text">Liberamos el horario. Si quieres volver, reserva de nuevo.</p>
        <a class="actions__done-link" :href="bookAgainHref">Reservar otro turno →</a>
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
        <button v-if="cancelUnavailable" type="button" class="actions__back" @click="backToMenu">
          ← Volver a las opciones
        </button>
      </div>

      <a class="actions__full" :href="myTurnHref">Ver el detalle completo del turno</a>
    </template>
  </div>
</template>

<style scoped>
.actions {
  --ax-text: var(--color-on-strong);
  --ax-soft: var(--color-on-strong-soft);
  --ax-muted: var(--color-on-strong-muted);
  --ax-brass: var(--color-brand-accent-surface);
  --ax-line: color-mix(in srgb, var(--ax-text) 14%, transparent);
  --ax-line-strong: color-mix(in srgb, var(--ax-text) 30%, transparent);
  --ax-panel: color-mix(in srgb, #000 26%, var(--color-surface-strong));
  --ax-ease: cubic-bezier(0.2, 0.7, 0.2, 1);

  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  color: var(--ax-text);
}

.actions__loading {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin: 0;
  font-size: 15px;
  color: var(--ax-soft);
}

.actions__pulse {
  width: 8px;
  height: 8px;
  background-color: var(--ax-brass);
  transform: rotate(45deg);
  animation: ax-pulse 1.1s ease-in-out infinite alternate;
}

.actions__error {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}

/* ── El turno en una línea ─────────────────────────────────────────────── */

.actions__ticket {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-4);
  background-color: var(--ax-panel);
  border: 1px solid var(--ax-line);
  border-top: 3px solid var(--ax-brass);
  border-radius: 2px;
  animation: ax-rise 0.6s var(--ax-ease) backwards;
}

.actions__leaf {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  padding: var(--space-2) var(--space-1);
  color: var(--color-brand-accent-text);
  background-color: var(--ax-brass);
  border-radius: 2px;
}

.actions__leaf-month {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.actions__leaf-day {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1;
}

.actions__ticket-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.actions__when {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
}

.actions__time {
  white-space: nowrap;
}

/* Solo el día de la semana lleva mayúscula inicial: «a. m.» no debe volverse «A. M.». */
.actions__weekday {
  text-transform: capitalize;
}

.actions__what,
.actions__where {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--ax-soft);
  overflow-wrap: anywhere;
}

.actions__where {
  font-size: 13px;
  color: var(--ax-muted);
}

.actions__stamp {
  align-self: flex-start;
  margin-bottom: var(--space-1);
  padding: 2px var(--space-2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-danger-on-strong);
  border: 1px solid currentcolor;
  border-radius: 2px;
}

/* ── Las dos acciones ──────────────────────────────────────────────────── */

.actions__menu {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.actions__menu > li {
  display: flex;
  animation: ax-rise 0.6s var(--ax-ease) 0.08s backwards;
}

.actions__menu > li + li {
  animation-delay: 0.16s;
}

.actions__choice {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-4);
  align-items: center;
  width: 100%;
  min-height: 88px;
  padding: var(--space-4) var(--space-5);
  font: inherit;
  color: var(--ax-text);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  background-color: var(--ax-panel);
  border: 1px solid var(--ax-line);
  border-radius: 2px;
  transition:
    transform 0.25s var(--ax-ease),
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.actions__choice:hover {
  background-color: color-mix(in srgb, var(--ax-brass) 7%, var(--ax-panel));
  border-color: color-mix(in srgb, var(--ax-brass) 55%, transparent);
  transform: translateY(-2px);
}

.actions__choice:focus-visible {
  outline: 2px solid var(--ax-brass);
  outline-offset: 3px;
}

.actions__choice--cancel:hover {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 7%, var(--ax-panel));
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 55%, transparent);
}

.actions__choice--off {
  cursor: default;
  opacity: 0.72;
}

.actions__choice--off:hover {
  background-color: var(--ax-panel);
  border-color: var(--ax-line);
  transform: none;
}

.actions__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--ax-brass);
  border: 1px solid color-mix(in srgb, var(--ax-brass) 45%, transparent);
  border-radius: 50%;
}

.actions__choice--cancel .actions__icon {
  color: var(--color-danger-on-strong);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 45%, transparent);
}

.actions__icon svg {
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.actions__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.actions__label {
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 28px;
}

.actions__hint {
  font-size: 14px;
  line-height: 20px;
  color: var(--ax-soft);
  overflow-wrap: anywhere;
}

.actions__go {
  font-size: 20px;
  color: var(--ax-brass);
  transition: transform 0.25s var(--ax-ease);
}

.actions__choice--cancel .actions__go {
  color: var(--color-danger-on-strong);
}

.actions__choice:hover .actions__go {
  transform: translateX(4px);
}

/* ── Cancelar aquí mismo ───────────────────────────────────────────────── */

.actions__cancel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background-color: var(--ax-panel);
  border: 1px solid var(--ax-line);
  border-top: 3px solid var(--color-danger-on-strong);
  border-radius: 2px;
  animation: ax-rise 0.5s var(--ax-ease) backwards;
}

/* Dentro del panel la sección no necesita su propia raya superior. */
.actions__cancel :deep(.appointment-cancel) {
  padding-top: 0;
  border-top: 0;
}

.actions__back {
  align-self: flex-start;
  min-height: 44px;
  padding: 0;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--ax-soft);
  cursor: pointer;
  background: none;
  border: 0;
}

.actions__back:hover {
  color: var(--ax-text);
}

.actions__back:focus-visible {
  outline: 2px solid var(--ax-brass);
  outline-offset: 3px;
}

/* ── Desenlaces y salida ───────────────────────────────────────────────── */

.actions__done {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  background-color: color-mix(in srgb, var(--color-success-on-strong) 10%, var(--ax-panel));
  border: 1px solid color-mix(in srgb, var(--color-success-on-strong) 40%, transparent);
  border-radius: 2px;
}

.actions__done:focus-visible {
  outline: 2px solid var(--ax-brass);
  outline-offset: 3px;
}

.actions__done-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 32px;
}

.actions__done-text,
.actions__note {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  color: var(--ax-soft);
}

.actions__done-link {
  align-self: flex-start;
  margin-top: var(--space-2);
  font-weight: 600;
  color: var(--ax-brass);
}

.actions__full {
  align-self: center;
  padding: var(--space-2) 0;
  font-size: 14px;
  color: var(--ax-soft);
  text-underline-offset: 3px;
}

.actions__full:hover {
  color: var(--ax-text);
}

.actions__full:focus-visible,
.actions__done-link:focus-visible {
  outline: 2px solid var(--ax-brass);
  outline-offset: 3px;
}

@keyframes ax-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@keyframes ax-pulse {
  to {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .actions__ticket,
  .actions__menu > li,
  .actions__cancel,
  .actions__pulse {
    animation: none;
  }

  .actions__choice,
  .actions__go {
    transition: none;
  }

  .actions__choice:hover,
  .actions__choice:hover .actions__go {
    transform: none;
  }
}

@media (width < 400px) {
  .actions__choice {
    grid-template-columns: auto 1fr;
    padding: var(--space-4);
  }

  .actions__go {
    display: none;
  }
}
</style>
