<script setup lang="ts">
/**
 * DaylightStrip · la franja del día (DEC-188, «La luz del día»). Un riel de
 * horas cuyo color es el cielo de cada hora REAL: mañana hasta las 12:00, tarde
 * hasta las 18:00 y noche desde entonces. Solo se ilumina lo que el negocio
 * atiende (`open`); lo cerrado queda rayado. Opcionalmente marca los tramos
 * libres (`free`, una línea dentro del cielo), la hora elegida (Sol, rombo) o
 * «ahora» (Sol, círculo), nunca las dos a la vez.
 *
 * Es decorativa para la tecnología de asistencia salvo por `label`, que resume
 * en una frase lo que dibuja (la misma información está en texto en la página).
 */
import { computed } from 'vue'

interface Interval {
  start: number
  end: number
}

interface Props {
  /** Tramos abiertos, en minutos desde la medianoche del negocio. */
  open: Interval[]
  /** Tramos libres, en minutos desde la medianoche del negocio. */
  free?: Interval[]
  /** Hora elegida (Sol). Excluye `now`. */
  selected?: number | null
  /** «Ahora» (Sol), solo si no hay `selected`. */
  now?: number | null
  /** Resumen accesible; sin él la franja es decorativa. */
  label?: string
  /** Anima la llegada (el amanecer de izquierda a derecha). */
  arrive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  free: () => [],
  selected: null,
  now: null,
  label: '',
  arrive: false,
})

const HOUR = 60

// La ventana visible: de la hora en punto anterior a la primera apertura a la
// siguiente al último cierre, con al menos 8 horas para que el cielo se lea.
const range = computed(() => {
  const starts = props.open.map((i) => i.start)
  const ends = props.open.map((i) => i.end)
  let from = Math.floor(Math.min(...starts, 8 * HOUR) / HOUR) * HOUR
  let to = Math.ceil(Math.max(...ends, 18 * HOUR) / HOUR) * HOUR
  if (to - from < 8 * HOUR) to = Math.min(24 * HOUR, from + 8 * HOUR)
  if (to - from < 8 * HOUR) from = Math.max(0, to - 8 * HOUR)
  return { from, to }
})

const pct = (minutes: number) => {
  const { from, to } = range.value
  return `${(((minutes - from) / (to - from)) * 100).toFixed(3)}%`
}

// El cielo: las paradas caen en las horas reales de cambio.
const sky = computed(
  () =>
    `linear-gradient(90deg, var(--color-sky-morning) 0%, var(--color-sky-morning) ${pct(11 * HOUR)}, ` +
    `var(--color-sky-afternoon) ${pct(13 * HOUR)}, var(--color-sky-afternoon) ${pct(17 * HOUR)}, ` +
    `var(--color-sky-night) ${pct(19 * HOUR)}, var(--color-sky-night) 100%)`,
)

// Lo cerrado: los huecos entre tramos abiertos dentro de la ventana.
const closed = computed(() => {
  const sorted = [...props.open].sort((a, b) => a.start - b.start)
  const gaps: Interval[] = []
  let cursor = range.value.from
  for (const interval of sorted) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start })
    cursor = Math.max(cursor, interval.end)
  }
  if (cursor < range.value.to) gaps.push({ start: cursor, end: range.value.to })
  return gaps
})

const marker = computed(() => {
  if (props.selected !== null) return { at: props.selected, kind: 'selected' as const }
  if (props.now !== null && props.now >= range.value.from && props.now <= range.value.to)
    return { at: props.now, kind: 'now' as const }
  return null
})

const hourLabels = computed(() => {
  const labels: { at: number; text: string }[] = []
  const { from, to } = range.value
  const step = to - from > 12 * HOUR ? 3 * HOUR : 2 * HOUR
  for (let m = Math.ceil(from / step) * step; m <= to; m += step) {
    const h = Math.floor(m / HOUR) % 24
    labels.push({ at: m, text: `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? ' a. m.' : ' p. m.'}` })
  }
  return labels
})
</script>

<template>
  <div
    class="daylight"
    :class="{ 'daylight--arrive': props.arrive }"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label || undefined"
    :aria-hidden="props.label ? undefined : 'true'"
  >
    <div class="daylight__track" :style="{ backgroundImage: sky }">
      <span
        v-for="gap in closed"
        :key="`c${gap.start}`"
        class="daylight__closed"
        :style="{ left: pct(gap.start), width: `calc(${pct(gap.end)} - ${pct(gap.start)})` }"
      ></span>
      <span
        v-for="span in props.free"
        :key="`f${span.start}`"
        class="daylight__free"
        :style="{ left: pct(span.start), width: `calc(${pct(span.end)} - ${pct(span.start)})` }"
      ></span>
      <span
        v-if="marker"
        class="daylight__marker"
        :class="`daylight__marker--${marker.kind}`"
        :style="{ left: pct(marker.at) }"
      ></span>
    </div>
    <div class="daylight__hours">
      <span v-for="hour in hourLabels" :key="hour.at" :style="{ left: pct(hour.at) }">{{
        hour.text
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.daylight {
  position: relative;
  padding-bottom: 18px;
}

.daylight__track {
  position: relative;
  height: 10px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-primary) 10%, transparent);
}

.daylight__closed {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    135deg,
    var(--color-surface-muted) 0 4px,
    color-mix(in srgb, var(--color-surface-muted) 70%, var(--color-canvas)) 4px 8px
  );
}

.daylight__free {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-text-primary) 62%, transparent);
}

.daylight__marker {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  background: var(--color-sun);
  box-shadow: 0 0 0 2px var(--color-canvas);
}

.daylight__marker--selected {
  transform: rotate(45deg) scale(0.9);
  border-radius: 2px;
}

.daylight__marker--now {
  border-radius: 50%;
}

.daylight__hours {
  position: absolute;
  inset: auto 0 0;
  height: 14px;
  font-size: 11px;
  line-height: 14px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.daylight__hours span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}

.daylight__hours span:first-child {
  transform: none;
}

.daylight__hours span:last-child {
  transform: translateX(-100%);
}

/* Llegada: la franja amanece de izquierda a derecha (solo clip-path). */
.daylight--arrive .daylight__track {
  animation: llega-amanecer 760ms cubic-bezier(0.65, 0, 0.25, 1) both;
}

.daylight--arrive .daylight__marker {
  animation: llega-sol 420ms cubic-bezier(0.34, 1.56, 0.64, 1) 600ms both;
}

@keyframes llega-amanecer {
  from {
    clip-path: inset(0 100% 0 0 round 999px);
  }

  to {
    clip-path: inset(0 0 0 0 round 999px);
  }
}

@keyframes llega-sol {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
}

@media (prefers-reduced-motion: reduce) {
  .daylight--arrive .daylight__track,
  .daylight--arrive .daylight__marker {
    animation: none;
  }
}
</style>
