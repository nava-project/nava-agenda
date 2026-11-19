<script setup lang="ts">
/**
 * DiamondLoader · la espera del panel, v2 «La luz del día» (DEC-188, entrega 5).
 *
 * Conserva el nombre y la API de la v1 (`label`, `layout`) para no tocar las
 * pantallas que lo usan, pero ya no talla un rombo: es el sol del logo
 * «Horizonte» asomando sobre su línea, despacio. Sin destello, sin rombo
 * viajero y sin frases rotativas («Afilando la navaja»): la espera dice lo que
 * espera, con el `label` a la vista.
 *
 * - Aparece tras 300 ms: una carga rápida no destella un cargador.
 * - Con movimiento reducido (sistema o preferencia del panel), el sol queda
 *   quieto sobre el horizonte.
 * - El consumidor aporta el role="status"/aria-live que le corresponda, igual
 *   que con AgendaSkeleton; el dibujo es decorativo.
 */
interface Props {
  /** Texto de la espera, visible y accesible: «Cargando la agenda de …». */
  label: string
  /** stacked: centrado en toda el área; inline: sol a la izquierda del texto. */
  layout?: 'stacked' | 'inline'
}

withDefaults(defineProps<Props>(), { layout: 'stacked' })
</script>

<template>
  <div class="diamond-loader" :class="`diamond-loader--${layout}`">
    <span class="diamond-loader__stage" aria-hidden="true">
      <span class="diamond-loader__sun" />
      <span class="diamond-loader__horizon" />
    </span>
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
  text-align: center;
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

/* El sol del logo bajo un horizonte: la mitad de abajo queda oculta. */
.diamond-loader__stage {
  position: relative;
  display: block;
  flex: none;
  width: 40px;
  height: 22px;
  overflow: hidden;
}

.diamond-loader--inline .diamond-loader__stage {
  width: 32px;
  height: 18px;
}

.diamond-loader__sun {
  position: absolute;
  bottom: -9px;
  left: 50%;
  width: 18px;
  height: 18px;
  background-color: var(--color-sun);
  border-radius: 50%;
  translate: -50% 0;
  animation: diamond-loader-rise 1.8s ease-in-out infinite alternate;
}

.diamond-loader__horizon {
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background-color: var(--color-text-primary);
  border-radius: 1px;
}

@keyframes diamond-loader-rise {
  from {
    transform: translateY(6px);
  }

  to {
    transform: translateY(-4px);
  }
}

@keyframes diamond-loader-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .diamond-loader,
  .diamond-loader__sun {
    animation: none;
  }
}

:global(:root[data-motion='reduced']) .diamond-loader,
:global(:root[data-motion='reduced']) .diamond-loader__sun {
  animation: none;
}
</style>
