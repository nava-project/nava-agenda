<script setup lang="ts">
// Pantalla dedicada «Cambiar la hora» del turno del cliente (HU-104, DEC-178).
// v2 «La luz del día» (DEC-188, 2c): el marco de la reserva, el mismo selector que
// «Día y hora» (DayTimePicker: días, franja del día y horas en filas, con la hora
// actual marcada y no elegible) y el pase con la hora de ahora y la nueva.
//
// La página posee la carga (turno y franjas a la vez), la selección, el envío y la
// clave de idempotencia. Plazo, límite, franja y versión los decide el servidor;
// `rescheduleAvailability` es solo una pista para no ofrecer lo que no procede.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import { civilDateChip, formatCivilDateFull, getCivilDateInTimezone } from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import {
  BookingStateScreen,
  DayTimePicker,
  PublicFrame,
  buildDaylightDays,
  type DaylightDay,
  type DaylightSlot,
} from '@/modules/public-booking'
import { getCustomerAppointment } from '../api/getCustomerAppointmentApi'
import { listRescheduleSlots } from '../api/listRescheduleSlotsApi'
import { rescheduleCustomerAppointment } from '../api/rescheduleCustomerAppointmentApi'
import { newIdempotencyKey } from '../model/idempotencyKey'
import { calendarLeaf } from '../model/appointmentMoment'
import { timezoneLabel, timezoneName } from '@/shared/time/timezoneName'
import { rescheduleAvailability } from '../model/rescheduleAvailability'
import type { CustomerAppointment } from '../model/customerAppointmentOutcome'
import '../styles/myTurnV2.css'

interface Props {
  /** Credencial en claro del enlace (`:token`). No confiada: el servidor la
   * vuelve a resolver en cada llamada y nunca se registra aquí. */
  token: string
}
const props = defineProps<Props>()

type ScreenState =
  | { status: 'loading' }
  | { status: 'ready'; appointment: CustomerAppointment; days: DaylightDay[]; grid: number }
  | { status: 'done'; appointment: CustomerAppointment; previousStartsAt: string }
  | { status: 'not-found' }
  | { status: 'network-error' }
  | { status: 'unexpected-error'; requestId?: string }

const screenState = ref<ScreenState>({ status: 'loading' })
const nowMs = ref(Date.now())
/** Rechazo de política que devolvió el servidor: prevalece sobre la pista local. */
const serverBlock = ref<'window-closed' | 'limit-reached' | null>(null)
const notice = ref('')
const submitError = ref('')
const submitting = ref(false)
const selectedStart = ref<string | null>(null)
const activeDate = ref<string | null>(null)
const doneHeading = ref<HTMLElement | null>(null)

let loadSeq = 0
// La clave se reutiliza solo al reintentar la MISMA hora tras un fallo de red o una
// respuesta inesperada; cualquier otra cosa es un intento nuevo (RN-IDE-01, DEC-043).
let lastAttempt: { startsAt: string; key: string } | null = null

async function load(options: { keepDay?: string } = {}) {
  const seq = ++loadSeq
  screenState.value = { status: 'loading' }
  selectedStart.value = null
  const [appointmentOutcome, slotsOutcome] = await Promise.all([
    getCustomerAppointment(props.token),
    listRescheduleSlots(props.token),
  ])
  if (seq !== loadSeq) return
  nowMs.value = Date.now()

  for (const outcome of [appointmentOutcome, slotsOutcome]) {
    if (outcome.kind === 'not-found') {
      screenState.value = { status: 'not-found' }
      return
    }
    if (outcome.kind === 'network-error') {
      screenState.value = { status: 'network-error' }
      return
    }
    if (outcome.kind === 'unexpected-error') {
      screenState.value = { status: 'unexpected-error', requestId: outcome.requestId }
      return
    }
  }
  if (appointmentOutcome.kind !== 'success' || slotsOutcome.kind !== 'success') return

  const { starts, timezone: zone } = slotsOutcome.slots
  const days = buildDaylightDays(
    starts.map((startsAt) => ({ startsAt, professionalId: '' })),
    zone,
    null,
  )
  const kept = days.find((d) => d.civilDate === options.keepDay)
  activeDate.value = (kept ?? days[0])?.civilDate ?? null
  screenState.value = {
    status: 'ready',
    appointment: appointmentOutcome.appointment,
    days,
    grid: agendaStep(starts, zone),
  }
}

