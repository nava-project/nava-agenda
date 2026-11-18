<script setup lang="ts">
// Pantalla dedicada «Cambiar la hora» del turno del cliente (HU-104, DEC-178).
// Sin mockup asignado: identidad guiada NAVA / Tailored Grid (DEC-078), sobre la
// misma tinta y el mismo boleto de «Mi turno» (issue #573), para que cambiar la
// hora se lea como «volver a sellar el mismo boleto».
//
// La página posee la carga (turno y franjas a la vez), la selección, el envío y la
// clave de idempotencia. Plazo, límite, franja y versión los decide el servidor;
// `rescheduleAvailability` es solo una pista para no ofrecer lo que no procede.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert, BaseButton, NavaWordmark, PageState } from '@/shared/ui'
import { buildVocabularyFromTerms } from '@/shared/model'
import { NAVA_PRIVACY_URL, NAVA_TERMS_URL } from '@/shared/model/navaSite'
import { civilDateChip, formatCivilDateFull, getCivilDateInTimezone } from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import { BookingBackdrop } from '@/modules/public-booking'
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

const unexpectedErrorMessage = computed(() => {
  const state = screenState.value
  if (state.status !== 'unexpected-error') return ''
  return state.requestId
    ? `Inténtalo de nuevo. Si continúa, comparte este código con soporte: ${state.requestId}.`
    : 'Inténtalo de nuevo en unos segundos.'
})
</script>

