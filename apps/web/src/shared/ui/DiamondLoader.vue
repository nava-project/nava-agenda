<script setup lang="ts">
/**
 * DiamondLoader · la espera de una pantalla (DEC-188, entrega 5; #735).
 *
 * Conserva el nombre y la API (`label`, `layout`) y dibuja la marca de espera
 * de la familia: el diamante dentro del sol (SunDiamond), con el texto de lo
 * que se espera a la vista («Cargando la agenda de …»). Es el mismo dibujo en
 * todas las esperas de la app, del mismo tamaño y en el mismo lugar.
 *
 * - Aparece tras 300 ms: una carga rápida no destella un cargador.
 * - Con movimiento reducido (sistema o preferencia del panel), queda quieto.
 * - Quien lo usa suele envolverlo en su región viva (role="status"); si no la
 *   hay, `announce` le da la suya. Nunca las dos: se anunciaría dos veces.
 */
import SunDiamond from './SunDiamond.vue'

interface Props {
  /** Texto de la espera, visible y accesible: «Cargando la agenda de …». */
  label: string
  /**
   * stacked: centrado en toda el área · inline: marca a la izquierda del texto ·
   * overlay: en el centro de la pantalla, encima de las siluetas, sin ocupar
   * alto propio: el esqueleto guarda el alto de lo que viene y nada salta. Es
   * el mismo lugar que el arranque de `index.html`, así que la espera no se
   * mueve al pasar del arranque a la pantalla ni de una pantalla a otra ·
   * column: igual, pero centrado en su columna (contenedor posicionado), para
   * las pantallas de dos columnas de la reserva.
   */
  layout?: 'stacked' | 'inline' | 'overlay' | 'column'
  /** Anuncia la espera con role="status". */
  announce?: boolean
}

withDefaults(defineProps<Props>(), { layout: 'stacked', announce: false })
</script>

<template>
  <div
    class="diamond-loader"
    :class="`diamond-loader--${layout}`"
    :role="announce ? 'status' : undefined"
    :aria-live="announce ? 'polite' : undefined"
  >
    <SunDiamond class="diamond-loader__mark" :size="layout === 'inline' ? 'md' : 'lg'" />
    <span class="diamond-loader__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.diamond-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-secondary);
  animation: diamond-loader-in 200ms ease-out 300ms backwards;
}

.diamond-loader--stacked {
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 176px;
  text-align: center;
}

.diamond-loader--overlay,
.diamond-loader--column {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 1;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-10, 40px);
  text-align: center;
  /* Sin caja: un halo del lienzo que apaga las siluetas detrás de la marca. */
  background: radial-gradient(
    closest-side,
    var(--color-canvas) 55%,
    color-mix(in srgb, var(--color-canvas) 0%, transparent)
  );
  translate: -50% -50%;
  width: max-content;
  max-width: calc(100vw - 2 * var(--space-4));
}

.diamond-loader--column {
  position: absolute;
  top: var(--space-8);
  translate: -50% 0;
}

.diamond-loader--inline {
  flex-direction: row;
  justify-content: flex-start;
  padding: var(--space-2) 0;
  text-align: left;
}

.diamond-loader__label {
  font-size: 15px;
  line-height: 22px;
}

/* El texto de la espera, en la serif de los titulares cuando ocupa la
   pantalla: es lo único que hay que leer. */
.diamond-loader--stacked .diamond-loader__label,
.diamond-loader--overlay .diamond-loader__label,
.diamond-loader--column .diamond-loader__label {
  font-family: var(--font-display);
  font-size: 19px;
  line-height: 26px;
  color: var(--color-text-primary);
}

@keyframes diamond-loader-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .diamond-loader {
    animation: none;
  }
}

:root[data-motion='reduced'] .diamond-loader {
  animation: none;
}
</style>
