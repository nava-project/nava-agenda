<script setup lang="ts">
// Emblema de la pantalla «Google Calendar» (#331; en la familia, #838 · DEC-189):
// la hoja de calendario de latón de la tarjeta de turno (CalendarLeaf, el mismo
// componente) con una insignia de estado en rombo en la esquina. Es de Nava: no
// imita el ícono de Google Calendar (nada azul, ningún «31» en una cuadrícula).
//
// Decorativo (aria-hidden): el estado lo dicen la etiqueta y el titular. La
// insignia tampoco es la única pista visual: hueca sin conexión, llena con ella,
// y con su propio trazo (marca, giro, «!» o raya). Quieta: nada se anima.
import { computed } from 'vue'
import { CalendarLeaf } from '@/shared/ui'
import type { GoogleCalendarView } from '../model/googleCalendar'

const props = defineProps<{ view: GoogleCalendarView }>()

// La hoja muestra el día de hoy: es «tu agenda», no una fecha concreta.
const parts = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).formatToParts(
  new Date(),
)
const month = (parts.find((p) => p.type === 'month')?.value ?? '')
  .replace('.', '')
  .toLocaleUpperCase('es-CO')
const day = parts.find((p) => p.type === 'day')?.value ?? ''

/** Sin conexión viva la insignia es solo contorno: «todavía no hay nada encendido». */
const hollow = computed(
  () =>
    props.view === 'not-connected' ||
    props.view === 'needs-professional' ||
    props.view === 'unavailable',
)
const isAlert = computed(() => props.view === 'reauth' || props.view === 'sync-error')
</script>

<template>
  <span class="gcal-emblem" :class="`gcal-emblem--${view}`" aria-hidden="true">
    <CalendarLeaf class="gcal-emblem__leaf" :month="month" :day="day" />
    <svg
      class="gcal-emblem__badge"
      :class="{ 'gcal-emblem__badge--hollow': hollow }"
      viewBox="0 0 36 36"
      width="36"
      height="36"
      focusable="false"
    >
      <path class="gcal-emblem__badge-disc" d="M18 2 L34 18 L18 34 L2 18 Z" />
      <path v-if="view === 'connected'" class="gcal-emblem__glyph" d="M11.5 18.5l4.5 4.5 8.5-9" />
      <path
        v-else-if="view === 'syncing'"
        class="gcal-emblem__glyph"
        d="M11.5 18a6.5 6.5 0 0 1 11-4.5M24.5 18a6.5 6.5 0 0 1-11 4.5"
      />
      <path v-else-if="isAlert" class="gcal-emblem__glyph" d="M18 10.5v9M18 24.5v.5" />
      <path v-else-if="view === 'unavailable'" class="gcal-emblem__glyph" d="M12 18h12" />
    </svg>
  </span>
</template>

<style scoped>
.gcal-emblem {
  --emblem-tone: var(--gcal-tone, var(--color-brass-text));

  position: relative;
  display: block;
  flex: 0 0 auto;
  width: 74px;
  padding: 0 14px 14px 0;
  box-sizing: content-box;
}

.gcal-emblem__badge {
  position: absolute;
  right: 0;
  bottom: 0;
  display: block;
  overflow: visible;
}

/* Llena con la conexión viva: el rombo en el tono del estado y el trazo en la
   superficie, como un sello. */
.gcal-emblem__badge-disc {
  fill: var(--emblem-tone);
  stroke: var(--color-surface);
  stroke-width: 2.5;
  stroke-linejoin: round;
}

.gcal-emblem__glyph {
  fill: none;
  stroke: var(--color-surface);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Sin conexión: solo el contorno, en latón de texto (≥ 3:1 en Día y Noche). */
.gcal-emblem__badge--hollow .gcal-emblem__badge-disc {
  fill: var(--color-surface);
  stroke: var(--emblem-tone);
  stroke-width: 2;
}

.gcal-emblem__badge--hollow .gcal-emblem__glyph {
  stroke: var(--emblem-tone);
}
</style>
