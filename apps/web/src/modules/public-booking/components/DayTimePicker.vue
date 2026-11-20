<script setup lang="ts">
/**
 * DayTimePicker · el selector de «Día y hora» v2 (DEC-188), compartido por la
 * reserva (paso 2) y por «Cambiar la hora» del turno (HU-104). Quien reservó con
 * filas por hora cambia la hora con las mismas filas.
 *
 * - Días: un grupo de radio con tabindex itinerante (las flechas, Inicio y Fin
 *   recorren), con la barra de luz libre de cada día y el mes solo donde cambia.
 * - Franja del día: el mapa del día activo; tocar un tramo libre elige la hora
 *   que cae ahí (atajo de puntero; la misma elección está en el grupo de horas).
 * - Horas: una fila por hora en punto, los minutos en columnas fijas y los
 *   tintes de Mañana, Tarde y Noche. La elegida pasa a Sol.
 * - `current` (solo «Cambiar la hora»): la hora que ya tiene el turno. Se ve
 *   (rombo hueco en la franja, chip punteado en su fila) pero no se elige.
 *
 * Solo presenta y emite: la página posee los datos, la elección y la URL.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DAYS_OF_WEEK, clockToMinutes, segmentsByDay } from '@/shared/model/openingHours'
import type { OpeningSegment } from '@/shared/model/openingHours'
import {
  civilDateChip,
  formatCivilDateFull,
  getCivilDateInTimezone,
  minutesSinceCivilMidnight,
} from '@/shared/time/civilDate'
import DaylightStrip from './DaylightStrip.vue'
import type { DaylightDay, DaylightSlot } from '../model/daylight'

interface Props {
  days: DaylightDay[]
  /** Día civil activo (`v-model:active-date`). */
  activeDate: string | null
  /** Inicio elegido, o `null`. */
  selectedStart: string | null
  /** Minutos de cada paso de la agenda (15, 20, 30, 60…). */
  slotGridMinutes: number
  /** Duración del servicio: cierra la franja cuando no hay horario del local. */
  durationMinutes: number
  /** Horario del local, si se conoce. Sin él, la franja va de la primera a la
   * última hora libre más la duración: nunca se inventa. */
  openingHours?: OpeningSegment[]
  /** Inicio actual del turno («Cambiar la hora»): visible, no elegible. */
  current?: string | null
  /** Zona del negocio: ubica `current` en su día. */
  timezone: string
  /** Rótulo de la hora elegida en la leyenda de la franja. */
  selectedLabel?: string
  /** Bloquea la elección (mientras se envía). */
  disabled?: boolean
  /** Anima la llegada de la franja. */
  arrive?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  openingHours: () => [],
  current: null,
  selectedLabel: 'Tu hora',
  disabled: false,
  arrive: false,
})

const emit = defineEmits<{
  'update:activeDate': [civilDate: string]
  select: [slot: DaylightSlot]
}>()

const activeDay = computed(() => props.days.find((d) => d.civilDate === props.activeDate) ?? null)
const activeDayIndex = computed(() => props.days.findIndex((d) => d.civilDate === props.activeDate))
const flatSlots = computed(() => activeDay.value?.slots ?? [])
const activeSlotIndex = ref(0)

const isCurrent = (slot: DaylightSlot) =>
  props.current !== null && Date.parse(slot.startsAt) === Date.parse(props.current)

// La hora actual del turno, solo en su día: el rombo hueco de la franja.
const currentMinutes = computed(() => {
  const start = props.current
  const date = props.activeDate
  if (!start || !date) return null
  if (getCivilDateInTimezone(props.timezone, new Date(start)) !== date) return null
  return minutesSinceCivilMidnight(start, date, props.timezone)
})

