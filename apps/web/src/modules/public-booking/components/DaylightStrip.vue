<script setup lang="ts">
/**
 * DaylightStrip · la franja del día (DEC-188, «La luz del día»). Es la
 * identidad de la reserva: el cielo de cada hora REAL, de la noche al alba, al
 * mediodía, al atardecer y otra vez a la noche, entre la apertura y el cierre
 * del negocio. Lo cerrado queda velado y rayado.
 *
 * Dos formas:
 * - `band` (entrada): una banda alta con el sol en «ahora», alto a mediodía y
 *   bajo al abrir y cerrar; de noche, la luna. La llegada es esta banda
 *   amaneciendo de izquierda a derecha.
 * - `map` (Día y hora): el mapa del día. Los tramos libres quedan encendidos,
 *   lo abierto sin horas se apaga y lo cerrado se raya; la hora elegida es un
 *   rombo Sol y, al cambiar la hora de un turno, la actual un rombo hueco. Tocar un tramo libre emite `pick` con esos minutos: es un atajo
 *   de puntero, la misma elección está en el grupo de horas (teclado y lector).
 *
 * En el panel (agenda del día) la franja lleva además `marks`, los turnos del
 * día como marcas del color y la forma de su estado, y `window`, la ventana
 * que se ve. Con `window` no se vela nada como cerrado: el panel no conoce la
 * apertura del día, solo los turnos. Tocar una marca emite `mark` con su
 * clave; es un atajo de puntero, la misma información está en la lista.
 *
 * Para la tecnología de asistencia solo existe `label`, una frase con lo que
 * dibuja; sin ella la franja es decorativa (la información está en texto).
 */
import { SKY_STOPS } from '@/shared/time/daySky'
import { computed } from 'vue'
import type { DaylightMark } from '../model/daylight'

interface Interval {
  start: number
  end: number
}

interface Props {
  /** Tramos abiertos, en minutos desde la medianoche del negocio. */
  open: Interval[]
  /** Tramos libres, en minutos desde la medianoche del negocio. */
  free?: Interval[]
  /** Hora elegida (Sol, rombo). Excluye `now`. */
  selected?: number | null
  /** Hora que ya tiene el turno («Cambiar la hora»): un rombo hueco. */
  current?: number | null
  /** Rótulo de la hora elegida en la leyenda del mapa. */
  selectedLabel?: string
  /** «Ahora» (sol o luna), solo si no hay `selected`. */
  now?: number | null
  /** Resumen accesible; sin él la franja es decorativa. */
  label?: string
  /** Anima la llegada (el amanecer de izquierda a derecha). */
  arrive?: boolean
  /** La hora elegida «se agenda»: el rombo cae en su sitio con un destello Sol. */
  land?: boolean
  variant?: 'band' | 'map'
  /** Ventana visible fija; sin ella, la deciden los tramos abiertos. */
  window?: Interval | null
  /** Turnos del día (panel), como marcas tocables. */
  marks?: DaylightMark[]
}

const props = withDefaults(defineProps<Props>(), {
  free: () => [],
  selected: null,
  current: null,
  selectedLabel: 'Tu hora',
  now: null,
  label: '',
  arrive: false,
  land: false,
  variant: 'band',
  window: null,
  marks: () => [],
})

const emit = defineEmits<{ pick: [minutes: number]; mark: [key: string] }>()

const HOUR = 60

// La ventana visible: de la hora en punto anterior a la primera apertura a la
// siguiente al último cierre, con al menos 8 horas para que el cielo se lea.
const range = computed(() => {
  if (props.window) {
    // Panel: la ventana que pide la agenda, a horas en punto y de al menos 8 h.
    let from = Math.floor(props.window.start / HOUR) * HOUR
    let to = Math.ceil(props.window.end / HOUR) * HOUR
    if (to - from < 8 * HOUR) to = Math.min(24 * HOUR, from + 8 * HOUR)
    if (to - from < 8 * HOUR) from = Math.max(0, to - 8 * HOUR)
    return { from, to }
  }
  const starts = props.open.map((i) => i.start)
  const ends = props.open.map((i) => i.end)
  let from = Math.floor(Math.min(...starts, 8 * HOUR) / HOUR) * HOUR
  let to = Math.ceil(Math.max(...ends, 18 * HOUR) / HOUR) * HOUR
  if (to - from < 8 * HOUR) to = Math.min(24 * HOUR, from + 8 * HOUR)
  if (to - from < 8 * HOUR) from = Math.max(0, to - 8 * HOUR)
  return { from, to }
})

