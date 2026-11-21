<script setup lang="ts">
/**
 * DayTrack - Pista horaria de un día: una regla con marcas por hora y, por
 * cada tramo, el pedazo del cielo de la familia que le toca a esa hora (el
 * mismo cielo de la franja de la reserva y de la regla del día, #782).
 * Decorativa (aria-hidden):
 * los tramos reales se leen en la lista que la acompaña. Sin animación al
 * montarse; `activeId` resalta la barra del tramo que el usuario señala en la
 * lista. Con `nowMinute` dibuja el marcador de "ahora" en Sol.
 */
import { computed } from 'vue'
import { skyGradient } from '@/shared/time/daySky'
import { segmentGeometry, type BoardScale } from '../model/weekBoard'

interface TrackSegment {
  id: string
  startsTime: string
  durationMinutes: number
  /** Tramo de contexto (ya existente) bajo el que se está proponiendo otro. */
  muted?: boolean
}

interface Props {
  segments: readonly TrackSegment[]
  scale: BoardScale
  activeId?: string | null
  nowMinute?: number | null
  /** Pista del diálogo: la barra es la propuesta y sigue al formulario. */
  preview?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  activeId: null,
  nowMinute: null,
  preview: false,
})

const hours = computed(() => (props.scale.endMinute - props.scale.startMinute) / 60)

// El cielo se pinta una vez para toda la regla; cada barra lo muestra en su
// tramo, con la imagen del ancho de la pista y corrida hasta su hora (en
// `background-position`, X% alinea el X% de la imagen con el X% de la barra).
const sky = computed(() => skyGradient(props.scale.startMinute, props.scale.endMinute))

function skyWindow(from: number, span: number): Record<string, string> {
  if (span <= 0) return {}
  const position = span >= 99.99 ? 0 : (from / (100 - span)) * 100
  return {
    '--bar-sky-size': `${(10000 / span).toFixed(3)}%`,
    '--bar-sky-at': `${position.toFixed(3)}%`,
  }
}

const bars = computed(() =>
  props.segments
    .filter((s) => /^\d{2}:\d{2}$/.test(s.startsTime) && s.durationMinutes > 0)
    .map((s) => {
      const geometry = segmentGeometry(s.startsTime, s.durationMinutes, props.scale)
      return {
        id: s.id,
        muted: s.muted === true,
        ...geometry,
        style: {
          '--bar-from': `${geometry.from}%`,
          '--bar-span': `${geometry.span}%`,
          ...skyWindow(geometry.from, geometry.span),
        },
      }
    }),
)

const nowPercent = computed(() => {
  if (props.nowMinute === null) return null
  const { startMinute, endMinute } = props.scale
  if (props.nowMinute < startMinute || props.nowMinute > endMinute) return null
  return ((props.nowMinute - startMinute) / (endMinute - startMinute)) * 100
})
</script>

<template>
  <div
    class="day-track"
    :class="{ 'day-track--preview': preview }"
    :style="{ '--track-hours': hours, '--track-sky': sky }"
    aria-hidden="true"
  >
    <span
      v-for="bar in bars"
      :key="bar.id"
      class="day-track__bar"
      :class="{
        'day-track__bar--active': bar.id === activeId,
        'day-track__bar--cut': bar.crossesMidnight,
        'day-track__bar--muted': bar.muted,
      }"
      :style="bar.style"
    />
    <span v-if="nowPercent !== null" class="day-track__now" :style="{ left: `${nowPercent}%` }" />
  </div>
</template>

<style scoped>
/* La jornada es luz (#782): la pista apagada es el «sin horas» neutro de la
   franja de la reserva y cada tramo abre su ventana al cielo de la familia,
   que es material fijo (igual en Día y en Noche). Las barras son opacas para
   que las líneas de hora de la regla no las crucen. */
.day-track {
  --day-track-off: color-mix(in srgb, var(--color-text-primary) 9%, var(--color-surface));

  position: relative;
  height: var(--track-height, 20px);
  background-color: var(--day-track-off);
  /* Una línea por hora: la regla se lee sin necesidad de etiquetas en cada día. */
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-text-primary) 12%, transparent) 1px,
    transparent 1px
  );
  background-size: calc(100% / var(--track-hours)) 100%;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-primary) 10%, transparent);
}

.day-track__bar {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: var(--bar-from);
  width: var(--bar-span);
  background-color: var(--color-sun);
  background-image: var(--track-sky);
  background-repeat: no-repeat;
  background-size: var(--bar-sky-size, 100%) 100%;
  background-position: var(--bar-sky-at, 0) 0;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #1a1c3d 18%, transparent);
  transition:
    top var(--motion-duration-fast) var(--motion-easing-standard),
    bottom var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.day-track__bar--cut {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent);
  mask-image: linear-gradient(90deg, #000 88%, transparent);
}

/* Tramo ya existente bajo la propuesta del diálogo: el cielo velado. */
.day-track__bar--muted {
  opacity: 0.38;
}

/* El tramo que se señala en la lista se ve entero y con filete de latón. */
.day-track__bar--active {
  top: -1px;
  bottom: -1px;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, #1a1c3d 22%, transparent),
    0 0 0 1.5px var(--color-brass-text);
}

/* «Ahora»: el rombo de sol de la franja del día, con su resplandor, sobre un
   hilo de sol. */
.day-track__now {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
  background-color: var(--color-sun);
}

.day-track__now::before {
  content: '';
  position: absolute;
  top: -5px;
  left: -4px;
  width: 10px;
  height: 10px;
  background-color: var(--color-sun);
  border-radius: 1px;
  rotate: 45deg;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 10px 3px color-mix(in srgb, var(--color-sun) 55%, transparent);
}

/* En el diálogo la propuesta es la que manda: cielo entero, filete de latón,
   y sigue al formulario. */
.day-track--preview .day-track__bar:not(.day-track__bar--muted) {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, #1a1c3d 22%, transparent),
    0 0 0 1.5px var(--color-brass-text);
}

.day-track--preview .day-track__bar {
  transition:
    left 200ms var(--motion-easing-standard),
    width 200ms var(--motion-easing-standard),
    background-size 200ms var(--motion-easing-standard),
    background-position 200ms var(--motion-easing-standard);
}

/* Llegada (#782): cada ventana de cielo se abre desde su hora de inicio,
   después de que su día asoma. Solo transform y opacidad; sin animación con
   movimiento reducido del sistema o del panel. La propuesta del diálogo no
   entra así: sigue al formulario. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .day-track:not(.day-track--preview) .day-track__bar {
    transform-origin: left center;
    animation: day-track-dawn 520ms calc(var(--day-index, 0) * 45ms + 160ms)
      cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
}

@keyframes day-track-dawn {
  from {
    opacity: 0;
    transform: scaleX(0.2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .day-track__bar,
  .day-track--preview .day-track__bar {
    transition: none;
  }
}

:root[data-motion='reduced'] .day-track__bar {
  transition: none;
}
</style>