// El paso de la agenda no viaja con las franjas: se deduce de sus minutos (todos en
// :00 y :30 → 30). Sirve para las columnas fijas de los minutos y la franja.
function agendaStep(starts: string[], zone: string): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  let step = 60
  for (const start of starts) {
    const minute = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, minute: 'numeric' }).format(
        new Date(start),
      ),
    )
    step = gcd(step, minute)
  }
  return step >= 5 ? step : 15
}

onMounted(() => void load())
watch(
  () => props.token,
  () => {
    serverBlock.value = null
    notice.value = ''
    void load()
  },
)

const appointment = computed(() =>
  screenState.value.status === 'ready' || screenState.value.status === 'done'
    ? screenState.value.appointment
    : null,
)
const v = computed(() => buildVocabularyFromTerms(appointment.value?.vocabulary ?? null))
const days = computed(() => (screenState.value.status === 'ready' ? screenState.value.days : []))
const grid = computed(() => (screenState.value.status === 'ready' ? screenState.value.grid : 15))
const timezone = computed(() => appointment.value?.timezone ?? 'UTC')

const availability = computed(() => {
  const a = appointment.value
  if (!a) return null
  if (serverBlock.value) return { mode: 'unavailable', reason: serverBlock.value } as const
  return rescheduleAvailability(a, nowMs.value)
})

const myTurnHref = computed(() => `/mi-turno/${encodeURIComponent(props.token)}`)

function timeLabel(iso: string): string {
  return formatTimeInTimezone(iso, timezone.value)
}

function endFor(startIso: string): string {
  const minutes = appointment.value?.durationMinutes ?? 0
  return new Date(Date.parse(startIso) + minutes * 60_000).toISOString()
}

// ── Lectura del «antes» y el «después» ───────────────────────────────────────

const current = computed(() => {
  const a = appointment.value
  if (!a) return null
  return {
    leaf: calendarLeaf(a.startsAt, a.timezone),
    start: timeLabel(a.startsAt),
    end: timeLabel(a.endsAt),
  }
})

const proposed = computed(() => {
  const start = selectedStart.value
  if (!start) return null
  return {
    leaf: calendarLeaf(start, timezone.value),
    start: timeLabel(start),
    end: timeLabel(endFor(start)),
  }
})

const deadlineLabel = computed(() => {
  const a = availability.value
  if (!a || a.mode !== 'available') return ''
  const iso = new Date(a.deadlineMs).toISOString()
  const civil = getCivilDateInTimezone(timezone.value, new Date(a.deadlineMs))
  const chip = civilDateChip(civil)
  return `${timeLabel(iso)} del ${chip.weekday} ${chip.day} ${chip.month}`
})

const remainingLabel = computed(() => {
  const a = availability.value
  if (!a || a.mode !== 'available') return ''
  return a.remaining === 1 ? 'Te queda 1 cambio' : `Te quedan ${a.remaining} cambios`
})

const unavailableCopy = computed(() => {
  const a = availability.value
  if (!a || a.mode !== 'unavailable') return null
  switch (a.reason) {
    case 'not-confirmed':
      return {
        headline: 'Este turno ya no se puede mover',
        body: 'Solo un turno confirmado puede cambiar de hora. Revisa en qué quedó.',
      }
    case 'window-closed':
      return {
        headline: 'Ya no puedes cambiar la hora por tu cuenta',
        body: `El plazo para cambiarla venció. Si necesitas moverla, escribe ${v.value.toTheBusiness}.`,
      }
    case 'limit-reached':
      return {
        headline: 'Ya usaste los cambios de este turno',
        body: `Cada turno se puede mover por tu cuenta hasta 2 veces. Para otro cambio, escribe ${v.value.toTheBusiness}.`,
      }
  }
  return null
})

