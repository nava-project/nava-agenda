<script setup lang="ts">
/**
 * WeeklyBoard - La jornada semanal como un tablero: siete días, cada uno con
 * su pista horaria (barras en tinta suave sobre una regla común) y, debajo, la lista
 * real de tramos con sus acciones. Los siete días siempre aparecen, con o sin
 * tramos (CA-040-01). El tablero no conoce la API: quien lo monta recibe los
 * eventos `add`/`edit`/`remove` y decide qué hacer (mismo contrato de estado
 * que la lista de antes: solo una respuesta exitosa cambia una fila).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BaseButton } from '@/shared/ui'
import {
  clockLabel,
  clockRangeParts,
  formatHours,
  scaleTicks,
  timeToMinutes,
  type BoardScale,
} from '../model/weekBoard'
import type { WorkingHour } from '../model/workingHour'
import DayTrack from './DayTrack.vue'

interface BoardDay {
  value: number
  label: string
  items: WorkingHour[]
}

interface Props {
  days: readonly BoardDay[]
  scale: BoardScale
  /** Día ISO vigente en el negocio, o null si su zona no se conoce. */
  todayIsoWeekday: number | null
  /** Minuto del día vigente en el negocio, para el marcador "ahora". */
  nowMinute: number | null
  pendingDeleteIds: ReadonlySet<string>
  /** Nombre de la región cuando el tablero se desplaza por dentro («Semana de …»). */
  regionLabel?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  add: [isoWeekday: number]
  edit: [workingHour: WorkingHour]
  remove: [workingHour: WorkingHour]
}>()

const ticks = computed(() => scaleTicks(props.scale))
const activeId = ref<string | null>(null)
const boardEl = ref<HTMLElement | null>(null)
const axisEl = ref<HTMLElement | null>(null)

// Cuando el tablero se desplaza por dentro (escritorio), Firefox lo vuelve
// enfocable con teclado: se presenta como región con nombre (patrón de región
// desplazable). En pantallas angostas crece con la página y no es región (#769).
const scrollable = ref(false)
let resizeObserver: ResizeObserver | null = null

function measureScrollable() {
  const board = boardEl.value
  scrollable.value = !!board && board.scrollHeight > board.clientHeight
}