<template>
  <div class="reschedule">
    <BookingBackdrop />

    <header class="reschedule__masthead">
      <NavaWordmark variant="inverted" size="sm" />
      <span class="reschedule__caption">Cambiar la hora</span>
    </header>

    <!-- Carga y errores: mismo tratamiento que «Mi turno». -->
    <main
      v-if="
        screenState.status === 'loading' ||
        screenState.status === 'not-found' ||
        screenState.status === 'network-error' ||
        screenState.status === 'unexpected-error'
      "
      class="reschedule__main reschedule__main--state"
    >
      <h1 class="visually-hidden">Cambiar la hora de tu turno</h1>
      <PageState
        v-if="screenState.status === 'loading'"
        variant="loading"
        headline="Buscando horas libres…"
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
          >Puede haber vencido o estar escrito de forma incompleta. Revisa el correo de confirmación
          y vuelve a intentarlo.</template
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

    <!-- Listo: el boleto vuelve sellado con la hora nueva. -->
    <main v-else-if="screenState.status === 'done' && doneSummary" class="reschedule__main">
      <div class="reschedule__intro">
        <p class="reschedule__eyebrow">Tu turno en</p>
        <h1 ref="doneHeading" class="reschedule__title" tabindex="-1">
          {{ screenState.appointment.businessName }}
        </h1>
      </div>

      <BaseAlert variant="success" role="status">
        Listo. Tu turno quedó para el {{ doneSummary.date }}, de {{ doneSummary.start }} a
        {{ doneSummary.end }}
      </BaseAlert>

      <article class="stamp stamp--done" aria-label="Turno con la hora nueva">
        <span class="stamp__seal" aria-hidden="true">Nueva hora</span>
        <div class="stamp__row stamp__row--old">
          <p class="stamp__label">Antes</p>
          <p class="stamp__line">
            <span class="stamp__when"
              >{{ doneSummary.previousLeaf.weekday }} {{ doneSummary.previousLeaf.day }}
              {{ doneSummary.previousLeaf.month }}</span
            >
            <span class="stamp__time stamp__time--struck">{{ doneSummary.previous }}</span>
          </p>
        </div>
        <div class="stamp__row stamp__row--new">
          <p class="stamp__label">Ahora</p>
          <p class="stamp__line">
            <span class="stamp__leaf" aria-hidden="true">
              <span class="stamp__leaf-month">{{ doneSummary.leaf.month }}</span>
              <span class="stamp__leaf-day">{{ doneSummary.leaf.day }}</span>
            </span>
            <span class="stamp__big">
              <span class="stamp__weekday">{{ doneSummary.leaf.weekday }}</span>
              <span class="stamp__range">{{ doneSummary.start }} – {{ doneSummary.end }}</span>
            </span>
          </p>
        </div>
        <p class="stamp__foot">
          {{ screenState.appointment.serviceName }} · con
          {{ screenState.appointment.professionalName }}
        </p>
      </article>

      <p class="reschedule__fine">
        <template v-if="doneSummary.remaining > 0"
          >Si lo necesitas, puedes cambiarla
          {{
            doneSummary.remaining === 1 ? 'una vez más' : `${doneSummary.remaining} veces más`
          }}.</template
        >
        <template v-else>Este fue el último cambio que puedes hacer por tu cuenta.</template>
        El recordatorio te llegará con la hora nueva.
      </p>

      <a class="reschedule__cta" :href="myTurnHref">
        <span>Ver mi turno</span>
        <span class="reschedule__cta-arrow" aria-hidden="true">→</span>
      </a>
    </main>

    <main
      v-else-if="screenState.status === 'ready' && appointment && current"
      class="reschedule__main reschedule__main--ready"
      :class="{ 'reschedule__main--bar': availability?.mode === 'available' && days.length > 0 }"
    >
      <div class="reschedule__intro">
        <p class="reschedule__eyebrow">Tu turno en</p>
        <h1 class="reschedule__title">{{ appointment.businessName }}</h1>
        <p class="reschedule__lede">
          Elige otro día y hora con {{ appointment.professionalName }}. El servicio, el precio y la
          duración siguen igual.
        </p>
      </div>

      <BaseAlert v-if="notice" variant="warning" role="status">{{ notice }}</BaseAlert>

      <!-- El boleto con el «antes» y el «después». En pantallas anchas queda fijo
           a la izquierda mientras se elige a la derecha. -->
      <div class="reschedule__layout">
        <aside class="reschedule__aside">
          <article
            class="stamp"
            :class="{ 'stamp--picked': proposed }"
            aria-label="Hora actual y hora nueva"
          >
            <div class="stamp__head">
              <p class="stamp__service">{{ appointment.serviceName }}</p>
              <p class="stamp__meta">
                {{ appointment.durationMinutes }} min · con {{ appointment.professionalName }}
              </p>
            </div>

            <div class="stamp__row stamp__row--old">
              <p class="stamp__label">Hora actual</p>
              <p class="stamp__line">
                <span class="stamp__when"
                  >{{ current.leaf.weekday }} {{ current.leaf.day }} {{ current.leaf.month }}</span
                >
                <span class="stamp__time" :class="{ 'stamp__time--struck': proposed }"
                  >{{ current.start }} – {{ current.end }}</span
                >
              </p>
            </div>

            <div class="stamp__arrow" aria-hidden="true"></div>

            <div class="stamp__row stamp__row--new">
              <p class="stamp__label">Hora nueva</p>
              <p v-if="proposed" :key="selectedStart ?? ''" class="stamp__line stamp__line--in">
                <span class="stamp__leaf" aria-hidden="true">
                  <span class="stamp__leaf-month">{{ proposed.leaf.month }}</span>
                  <span class="stamp__leaf-day">{{ proposed.leaf.day }}</span>
                </span>
                <span class="stamp__big">
                  <span class="stamp__weekday">{{ proposed.leaf.weekday }}</span>
                  <span class="stamp__range">{{ proposed.start }} – {{ proposed.end }}</span>
                </span>
              </p>
              <p v-else class="stamp__placeholder">Elige un día y una hora</p>
            </div>

            <p class="stamp__foot">Horas de {{ timezoneCity(timezone) }}</p>
          </article>

          <ul v-if="availability?.mode === 'available'" class="reschedule__facts">
            <li class="reschedule__fact">
              <span class="reschedule__fact-mark" aria-hidden="true"></span>{{ remainingLabel }}
            </li>
            <li class="reschedule__fact">
              <span class="reschedule__fact-mark" aria-hidden="true"></span>Puedes cambiarla hasta
              las {{ deadlineLabel }}
            </li>
          </ul>
        </aside>

        <!-- No se puede: la razón y a quién escribir. -->
        <section
          v-if="availability?.mode === 'unavailable' && unavailableCopy"
          class="reschedule__blocked"
          role="status"
          aria-labelledby="reschedule-blocked-title"
        >
          <p id="reschedule-blocked-title" class="reschedule__blocked-title">
            {{ unavailableCopy.headline }}
          </p>
          <p class="reschedule__blocked-text">{{ unavailableCopy.body }}</p>
          <ul
            v-if="contact.length && availability.reason !== 'not-confirmed'"
            class="reschedule__contact"
          >
            <li v-for="item in contact" :key="item.href">
              <span class="reschedule__contact-label">{{ item.label }}</span>
              <a :href="item.href">{{ item.text }}</a>
            </li>
          </ul>
          <a class="reschedule__back" :href="myTurnHref">← Volver a mi turno</a>
        </section>

        <section v-else class="reschedule__picker" aria-labelledby="reschedule-picker-title">
          <h2 id="reschedule-picker-title" class="reschedule__section-title">
            <span class="reschedule__step" aria-hidden="true">1</span>Elige el día
          </h2>

          <div v-if="days.length === 0" class="reschedule__empty">
            <p>
              No hay otras horas libres con {{ appointment.professionalName }} en este momento.
              Vuelve a mirar más tarde o escribe {{ v.toTheBusiness }}.
            </p>
            <a class="reschedule__back" :href="myTurnHref">← Volver a mi turno</a>
          </div>

          <template v-else>
            <div class="reschedule__days" role="group" aria-label="Días con horas libres">
              <button
                v-for="(day, index) in days"
                :key="day.civilDate"
                :ref="(el) => setDayRef(el as Element | null, index)"
                type="button"
                class="reschedule__day"
                :style="{ '--i': index }"
                :aria-current="index === activeDayIndex ? 'date' : undefined"
                :aria-label="formatCivilDateFull(day.civilDate)"
                @click="chooseDay(index)"
              >
                <span class="reschedule__day-dow">{{ dayChip(day.civilDate).weekday }}</span>
                <span class="reschedule__day-num">{{ dayChip(day.civilDate).day }}</span>
                <span class="reschedule__day-month">{{ dayChip(day.civilDate).month }}</span>
              </button>
            </div>

            <h2 class="reschedule__section-title">
              <span class="reschedule__step" aria-hidden="true">2</span>Elige la hora
              <span class="reschedule__section-note">{{
                activeDay ? formatCivilDateFull(activeDay.civilDate) : ''
              }}</span>
            </h2>

            <ul
              class="reschedule__slots"
              role="radiogroup"
              :aria-label="`Horas libres del ${activeDay ? formatCivilDateFull(activeDay.civilDate) : ''}`"
              @keydown="onSlotsKeydown"
            >
              <li
                v-for="(start, index) in activeDay?.starts ?? []"
                :key="start"
                :ref="(el) => setSlotRef(el as Element | null, index)"
                class="reschedule__slot"
                :class="{
                  'reschedule__slot--selected': selectedStart === start,
                  'reschedule__slot--current': isCurrent(start),
                }"
                :style="{ '--i': index }"
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
                <span v-if="isCurrent(start)" class="reschedule__slot-tag" aria-hidden="true"
                  >actual</span
                >
              </li>
            </ul>

            <p v-if="selectionSummary" class="visually-hidden" role="status">
              {{ selectionSummary }}
            </p>

            <div class="reschedule__actionbar">
              <p v-if="submitError" class="reschedule__error" role="alert">{{ submitError }}</p>
              <div class="reschedule__actions">
                <a class="reschedule__cancel" :href="myTurnHref">No cambiar</a>
                <BaseButton
                  variant="primary"
                  :disabled="!selectedStart"
                  :loading="submitting"
                  @click="confirmChange"
                >
                  {{ confirmLabel }}
                </BaseButton>
              </div>
            </div>
          </template>
        </section>
      </div>
    </main>

    <footer class="reschedule__footer">
      <span>Turnos con</span>
      <NavaWordmark variant="inverted" size="sm" />
      <nav class="reschedule__legal" aria-label="Documentos legales">
        <a :href="NAVA_PRIVACY_URL">Privacidad</a>
        <a :href="NAVA_TERMS_URL">Condiciones</a>
      </nav>
    </footer>
  </div>