const contact = computed(() => {
  const a = appointment.value
  if (!a) return []
  const items: { label: string; href: string; text: string }[] = []
  if (a.businessContactPhone) {
    items.push({
      label: 'Teléfono',
      href: `tel:${a.businessContactPhone}`,
      text: a.businessContactPhone,
    })
  }
  if (a.businessContactEmail) {
    items.push({
      label: 'Correo',
      href: `mailto:${a.businessContactEmail}`,
      text: a.businessContactEmail,
    })
  }
  return items
})

// Oración completa para la tecnología de apoyo: fecha, hora y zona juntas
// (mismo criterio que CA-095-02), nunca una hora suelta.
const selectionSummary = computed(() => {
  const start = selectedStart.value
  if (!start) return ''
  const civil = getCivilDateInTimezone(timezone.value, new Date(start))
  return `Nueva hora elegida: ${formatCivilDateFull(civil)}, de ${timeLabel(start)} a ${timeLabel(endFor(start))}, ${timezoneName(timezone.value)}.`
})

const confirmLabel = computed(() => {
  const start = selectedStart.value
  if (!start) return 'Elige una hora'
  const chip = civilDateChip(getCivilDateInTimezone(timezone.value, new Date(start)))
  return `Cambiar a ${chip.weekday} ${chip.day}, ${timeLabel(start)}`
})

// ── Selección (el teclado y el foco los lleva DayTimePicker) ─────────────────

function selectSlot(slot: DaylightSlot) {
  if (submitting.value) return
  selectedStart.value = slot.startsAt
  submitError.value = ''
}

// ── Envío ────────────────────────────────────────────────────────────────────

function attemptKey(startsAt: string): string {
  if (lastAttempt && lastAttempt.startsAt === startsAt) return lastAttempt.key
  lastAttempt = { startsAt, key: newIdempotencyKey() }
  return lastAttempt.key
}

async function confirmChange() {
  const state = screenState.value
  const start = selectedStart.value
  if (state.status !== 'ready' || !start || submitting.value) return
  submitting.value = true
  submitError.value = ''
  notice.value = ''
  const outcome = await rescheduleCustomerAppointment(
    props.token,
    state.appointment.versionToken,
    attemptKey(start),
    start,
  )
  submitting.value = false

  switch (outcome.kind) {
    case 'success':
      lastAttempt = null
      screenState.value = {
        status: 'done',
        previousStartsAt: state.appointment.startsAt,
        appointment: {
          ...state.appointment,
          startsAt: outcome.startsAt,
          endsAt: outcome.endsAt,
          rescheduleRemaining: Math.max(0, state.appointment.rescheduleRemaining - 1),
        },
      }
      await nextTick()
      doneHeading.value?.focus()
      return
    case 'slot-taken': {
      lastAttempt = null
      const day = activeDate.value ?? undefined
      await load({ keepDay: day })
      notice.value = 'Esa hora se acaba de ocupar. Te mostramos las que siguen libres.'
      return
    }
    case 'changed':
      lastAttempt = null
      await load()
      notice.value = 'Tu turno cambió mientras elegías. Esto es lo que figura ahora.'
      return
    case 'window-closed':
    case 'limit-reached':
      lastAttempt = null
      serverBlock.value = outcome.kind
      return
    case 'not-found':
      lastAttempt = null
      screenState.value = { status: 'not-found' }
      return
    case 'idempotency-in-progress':
      submitError.value = 'Tu cambio sigue en curso. Espera unos segundos e inténtalo de nuevo.'
      return
    case 'validation-error':
      lastAttempt = null
      submitError.value = 'No pudimos usar esa hora. Elige otra e inténtalo de nuevo.'
      return
    case 'network-error':
      submitError.value = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
      return
    case 'unexpected-error':
      submitError.value = outcome.requestId
        ? `No pudimos cambiar la hora. Si continúa, comparte este código con soporte: ${outcome.requestId}.`
        : 'No pudimos cambiar la hora. Inténtalo de nuevo en unos segundos.'
  }
}

const retry = () => void load()

const doneSummary = computed(() => {
  if (screenState.value.status !== 'done') return null
  const a = screenState.value.appointment
  const civil = getCivilDateInTimezone(a.timezone, new Date(a.startsAt))
  return {
    date: formatCivilDateFull(civil),
    start: timeLabel(a.startsAt),
    end: timeLabel(a.endsAt),
    previous: timeLabel(screenState.value.previousStartsAt),
    previousLeaf: calendarLeaf(screenState.value.previousStartsAt, a.timezone),
    leaf: calendarLeaf(a.startsAt, a.timezone),
    remaining: a.rescheduleRemaining,
  }
})

