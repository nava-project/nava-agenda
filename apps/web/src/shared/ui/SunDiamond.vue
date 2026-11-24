<script setup lang="ts">
/**
 * SunDiamond · la marca de la espera de Agenda: el diamante dentro del sol (#735).
 *
 * El sol es el del logo «Horizonte» y dentro, separado por un filete calado
 * (deja ver el fondo, así se lee nítido sobre cualquier lienzo), el diamante
 * entero, tallado en cuatro caras de latón. Es el único dibujo de carga de la
 * app; lo usan DiamondLoader (espera de pantalla), BaseSpinner (PageState y
 * paneles) y BaseButton (botón que espera, en el color de su texto).
 *
 * Mientras existe, se mueve: los rayos (ocho rombos diminutos) giran despacio,
 * el sol respira y un brillo cruza el diamante. El bucle dura lo que dura la
 * carga porque el componente solo se monta mientras se espera (WCAG 2.2.2: es
 * el indicador de progreso). Con movimiento reducido, del sistema o del panel
 * (`data-motion="reduced"`), todo queda quieto: el diamante dentro del sol.
 *
 * Decorativo: quien lo usa pone el texto de la espera y su role="status".
 */
import { computed, useId } from 'vue'

interface Props {
  /** sm: dentro de un botón (sin rayos) · md: en línea · lg: espera de pantalla. */
  size?: 'sm' | 'md' | 'lg'
  /** Quieto: la marca como estado y no como espera (un enlace que no lleva a
   * ninguna agenda, #809). Sin entrada, giro, respiro ni brillo. */
  still?: boolean
}

const props = withDefaults(defineProps<Props>(), { size: 'lg', still: false })

const uid = useId()
const maskId = `sd-cut-${uid}`
const gleamId = `sd-gleam-${uid}`
const clipId = `sd-clip-${uid}`
const withRays = computed(() => props.size !== 'sm')

/* Ocho rombos en el anillo de rayos, a 45° entre sí. */
const rays = Array.from({ length: 8 }, (_, i) => i * 45)

/* El filete calado alrededor del diamante y sus cuatro caras. */
const GAP = 'M24 11 L37 24 L24 37 L11 24 Z'
const DIAMOND = 'M24 13.5 L34.5 24 L24 34.5 L13.5 24 Z'
const FACETS = [
  'M24 13.5 L13.5 24 L24 24 Z',
  'M24 13.5 L34.5 24 L24 24 Z',
  'M34.5 24 L24 34.5 L24 24 Z',
  'M13.5 24 L24 34.5 L24 24 Z',
]
</script>

