<script setup lang="ts">
// Emblema de la pantalla «Google Calendar» (issue #331): una hoja de calendario con
// un día marcado y una insignia de estado. Es solo ilustración (aria-hidden): el estado
// real lo comunican el badge y el texto de la pantalla. v2 (DEC-188): la hoja va en
// tinta y solo la insignia toma el tono del estado; queda dibujada y quieta (sin
// trazo al entrar, sin órbita ni anillo que respira, sin rombo).
import { computed } from 'vue'
import type { GoogleCalendarView } from '../model/googleCalendar'

const props = defineProps<{ view: GoogleCalendarView }>()

const isLive = computed(() => props.view === 'connected' || props.view === 'syncing')
const isAlert = computed(() => props.view === 'reauth' || props.view === 'sync-error')
</script>

<template>
  <svg
    class="gcal-emblem"
    :class="[`gcal-emblem--${view}`]"
    viewBox="0 0 112 112"
    width="112"
    height="112"
    aria-hidden="true"
    focusable="false"
  >
    <g class="gcal-emblem__sheet">
      <rect class="gcal-emblem__body" x="22" y="28" width="68" height="64" rx="4" fill="none" />
      <path class="gcal-emblem__band" d="M22 46h68" fill="none" />
      <path class="gcal-emblem__ring" d="M40 21v14M72 21v14" fill="none" />
      <!-- Rejilla de días. -->
      <g class="gcal-emblem__days">
        <rect
          v-for="(d, i) in [0, 1, 2, 3, 4, 5]"
          :key="d"
          class="gcal-emblem__day"
          :x="32 + (i % 3) * 18"
          :y="56 + Math.floor(i / 3) * 14"
          width="10"
          height="8"
          rx="1.5"
        />
      </g>
      <!-- Día marcado: hueco hasta que la agenda se publica. -->
      <circle
        class="gcal-emblem__mark"
        :class="{ 'gcal-emblem__mark--filled': isLive }"
        cx="56"
        cy="76"
        r="5.5"
      />
    </g>

    <!-- Insignia de estado. -->
    <g :key="view" class="gcal-emblem__badge">
      <circle cx="88" cy="88" r="15" class="gcal-emblem__badge-disc" />
      <path
        v-if="view === 'connected'"
        class="gcal-emblem__glyph"
        d="M81 88.5l5 5 9-10"
        fill="none"
      />
      <path
        v-else-if="view === 'syncing'"
        class="gcal-emblem__glyph"
        d="M81 88a7 7 0 0 1 12-5M95 88a7 7 0 0 1-12 5"
        fill="none"
      />
      <path v-else-if="isAlert" class="gcal-emblem__glyph" d="M88 80v9M88 94.5v.5" fill="none" />
      <path
        v-else-if="view === 'unavailable'"
        class="gcal-emblem__glyph"
        d="M81 88h14"
        fill="none"
      />
      <path v-else class="gcal-emblem__glyph" d="M88 80v16M80 88h16" fill="none" />
    </g>
  </svg>
</template>

<style scoped>
.gcal-emblem {
  --emblem-tone: var(--gcal-tone, var(--color-text-secondary));

  display: block;
  flex: 0 0 auto;
  overflow: visible;
}

.gcal-emblem__body,
.gcal-emblem__band,
.gcal-emblem__ring {
  stroke: var(--color-text-primary);
  stroke-width: 2;
  stroke-linecap: round;
}

.gcal-emblem__ring {
  stroke-width: 3;
}

.gcal-emblem__day {
  fill: color-mix(in srgb, var(--color-text-primary) 18%, transparent);
}

.gcal-emblem__mark {
  fill: var(--color-surface);
  stroke: var(--color-text-primary);
  stroke-width: 1.6;
}

.gcal-emblem__mark--filled {
  fill: var(--color-text-primary);
}

.gcal-emblem__badge-disc {
  fill: var(--color-surface);
  stroke: var(--emblem-tone);
  stroke-width: 2;
}

.gcal-emblem__glyph {
  stroke: var(--emblem-tone);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