</template>

<style scoped>
/*
 * «Cambiar la hora» (HU-104) sobre la tinta de «Mi turno»: mismo lienzo, latón y
 * serif editorial. El boleto muestra la hora actual y, al elegir, la nueva entra
 * desde abajo mientras la vieja se tacha: es el mismo boleto sellado otra vez.
 * Colores solo de tokens; movimiento solo con transform/opacity/clip-path y
 * desactivado con movimiento reducido.
 */
.reschedule {
  --rs-text: var(--color-on-strong);
  --rs-muted: var(--color-on-strong-muted);
  --rs-soft: var(--color-on-strong-soft);
  --rs-brass: var(--color-brand-accent-surface);
  --rs-on-brass: var(--color-brand-accent-text);
  --rs-line: color-mix(in srgb, var(--rs-text) 14%, transparent);
  --rs-line-strong: color-mix(in srgb, var(--rs-text) 30%, transparent);
  --rs-wash: color-mix(in srgb, var(--rs-brass) 15%, transparent);
  --rs-card: color-mix(in srgb, #000 26%, var(--color-surface-strong));
  --rs-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  --rs-bar-height: 0px;

  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  overflow-x: clip;
  font-family: var(--font-sans);
  color: var(--rs-text);
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

.reschedule__masthead {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 1040px;
  min-height: var(--control-height);
  padding: var(--space-3) var(--space-4) 0;
  margin: 0 auto;
  animation: rs-fade 0.8s ease backwards;
}

.reschedule__masthead :deep(.nava-wordmark) {
  font-size: 26px;
  letter-spacing: 0.08em;
}

.reschedule__caption,
.reschedule__eyebrow,
.stamp__label,
.reschedule__contact-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.reschedule__caption {
  color: var(--rs-muted);
}

/* ── Columna ────────────────────────────────────────────────────────────── */

.reschedule__main {
  position: relative;
  /* Por encima del pie: la barra de acción fija vive dentro de este contexto de
     apilamiento y, con z-index 1, el pie (posterior en el DOM) la tapaba. */
  z-index: 2;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 640px;
  padding: var(--space-8) var(--space-4) var(--space-12);
  margin: 0 auto;
}

.reschedule__main--state {
  justify-content: center;
  padding-top: 0;
}

.reschedule__main--ready {
  max-width: 1040px;
}

/* Reserva el alto de la barra fija en móvil para que no tape el final. */
.reschedule__main--bar {
  --rs-bar-height: 148px;

  padding-bottom: calc(var(--rs-bar-height) + var(--space-6));
}

.reschedule__intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 640px;
}

.reschedule__eyebrow {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  color: var(--rs-brass);
}

.reschedule__eyebrow::before {
  content: '';
  width: 28px;
  height: 1px;
  background-color: currentcolor;
  transform-origin: left;
  animation: rs-grow 0.8s var(--rs-ease) 0.25s backwards;
}

.reschedule__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(34px, 9vw, 52px);
  font-weight: 400;
  line-height: 1.04;
  letter-spacing: -0.015em;
  overflow-wrap: anywhere;
  color: var(--rs-text);
  animation: rs-wipe 1s cubic-bezier(0.65, 0, 0.2, 1) 0.12s backwards;
}

