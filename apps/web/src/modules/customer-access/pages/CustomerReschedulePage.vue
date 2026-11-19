<script setup lang="ts">
// Pantalla dedicada «Cambiar la hora» del turno del cliente (HU-104, DEC-178).
// v2 «La luz del día» (DEC-188, 2c): el marco de la reserva, los mismos chips de
// día y de minuto que «Día y hora», y el pase con la hora de ahora y la nueva.
//
// La página posee la carga (turno y franjas a la vez), la selección, el envío y la
// clave de idempotencia. Plazo, límite, franja y versión los decide el servidor;
// `rescheduleAvailability` es solo una pista para no ofrecer lo que no procede.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import { civilDateChip, formatCivilDateFull, getCivilDateInTimezone } from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import { BookingStateScreen, PublicFrame } from '@/modules/public-booking'
import { getCustomerAppointment } from '../api/getCustomerAppointmentApi'
import { listRescheduleSlots } from '../api/listRescheduleSlotsApi'
import { rescheduleCustomerAppointment } from '../api/rescheduleCustomerAppointmentApi'
import { newIdempotencyKey } from '../model/idempotencyKey'
import { calendarLeaf, timezoneCity } from '../model/appointmentMoment'
import {
  groupStartsByCivilDate,
  rescheduleAvailability,
  sameInstant,
  type RescheduleDay,
} from '../model/rescheduleAvailability'
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
  | { status: 'ready'; appointment: CustomerAppointment; days: RescheduleDay[] }
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
const activeDayIndex = ref(0)
const activeSlotIndex = ref(0)
const slotRefs = ref<HTMLElement[]>([])
const dayRefs = ref<HTMLElement[]>([])
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

  const days = groupStartsByCivilDate(slotsOutcome.slots.starts, slotsOutcome.slots.timezone)
  const keptIndex = options.keepDay ? days.findIndex((d) => d.civilDate === options.keepDay) : -1
  activeDayIndex.value = keptIndex >= 0 ? keptIndex : 0
  activeSlotIndex.value = 0
  screenState.value = { status: 'ready', appointment: appointmentOutcome.appointment, days }
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
const activeDay = computed<RescheduleDay | null>(() => days.value[activeDayIndex.value] ?? null)
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

function dayChip(civilDate: string) {
  return civilDateChip(civilDate)
}

// El mes solo en el primer día y donde cambia, como en «Día y hora».
function monthOf(index: number): string {
  const month = dayChip(days.value[index]!.civilDate).month
  const previous = index > 0 ? dayChip(days.value[index - 1]!.civilDate).month : null
  return month === previous ? '' : month
}

function isCurrent(start: string): boolean {
  return appointment.value ? sameInstant(start, appointment.value.startsAt) : false
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
  return `Nueva hora elegida: ${formatCivilDateFull(civil)}, de ${timeLabel(start)} a ${timeLabel(endFor(start))}, hora de ${timezoneCity(timezone.value)}.`
})

const confirmLabel = computed(() => {
  const start = selectedStart.value
  if (!start) return 'Elige una hora'
  const chip = civilDateChip(getCivilDateInTimezone(timezone.value, new Date(start)))
  return `Cambiar a ${chip.weekday} ${chip.day}, ${timeLabel(start)}`
})

// ── Selección con teclado (roving tabindex, mismo patrón que HU-095) ─────────

function setSlotRef(el: Element | { $el?: Element } | null, index: number) {
  if (el instanceof HTMLElement) slotRefs.value[index] = el
}

function setDayRef(el: Element | { $el?: Element } | null, index: number) {
  if (el instanceof HTMLElement) dayRefs.value[index] = el
}

watch(activeDayIndex, async () => {
  slotRefs.value = []
  const day = activeDay.value
  const preserved = day?.starts.findIndex((s) => s === selectedStart.value) ?? -1
  activeSlotIndex.value = preserved >= 0 ? preserved : 0
  await nextTick()
  dayRefs.value[activeDayIndex.value]?.scrollIntoView?.({
    inline: 'center',
    block: 'nearest',
    behavior: 'smooth',
  })
})