const ratio = (minutes: number) => {
  const { from, to } = range.value
  return (minutes - from) / (to - from)
}
const pct = (minutes: number) => `${(ratio(minutes) * 100).toFixed(3)}%`
const spanStyle = (i: Interval) => ({
  left: pct(i.start),
  width: `${((ratio(i.end) - ratio(i.start)) * 100).toFixed(3)}%`,
})

// El cielo: cada color cae en su hora real (fuera de la ventana también, para
// que el borde tenga el tono que le toca). Las paradas son las de la regla del
// día (shared/time/daySky.ts): un solo cielo.
const sky = computed(
  () =>
    `linear-gradient(90deg, ${SKY_STOPS.map(([h, c]) => `var(--dl-${c}) ${pct(h * HOUR)}`).join(', ')})`,
)

function complement(spans: Interval[], within: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const w of within) {
    let cursor = w.start
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      if (s.end <= cursor || s.start >= w.end) continue
      if (s.start > cursor) out.push({ start: cursor, end: s.start })
      cursor = Math.max(cursor, s.end)
    }
    if (cursor < w.end) out.push({ start: cursor, end: w.end })
  }
  return out
}

// Lo cerrado: los huecos entre tramos abiertos dentro de la ventana.
const closed = computed(() =>
  props.window ? [] : complement(props.open, [{ start: range.value.from, end: range.value.to }]),
)

// En el mapa, lo abierto sin horas libres se apaga.
const busy = computed(() =>
  props.variant === 'map' ? complement(props.free, props.open).filter((i) => i.end > i.start) : [],
)

const marker = computed(() => {
  const { from, to } = range.value
  if (props.selected !== null) return { at: props.selected, kind: 'selected' as const, top: 50 }
  const now = props.now
  if (now === null) return null
  // En la entrada, fuera del horario el ahora no desaparece (#745): un rombo
  // hueco se queda en el borde por el que el día empieza o ya terminó.
  if (props.variant === 'band' && (now < from || now > to)) {
    const inset = (to - from) * 0.015
    return { at: now < from ? from + inset : to - inset, kind: 'off' as const, top: 50 }
  }
  if (now < from || now > to) return null
  // El sol sube hasta el mediodía y baja hasta el atardecer; de noche, la luna.
  const t = (now - 6 * HOUR) / (12 * HOUR)
  if (t <= 0 || t >= 1) return { at: now, kind: 'moon' as const, top: 32 }
  return { at: now, kind: 'sun' as const, top: 74 - Math.sin(Math.PI * t) * 46 }
})

