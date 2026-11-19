<script setup lang="ts">
/**
 * PageState - Estado de página centrado (issue #189, atlas
 * panel-agenda-eventos, eventos 02/03/04/07/08): para cuando la carga, el
 * error o el vacío ocupan TODA el área de contenido. Cuando el estado
 * acompaña contenido que sigue visible (p. ej. el evento 10, zona horaria no
 * confirmada), se usa `BaseAlert` como nota al margen en su lugar — este
 * componente no reemplaza esa variante.
 *
 * variant="loading": BaseSpinner + titular, sin divisor ni rótulo de estado
 * (evento 02). Los demás variants componen un filete corto del color de
 * estado (la regla-rombo-regla de la familia, DEC-189) con un rótulo de estado
 * opcional (omitido para `info`, presente para `warning`/`danger`
 * con la palabra "Atención"/"Error", igual criterio que BaseAlert), titular
 * serif y cuerpo. La acción real (BaseButton) es responsabilidad del
 * consumidor vía el slot `action`.
 */
import { computed } from 'vue'
import BaseSpinner from './BaseSpinner.vue'
import DiamondRule from './DiamondRule.vue'

interface Props {
  variant?: 'loading' | 'info' | 'success' | 'warning' | 'danger'
  /** Rótulo de estado en tipo oración, p. ej. "Atención"/"Error". Se omite si
   * no se pasa: no todo estado necesita nombrarse (evento 04, informativo). */
  statusLabel?: string
  /** Titular serif — el texto exacto del código, nunca reescrito aquí. */
  headline: string
  /** loading/info → status (polite); warning/danger → alert (assertive). */
  role?: 'status' | 'alert'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'info',
})

const isLoading = computed(() => props.variant === 'loading')

const resolvedRole = computed(() => {
  if (props.role) return props.role
  return props.variant === 'warning' || props.variant === 'danger' ? 'alert' : 'status'
})

// PageState vive siempre sobre la superficie fuerte (tinta o marfil), así que
// la marca usa los tokens `*-on-strong` (medidos AA en ambos temas) y el
// acento de marca de esa superficie; los pares claros del sistema darían
// 2.04:1 (danger) a 3.68:1 (warning) sobre tinta.
const markVar = computed(() => {
  const map: Record<string, string> = {
    info: 'var(--color-brand-accent-surface)',
    success: 'var(--color-success-on-strong)',
    warning: 'var(--color-warning-on-strong)',
    danger: 'var(--color-danger-on-strong)',
  }
  return map[props.variant] || map.info
})

const style = computed(() => ({ '--page-state-mark': markVar.value }))
</script>

<template>
  <div
    class="page-state"
    :style="style"
    :role="resolvedRole"
    :aria-live="resolvedRole === 'alert' ? 'assertive' : 'polite'"
    aria-atomic="true"
  >
    <BaseSpinner v-if="isLoading" size="lg" tone="brass" aria-hidden="true" />
    <DiamondRule v-else class="page-state__divider" size="short" tone="var(--page-state-mark)" />

    <p v-if="statusLabel" class="page-state__status">{{ statusLabel }}</p>
    <h2 class="page-state__headline">{{ headline }}</h2>
    <p v-if="$slots.default" class="page-state__body"><slot /></p>
    <div v-if="$slots.action" class="page-state__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.page-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}

/* Regla-rombo-regla corta, del color del estado, sobre el rótulo (DEC-189). */
.page-state__divider {
  margin-bottom: var(--space-1);
}

.page-state__status {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--page-state-mark);
}

.page-state__headline {
  margin: 0;
  max-width: 32ch;
  font-family: var(--font-display);
  font-size: var(--font-size-h2);
  line-height: var(--font-size-h2-line);
  font-weight: var(--font-weight-h2);
  color: var(--color-on-strong);
}

.page-state__body {
  margin: 0;
  max-width: 42ch;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--color-on-strong-muted);
}

/* Destino de otra sección del producto (evento 04, "Profesionales"): el
 * consumidor marca el enlace con esta clase para heredar el estilo del enlace — PageState
 * no expone un prop de color libre (props describen intención, no valores
 * libres, mismo criterio que BaseBadge). */
.page-state__body :deep(.page-state__link) {
  color: var(--color-text-secondary);
  font-weight: 600;
  text-decoration: none;
}

.page-state__body :deep(.page-state__link:hover) {
  text-decoration: underline;
}

.page-state__action {
  margin-top: var(--space-2);
}
</style>