// ── Franja ────────────────────────────────────────────────────────────────
const activeOpen = computed(() => {
  const day = activeDay.value
  if (!day) return []
  if (props.openingHours.length > 0) {
    const [y, m, d] = day.civilDate.split('-').map(Number)
    const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
    const hours = segmentsByDay(props.openingHours)[DAYS_OF_WEEK[weekday]!]
    if (hours.length > 0)
      return hours.map((h) => ({
        start: clockToMinutes(h.opens) ?? 0,
        end: clockToMinutes(h.closes) ?? 0,
      }))
  }
  const minutes = day.slots.map((s) => s.minutes)
  if (currentMinutes.value !== null) minutes.push(currentMinutes.value)
  return [{ start: Math.min(...minutes), end: Math.max(...minutes) + props.durationMinutes }]
})

// Cada inicio cubre un paso de la agenda y los contiguos se funden: la franja
// dice «aquí hay sitio» sin 40 marcas. La hora actual no cuenta como libre.
const activeFree = computed(() => {
  const step = props.slotGridMinutes || 15
  const spans: { start: number; end: number }[] = []
  for (const slot of flatSlots.value) {
    if (isCurrent(slot)) continue
    const last = spans[spans.length - 1]
    if (last && slot.minutes <= last.end) last.end = Math.max(last.end, slot.minutes + step)
    else spans.push({ start: slot.minutes, end: slot.minutes + step })
  }
  return spans
})

const selectedMinutes = computed(
  () => flatSlots.value.find((s) => s.startsAt === props.selectedStart)?.minutes ?? null,
)

// ── Días ──────────────────────────────────────────────────────────────────
const dayRefs = ref<HTMLElement[]>([])
function setDayRef(el: unknown, index: number) {
  if (el instanceof HTMLElement) dayRefs.value[index] = el
}

async function chooseDay(index: number, focus = false) {
  const day = props.days[index]
  if (!day) return
  emit('update:activeDate', day.civilDate)
  await nextTick()
  const el = dayRefs.value[index]
  el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  if (focus) el?.focus()
}

