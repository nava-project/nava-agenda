<script setup lang="ts">
/**
 * DiamondRule · la regla-rombo-regla de la familia NAVA (DEC-189, #728).
 *
 * Un filete de latón con el rombo en el centro. Solo va donde el corte tiene
 * intención (un cambio de alcance, un estado de página), nunca como adorno
 * entre cada bloque.
 *
 * - Sin `label` es decorativa y queda oculta a los lectores de pantalla.
 * - Con `label`, el rótulo se lee: va a la izquierda y la regla llena el resto.
 * - `tone` permite teñirla del color de un estado (PageState); por omisión es
 *   el filete de latón, que nunca lleva texto encima.
 */
interface Props {
  /** Rótulo visible del corte, en tipo oración: «Todo el negocio». */
  label?: string
  /** Color del filete y el rombo; por omisión, el latón de filete. */
  tone?: string
  /** `full` llena el ancho; `short` es un remate centrado de 96 px. */
  size?: 'full' | 'short'
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  tone: undefined,
  size: 'full',
})
</script>

<template>
  <div
    class="diamond-rule"
    :class="[`diamond-rule--${props.size}`, { 'diamond-rule--labelled': props.label }]"
    :style="props.tone ? { '--diamond-rule-tone': props.tone } : undefined"
    :aria-hidden="props.label ? undefined : 'true'"
  >
    <p v-if="props.label" class="diamond-rule__label">{{ props.label }}</p>
    <span class="diamond-rule__line" aria-hidden="true" />
    <span class="diamond-rule__mark" aria-hidden="true" />
    <span class="diamond-rule__line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.diamond-rule {
  --diamond-rule-tone: var(--color-brass-line);

  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.diamond-rule--short {
  width: 96px;
  margin-inline: auto;
}

.diamond-rule__line {
  flex: 1;
  height: 1px;
  background-color: var(--diamond-rule-tone);
}

.diamond-rule__mark {
  flex: none;
  width: 7px;
  height: 7px;
  background-color: var(--diamond-rule-tone);
  transform: rotate(45deg);
}

/* Con rótulo: el texto manda a la izquierda y la regla corre hasta el borde,
   con el rombo a un tercio. */
.diamond-rule--labelled .diamond-rule__line:first-of-type {
  flex: 0 0 32px;
}

.diamond-rule__label {
  flex: none;
  margin: 0;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  line-height: 20px;
  color: var(--color-brass-text);
}
</style>