function clock(minutes: number): string {
  const h = Math.floor(minutes / HOUR) % 24
  const m = minutes % HOUR
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

// Rótulos: la apertura, el mediodía y el cierre. Uno que caería a menos de un
// 18 % del anterior se omite, para que nunca se pisen en pantallas estrechas.
const hourLabels = computed(() => {
  const { from, to } = range.value
  const wanted = new Set<number>()
  if (props.window) {
    wanted.add(from)
    wanted.add(to)
  }
  for (const i of props.window ? [] : props.open) {
    wanted.add(i.start)
    wanted.add(i.end)
  }
  if (12 * HOUR > from && 12 * HOUR < to) wanted.add(12 * HOUR)
  const sorted = [...wanted].filter((m) => m >= from && m <= to).sort((a, b) => a - b)
  const kept: number[] = []
  for (const m of sorted) {
    const last = kept[kept.length - 1]
    if (last === undefined || ratio(m) - ratio(last) >= 0.18) kept.push(m)
    else if (m === sorted[sorted.length - 1] && kept.length > 1) kept[kept.length - 1] = m
  }
  return kept.map((at) => ({ at, text: clock(at), edge: ratio(at) }))
})

function onPick(event: MouseEvent) {
  const track = (event.currentTarget as HTMLElement).closest('.daylight__track')
  if (!track) return
  const box = track.getBoundingClientRect()
  if (box.width === 0) return
  const { from, to } = range.value
  emit('pick', from + ((event.clientX - box.left) / box.width) * (to - from))
}
</script>

<template>
  <div
    class="daylight"
    :class="[
      `daylight--${props.variant}`,
      { 'daylight--arrive': props.arrive, 'daylight--land': props.land },
    ]"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label || undefined"
    :aria-hidden="props.label ? undefined : 'true'"
  >
    <div class="daylight__track" :style="{ backgroundImage: sky }">
      <span
        v-for="gap in closed"
        :key="`c${gap.start}`"
        class="daylight__closed"
        :style="spanStyle(gap)"
      ></span>
      <span
        v-for="span in busy"
        :key="`b${span.start}`"
        class="daylight__busy"
        :style="spanStyle(span)"
      ></span>
      <template v-if="props.variant === 'map'">
        <span
          v-for="span in props.free"
          :key="`f${span.start}`"
          class="daylight__free"
          :style="spanStyle(span)"
          @click="onPick"
        ></span>
      </template>
      <span
        v-for="mark in props.marks"
        :key="`m${mark.key}`"
        class="daylight__mark"
        :class="`daylight__mark--${mark.tone}`"
        :style="spanStyle(mark)"
        @click="emit('mark', mark.key)"
      ></span>
      <span v-if="props.arrive" class="daylight__dusk"></span>
      <span
        v-if="marker && props.land"
        class="daylight__flash"
        :style="{ left: pct(marker.at), top: `${marker.top}%` }"
      ></span>
      <span
        v-if="props.current !== null && props.variant === 'map'"
        class="daylight__marker daylight__marker--current"
        :style="{ left: pct(props.current), top: '50%' }"
      ></span>
      <span
        v-if="marker"
        class="daylight__marker"
        :class="`daylight__marker--${marker.kind}`"
        :style="{ left: pct(marker.at), top: `${marker.top}%` }"
      ></span>
    </div>
    <div class="daylight__hours">
      <span
        v-for="hour in hourLabels"
        :key="hour.at"
        :class="{
          'daylight__hour--start': hour.edge < 0.08,
          'daylight__hour--end': hour.edge > 0.92,
        }"
        :style="{ left: pct(hour.at) }"
        >{{ hour.text }}</span
      >
    </div>
    <p v-if="props.variant === 'map'" class="daylight__legend">
      <span><i class="daylight__key daylight__key--free"></i>Libre</span>
      <span><i class="daylight__key daylight__key--busy"></i>Sin horas</span>
      <span v-if="closed.length > 0"
        ><i class="daylight__key daylight__key--closed"></i>Cerrado</span
      >
      <span v-if="props.current !== null"
        ><i class="daylight__key daylight__key--current"></i>Hora actual</span
      >
      <!-- Siempre ocupa su sitio: elegir una hora no reacomoda la leyenda ni empuja
           las horas de debajo cuando la leyenda se parte en dos líneas. -->
      <span
        :class="{ 'daylight__legend-slot--empty': props.selected === null }"
        :aria-hidden="props.selected === null ? 'true' : undefined"
        ><i class="daylight__key daylight__key--sun"></i>{{ props.selectedLabel }}</span
      >
    </p>
  </div>
</template>

