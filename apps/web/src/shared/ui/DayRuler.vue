<script setup lang="ts">
/**
 * DayRuler · la regla del día (DEC-189, #730).
 *
 * El objeto de Agenda: una regla de latón plano con las marcas de hora, media y
 * cuarto grabadas en tinta, y el cielo v2 embutido debajo, cada color en su
 * hora real. Los numerales van centrados en su marca mayor, con «a. m.»,
 * «m.» o «p. m.» colgando a la derecha. El Sol marca «ahora». Cada turno es un
 * rombo posado con su centro en el borde inferior del cielo.
 *
 * Material fijo: el latón y el cielo son los mismos en Día y Noche, así que los
 * rombos usan los colores de estado de Día y un hueco de papel claro en los dos
 * modos. Fuera de la regla, cada modo usa los suyos.
 *
 * El dibujo es decorativo; la regla se lee entera por su `label` (role="img").
 */
import { computed } from 'vue'
import { skyGradient } from '@/shared/time/daySky'

export type DayRulerMarkKind =
  'confirmed' | 'to-record' | 'no-show' | 'cancelled' | 'mine' | 'draft'

export interface DayRulerMark {
  /** Minutos desde la medianoche civil. */
  at: number
  kind: DayRulerMarkKind
}

interface Props {
  /** Inicio de la ventana, en minutos desde la medianoche civil. */
  from: number
  /** Fin de la ventana, en minutos desde la medianoche civil. */
  to: number
  marks?: DayRulerMark[]
  /** «Ahora», en minutos; fuera de la ventana no se dibuja. */
  now?: number | null
  /** large: reserva · card: tarjeta de turno · compact: libreta. */
  size?: 'large' | 'card' | 'compact'
  /** Lectura completa de la regla para lectores de pantalla. */
  label: string
}

const props = withDefaults(defineProps<Props>(), { marks: () => [], now: null, size: 'large' })

// Numerales: los mayores llevan sufijo y se ven siempre; los menores (sin
// sufijo) se ocultan en el teléfono.
const STEPS = { large: [4, 2], card: [4, 0], compact: [6, 2] } as const

const span = computed(() => Math.max(60, props.to - props.from))
const pct = (minutes: number) => ((minutes - props.from) / span.value) * 100

function suffix(hour: number): string {
  if (hour === 12) return 'm.'
  return hour < 12 || hour === 24 ? 'a. m.' : 'p. m.'
}

const numerals = computed(() => {
  const [major, minor] = STEPS[props.size]
  const first = Math.ceil(props.from / 60)
  const last = Math.floor(props.to / 60)
  const out: { hour: number; left: number; major: boolean }[] = []
  for (let h = first; h <= last; h++) {
    const k = h - first
    const isMajor = k % major === 0 || h === last
    const isMinor = minor > 0 && k % minor === 0
    // El último numeral manda: el anterior se calla si quedaría encimado.
    if (h !== last && last - h < Math.min(2, major / 2) && isMajor) continue
    if (isMajor || isMinor) out.push({ hour: h, left: pct(h * 60), major: isMajor })
  }
  return out.map((n) => ({
    ...n,
    text: String(n.hour % 12 || 12),
    suffix: n.major ? suffix(n.hour) : '',
  }))
})

const hours = computed(() => span.value / 60)
const sky = computed(() => skyGradient(props.from, props.to))
const visibleMarks = computed(() =>
  props.marks
    .filter((m) => m.at >= props.from && m.at <= props.to)
    .map((m) => ({ ...m, left: pct(m.at) })),
)
const nowLeft = computed(() =>
  props.now !== null && props.now >= props.from && props.now <= props.to ? pct(props.now) : null,
)
</script>

<template>
  <div
    class="day-ruler"
    :class="`day-ruler--${size}`"
    role="img"
    :aria-label="label"
    :style="{ '--day-ruler-hours': hours }"
  >
    <div class="day-ruler__body" aria-hidden="true">
      <div class="day-ruler__track">
        <div class="day-ruler__ticks" />
        <div class="day-ruler__sky" :style="{ backgroundImage: sky }" />
        <span
          v-for="n in numerals"
          :key="n.hour"
          class="day-ruler__numeral"
          :class="{ 'day-ruler__numeral--minor': !n.major }"
          :style="{ left: `${n.left}%` }"
          >{{ n.text }}<small v-if="n.suffix">{{ n.suffix }}</small></span
        >
        <span
          v-for="(m, i) in visibleMarks"
          :key="`${m.kind}-${m.at}-${i}`"
          class="day-ruler__mark"
          :class="`day-ruler__mark--${m.kind}`"
          :style="{ left: `${m.left}%` }"
        />
        <!-- El Sol va por encima de los rombos: si chocan, se leen los dos. -->
        <span v-if="nowLeft !== null" class="day-ruler__sun" :style="{ left: `${nowLeft}%` }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.day-ruler {
  /* Material fijo (DEC-189): el mismo latón y el mismo cielo en los dos modos. */
  --dr-ink: #101b2b;
  --dr-paper: #fffdf8;
  --dr-confirmed: #2453c2;
  --dr-to-record: #8f5b00;
  --dr-no-show: #8a3a86;
  --dr-cancelled: #5b6475;
  --dr-body: var(--color-brass-body);
  --dr-height: 54px;
  --dr-sky: 26px;
  --dr-tick: 16px;
  --dr-numeral: 14px;
  --dr-mark: 13px;
  --dr-rim: 6px;
  --dr-inset: 10px;

  /* Aire para los numerales encima, los sufijos a la derecha y los rombos debajo. */
  padding: calc(var(--dr-numeral) + 10px) 44px calc(var(--dr-mark) * 0.75) 6px;
}

