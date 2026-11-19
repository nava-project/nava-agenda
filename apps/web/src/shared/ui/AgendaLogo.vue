<script setup lang="ts">
/**
 * AgendaLogo · el logo v2 «Horizonte» de Nava Agenda (DEC-188): la cúpula es el
 * sol a medias, el rombo NAVA va calado en el horizonte y su punta asoma en Alba
 * bajo la línea (tu hora). Es la misma geometría de public/favicon.svg.
 *
 * - `tile`: con la baldosa de tinta, como el favicon (el Alba del logo es fijo).
 * - Sin baldosa: el cuerpo toma `currentColor` y la punta el Alba del modo, para
 *   cabeceras sobre el lienzo.
 * Es decorativo por omisión (el nombre accesible lo da el texto vecino); con
 * `label` se anuncia como imagen.
 */
interface Props {
  tile?: boolean
  label?: string
}
const props = withDefaults(defineProps<Props>(), { tile: false, label: '' })
</script>

<template>
  <svg
    class="agenda-logo"
    :class="{ 'agenda-logo--tile': props.tile }"
    viewBox="0 0 512 512"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label || undefined"
    :aria-hidden="props.label ? undefined : 'true'"
    focusable="false"
  >
    <rect v-if="props.tile" class="agenda-logo__tile" width="512" height="512" rx="112" />
    <path
      class="agenda-logo__body"
      fill-rule="evenodd"
      d="M72 296A184 184 0 0 1 440 296Z M256 200L352 296L160 296Z M92 334H169.7L209.7 374H92A20 20 0 0 1 92 334Z M342.3 334H420A20 20 0 0 1 420 374H302.3Z"
    />
    <path class="agenda-logo__hour" d="M160 296L352 296L256 392Z" />
  </svg>
</template>

<style scoped>
.agenda-logo {
  display: block;
  flex: none;
  width: 1em;
  height: 1em;
}

.agenda-logo__body {
  fill: currentColor;
}

.agenda-logo__hour {
  fill: var(--color-brand-alba);
}

.agenda-logo__tile {
  fill: var(--color-brand-tile);
}

.agenda-logo--tile .agenda-logo__body {
  fill: var(--color-brand-tile-mark);
}

.agenda-logo--tile .agenda-logo__hour {
  fill: var(--color-brand-alba-mark);
}
</style>