.reschedule__title:focus-visible {
  outline: 2px solid var(--rs-brass);
  outline-offset: 4px;
}

.reschedule__lede {
  margin: 0;
  font-size: var(--font-size-body-lg);
  line-height: 1.5;
  color: var(--rs-soft);
  animation: rs-rise 0.7s var(--rs-ease) 0.3s backwards;
}

.reschedule__layout {
  display: grid;
  gap: var(--space-8);
  align-items: start;
}

.reschedule__aside {
  display: grid;
  gap: var(--space-4);
  width: 100%;
  max-width: 560px;
}

/* ── Boleto con el antes y el después ───────────────────────────────────── */

.stamp {
  position: relative;
  display: grid;
  overflow: hidden;
  background-color: var(--rs-card);
  background-image: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--rs-brass) 8%, transparent),
    transparent 180px
  );
  border: 1px solid var(--rs-line);
  border-top: 2px solid var(--rs-brass);
  border-radius: 4px;
  box-shadow:
    0 36px 60px -30px rgb(0 0 0 / 80%),
    0 0 0 1px color-mix(in srgb, var(--rs-brass) 6%, transparent);
  animation: rs-drop 0.95s cubic-bezier(0.2, 0.8, 0.2, 1) 0.4s backwards;
}

/* Cinta métrica de latón en el borde superior, como en «Mi turno». */
.stamp::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 14px;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--rs-brass) 1px, transparent 1px),
    linear-gradient(to right, var(--rs-brass) 1px, transparent 1px);
  background-repeat: repeat-x;
  background-size:
    12px 7px,
    60px 14px;
  opacity: 0.42;
  mask-image: linear-gradient(to right, transparent, #000 14%, #000 86%, transparent);
}