onMounted(() => {
  measureScrollable()
  if (typeof ResizeObserver === 'undefined' || !boardEl.value) return
  resizeObserver = new ResizeObserver(measureScrollable)
  resizeObserver.observe(boardEl.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())

watch(
  () => props.days,
  () => nextTick(measureScrollable),
  { deep: true },
)

/** Grosor del anillo de foco de BaseButton (2 + 2 px), igual que --board-focus-ring. */
const FOCUS_RING_PX = 4

// Con el tablero desplazable (escritorio), el control que recibe el foco debe
// verse entero, con su anillo, entre el eje fijo y el borde inferior (WCAG
// 2.4.11). Chromium lo resuelve con scroll-padding; Firefox no desplaza si el
// control ya asoma en parte, así que se corrige aquí con scrollIntoView, que en
// ambos respeta el scroll-padding (#769).
function keepFocusInView(event: FocusEvent) {
  const board = boardEl.value
  const axis = axisEl.value
  const target = event.target
  if (!board || !axis || !(target instanceof HTMLElement)) return
  if (board.scrollHeight <= board.clientHeight) return

  const rect = target.getBoundingClientRect()
  const visibleTop = axis.getBoundingClientRect().bottom + FOCUS_RING_PX
  const visibleBottom =
    board.getBoundingClientRect().top + board.clientTop + board.clientHeight - FOCUS_RING_PX
  if (rect.top < visibleTop || rect.bottom > visibleBottom) {
    target.scrollIntoView({ block: 'nearest' })
  }
}

function dayMinutes(day: BoardDay): number {
  return day.items.reduce((sum, item) => sum + item.durationMinutes, 0)
}

function countLabel(day: BoardDay): string {
  return day.items.length === 1 ? '1 tramo' : `${day.items.length} tramos`
}

/**
 * «8:00 a. m.» → cifra en serif y sufijo menudo, como la hora protagonista de
 * la familia. El sufijo conserva su espacio inicial: el texto (y el lector de
 * pantalla) sigue diciendo «8:00 a. m.», no «8:00a. m.».
 */
function clockParts(label: string): { clock: string; suffix: string } {
  const at = label.indexOf(' ')
  return at < 0
    ? { clock: label, suffix: '' }
    : { clock: label.slice(0, at), suffix: label.slice(at) }
}

function tramoParts(wh: WorkingHour) {
  const { start, end } = clockRangeParts(wh.startsTime, wh.durationMinutes)
  return { start: clockParts(start), end: clockParts(end) }
}
</script>

<template>
  <div
    ref="boardEl"
    class="week-board"
    :role="scrollable && regionLabel ? 'region' : undefined"
    :aria-label="scrollable && regionLabel ? regionLabel : undefined"
    @focusin="keepFocusInView"
  >
    <div ref="axisEl" class="week-board__axis" aria-hidden="true">
      <div class="week-board__axis-scale">
        <span
          v-for="tick in ticks"
          :key="tick.minute"
          class="week-board__tick"
          :class="{
            'week-board__tick--start': tick.percent === 0,
            'week-board__tick--end': tick.percent === 100,
          }"
          :style="{ left: `${tick.percent}%` }"
          >{{ tick.label }}</span
        >
      </div>
    </div>

    <section
      v-for="(day, index) in days"
      :key="day.value"
      :style="{ '--day-index': index }"
      class="week-board__day"
      :class="{
        'week-board__day--today': day.value === todayIsoWeekday,
        'week-board__day--free': day.items.length === 0,
      }"
      :aria-labelledby="`schedules-day-${day.value}-title`"
    >
      <header class="week-board__day-header">
        <h2 :id="`schedules-day-${day.value}-title`" class="week-board__day-title">
          {{ day.label }}
        </h2>
        <span v-if="day.value === todayIsoWeekday" class="week-board__today">Hoy</span>
        <span class="week-board__day-count">
          <template v-if="day.items.length === 0">Día libre</template>
          <template v-else>
            {{ countLabel(day)
            }}<span class="week-board__day-hours">{{ formatHours(dayMinutes(day)) }}</span>
          </template>
        </span>
      </header>

      <div class="week-board__body">
        <DayTrack
          :segments="day.items"
          :scale="scale"
          :active-id="activeId"
          :now-minute="day.value === todayIsoWeekday ? nowMinute : null"
        />

        <div class="week-board__line">
          <!-- Día libre: un renglón de libreta con puntos guía, no una caja gris. -->
          <p v-if="day.items.length === 0" class="week-board__empty">
            <span class="week-board__empty-label">Sin tramos</span>
          </p>

          <ul v-else class="week-board__list" :aria-label="`Tramos del ${day.label}`">
            <!-- El tramo es la pieza (#782): la hora en serif, como la hora
                 protagonista de la familia, y sus dos acciones en texto, sin cajas. -->
            <li
              v-for="wh in day.items"
              :key="wh.id"
              class="week-board__chip"
              @mouseenter="activeId = wh.id"
              @mouseleave="activeId = null"
              @focusin="activeId = wh.id"
              @focusout="activeId = null"
            >
              <span class="week-board__chip-time"
                ><span class="week-board__clock"
                  >{{ tramoParts(wh).start.clock
                  }}<small v-if="tramoParts(wh).start.suffix">{{
                    tramoParts(wh).start.suffix
                  }}</small></span
                ><span class="week-board__dash"> – </span
                ><span class="week-board__clock"
                  >{{ tramoParts(wh).end.clock
                  }}<small v-if="tramoParts(wh).end.suffix">{{
                    tramoParts(wh).end.suffix
                  }}</small></span
                ></span
              >
              <div class="week-board__chip-actions">
                <BaseButton
                  type="button"
                  variant="ghost"
                  class="week-board__action"
                  :aria-label="`Editar tramo de ${day.label} a las ${clockLabel(timeToMinutes(wh.startsTime))}`"
                  @click="emit('edit', wh)"
                >
                  Editar
                </BaseButton>
                <span class="week-board__action-sep" aria-hidden="true" />
                <BaseButton
                  type="button"
                  variant="ghost"
                  class="week-board__action week-board__remove"
                  :loading="pendingDeleteIds.has(wh.id)"
                  :disabled="pendingDeleteIds.has(wh.id)"
                  :aria-label="`Retirar tramo de ${day.label} a las ${clockLabel(timeToMinutes(wh.startsTime))}`"
                  @click="emit('remove', wh)"
                >
                  Retirar
                </BaseButton>
              </div>
            </li>
          </ul>

          <button
            type="button"
            class="week-board__add"
            :aria-label="`Agregar un tramo el ${day.label}`"
            :title="`Agregar un tramo el ${day.label}`"
            @click="emit('add', day.value)"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Tablero de la familia (#782, DEC-189): papel con filete de latón, como la
   ficha y la tarjeta de turno. El acento del negocio no aparece aquí; «hoy» va
   en latón con su rombo y «ahora» en sol, como la regla del día. */
.week-board {
  --track-height: 14px;
  /* Objetivo de las acciones de fila y del «+»: 44 px táctil (DEC-039); en
     escritorio baja al piso de 36 px de las acciones de fila (DEC-112). */
  --board-control: 44px;
  /* Alto del eje fijo y grosor del anillo de foco de BaseButton (2 + 2 px):
     el desplazamiento por teclado se aparta de ambos (WCAG 2.4.11). */
  --board-axis-height: 30px;
  --board-focus-ring: 4px;

  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-brass-line);
  border-radius: 4px;
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
}

/* Firefox enfoca el tablero desplazable: el anillo doble de la familia, por
   fuera. Por dentro lo taparía el eje fijo (se pinta encima del outline y de un
   box-shadow inset); por fuera sigue el radio y cabe en el hueco que rodea al
   tablero (#769). */
.week-board:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

/* Regla horaria: sus etiquetas quedan sobre la columna de pistas, alineadas
   con las líneas de hora de cada día. */
.week-board__axis {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  flex: none;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 18px;
  height: var(--board-axis-height);
  padding: 0 18px;
  align-items: end;
  background-color: var(--color-surface);
}

.week-board__axis::before {
  content: '';
}

/* Contenedor: el eje decide por su propio ancho cuántas etiquetas caben. */
.week-board__axis-scale {
  position: relative;
  height: 20px;
  container-type: inline-size;
}

.week-board__tick {
  position: absolute;
  bottom: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  white-space: nowrap;
  transform: translateX(-50%);
}

/* Las etiquetas de los extremos se anclan hacia adentro (como en el carril de
   la agenda): centradas, la mitad caería fuera del tablero. */
.week-board__tick--start {
  transform: none;
}

.week-board__tick--end {
  transform: translateX(-100%);
}

/* La regla tiene a lo sumo 7 tramos entre etiquetas; «12 p. m.» mide unos
   50 px, así que con menos de ~60 px por tramo se rotula una de cada dos
   (la primera siempre) y las rayitas de hora siguen todas en la pista. */
@container (max-width: 420px) {
  .week-board__tick:nth-child(even) {
    visibility: hidden;
  }
}

.week-board__tick::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  width: 1px;
  height: 4px;
  background-color: var(--color-border-control);
}