function onDaysKeydown(event: KeyboardEvent) {
  const last = props.days.length - 1
  const at = activeDayIndex.value
  const target =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? Math.min(last, at + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? Math.max(0, at - 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (target === null) return
  event.preventDefault()
  void chooseDay(target, true)
}

// Son inicios posibles, no horas de reloj: «46 horarios libres» en un día que
// abre 12 horas es cierto; «46 horas libres» no.
function dayAria(day: DaylightDay): string {
  const n = day.slots.filter((s) => !isCurrent(s)).length
  return `${formatCivilDateFull(day.civilDate)}, ${n} ${n === 1 ? 'horario libre' : 'horarios libres'}`
}

// El mes se dice una vez y se repite solo cuando cambia.
function monthOf(index: number): string {
  const day = props.days[index]
  if (!day) return ''
  const month = civilDateChip(day.civilDate).month
  const previous = props.days[index - 1]
  return previous && civilDateChip(previous.civilDate).month === month ? '' : month
}

// Más días a un lado: un degradado en el borde y una flecha lo dicen.
const daysEl = ref<HTMLElement | null>(null)
const moreBefore = ref(false)
const moreAfter = ref(false)
function measureDays() {
  const el = daysEl.value
  if (!el) return
  moreBefore.value = el.scrollLeft > 4
  moreAfter.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}
function scrollDays(direction: 1 | -1) {
  const el = daysEl.value
  el?.scrollBy?.({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
}
watch(
  () => props.days,
  () => void nextTick(measureDays),
  { immediate: true },
)
onMounted(() => window.addEventListener('resize', measureDays))
onBeforeUnmount(() => window.removeEventListener('resize', measureDays))

// ── Horas ─────────────────────────────────────────────────────────────────
const slotRefs = ref<Record<string, HTMLElement>>({})
function setSlotRef(el: unknown, startsAt: string) {
  if (el instanceof HTMLElement) slotRefs.value[startsAt] = el
}

// La parada de Tab del grupo: la elegida si está en este día; si no, la primera
// que se puede elegir.
watch(
  [flatSlots, () => props.selectedStart],
  ([slots, start]) => {
    const chosen = slots.findIndex((s) => s.startsAt === start)
    const firstFree = slots.findIndex((s) => !isCurrent(s))
    activeSlotIndex.value = chosen >= 0 ? chosen : Math.max(0, firstFree)
  },
  { immediate: true },
)

function selectSlot(slot: DaylightSlot) {
  if (props.disabled || isCurrent(slot)) return
  emit('select', slot)
}

// Las columnas de los minutos: con agenda de 15, 20, 30 o 60 minutos cada minuto
// tiene su columna (:00 :15 :30 :45) y las filas se leen como una agenda.
const minuteColumns = computed(() => {
  const grid = props.slotGridMinutes
  return grid >= 15 && 60 % grid === 0 ? 60 / grid : 0
})
function minuteColumn(slot: DaylightSlot): string | undefined {
  if (minuteColumns.value === 0) return undefined
  const grid = 60 / minuteColumns.value
  return String(Math.floor((slot.minutes % 60) / grid) + 1)
}

function pickFromStrip(minutes: number) {
  const slots = flatSlots.value.filter((s) => !isCurrent(s))
  if (slots.length === 0) return
  const step = props.slotGridMinutes || 15
  const inside = slots.find((s) => s.minutes <= minutes && minutes < s.minutes + step)
  const slot =
    inside ??
    slots.reduce((best, s) =>
      Math.abs(s.minutes - minutes) < Math.abs(best.minutes - minutes) ? s : best,
    )
  selectSlot(slot)
  void revealSlot(slot)
}

// Lleva a la vista el chip elegido desde la franja: si asoma, lo justo; si está
// fuera, al centro. Sin desplazamiento suave con movimiento reducido.
async function revealSlot(slot: DaylightSlot) {
  await nextTick()
  const el = slotRefs.value[slot.startsAt]
  if (!el?.scrollIntoView) return
  const box = el.getBoundingClientRect()
  // La barra fija tapa el pie de la ventana en móvil.
  const bottom = window.innerHeight - (window.innerWidth < 1024 ? 96 : 0)
  const outside = box.bottom < 0 || box.top > bottom
  const reduced =
    document.documentElement.dataset.motion === 'reduced' ||
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  el.scrollIntoView({
    block: outside ? 'center' : 'nearest',
    behavior: reduced ? 'auto' : 'smooth',
  })
}

function onSlotsKeydown(event: KeyboardEvent) {
  const slots = flatSlots.value
  const count = slots.length
  if (count === 0) return
  let next: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
    next = (activeSlotIndex.value + 1) % count
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = (activeSlotIndex.value - 1 + count) % count
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = count - 1
  if (next === null) return
  event.preventDefault()
  activeSlotIndex.value = next
  const slot = slots[next]!
  // Como en un grupo de radio, moverse elige; la hora actual solo se visita.
  selectSlot(slot)
  slotRefs.value[slot.startsAt]?.focus()
}

function slotAria(slot: DaylightSlot): string {
  return isCurrent(slot) ? `${slot.spokenLabel}, tu hora actual` : slot.spokenLabel
}
</script>

<template>
  <div class="bk-picker">
    <h2 class="pb-sr-only">Día</h2>
    <!-- Las flechas van juntas en su propia columna, a la derecha y fuera de
         los días (#745): nunca tapan uno y los días empiezan alineados con el
         resto. Sin más días hacia un lado, su flecha se apaga sin mover nada. -->
    <div
      class="bk-days-wrap"
      :class="{ 'bk-days-wrap--before': moreBefore, 'bk-days-wrap--after': moreAfter }"
    >
      <div
        ref="daysEl"
        class="bk-days"
        role="radiogroup"
        aria-label="Día"
        @keydown="onDaysKeydown"
        @scroll.passive="measureDays"
      >
        <button
          v-for="(day, index) in props.days"
          :key="day.civilDate"
          :ref="(el) => setDayRef(el, index)"
          type="button"
          role="radio"
          class="bk-day"
          :style="{ '--i': index }"
          :aria-checked="day.civilDate === props.activeDate"
          :aria-label="dayAria(day)"
          :tabindex="day.civilDate === props.activeDate ? 0 : -1"
          @click="chooseDay(index)"
        >
          <span class="bk-day__month">{{ monthOf(index) }}</span>
          <span class="bk-day__weekday">{{ civilDateChip(day.civilDate).weekday }}</span>
          <span class="bk-day__number">{{ civilDateChip(day.civilDate).day }}</span>
          <span class="bk-day__light"
            ><span :style="{ inlineSize: `${Math.max(8, day.freeRatio * 100)}%` }"></span
          ></span>
        </button>
      </div>
      <!-- Atajo de puntero: con teclado, las flechas del grupo recorren los días. -->
      <div class="bk-days__navs">
        <button
          type="button"
          class="bk-days__nav bk-days__nav--before"
          :disabled="!moreBefore"
          tabindex="-1"
          aria-hidden="true"
          @click="scrollDays(-1)"
        >
          ‹
        </button>
        <button
          type="button"
          class="bk-days__nav bk-days__nav--after"
          :disabled="!moreAfter"
          tabindex="-1"
          aria-hidden="true"
          @click="scrollDays(1)"
        >
          ›
        </button>
      </div>
    </div>

    <template v-if="activeDay">
      <h2 class="bk-day-title">{{ formatCivilDateFull(activeDay.civilDate) }}</h2>
      <DaylightStrip
        class="bk-daytime__strip"
        variant="map"
        :open="activeOpen"
        :free="activeFree"
        :selected="selectedMinutes"
        :current="currentMinutes"
        :selected-label="props.selectedLabel"
        :arrive="props.arrive"
        @pick="pickFromStrip"
      />

      <!-- Una fila por hora, como una agenda: la hora grande a la izquierda y
           sus minutos libres como chips en columnas fijas. La elegida pasa a Sol
           sin mover nada. -->
      <div
        :key="activeDay.civilDate"
        class="bk-hours"
        role="radiogroup"
        aria-label="Hora"
        @keydown="onSlotsKeydown"
      >
        <section
          v-for="group in activeDay.groups"
          :key="group.part"
          class="bk-hours__group"
          :class="`bk-hours__group--${group.part}`"
          :aria-label="group.label"
        >
          <h3 class="bk-hours__label">
            <span class="bk-hours__sky" aria-hidden="true"></span>{{ group.label }}
          </h3>
          <div
            v-for="row in group.rows"
            :key="row.label"
            class="bk-hrow"
            :class="{
              'bk-hrow--chosen': row.slots.some((s) => s.startsAt === props.selectedStart),
            }"
          >
            <span class="bk-hrow__hour" aria-hidden="true"
              ><span class="bk-hrow__number">{{ row.hour }}</span
              ><span class="bk-hrow__meridiem">{{ row.meridiem }}</span></span
            >
            <div
              class="bk-hrow__mins"
              :class="{ 'bk-hrow__mins--flow': minuteColumns === 0 }"
              :style="{ '--bk-cols': minuteColumns || undefined }"
            >
              <button
                v-for="slot in row.slots"
                :key="slot.startsAt"
                :ref="(el) => setSlotRef(el, slot.startsAt)"
                type="button"
                role="radio"
                class="bk-min"
                :class="{ 'bk-min--current': isCurrent(slot) }"
                :style="{ gridColumn: minuteColumn(slot) }"
                :aria-checked="props.selectedStart === slot.startsAt"
                :aria-disabled="isCurrent(slot) || props.disabled || undefined"
                :aria-label="slotAria(slot)"
                :tabindex="flatSlots[activeSlotIndex]?.startsAt === slot.startsAt ? 0 : -1"
                @click="selectSlot(slot)"
              >
                {{ slot.minuteLabel }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