.stamp__head {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-8) var(--space-5) var(--space-4);
  border-bottom: 2px dashed var(--rs-line-strong);
}

.stamp__service {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(26px, 7vw, 34px);
  line-height: 1.08;
  overflow-wrap: anywhere;
}

.stamp__meta {
  margin: 0;
  color: var(--rs-soft);
  overflow-wrap: anywhere;
}

.stamp__row {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-5) var(--space-4);
}

.stamp__label {
  color: var(--rs-muted);
}

.stamp__row--new .stamp__label {
  color: var(--rs-brass);
}

.stamp__line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  margin: 0;
}

.stamp__line--in {
  animation: rs-stamp 0.55s cubic-bezier(0.2, 0.9, 0.25, 1.15) backwards;
}

.stamp__when {
  font-size: var(--font-size-body-lg);
  color: var(--rs-soft);
  text-transform: capitalize;
}

.stamp__time {
  position: relative;
  font-size: clamp(18px, 5vw, 22px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--rs-text);
}

/* La hora vieja se tacha con una línea que se dibuja de izquierda a derecha. */
.stamp__time--struck {
  color: var(--rs-muted);
}

.stamp__time--struck::after {
  content: '';
  position: absolute;
  top: 52%;
  right: -4px;
  left: -4px;
  height: 2px;
  background-color: var(--rs-brass);
  transform-origin: left;
  animation: rs-grow 0.45s cubic-bezier(0.65, 0, 0.2, 1) backwards;
}

.stamp__arrow {
  position: relative;
  height: 28px;
  margin: 0 var(--space-5);
}

.stamp__arrow::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 6px;
  left: 33px;
  border-left: 2px dotted var(--rs-line-strong);
}

.stamp__arrow::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 29px;
  width: 10px;
  height: 10px;
  background-color: var(--rs-brass);
  transform: rotate(45deg);
}

.stamp__leaf {
  display: grid;
  flex: none;
  width: 64px;
  overflow: hidden;
  text-align: center;
  border: 1px solid var(--rs-brass);
  border-radius: 3px;
}

.stamp__leaf-month {
  padding: 3px 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--rs-on-brass);
  background-color: var(--rs-brass);
}