<template>
  <svg
    class="sun-diamond"
    :class="[`sun-diamond--${size}`, { 'sun-diamond--still': still }]"
    viewBox="0 0 48 48"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
        <rect width="48" height="48" fill="#fff" />
        <path :d="GAP" fill="#000" />
      </mask>
      <clipPath :id="clipId">
        <path :d="DIAMOND" />
      </clipPath>
      <linearGradient :id="gleamId" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" />
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.85" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
    </defs>

    <g v-if="withRays" class="sun-diamond__rays">
      <path
        v-for="angle in rays"
        :key="angle"
        class="sun-diamond__ray"
        d="M24 0 L25.8 2.6 L24 5.2 L22.2 2.6 Z"
        :transform="`rotate(${angle} 24 24)`"
      />
    </g>

    <g class="sun-diamond__sun">
      <circle class="sun-diamond__disc" cx="24" cy="24" r="17.5" :mask="`url(#${maskId})`" />
    </g>

    <g class="sun-diamond__gem">
      <path
        v-for="(facet, i) in FACETS"
        :key="i"
        class="sun-diamond__facet"
        :class="`sun-diamond__facet--${i + 1}`"
        :d="facet"
      />
      <g :clip-path="`url(#${clipId})`">
        <rect
          class="sun-diamond__gleam"
          x="2"
          y="12"
          width="12"
          height="24"
          :fill="`url(#${gleamId})`"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.sun-diamond {
  --sd-size: 72px;
  --sd-sun: var(--color-sun);
  --sd-ray: var(--color-brass-body);
  /* Las cuatro caras del latón: la luz entra arriba a la derecha. */
  --sd-facet-1: color-mix(in srgb, var(--color-brass-body) 55%, #fff);
  --sd-facet-2: color-mix(in srgb, var(--color-brass-body) 30%, #fff);
  --sd-facet-3: color-mix(in srgb, var(--color-brass-body) 80%, #000);
  --sd-facet-4: var(--color-brass-body);

  display: block;
  flex: none;
  width: var(--sd-size);
  height: var(--sd-size);
  overflow: visible;
}

.sun-diamond--md {
  --sd-size: 36px;
}

/* En el botón toma el color del texto: un sol del tono de la letra, el filete
   calado deja ver el fondo del botón y las caras van en el mismo tono. */
.sun-diamond--sm {
  --sd-size: 1.5em;
  --sd-sun: currentColor;
  --sd-facet-1: currentColor;
  --sd-facet-2: currentColor;
  --sd-facet-3: currentColor;
  --sd-facet-4: currentColor;
}

.sun-diamond--sm .sun-diamond__facet--3,
.sun-diamond--sm .sun-diamond__facet--4 {
  opacity: 0.7;
}

.sun-diamond__disc {
  fill: var(--sd-sun);
}

.sun-diamond__ray {
  fill: var(--sd-ray);
}

.sun-diamond__facet--1 {
  fill: var(--sd-facet-1);
}

.sun-diamond__facet--2 {
  fill: var(--sd-facet-2);
}

.sun-diamond__facet--3 {
  fill: var(--sd-facet-3);
}

.sun-diamond__facet--4 {
  fill: var(--sd-facet-4);
}

.sun-diamond__gleam {
  opacity: 0;
}

/* El movimiento: solo transform y opacity. */
.sun-diamond__rays,
.sun-diamond__sun,
.sun-diamond__gem {
  transform-box: view-box;
  transform-origin: 24px 24px;
}

.sun-diamond__rays {
  animation: sun-diamond-turn 9s linear infinite;
}

.sun-diamond__sun {
  animation: sun-diamond-breathe 1.6s ease-in-out infinite alternate;
}

.sun-diamond__gem {
  animation: sun-diamond-settle 1.6s ease-in-out infinite alternate;
}

.sun-diamond__gleam {
  animation: sun-diamond-gleam 1.6s ease-in-out infinite;
}

/* Al aparecer, el diamante gira un cuarto de vuelta hasta asentarse dentro
   del sol (una sola vez; luego sigue el respiro). */
.sun-diamond {
  animation: sun-diamond-in 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes sun-diamond-in {
  from {
    opacity: 0;
    transform: scale(0.6) rotate(-45deg);
  }
}

@keyframes sun-diamond-turn {
  to {
    transform: rotate(360deg);
  }
}

@keyframes sun-diamond-breathe {
  from {
    transform: scale(0.92);
  }

  to {
    transform: scale(1.04);
  }
}

@keyframes sun-diamond-settle {
  from {
    transform: scale(0.94);
  }

  to {
    transform: scale(1.06);
  }
}

@keyframes sun-diamond-gleam {
  0%,
  20% {
    opacity: 0;
    transform: translateX(0);
  }

  35% {
    opacity: 1;
  }

  70%,
  100% {
    opacity: 0;
    transform: translateX(28px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sun-diamond,
  .sun-diamond__rays,
  .sun-diamond__sun,
  .sun-diamond__gem,
  .sun-diamond__gleam {
    animation: none;
  }
}

/* La preferencia del panel (Configuración › Pantalla). Sin :global(): en
   scoped, `:global(X) .y` compila a solo `X` (#731). */
:root[data-motion='reduced'] .sun-diamond,
:root[data-motion='reduced'] .sun-diamond__rays,
:root[data-motion='reduced'] .sun-diamond__sun,
:root[data-motion='reduced'] .sun-diamond__gem,
:root[data-motion='reduced'] .sun-diamond__gleam {
  animation: none;
}

/* Quieto (#809): la marca de un estado, no de una espera. */
.sun-diamond--still,
.sun-diamond--still .sun-diamond__rays,
.sun-diamond--still .sun-diamond__sun,
.sun-diamond--still .sun-diamond__gem,
.sun-diamond--still .sun-diamond__gleam {
  animation: none;
}
</style>
