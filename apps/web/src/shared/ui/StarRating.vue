<script setup lang="ts">
/**
 * StarRating - Promedio de solo lectura (DEC-128, HU-100), dibujado con diamantes
 * (rombos de la identidad NAVA, issue #487; el nombre del componente se conserva).
 * Cinco diamantes con relleno proporcional (4,5 pinta cuatro y medio) y, opcional,
 * el valor y el total al lado. El conjunto es una sola imagen para el lector de
 * pantalla con el texto completo («4,5 de 5 · 12 reseñas»); los glifos y el texto
 * visible son decorativos para no leer dos veces. Sin reseñas visibles muestra
 * diamantes vacíos y «Sin reseñas todavía», nunca «0».
 * El color lo da `--star-filled-color` (latón por defecto) y se ajusta por superficie.
 */
import { computed } from 'vue'
import RatingGem from './RatingGem.vue'
import { MAX_RATING, ratingSummaryLabel, formatRating, reviewCountLabel } from '../model/rating'

interface Props {
  /** Promedio de 1 decimal, o `null` sin reseñas visibles. */
  rating: number | null
  /** Total de reseñas visibles. */
  count?: number
  /** Tamaño de las estrellas. */
  size?: 'sm' | 'md'
  /** Muestra el valor y el total junto a las estrellas. */
  showValue?: boolean
  /** Texto accesible propio; por defecto el resumen «4,5 de 5 · 12 reseñas». Una sola
   * reseña lo necesita («4 de 5 estrellas»): «1 reseña» la confundiría con un promedio. */
  label?: string
}

const props = withDefaults(defineProps<Props>(), { count: 0, size: 'md', showValue: true })

const hasRating = computed(() => props.rating !== null && props.count > 0)
const label = computed(() => props.label ?? ratingSummaryLabel(props.rating, props.count))

// Fracción de cada estrella pintada: la i-ésima (0..4) se llena con lo que falte
// del promedio, entre 0 y 1.
const fills = computed(() =>
  Array.from({ length: MAX_RATING }, (_, i) =>
    hasRating.value ? Math.min(1, Math.max(0, (props.rating ?? 0) - i)) : 0,
  ),
)
</script>

<template>
  <span class="star-rating" :class="`star-rating--${size}`" role="img" :aria-label="label">
    <span class="star-rating__stars" aria-hidden="true">
      <RatingGem v-for="(fill, i) in fills" :key="i" :fill="fill" class="star-rating__star" />
    </span>
    <span v-if="showValue" class="star-rating__value" aria-hidden="true">
      <template v-if="hasRating">
        <strong>{{ formatRating(rating) }}</strong>
        <span class="star-rating__count">({{ reviewCountLabel(count) }})</span>
      </template>
      <template v-else>Sin reseñas todavía</template>
    </span>
  </span>
</template>

<style scoped>
.star-rating {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-family-base);
  line-height: 1;
}

.star-rating__stars {
  display: inline-flex;
  gap: 2px;
}

.star-rating--md .star-rating__star {
  width: 20px;
  height: 20px;
}

.star-rating--sm .star-rating__star {
  width: 16px;
  height: 16px;
}

.star-rating__value {
  font-size: var(--font-size-caption, 13px);
  color: inherit;
}

.star-rating__value strong {
  font-weight: 700;
}

.star-rating__count {
  margin-left: 4px;
  opacity: 0.82;
}
</style>
