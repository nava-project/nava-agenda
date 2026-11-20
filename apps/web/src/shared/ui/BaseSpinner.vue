<script setup lang="ts">
/**
 * BaseSpinner · indicador de progreso indeterminado (issue #189).
 *
 * Desde #735 dibuja la marca de espera de la familia: el diamante dentro del
 * sol (SunDiamond), en lugar del anillo de latón. Conserva su API (`size`,
 * `tone`, `label`) para no tocar a sus consumidores (PageState y paneles).
 * `tone` tiñe los rayos: la espera neutra va en latón y un tono de estado solo
 * se usa cuando la espera es parte de un aviso.
 *
 * Accesibilidad: decorativo (aria-hidden) cuando un rótulo visible lo
 * acompaña, que es el caso normal dentro de PageState; role="img" con
 * aria-label cuando va solo. Con movimiento reducido queda quieto.
 */
import { computed } from 'vue'
import SunDiamond from './SunDiamond.vue'

interface Props {
  /** Tamaño de la marca */
  size?: 'sm' | 'md' | 'lg'
  /** Tinte de los rayos; latón por defecto (espera neutra) */
  tone?: 'brass' | 'success' | 'warning' | 'danger' | 'info'
  /** Texto accesible cuando no hay un rótulo visible adyacente */
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'lg',
  tone: 'brass',
  label: undefined,
})

const toneVar = computed(() => {
  const map: Record<string, string> = {
    brass: 'var(--color-brass-body)',
    success: 'var(--color-success-text)',
    warning: 'var(--color-warning-text)',
    danger: 'var(--color-danger-text)',
    info: 'var(--color-info-text)',
  }
  return map[props.tone] || map.brass
})

const classes = computed(() => ['base-spinner', `base-spinner--${props.size}`])

const style = computed(() => ({ '--spinner-tone': toneVar.value }))
</script>

<template>
  <span
    :class="classes"
    :style="style"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  >
    <SunDiamond :size="size === 'sm' ? 'md' : size" class="base-spinner__mark" />
  </span>
</template>

<style scoped>
.base-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.base-spinner__mark {
  --sd-ray: var(--spinner-tone);
}

.base-spinner--sm .base-spinner__mark {
  --sd-size: 20px;
}
</style>