// Enlace que no abre: no se distingue vencido, usado o incompleto (CA-098-02).
const NOT_FOUND = {
  headline: 'No pudimos abrir ese enlace',
  body: 'Puede haber vencido o estar incompleto. Ábrelo de nuevo desde el correo de tu reserva.',
}

const pageState = computed(() =>
  screenState.value.status === 'loading' ||
  screenState.value.status === 'not-found' ||
  screenState.value.status === 'network-error' ||
  screenState.value.status === 'unexpected-error'
    ? screenState.value.status
    : null,
)

const requestId = computed(() =>
  screenState.value.status === 'unexpected-error' ? screenState.value.requestId : undefined,
)
</script>

<template>
  <PublicFrame :business-name="appointment?.businessName ?? ''" caption="Cambiar la hora">
    <BookingStateScreen
      v-if="pageState"
      :status="pageState"
      title="Cambiar la hora de tu turno"
      loading-headline="Buscando horas libres…"
      :request-id="requestId"
      :not-found="NOT_FOUND"
      @retry="retry"
    />

    <!-- Listo: el pase vuelve con la hora nueva y la de antes, tachada. -->
    <main v-else-if="screenState.status === 'done' && doneSummary" class="bk-page mt">
      <p class="bk-kicker">Hora cambiada</p>
      <h1 ref="doneHeading" class="bk-title mt__title" tabindex="-1">Tu turno cambió de hora</h1>

      <p class="mt-access__lead" role="status">
        Listo. Tu turno quedó para el {{ doneSummary.date }}, de {{ doneSummary.start }} a
        {{ doneSummary.end }}.
      </p>

      <article class="mt-pase mt-pase--landed stamp" aria-label="Turno con la hora nueva">
        <p class="mt-pase__service">
          {{ screenState.appointment.serviceName }}
          <span class="mt-pase__minutes">con {{ screenState.appointment.professionalName }}</span>
        </p>
        <p class="mt-pase__when">
          <span class="mt-pase__day"
            >{{ doneSummary.leaf.weekday }}, {{ doneSummary.leaf.longDate }}</span
          >
          <span class="mt-pase__time">{{ doneSummary.start }} – {{ doneSummary.end }}</span>
        </p>
        <p class="mt-swap__before">
          Antes:
          {{ doneSummary.previousLeaf.weekday }} {{ doneSummary.previousLeaf.day }}
          {{ doneSummary.previousLeaf.month }},
          <span class="stamp__time--struck">{{ doneSummary.previous }}</span>
        </p>
      </article>

      <p class="mt-block__policy mt-swap__fine">
        <template v-if="doneSummary.remaining > 0"
          >Si lo necesitas, puedes cambiarla
          {{
            doneSummary.remaining === 1 ? 'una vez más' : `${doneSummary.remaining} veces más`
          }}.</template
        >
        <template v-else>Este fue el último cambio que puedes hacer por tu cuenta.</template>
        El recordatorio te llegará con la hora nueva.
      </p>

      <a class="bk-cta mt-swap__cta reschedule__cta" :href="myTurnHref">Ver mi turno</a>
    </main>

    <main
      v-else-if="screenState.status === 'ready' && appointment && current"
      class="bk-page mt-swap"
      :class="{ 'mt-swap--bar': availability?.mode === 'available' && days.length > 0 }"
    >
      <p class="bk-kicker">Tu turno</p>
      <h1 class="bk-title mt__title">Cambiar la hora</h1>
      <p class="mt-swap__lede">
        Elige otro día y hora con {{ appointment.professionalName }}. El servicio, el precio y la
        duración siguen igual.
      </p>

      <BaseAlert v-if="notice" variant="warning" role="status">{{ notice }}</BaseAlert>

      <div class="mt-swap__grid">
        <!-- El pase: la hora de ahora y la nueva. En pantallas anchas queda fijo en el
             riel derecho, como en «Día y hora»; en móvil, arriba. -->
        <aside class="mt-swap__aside">
          <article
            class="mt-pase stamp"
            :class="{ 'mt-pase--picked': proposed }"
            aria-label="Hora actual y hora nueva"
          >
            <p class="mt-pase__service">
              {{ appointment.serviceName }}
              <span class="mt-pase__minutes">{{ appointment.durationMinutes }} min</span>
            </p>
            <div class="mt-swap__row">
              <p class="mt-swap__label">Hora actual</p>
              <p class="mt-swap__now">
                {{ current.leaf.weekday }} {{ current.leaf.day }} {{ current.leaf.month }},
                <span :class="{ 'stamp__time--struck': proposed }"
                  >{{ current.start }} – {{ current.end }}</span
                >
              </p>
            </div>
            <div class="mt-swap__row mt-swap__row--new">
              <p class="mt-swap__label">Hora nueva</p>
              <p v-if="proposed" :key="selectedStart ?? ''" class="mt-pase__when mt-swap__in">
                <span class="mt-pase__day"
                  >{{ proposed.leaf.weekday }}, {{ proposed.leaf.longDate }}</span
                >
                <span class="mt-pase__time">{{ proposed.start }} – {{ proposed.end }}</span>
              </p>
              <p v-else class="mt-swap__placeholder">Elige un día y una hora</p>
            </div>
            <p class="mt-pase__zone">{{ timezoneLabel(timezone) }}</p>
          </article>

          <ul v-if="availability?.mode === 'available'" class="mt-swap__facts">
            <li>{{ remainingLabel }}</li>
            <li>Puedes cambiarla hasta las {{ deadlineLabel }}</li>
          </ul>
        </aside>

        <!-- No se puede: la razón y a quién escribir. -->
        <section
          v-if="availability?.mode === 'unavailable' && unavailableCopy"
          class="mt-section mt-swap__blocked"
          role="status"
          aria-labelledby="reschedule-blocked-title"
        >
          <h2 id="reschedule-blocked-title">{{ unavailableCopy.headline }}</h2>
          <p class="mt-section__lead">{{ unavailableCopy.body }}</p>
          <ul
            v-if="contact.length && availability.reason !== 'not-confirmed'"
            class="mt-swap__contact"
          >
            <li v-for="item in contact" :key="item.href">
              <span>{{ item.label }}</span>
              <a :href="item.href">{{ item.text }}</a>
            </li>
          </ul>
          <a class="bk-link reschedule__back" :href="myTurnHref">Volver a mi turno</a>
        </section>

        <section v-else class="mt-swap__picker" aria-labelledby="reschedule-picker-title">
          <h2 id="reschedule-picker-title" class="bk-section-title">Elige día y hora</h2>

          <div v-if="days.length === 0" class="bk-empty">
            <p>
              No hay otras horas libres con {{ appointment.professionalName }} en este momento.
              Vuelve a mirar más tarde o escribe {{ v.toTheBusiness }}.
            </p>
            <a class="bk-link reschedule__back" :href="myTurnHref">Volver a mi turno</a>
          </div>

          <template v-else>
            <DayTimePicker
              v-model:active-date="activeDate"
              :days="days"
              :selected-start="selectedStart"
              :current="appointment.startsAt"
              :slot-grid-minutes="grid"
              :duration-minutes="appointment.durationMinutes"
              :timezone="timezone"
              :disabled="submitting"
              selected-label="Hora nueva"
              @select="selectSlot"
            />

            <p v-if="selectionSummary" class="visually-hidden" role="status">
              {{ selectionSummary }}
            </p>

            <div class="mt-swap__bar">
              <p v-if="submitError" class="mt-field__error" role="alert">{{ submitError }}</p>
              <div class="mt-swap__actions">
                <a class="bk-link" :href="myTurnHref">No cambiar</a>
                <button
                  type="button"
                  class="bk-cta mt-swap__confirm"
                  :class="{ 'bk-cta--idle': !selectedStart }"
                  :disabled="!selectedStart || submitting"
                  :aria-busy="submitting"
                  @click="confirmChange"
                >
                  {{ submitting ? 'Cambiando…' : confirmLabel }}
                </button>
              </div>
            </div>
          </template>
        </section>
      </div>
    </main>
  </PublicFrame>
</template>
