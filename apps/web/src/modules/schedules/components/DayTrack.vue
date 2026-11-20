<script setup lang="ts">
/**
 * DayTrack - Pista horaria de un día: una regla con marcas por hora y una
 * barra en tinta suave por cada tramo (v2, DEC-188). Decorativa (aria-hidden):
 * los tramos reales se leen en la lista que la acompaña. Sin animación al
 * montarse; `activeId` resalta la barra del tramo que el usuario señala en la
 * lista. Con `nowMinute` dibuja el marcador de "ahora" en Sol.
 */
import { computed } from 'vue'
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

const bars = computed(() =>
  props.segments
    .filter((s) => /^\d{2}:\d{2}$/.test(s.startsTime) && s.durationMinutes > 0)
    .map((s) => ({
      id: s.id,
      muted: s.muted === true,
      ...segmentGeometry(s.startsTime, s.durationMinutes, props.scale),
    })),
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
    :style="{ '--track-hours': hours }"
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
      :style="{ '--bar-from': `${bar.from}%`, '--bar-span': `${bar.span}%` }"
    />
    <span v-if="nowPercent !== null" class="day-track__now" :style="{ left: `${nowPercent}%` }" />
  </div>
</template>

<style scoped>
/* Barras en tinta suave y no en el azul «confirmado» de la agenda: aquí la
   barra es la jornada disponible, no una cita, y ese azul ya significa «cita
   confirmada» en el carril del día. El acento del negocio queda fuera (v2).
   Las barras son opacas (mezcla con la superficie) para que las líneas de hora
   de la regla no las crucen. */
.day-track {
  --day-track-bar: color-mix(in srgb, var(--color-text-primary) 36%, var(--color-surface));

  position: relative;
  height: var(--track-height, 20px);
  background-color: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  /* Una línea por hora: la regla se lee sin necesidad de etiquetas en cada día. */
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-text-primary) 10%, transparent) 1px,
    transparent 1px
  );
  background-size: calc(100% / var(--track-hours)) 100%;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: 2px;
}

.day-track__bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: var(--bar-from);
  width: var(--bar-span);
  background-color: var(--day-track-bar);
  border-radius: 2px;
  transition:
    top var(--motion-duration-fast) var(--motion-easing-standard),
    bottom var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.day-track__bar--cut {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent);
  mask-image: linear-gradient(90deg, #000 88%, transparent);
}

/* Tramo ya existente bajo la propuesta del diálogo: más tenue. */
.day-track__bar--muted {
  background-color: color-mix(in srgb, var(--color-text-primary) 16%, var(--color-surface));
}

/* El tramo que se señala en la lista se ve entero y en tinta más firme. */
.day-track__bar--active {
  top: 0;
  bottom: 0;
  background-color: color-mix(in srgb, var(--color-text-primary) 64%, var(--color-surface));
}

/* "Ahora": línea de Sol con su disco, como la de la agenda, sin pulso. */
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
  top: -4px;
  left: -3px;
  width: 8px;
  height: 8px;
  background-color: var(--color-sun);
  border-radius: 1px;
  rotate: 45deg;
  box-shadow: 0 0 0 2px var(--color-surface);
}

/* En el diálogo la propuesta va en tinta firme y sigue al formulario. */
.day-track--preview {
  --day-track-bar: color-mix(in srgb, var(--color-text-primary) 64%, var(--color-surface));
}

.day-track--preview .day-track__bar {
  transition:
    left 200ms var(--motion-easing-standard),
    width 200ms var(--motion-easing-standard);
}

@media (prefers-reduced-motion: reduce) {
  .day-track__bar,
  .day-track--preview .day-track__bar {
    transition: none;
  }
}
</style>
