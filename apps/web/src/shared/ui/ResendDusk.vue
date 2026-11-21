<script setup lang="ts">
/**
 * ResendDusk · la espera para pedir otro código, como un atardecer (#751).
 *
 * El sol de la marca, con el diamante calado dentro (la espera de Agenda, #735),
 * se pone detrás del horizonte de latón durante los segundos que faltan para
 * poder pedir otro código. Cuando se oculta del todo, la página cambia el texto
 * por «Pedir otro código». No es un bucle: dura lo que dura la espera.
 *
 * El avance se calcula una vez al montar (total y restante) y la animación hace
 * el resto con transform: quien lo usa le pone :key al instante del reenvío para
 * que un código nuevo vuelva a empezar el atardecer. Con movimiento reducido el
 * sol queda quieto a medio poner y el texto con la cuenta lleva la información.
 *
 * Decorativo: la cuenta en texto está al lado.
 */
import { useId } from 'vue'

interface Props {
  /** Segundos de espera completos de este código. */
  total: number
  /** Segundos que faltan al montar. */
  remaining: number
}
const props = defineProps<Props>()

const uid = useId()
const clipId = `dusk-sky-${uid}`
const cutId = `dusk-cut-${uid}`

/* Se fija una sola vez al montar: si siguiera a `remaining`, que baja cada segundo,
   el retraso cambiaría con cada tic y el sol saltaría. */
function startStyle(total: number, remaining: number) {
  const whole = Math.max(1, total)
  const left = Math.min(whole, Math.max(0, remaining))
  return {
    '--dusk-total': `${whole}s`,
    // Un retraso negativo arranca la animación ya avanzada lo que pasó.
    '--dusk-elapsed': `${left - whole}s`,
  }
}
const style = startStyle(props.total, props.remaining)
</script>

<template>
  <svg class="dusk" viewBox="0 0 32 20" aria-hidden="true" focusable="false" :style="style">
    <defs>
      <clipPath :id="clipId">
        <rect x="0" y="0" width="32" height="15.5" />
      </clipPath>
      <mask :id="cutId" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="20">
        <rect width="32" height="20" fill="#fff" />
        <path d="M16 3.2 L21.3 8.5 L16 13.8 L10.7 8.5 Z" fill="#000" />
      </mask>
    </defs>
    <g :clip-path="`url(#${clipId})`">
      <g class="dusk__sun">
        <circle class="dusk__disc" cx="16" cy="8.5" r="7" :mask="`url(#${cutId})`" />
        <path class="dusk__gem" d="M16 4.6 L19.9 8.5 L16 12.4 L12.1 8.5 Z" />
      </g>
    </g>
    <path class="dusk__horizon" d="M1 16.25 H31" />
    <path class="dusk__mark" d="M16 14.6 L17.65 16.25 L16 17.9 L14.35 16.25 Z" />
  </svg>
</template>

<style scoped>
.dusk {
  display: block;
  flex: none;
  width: 40px;
  height: 25px;
  overflow: visible;
}

.dusk__disc {
  fill: var(--color-sun);
}

.dusk__gem {
  fill: var(--color-brass-body);
}

.dusk__horizon {
  fill: none;
  stroke: var(--color-brass-line);
  stroke-width: 1.25;
  stroke-linecap: round;
}

.dusk__mark {
  fill: var(--color-brass-body);
}

/* Sin movimiento: el sol a medio poner. */
.dusk__sun {
  transform: translateY(5px);
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .dusk__sun {
    animation: dusk-set var(--dusk-total) linear var(--dusk-elapsed) both;
  }
}

/* De entero sobre el horizonte a oculto bajo él (15.5 − 1.5 = 14 unidades). */
@keyframes dusk-set {
  from {
    transform: translateY(0);
  }

  to {
    transform: translateY(14px);
  }
}
</style>