.week-board__tick--start::after {
  left: 0;
}

.week-board__tick--end::after {
  right: 0;
  left: auto;
}

.week-board__day {
  position: relative;
  display: grid;
  flex: 1 0 auto;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 18px;
  padding: 7px 18px;
  /* Troquel punteado de latón entre días, como bajo las secciones de Configuración. */
  border-top: 1px dashed color-mix(in srgb, var(--color-brass-line) 70%, transparent);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Hoy: un filete de latón a la izquierda y el papel apenas dorado. */
.week-board__day--today {
  background-color: color-mix(in srgb, var(--color-brass-body) 6%, transparent);
}

.week-board__day--today::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background-color: var(--color-brass-body);
}

@media (hover: hover) {
  .week-board__day:hover {
    background-color: color-mix(in srgb, var(--color-brass-body) 4%, transparent);
  }

  .week-board__day--today:hover {
    background-color: color-mix(in srgb, var(--color-brass-body) 8%, transparent);
  }
}

.week-board__day-header {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: baseline;
  gap: 2px 8px;
  min-width: 0;
}

.week-board__day-title {
  margin: 0;
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
  line-height: 28px;
}

/* «Hoy»: el rótulo de latón en versalitas con su rombo lleno, como el oficio
   de la ficha. */
.week-board__today {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-brass-text);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.week-board__today::before {
  flex: none;
  width: 6px;
  height: 6px;
  content: '';
  background-color: currentColor;
  transform: rotate(45deg);
}

