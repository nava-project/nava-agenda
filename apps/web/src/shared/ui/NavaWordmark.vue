<script setup lang="ts">
/**
 * NavaWordmark · la firma de Nava Agenda (DEC-188): el logo «Horizonte» y el
 * nombre en Instrument Sans, «NAVA» espaciado y «Agenda» al lado. Texto
 * accesible, nunca imagen raster. NAVA identifica la plataforma; el nombre del
 * negocio es dato del tenant y se muestra por separado.
 */
import AgendaLogo from './AgendaLogo.vue'

interface Props {
  /** ink: texto del lienzo claro. inverted: texto del lienzo del modo (panel). */
  variant?: 'ink' | 'inverted'
  /** sm: firma de cabecera. lg: marca del panel partido de acceso. */
  size?: 'sm' | 'lg'
  /** Muestra «Agenda» junto a NAVA. */
  product?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'ink',
  size: 'sm',
  product: true,
})
</script>

<template>
  <span class="nava-wordmark" :class="[`nava-wordmark--${variant}`, `nava-wordmark--${size}`]">
    <AgendaLogo class="nava-wordmark__logo" />
    <span class="nava-wordmark__name">NAVA</span>
    <!-- El espacio inicial separa «NAVA Agenda» al leerlo; el flex no lo dibuja. -->
    <span v-if="product" class="nava-wordmark__product">&#32;Agenda</span>
  </span>
</template>

<style scoped>
.nava-wordmark {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  font-family: var(--font-sans);
  line-height: 1;
  color: var(--color-text-primary);
}

.nava-wordmark--inverted {
  color: var(--color-on-strong);
}

.nava-wordmark__logo {
  width: 1.5em;
  height: 1.5em;
  margin-right: 0.1em;
}

.nava-wordmark__name {
  font-weight: 700;
  letter-spacing: 0.16em;
}

.nava-wordmark__product {
  font-weight: 500;
  color: var(--color-text-secondary);
}

.nava-wordmark--inverted .nava-wordmark__product {
  color: var(--color-on-strong-muted);
}

.nava-wordmark--sm {
  font-size: 15px;
}

.nava-wordmark--lg {
  font-size: 28px;
}

@media (min-width: 1024px) {
  .nava-wordmark--lg {
    font-size: 40px;
  }
}
</style>