.stamp__leaf-day {
  padding: 2px 0 6px;
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 40px;
}

.stamp__big {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.stamp__weekday {
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 30px;
  text-transform: capitalize;
}

.stamp__range {
  font-size: clamp(18px, 5vw, 22px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--rs-brass);
}

.stamp__placeholder {
  display: grid;
  place-items: center;
  min-height: 72px;
  margin: 0;
  color: var(--rs-muted);
  border: 1px dashed var(--rs-line-strong);
  border-radius: 3px;
}

.stamp__foot {
  padding: var(--space-3) var(--space-5) var(--space-5);
  margin: 0;
  font-size: var(--font-size-body-sm);
  color: var(--rs-muted);
  border-top: 1px solid var(--rs-line);
}

/* Sello «Nueva hora» del boleto ya cambiado. */
.stamp--done {
  padding-top: var(--space-6);
}

.stamp__seal {
  position: absolute;
  top: var(--space-5);
  right: var(--space-5);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--rs-brass);
  border: 2px solid var(--rs-brass);
  border-radius: 3px;
  transform: rotate(-6deg);
  animation: rs-seal 0.6s cubic-bezier(0.3, 1.6, 0.5, 1) 0.9s backwards;
}

.reschedule__facts {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
  animation: rs-rise 0.7s var(--rs-ease) 0.9s backwards;
}

.reschedule__fact {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--font-size-body-sm);
  color: var(--rs-soft);
}

.reschedule__fact-mark {
  flex: none;
  width: 7px;
  height: 7px;
  background-color: var(--rs-brass);
  transform: rotate(45deg);
}

/* ── Selector de día y hora ─────────────────────────────────────────────── */

.reschedule__picker {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
  animation: rs-rise 0.7s var(--rs-ease) 0.6s backwards;
}

.reschedule__section-title {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
  line-height: 1.2;
}

.reschedule__step {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  color: var(--rs-on-brass);
  background-color: var(--rs-brass);
  border-radius: 2px;
}

.reschedule__section-note {
  flex-basis: 100%;
  font-family: var(--font-sans);
  font-size: var(--font-size-body-sm);
  color: var(--rs-muted);
}

.reschedule__section-note::first-letter {
  text-transform: uppercase;
}

.reschedule__days {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1) var(--space-3);
  margin: 0 calc(var(--space-1) * -1);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}

.reschedule__day {
  display: grid;
  flex: none;
  gap: 2px;
  justify-items: center;
  width: 64px;
  padding: var(--space-2) 0 var(--space-3);
  font: inherit;
  color: var(--rs-soft);
  cursor: pointer;
  background-color: transparent;
  border: 1px solid var(--rs-line-strong);
  border-radius: 3px;
  scroll-snap-align: center;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
  animation: rs-rise 0.5s var(--rs-ease) backwards;
  animation-delay: calc(0.65s + var(--i, 0) * 40ms);
}

.reschedule__day:hover {
  color: var(--rs-text);
  border-color: var(--rs-brass);
}

.reschedule__day[aria-current='date'] {
  color: var(--rs-on-brass);
  background-color: var(--rs-brass);
  border-color: var(--rs-brass);
}

.reschedule__day:focus-visible,
.reschedule__slot:focus-visible {
  outline: 2px solid var(--rs-text);
  outline-offset: 2px;
}

.reschedule__day-dow,
.reschedule__day-month {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.reschedule__day-num {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 32px;
}

.reschedule__slots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.reschedule__slot {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 48px;
  padding: var(--space-2);
  font-size: var(--font-size-body);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--rs-text);
  cursor: pointer;
  background-color: color-mix(in srgb, var(--rs-text) 4%, transparent);
  border: 1px solid var(--rs-line-strong);
  border-radius: 3px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s var(--rs-ease);
  animation: rs-rise 0.45s var(--rs-ease) backwards;
  animation-delay: calc(var(--i, 0) * 25ms);
}