<style scoped>
.daylight {
  /* El cielo de la marca, igual en Día y en Noche: es luz, no superficie. */
  --dl-night: #2a2e66;
  --dl-dawn: #f08a7a;
  --dl-morning: #ffc96b;
  --dl-noon: #ffeab8;
  --dl-afternoon: #ffb27e;
  --dl-dusk: #d9577a;
  --dl-veil: var(--color-canvas);
  --dl-off: color-mix(in srgb, var(--color-text-primary) 16%, var(--color-canvas));

  position: relative;
  padding-bottom: 22px;
}

.daylight__track {
  position: relative;
  height: 64px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-primary) 12%, transparent);
}

.daylight--map .daylight__track {
  height: 36px;
  border-radius: var(--radius-md, 8px);
}

@media (max-width: 639px) {
  .daylight--band .daylight__track {
    height: 56px;
  }
}

/* El horizonte: un filete claro al pie de la banda. */
.daylight--band .daylight__track::after {
  position: absolute;
  inset: auto 0 0;
  height: 1px;
  content: '';
  background: color-mix(in srgb, #fff 55%, transparent);
}

.daylight__closed,
.daylight__busy,
.daylight__free {
  position: absolute;
  top: 0;
  bottom: 0;
}

.daylight__closed {
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-text-primary) 22%, transparent) 0 1.5px,
      transparent 1.5px 7px
    ),
    var(--dl-off);
}

/* «Sin horas» es un solo tono neutro, igual en toda la franja y en la
   leyenda: un cliente no debe ver dos «apagados» con una sola clave. */
.daylight__busy {
  background: var(--dl-off);
}

.daylight__free {
  cursor: pointer;
  border-radius: 3px;
  transition: box-shadow var(--motion-duration-fast) ease;
}

.daylight__free:hover {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-text-primary) 55%, transparent);
}

/* Turnos del panel: una barra al pie del cielo, del color y la forma de su
   estado (diseno-v2, «Estados de la cita»). El área táctil cubre todo el alto
   de la franja y al menos 24 px de ancho (WCAG 2.5.8). */
.daylight__mark {
  --mk: var(--color-appt-confirmed);

  position: absolute;
  bottom: 8px;
  z-index: 1;
  min-width: 10px;
  height: 14px;
  cursor: pointer;
  background: var(--mk);
  border: 2px solid var(--mk);
  border-radius: 4px;
  box-shadow: 0 0 0 1.5px color-mix(in srgb, #fff 80%, transparent);
}

.daylight__mark::before {
  position: absolute;
  inset: -40px -8px -8px;
  content: '';
}

.daylight__mark--current {
  --mk: var(--color-sun);

  border-color: var(--color-on-sun);
}

.daylight__mark--pending {
  --mk: var(--color-appt-pending);

  background: var(--color-surface);
  border-style: dotted;
}

.daylight__mark--completed {
  --mk: var(--color-appt-completed);
}

.daylight__mark--no-show {
  --mk: var(--color-appt-no-show);

  background: var(--color-surface);
}

.daylight__mark--cancelled {
  --mk: var(--color-appt-cancelled);

  background: transparent;
  border-style: dashed;
}

.daylight__marker {
  position: absolute;
  pointer-events: none;
  translate: -50% -50%;
}

/* El ahora del cielo, en rombo (#737): ningún sol ni luna redondos como
   marcador. De día, un rombo de sol con su resplandor; de noche, hueco. */
.daylight__marker--sun {
  width: 16px;
  height: 16px;
  background: var(--color-sun);
  border-radius: 2px;
  rotate: 45deg;
  box-shadow:
    0 0 0 2px #fff8e6,
    0 0 18px 6px color-mix(in srgb, var(--color-sun) 70%, transparent);
}

.daylight__marker--moon {
  width: 13px;
  height: 13px;
  border-radius: 2px;
  rotate: 45deg;
  box-shadow: inset 0 0 0 2px #fff4d6;
}

.daylight__marker--selected {
  width: 16px;
  height: 16px;
  background: var(--color-sun);
  border-radius: 2px;
  box-shadow:
    0 0 0 2px var(--color-canvas),
    0 0 0 3px color-mix(in srgb, var(--color-text-primary) 35%, transparent);
  rotate: 45deg;
}

/* Fuera del horario: el ahora queda en el borde, hueco y en tinta sobre el
   lienzo, legible sobre el sol de la mañana y sobre la noche. */
.daylight__marker--off,
.daylight__marker--current {
  width: 14px;
  height: 14px;
  background: var(--color-canvas);
  border: 2px solid var(--color-text-primary);
  border-radius: 2px;
  rotate: 45deg;
}

.daylight__hours {
  position: absolute;
  inset: auto 0 0;
  height: 16px;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.daylight--map .daylight__hours {
  position: relative;
  margin-top: 4px;
}

.daylight--map {
  padding-bottom: 0;
}

.daylight__hours span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}

.daylight__hours .daylight__hour--start {
  transform: none;
}

.daylight__hours .daylight__hour--end {
  transform: translateX(-100%);
}

.daylight__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-2) 0 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
}