function chooseDay(index: number) {
  activeDayIndex.value = index
}

function selectStart(start: string) {
  if (isCurrent(start) || submitting.value) return
  selectedStart.value = start
  submitError.value = ''
  const index = activeDay.value?.starts.indexOf(start) ?? -1
  if (index >= 0) activeSlotIndex.value = index
}

async function focusActiveSlot() {
  await nextTick()
  slotRefs.value[activeSlotIndex.value]?.focus()
}

function onSlotsKeydown(event: KeyboardEvent) {
  const count = activeDay.value?.starts.length ?? 0
  if (count === 0) return
  const move = (to: number) => {
    event.preventDefault()
    activeSlotIndex.value = (to + count) % count
    void focusActiveSlot()
  }
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      move(activeSlotIndex.value + 1)
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      move(activeSlotIndex.value - 1)
      break
    case 'Home':
      move(0)
      break
    case 'End':
      move(count - 1)
      break
    case ' ':
    case 'Enter': {
      event.preventDefault()
      const start = activeDay.value?.starts[activeSlotIndex.value]
      if (start) selectStart(start)
      break
    }
  }
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
      const day = activeDay.value?.civilDate
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
        <!-- El pase: la hora de ahora y la nueva. En pantallas anchas queda fijo a la
             izquierda mientras se elige a la derecha. -->
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
            <p class="mt-pase__zone">Horas de {{ timezoneCity(timezone) }}</p>
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
          <h2 id="reschedule-picker-title" class="bk-section-title">Elige el día</h2>

          <div v-if="days.length === 0" class="bk-empty">
            <p>
              No hay otras horas libres con {{ appointment.professionalName }} en este momento.
              Vuelve a mirar más tarde o escribe {{ v.toTheBusiness }}.
            </p>
            <a class="bk-link reschedule__back" :href="myTurnHref">Volver a mi turno</a>
          </div>

          <template v-else>
            <div class="bk-days mt-swap__days" role="group" aria-label="Días con horas libres">
              <button
                v-for="(day, index) in days"
                :key="day.civilDate"
                :ref="(el) => setDayRef(el as Element | null, index)"
                type="button"
                class="bk-day reschedule__day"
                :aria-current="index === activeDayIndex ? 'date' : undefined"
                :aria-label="formatCivilDateFull(day.civilDate)"
                @click="chooseDay(index)"
              >
                <span class="bk-day__month">{{ monthOf(index) }}</span>
                <span class="bk-day__weekday">{{ dayChip(day.civilDate).weekday }}</span>
                <span class="bk-day__number">{{ dayChip(day.civilDate).day }}</span>
              </button>
            </div>

            <h2 class="bk-section-title">
              Elige la hora
              <span class="mt-swap__note">{{
                activeDay ? formatCivilDateFull(activeDay.civilDate) : ''
              }}</span>
            </h2>

            <ul
              class="mt-swap__slots"
              role="radiogroup"
              :aria-label="`Horas libres del ${activeDay ? formatCivilDateFull(activeDay.civilDate) : ''}`"
              @keydown="onSlotsKeydown"
            >
              <li
                v-for="(start, index) in activeDay?.starts ?? []"
                :key="start"
                :ref="(el) => setSlotRef(el as Element | null, index)"
                class="bk-min mt-swap__slot"
                :class="{ 'mt-swap__slot--current': isCurrent(start) }"
                role="radio"
                :aria-checked="selectedStart === start"
                :aria-disabled="isCurrent(start) ? 'true' : undefined"
                :aria-label="
                  isCurrent(start) ? `${timeLabel(start)}, tu hora actual` : timeLabel(start)
                "
                :tabindex="index === activeSlotIndex ? 0 : -1"
                @click="selectStart(start)"
              >
                {{ timeLabel(start) }}
                <span v-if="isCurrent(start)" class="mt-swap__tag" aria-hidden="true">actual</span>
              </li>
            </ul>

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