.reschedule__slot:hover:not(.reschedule__slot--current) {
  border-color: var(--rs-brass);
  transform: translateY(-1px);
}

.reschedule__slot--selected {
  color: var(--rs-on-brass);
  background-color: var(--rs-brass);
  border-color: var(--rs-brass);
  box-shadow: 0 10px 24px -12px color-mix(in srgb, var(--rs-brass) 70%, transparent);
}

.reschedule__slot--current {
  color: var(--rs-muted);
  cursor: default;
  background-color: transparent;
  border-style: dashed;
}

.reschedule__slot-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--rs-brass);
}

.reschedule__empty {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  color: var(--rs-soft);
  border: 1px dashed var(--rs-line-strong);
  border-radius: 4px;
}

.reschedule__empty p {
  margin: 0;
}

/* Barra de acción: fija al pie en móvil, en línea en pantallas anchas. */
.reschedule__actionbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 5;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  background-color: color-mix(in srgb, var(--color-surface-strong) 94%, transparent);
  border-top: 1px solid var(--rs-line-strong);
  backdrop-filter: blur(10px);
}

.reschedule__actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}

.reschedule__actions :deep(.base-button) {
  flex: 1;
  max-width: 360px;
}

.reschedule__error {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  font-size: var(--font-size-body-sm);
  color: var(--color-danger-on-strong);
}

.reschedule__cancel,
.reschedule__back {
  display: inline-flex;
  flex: none;
  white-space: nowrap;
  align-items: center;
  min-height: 44px;
  font-weight: 600;
  color: var(--rs-soft);
  text-underline-offset: 3px;
}

.reschedule__cancel:hover,
.reschedule__back:hover {
  color: var(--rs-text);
}

.reschedule__cancel:focus-visible,
.reschedule__back:focus-visible,
.reschedule__cta:focus-visible,
.reschedule__contact a:focus-visible,
.reschedule__legal a:focus-visible {
  outline: 2px solid var(--rs-brass);
  outline-offset: 3px;
}

/* ── No se puede cambiar ────────────────────────────────────────────────── */

.reschedule__blocked {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-1) 0 var(--space-1) var(--space-5);
  border-left: 2px solid var(--rs-brass);
  animation: rs-rise 0.7s var(--rs-ease) 0.6s backwards;
}

.reschedule__blocked-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.2;
}

.reschedule__blocked-text {
  margin: 0;
  line-height: 1.5;
  color: var(--rs-soft);
}

.reschedule__contact {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: var(--space-2) 0 0;
  list-style: none;
}

.reschedule__contact li {
  display: grid;
  gap: 2px;
}

.reschedule__contact-label {
  color: var(--rs-brass);
}

.reschedule__contact a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: var(--font-size-body-lg);
  color: var(--rs-text);
  overflow-wrap: anywhere;
  text-underline-offset: 3px;
}

/* ── Listo ──────────────────────────────────────────────────────────────── */

.reschedule__fine {
  margin: 0;
  line-height: 1.5;
  color: var(--rs-soft);
}