.daylight__legend span {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.daylight__legend-slot--empty {
  visibility: hidden;
}

.daylight__key {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-primary) 18%, transparent);
}

.daylight__key--free {
  background: linear-gradient(90deg, var(--dl-morning), var(--dl-afternoon));
}

.daylight__key--busy {
  background: var(--dl-off);
}

.daylight__key--closed {
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-text-primary) 30%, transparent) 0 1.5px,
      transparent 1.5px 4px
    ),
    var(--dl-off);
}

.daylight__key--current {
  width: 9px;
  height: 9px;
  margin: 0 2px;
  background: transparent;
  border: 1.5px solid var(--color-text-primary);
  box-shadow: none;
  rotate: 45deg;
}

.daylight__key--sun {
  width: 9px;
  height: 9px;
  margin: 0 2px;
  background: var(--color-sun);
  rotate: 45deg;
}

/* ── Llegada: la banda amanece de izquierda a derecha ───────────────────── */

.daylight__dusk {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--dl-night);
  opacity: 0;
}

.daylight--arrive .daylight__track {
  animation: llega-amanecer 720ms cubic-bezier(0.65, 0, 0.25, 1) both;
}

.daylight--arrive .daylight__dusk {
  animation: llega-alba 820ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

.daylight--arrive .daylight__marker {
  animation: llega-sol 460ms cubic-bezier(0.34, 1.4, 0.64, 1) 520ms both;
}

@keyframes llega-amanecer {
  from {
    clip-path: inset(0 100% 0 0 round 12px);
  }

  to {
    clip-path: inset(0 0 0 0 round 12px);
  }
}

/* El cielo pasa de la noche al alba mientras se abre. */
@keyframes llega-alba {
  from {
    opacity: 0.85;
  }

  to {
    opacity: 0;
  }
}

@keyframes llega-sol {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.6);
  }
}

/* ── Se agenda: el rombo cae en su hora y la franja destella en Sol ───── */

.daylight__flash {
  position: absolute;
  width: 18px;
  height: 18px;
  pointer-events: none;
  border: 2px solid var(--color-sun);
  border-radius: 2px;
  rotate: 45deg;
  opacity: 0;
  translate: -50% -50%;
}

.daylight--land .daylight__marker {
  animation: bk-cae 560ms cubic-bezier(0.34, 1.5, 0.64, 1) 240ms both;
}

.daylight--land .daylight__flash {
  animation: bk-destello 640ms cubic-bezier(0.2, 0.7, 0.2, 1) 640ms both;
}

@keyframes bk-cae {
  from {
    opacity: 0;
    transform: translateY(-56px);
  }

  40% {
    opacity: 1;
  }
}

@keyframes bk-destello {
  from {
    opacity: 0.9;
    transform: scale(0.6);
  }

  to {
    opacity: 0;
    transform: scale(3.2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .daylight--land .daylight__marker,
  .daylight--land .daylight__flash,
  .daylight--arrive .daylight__track,
  .daylight--arrive .daylight__dusk,
  .daylight--arrive .daylight__marker {
    animation: none;
  }
}
</style>
