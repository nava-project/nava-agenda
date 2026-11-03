<script setup lang="ts">
/**
 * RatingGem - Diamante tallado de la calificación (issue #489; sustituye al rombo plano
 * de #487). Un rombo de cuatro facetas —luz arriba a la izquierda, sombra abajo a la
 * derecha— con borde definido. Vacío conserva contorno y facetas tenues; `fill` (0..1)
 * pinta la fracción izquierda del diamante, así 4,5 deja el quinto a medias.
 * Decorativo: quien lo usa aporta el nombre accesible. El color sale de
 * `--star-filled` y las tres tonalidades se derivan de él, de modo que cualquier
 * superficie lo ajusta con `--star-filled-color` sin tocar el glifo.
 */
import { computed, useId } from 'vue'

interface Props {
  /** Fracción pintada, de 0 (vacío) a 1 (lleno). */
  fill: number
}
const props = defineProps<Props>()

const clipId = `rating-gem-${useId()}`
const width = computed(() => Math.min(1, Math.max(0, props.fill)) * 24)
</script>

<template>
  <svg class="rating-gem" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <defs>
      <clipPath :id="clipId">
        <rect x="0" y="0" :width="width" height="24" />
      </clipPath>
    </defs>
    <!-- Vacío: contorno y talla tenue. -->
    <path class="rating-gem__outline" d="M12 1.5 22.5 12 12 22.5 1.5 12Z" />
    <path class="rating-gem__cut" d="M1.5 12h21M12 1.5v21" />
    <!-- Lleno: cuatro facetas recortadas a la fracción pintada. -->
    <g v-if="fill > 0" :clip-path="`url(#${clipId})`">
      <path class="rating-gem__facet rating-gem__facet--light" d="M1.5 12 12 1.5V12Z" />
      <path class="rating-gem__facet rating-gem__facet--base" d="M12 1.5 22.5 12H12Z" />
      <path class="rating-gem__facet rating-gem__facet--dark" d="M22.5 12 12 22.5V12Z" />
      <path class="rating-gem__facet rating-gem__facet--mid" d="M12 22.5 1.5 12H12Z" />
      <path class="rating-gem__edge" d="M12 1.5 22.5 12 12 22.5 1.5 12Z" />
    </g>
  </svg>
</template>

<style scoped>
.rating-gem {
  --gem: var(--star-filled-color, var(--color-accent-brass));
  --gem-light: color-mix(in srgb, var(--gem) 55%, white);
  --gem-dark: color-mix(in srgb, var(--gem) 62%, black);
  --gem-mid: color-mix(in srgb, var(--gem) 82%, black);

  display: block;
  overflow: visible;
}

.rating-gem__outline {
  fill: none;
  stroke: color-mix(in srgb, var(--gem) 58%, transparent);
  stroke-width: 1.3;
  stroke-linejoin: miter;
}

.rating-gem__cut {
  fill: none;
  stroke: color-mix(in srgb, var(--gem) 24%, transparent);
  stroke-width: 0.8;
}

.rating-gem__facet {
  stroke: var(--gem-dark);
  stroke-width: 0.5;
  stroke-linejoin: round;
}

.rating-gem__facet--light {
  fill: var(--gem-light);
}

.rating-gem__facet--base {
  fill: var(--gem);
}

.rating-gem__facet--dark {
  fill: var(--gem-dark);
}

.rating-gem__facet--mid {
  fill: var(--gem-mid);
}

.rating-gem__edge {
  fill: none;
  stroke: var(--gem-dark);
  stroke-width: 1;
  stroke-linejoin: miter;
}
</style>