.reschedule__cta {
  display: inline-flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 var(--space-6);
  font-weight: 600;
  color: var(--rs-on-brass);
  text-decoration: none;
  background-color: var(--rs-brass);
  border-bottom: var(--border-width-emphasis) solid color-mix(in srgb, var(--rs-brass) 70%, #000);
  border-radius: 3px;
}

.reschedule__cta:hover {
  background-color: color-mix(in srgb, var(--rs-brass) 86%, #fff);
}

.reschedule__cta-arrow {
  transition: transform 0.2s var(--rs-ease);
}

.reschedule__cta:hover .reschedule__cta-arrow {
  transform: translateX(4px);
}

/* ── Botones sobre tinta (mismo tratamiento que «Mi turno») ─────────────── */

.reschedule :deep(.base-button) {
  font-weight: 600;
}

.reschedule :deep(.base-button--primary) {
  color: var(--rs-on-brass);
  background-color: var(--rs-brass);
  border-color: var(--rs-brass);
  border-bottom-width: var(--border-width-emphasis);
  border-bottom-color: color-mix(in srgb, var(--rs-brass) 70%, #000);
}

.reschedule :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--rs-brass) 86%, #fff);
  border-color: color-mix(in srgb, var(--rs-brass) 86%, #fff);
}

.reschedule :deep(.base-button--primary:disabled) {
  color: var(--rs-muted);
  background-color: transparent;
  border-color: var(--rs-line-strong);
}

.reschedule :deep(.base-button--secondary) {
  color: var(--rs-brass);
  background-color: transparent;
  border-color: var(--rs-brass);
}

.reschedule :deep(.base-button:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-on-strong);
}

/* ── Firma al pie ───────────────────────────────────────────────────────── */

.reschedule__footer {
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
  color: var(--rs-muted);
}

.reschedule__footer :deep(.nava-wordmark) {
  font-size: 18px;
  letter-spacing: 0.08em;
}

.reschedule__legal {
  display: flex;
  flex-basis: 100%;
  gap: var(--space-1) var(--space-5);
  justify-content: center;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
}

.reschedule__legal a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: 13px;
  color: var(--rs-muted);
  text-underline-offset: 3px;
}

/* ── Anchos ─────────────────────────────────────────────────────────────── */

/* En los móviles más angostos la etiqueta con día y hora no cabe junto a «No
   cambiar»: el botón toma todo el ancho y el enlace queda debajo. */
@media (max-width: 419px) {
  .reschedule__actions {
    flex-direction: column-reverse;
    gap: var(--space-1);
    align-items: stretch;
  }

  .reschedule__actions :deep(.base-button) {
    flex: none;
    max-width: none;
  }

  .reschedule__cancel {
    justify-content: center;
    min-height: 40px;
  }

  .reschedule__main--bar {
    --rs-bar-height: 168px;
  }
}

@media (min-width: 560px) {
  .stamp__head {
    padding: var(--space-10) var(--space-8) var(--space-5);
  }

  .stamp__row,
  .stamp__foot {
    padding-right: var(--space-8);
    padding-left: var(--space-8);
  }

  .stamp__arrow {
    margin: 0 var(--space-8);
  }
}

@media (min-width: 960px) {
  .reschedule__main--ready {
    padding-top: var(--space-12);
  }

  .reschedule__main--bar {
    --rs-bar-height: 0px;
  }

  .reschedule__layout {
    grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
    gap: var(--space-12);
  }

  .reschedule__aside {
    max-width: none;
    position: sticky;
    top: var(--space-8);
  }

  .reschedule__actionbar {
    position: static;
    padding: var(--space-5) 0 0;
    background-color: transparent;
    border-top: 1px solid var(--rs-line);
    backdrop-filter: none;
  }

  .reschedule__actions {
    max-width: none;
  }

  .reschedule__error {
    max-width: none;
  }
}

/* ── Movimiento ─────────────────────────────────────────────────────────── */

@keyframes rs-fade {
  from {
    opacity: 0;
  }
}

@keyframes rs-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes rs-grow {
  from {
    transform: scaleX(0);
  }
}

@keyframes rs-wipe {
  from {
    clip-path: inset(0 100% 0 0);
    transform: translateY(8px);
  }
  to {
    clip-path: inset(0 0 0 0);
    transform: none;
  }
}

@keyframes rs-drop {
  from {
    opacity: 0;
    transform: translateY(-24px) rotate(-1deg) scale(0.97);
  }
  60% {
    opacity: 1;
    transform: translateY(4px) rotate(0.2deg) scale(1);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes rs-stamp {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
}

@keyframes rs-seal {
  from {
    opacity: 0;
    transform: rotate(-18deg) scale(1.6);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reschedule *,
  .reschedule *::before,
  .reschedule *::after,
  .reschedule :deep(*) {
    animation: none !important;
    transition: none !important;
  }
}
</style>