.day-ruler--card {
  --dr-height: 36px;
  --dr-sky: 16px;
  --dr-tick: 10px;
  --dr-numeral: 12px;
  --dr-mark: 11px;
  --dr-rim: 4px;
  --dr-inset: 7px;

  padding-right: 38px;
}

.day-ruler--compact {
  --dr-height: 30px;
  --dr-sky: 13px;
  --dr-tick: 9px;
  --dr-numeral: 14px;
  --dr-mark: 10px;
  --dr-rim: 4px;
  --dr-inset: 7px;
}

.day-ruler__body {
  position: relative;
  height: var(--dr-height);
  background-color: var(--dr-body);
  border-radius: 3px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 40%),
    inset 0 -1px 0 rgb(0 0 0 / 22%),
    0 1px 2px rgb(16 27 43 / 25%);
}

.day-ruler__track {
  position: absolute;
  inset: 0 var(--dr-inset) var(--dr-rim);
}

/* Marcas grabadas en tinta: hora, media y cuarto. */
.day-ruler__ticks {
  position: absolute;
  inset: 0 0 auto;
  height: calc(var(--dr-height) - var(--dr-sky) - var(--dr-rim));
  background:
    repeating-linear-gradient(
        90deg,
        var(--dr-ink) 0 1.5px,
        transparent 1.5px calc(100% / var(--day-ruler-hours))
      )
      top left / calc(100% + 1.5px) var(--dr-tick) no-repeat,
    repeating-linear-gradient(
        90deg,
        var(--dr-ink) 0 1px,
        transparent 1px calc(100% / (var(--day-ruler-hours) * 2))
      )
      top left / calc(100% + 1px) calc(var(--dr-tick) * 0.62) no-repeat,
    repeating-linear-gradient(
        90deg,
        rgb(16 27 43 / 55%) 0 1px,
        transparent 1px calc(100% / (var(--day-ruler-hours) * 4))
      )
      top left / calc(100% + 1px) calc(var(--dr-tick) * 0.36) no-repeat;
}

.day-ruler--card .day-ruler__ticks {
  background-size:
    calc(100% + 1.5px) var(--dr-tick),
    calc(100% + 1px) calc(var(--dr-tick) * 0.62),
    0 0;
}

.day-ruler__sky {
  position: absolute;
  inset: auto 0 0;
  height: var(--dr-sky);
  border-radius: 2px;
  box-shadow:
    inset 0 1px 2px rgb(0 0 0 / 40%),
    0 0 0 1px rgb(16 27 43 / 30%);
}

/* Numeral centrado en su marca mayor; el sufijo cuelga a la derecha. En la sans:
   a este tamaño la serif dibuja el 1 como una «l» y «11» se leería «ll». */
.day-ruler__numeral {
  position: absolute;
  top: calc(var(--dr-numeral) * -1 - 8px);
  font-family: var(--font-sans);
  font-size: var(--dr-numeral);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--color-brass-text);
  white-space: nowrap;
  transform: translateX(-50%);
}

.day-ruler__numeral small {
  position: absolute;
  bottom: 1px;
  left: 100%;
  margin-left: 3px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
}

/* Rombo: siempre posado con su centro en el borde inferior del cielo. */
.day-ruler__mark {
  position: absolute;
  top: 100%;
  width: var(--dr-mark);
  height: var(--dr-mark);
  color: var(--dr-confirmed);
  background-color: currentColor;
  border: 1.5px solid currentColor;
  box-shadow: 0 0 0 1.5px var(--dr-paper);
  transform: translate(-50%, -50%) rotate(45deg);
}

.day-ruler__mark--to-record {
  color: var(--dr-to-record);
  background: linear-gradient(135deg, currentColor 50%, var(--dr-paper) 50%);
}

.day-ruler__mark--no-show {
  color: var(--dr-no-show);
  background: var(--dr-paper);
}

.day-ruler__mark--cancelled {
  color: var(--dr-cancelled);
  background: var(--dr-paper);
  border-style: dashed;
}

/* Tu turno por confirmar: el rombo vacío de «Por confirmar», del tamaño del tuyo
   confirmado, con borde liso en tinta y un aura, para que se lea también sobre el
   cielo claro del mediodía. Punteado no: a este tamaño, girado, el trazo se rompe
   en manchas en las esquinas. */
.day-ruler__mark--draft {
  width: calc(var(--dr-mark) + 4px);
  height: calc(var(--dr-mark) + 4px);
  color: var(--dr-ink);
  background: var(--dr-paper);
  border: 2px solid currentColor;
  box-shadow:
    0 0 0 1.5px var(--dr-paper),
    0 0 0 5px rgb(16 27 43 / 22%);
}

.day-ruler__mark--mine {
  width: calc(var(--dr-mark) + 4px);
  height: calc(var(--dr-mark) + 4px);
  color: var(--dr-ink);
  background-color: var(--color-sun);
  box-shadow:
    0 0 0 1.5px var(--dr-paper),
    0 0 0 5px color-mix(in srgb, var(--color-sun) 40%, transparent);
}

/* «Ahora»: una aguja de Sol con su disco, sobre el cielo y por encima de los rombos. */
.day-ruler__sun {
  position: absolute;
  bottom: 0;
  z-index: 1;
  width: 2px;
  height: var(--dr-sky);
  background-color: var(--color-sun);
  box-shadow: 0 0 0 1px rgb(16 27 43 / 35%);
  transform: translateX(-50%);
}

.day-ruler__sun::after {
  position: absolute;
  top: -7px;
  left: 50%;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  content: '';
  background-color: var(--color-sun);
  border-radius: 1px;
  rotate: 45deg;
  box-shadow: 0 0 0 1.5px var(--dr-ink);
}

@media (max-width: 599px) {
  .day-ruler__numeral--minor {
    display: none;
  }
}
</style>