.week-board__day-count {
  flex-basis: 100%;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: var(--font-size-caption-line);
}

/* Las horas del día, en serif como toda cifra protagonista de la familia. */
.week-board__day-hours {
  margin-left: 6px;
  padding-left: 7px;
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  border-left: 1px solid var(--color-brass-line);
}

.week-board__day--free .week-board__day-title {
  color: var(--color-text-secondary);
}

.week-board__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
}

.week-board__line {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.week-board__list {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* El tramo es la pieza (#782): un talón de papel con filete de latón, la hora
   en serif y sus acciones en texto. Al señalarlo, el filete se afirma y su
   ventana de cielo se enciende en la pista. */
.week-board__chip {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: calc(var(--board-control) + 6px);
  padding: 2px 4px 2px 14px;
  background-color: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 75%, transparent);
  border-radius: 3px;
  box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--color-brass-body) 55%, transparent);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (hover: hover) {
  .week-board__chip:hover {
    border-color: var(--color-brass-text);
    box-shadow: inset 0 -2px 0 var(--color-brass-body);
  }
}

.week-board__chip:focus-within {
  border-color: var(--color-brass-text);
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
}

/* El tramo como rango en 12 h: la cifra en serif y el sufijo menudo; la
   duración ya va en la cabecera del día. */
.week-board__chip-time {
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 400;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.week-board__chip-time small {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
}

.week-board__dash {
  color: var(--color-brass-text);
}

.week-board__clock {
  white-space: nowrap;
}

.week-board__chip-actions {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: 2px;
}

/* Acciones discretas: texto sin caja, en tinta secundaria; al señalarlas,
   Editar pasa a latón y Retirar a peligro. El alto táctil se conserva. */
.week-board__chip-actions :deep(.week-board__action.base-button) {
  height: var(--board-control);
  min-width: 0;
  padding-inline: 8px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  background: transparent;
  border-color: transparent;
}

.week-board__chip-actions
  :deep(.week-board__action.base-button:hover:not(:disabled):not(.base-button--loading)) {
  color: var(--color-brass-text);
  background: color-mix(in srgb, var(--color-brass-body) 10%, transparent);
}

.week-board__chip-actions
  :deep(.week-board__remove.base-button:hover:not(:disabled):not(.base-button--loading)) {
  color: var(--color-danger-on-strong);
  background: color-mix(in srgb, var(--color-danger-on-strong) 10%, transparent);
}

/* Entre las dos acciones, un rombo de latón diminuto en lugar de otra caja. */
.week-board__action-sep {
  flex: none;
  width: 4px;
  height: 4px;
  background-color: var(--color-brass-line);
  transform: rotate(45deg);
}

/* Día libre: un renglón de libreta, el rótulo y los puntos guía de latón. */
.week-board__empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: calc(var(--board-control) + 6px);
  padding: 0 4px 0 2px;
  margin: 0;
  color: var(--color-text-secondary);
  font-family: var(--font-display);
  font-size: 18px;
  font-style: italic;
}

.week-board__empty::after {
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
  transform: translateY(4px);
}

/* «+» por día: contorno punteado de latón, como una acción que espera. */
.week-board__add {
  display: inline-grid;
  place-items: center;
  width: var(--board-control);
  height: var(--board-control);
  padding: 0;
  color: var(--color-brass-text);
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1;
  background: transparent;
  border: 1.5px dashed var(--color-brass-line);
  border-radius: 3px;
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (hover: hover) {
  .week-board__add:hover {
    background-color: color-mix(in srgb, var(--color-brass-body) 12%, transparent);
    border-color: var(--color-brass-text);
    border-style: solid;
  }
}

.week-board__add:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

@media (max-width: 760px) {
  .week-board__axis {
    position: static;
    grid-template-columns: minmax(0, 1fr);
    padding: 0 12px;
  }

  .week-board__axis::before {
    display: none;
  }

  .week-board__day {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 14px 12px;
  }

  .week-board__day-header {
    flex-wrap: nowrap;
    justify-content: flex-start;
  }

  .week-board__day-title {
    font-size: var(--font-size-title-item);
  }

  .week-board__day-count {
    flex: 1;
    flex-basis: auto;
    text-align: right;
  }

  /* Angosto: el tramo, sus acciones y el «+» en un renglón. El rango es el
     corazón del renglón de libreta y nunca se parte (revisión de #783): si no
     cabe junto a «Editar · Retirar», son las acciones las que bajan. */
  .week-board__line {
    flex-wrap: nowrap;
  }

  .week-board__list {
    flex: 1 1 auto;
  }

  .week-board__chip {
    flex: 1 1 100%;
    flex-wrap: wrap;
    gap: 0 8px;
  }

  .week-board__chip-time {
    flex: 1 0 auto;
    font-size: 19px;
    white-space: nowrap;
  }

  .week-board__add {
    flex: 0 0 auto;
  }

  .week-board__chip-actions {
    margin-left: auto;
  }

  .week-board__line {
    gap: 8px;
  }
}

/* Escritorio (≥ 1100 px): la semana entera cabe en la altura del panel
   (DEC-109, «Composición sin desplazamiento»). Filas más ceñidas y acciones en
   el piso de 36 px, para que dos tramos y el «+» quepan en un renglón; si un
   barbero tiene más, el tablero se desplaza por dentro, nunca la página. */
@media (min-width: 1100px) {
  /* Con el tablero desplazable, el foco que llega por teclado no queda bajo
     el eje fijo ni con el anillo recortado contra el borde inferior. */
  .week-board {
    --board-control: 36px;
    --board-axis-height: 26px;

    padding-bottom: var(--board-focus-ring);
    scroll-padding-top: calc(var(--board-axis-height) + 8px);
    scroll-padding-bottom: 8px;
  }

  .week-board__axis,
  .week-board__day {
    gap: 14px;
    padding-inline: 14px;
  }

  .week-board__day {
    padding-block: 3px;
  }

  .week-board__body {
    gap: 4px;
  }

  .week-board__chip {
    gap: 8px;
    padding-left: 12px;
  }

  .week-board__chip-actions {
    margin-left: 0;
  }

  .week-board__chip-actions :deep(.base-button) {
    padding-inline: 10px;
  }
}

/* Llegada (#782): los días suben escalonados (~45 ms entre uno y otro, unos
   700 ms en total), solo transform y opacidad. Corre una vez, al montarse el
   tablero; con movimiento reducido del sistema o del panel, no existe. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .week-board__day {
    animation: week-board-arrive 380ms calc(var(--day-index, 0) * 45ms)
      cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
}

@keyframes week-board-arrive {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .week-board__day,
  .week-board__chip,
  .week-board__add {
    transition: none;
  }
}

:root[data-motion='reduced'] .week-board__day,
:root[data-motion='reduced'] .week-board__chip,
:root[data-motion='reduced'] .week-board__add {
  transition: none;
}
</style>
