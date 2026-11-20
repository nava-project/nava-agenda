<script setup lang="ts">
// Mapa del local (DEC-130, HU-102; #749). Lo usan la reserva pública, la vista
// previa de Configuración y el campo de dirección, así que vive en `shared/ui`.
//
// En reposo es un plano ilustrado de la familia: papel, calles en tinta suave,
// filete de latón y el rombo como pin. No carga nada de Google, así que nunca
// queda un recuadro gris mientras carga ni el texto crudo de Google si la
// clave falla. El `iframe` de Google se carga solo cuando la persona toca «Ver
// mapa», y el plano sigue debajo hasta que el `iframe` termina de cargar.
//
// Para quien no pueda usar el mapa, la dirección va en texto, con un enlace
// que lo abre en Google Maps (no necesita clave). Sin forma de incrustar el
// mapa en este entorno, no se ofrece «Ver mapa». Con un punto inválido no se
// pinta nada: nunca un mapa sin coordenadas reales.
import { computed, ref, useId, watch } from 'vue'
import { mapEmbedUrl, mapsLinkUrl } from '../model/mapEmbed'

const props = defineProps<{
  latitude: number
  longitude: number
  address: string
}>()

const embedUrl = computed(() => mapEmbedUrl(props.latitude, props.longitude))
const linkUrl = computed(() => mapsLinkUrl(props.latitude, props.longitude))

const frameId = useId()
const showLive = ref(false)
const liveLoaded = ref(false)

// Otro punto, otro mapa: se vuelve al plano.
watch(
  () => [props.latitude, props.longitude],
  () => {
    showLive.value = false
    liveLoaded.value = false
  },
)

function toggleLive() {
  showLive.value = !showLive.value
  if (!showLive.value) liveLoaded.value = false
}

// Cada local, su plano: el ángulo y el corrimiento de las calles salen de las
// coordenadas, así dos negocios no se ven iguales y el mismo siempre igual.
const plan = computed(() => {
  const seed = Math.abs(Math.round(props.latitude * 1e4) * 31 + Math.round(props.longitude * 1e4))
  return {
    angle: (seed % 25) - 12,
    shift: (seed % 37) - 18,
    park: seed % 2 === 0 ? 'left' : 'right',
  }
})
</script>

<template>
  <figure v-if="linkUrl" class="location-map">
    <div :id="frameId" class="location-map__canvas">
      <!-- Plano ilustrado: decorativo, la dirección va en texto debajo. -->
      <svg
        class="location-map__art"
        viewBox="0 0 400 220"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <rect class="location-map__paper" width="400" height="220" />
        <g :transform="`rotate(${plan.angle} 200 110) translate(${plan.shift} 0)`">
          <!-- El río, una banda suave que cruza el plano. -->
          <path
            class="location-map__river"
            d="M -60 196 C 60 168, 120 214, 220 186 S 380 150, 470 170"
          />
          <!-- El parque, una manzana de latón tenue. -->
          <rect
            class="location-map__park"
            :x="plan.park === 'left' ? 34 : 262"
            y="30"
            width="94"
            height="52"
            rx="3"
          />
          <g class="location-map__streets">
            <line x1="-80" y1="22" x2="480" y2="22" />
            <line x1="-80" y1="92" x2="480" y2="92" />
            <line x1="-80" y1="150" x2="480" y2="150" />
            <line x1="20" y1="-60" x2="20" y2="280" />
            <line x1="142" y1="-60" x2="142" y2="280" />
            <line x1="250" y1="-60" x2="250" y2="280" />
            <line x1="360" y1="-60" x2="360" y2="280" />
          </g>
          <!-- La avenida, en diagonal, con su eje de latón. -->
          <line class="location-map__avenue" x1="-60" y1="250" x2="470" y2="-40" />
          <line class="location-map__avenue-axis" x1="-60" y1="250" x2="470" y2="-40" />
        </g>
        <!-- El local: el rombo como pin, con el halo del sol. -->
        <g class="location-map__pin">
          <circle class="location-map__halo" cx="200" cy="110" r="34" />
          <circle class="location-map__halo location-map__halo--inner" cx="200" cy="110" r="19" />
          <rect
            class="location-map__diamond"
            x="190"
            y="100"
            width="20"
            height="20"
            transform="rotate(45 200 110)"
          />
          <rect
            class="location-map__diamond-core"
            x="196.5"
            y="106.5"
            width="7"
            height="7"
            transform="rotate(45 200 110)"
          />
        </g>
      </svg>

      <iframe
        v-if="showLive && embedUrl"
        class="location-map__frame"
        :class="{ 'location-map__frame--ready': liveLoaded }"
        :src="embedUrl"
        tabindex="-1"
        :title="`Mapa de ${address}`"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allowfullscreen
        @load="liveLoaded = true"
      />
    </div>
    <figcaption class="location-map__caption">
      <span class="location-map__address">{{ address }}</span>
      <span class="location-map__actions">
        <button
          v-if="embedUrl"
          type="button"
          class="location-map__toggle"
          :aria-expanded="showLive"
          :aria-controls="frameId"
          @click="toggleLive"
        >
          {{ showLive ? 'Ocultar mapa' : 'Ver mapa' }}
        </button>
        <a class="location-map__link" :href="linkUrl" target="_blank" rel="noopener">
          Abrir en Google Maps<span class="location-map__sr"> (se abre en una pestaña nueva)</span>
        </a>
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
.location-map {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  color: inherit;
}

/* Un solo alto para el plano y el mapa vivo: cambiar de uno a otro no mueve nada. */
.location-map__canvas {
  position: relative;
  height: clamp(180px, 34vh, 260px);
  overflow: hidden;
  border: 1px solid var(--color-brass-line, color-mix(in srgb, currentColor 24%, transparent));
  border-radius: 4px;
}

.location-map__art {
  display: block;
  width: 100%;
  height: 100%;
}

.location-map__paper {
  fill: var(--color-surface-muted, color-mix(in srgb, currentColor 8%, transparent));
}

.location-map__river {
  fill: none;
  stroke: color-mix(in srgb, currentColor 9%, transparent);
  stroke-width: 22;
  stroke-linecap: round;
}

.location-map__park {
  fill: color-mix(in srgb, var(--color-brass-line, currentColor) 22%, transparent);
}

.location-map__streets line {
  stroke: var(--color-surface, color-mix(in srgb, currentColor 4%, transparent));
  stroke-width: 9;
}

.location-map__avenue {
  stroke: var(--color-surface, color-mix(in srgb, currentColor 4%, transparent));
  stroke-width: 18;
}

.location-map__avenue-axis {
  stroke: color-mix(in srgb, var(--color-brass-line, currentColor) 70%, transparent);
  stroke-width: 1.5;
  stroke-dasharray: 6 6;
}

.location-map__halo {
  fill: color-mix(in srgb, var(--color-sun, currentColor) 18%, transparent);
}

.location-map__halo--inner {
  fill: color-mix(in srgb, var(--color-sun, currentColor) 32%, transparent);
}

.location-map__diamond {
  fill: var(--color-brass-line, currentColor);
  stroke: var(--color-surface, transparent);
  stroke-width: 2;
}

.location-map__diamond-core {
  fill: var(--color-surface, transparent);
}

/* El pin respira despacio en reposo, como el cargador del sol. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .location-map__halo {
    transform-box: fill-box;
    transform-origin: center;
    animation: location-map-breathe 2.4s ease-in-out infinite alternate;
  }
}

@keyframes location-map-breathe {
  to {
    opacity: 0.55;
    transform: scale(1.12);
  }
}

/* El mapa vivo entra sobre el plano solo cuando ya cargó: sin recuadro vacío. */
.location-map__frame {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
}

.location-map__frame--ready {
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .location-map__frame {
    transition: opacity 240ms ease-out;
  }
}

.location-map__caption {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  align-items: baseline;
  justify-content: space-between;
  font-size: 14px;
  line-height: 20px;
}

.location-map__address {
  min-width: 0;
  overflow-wrap: anywhere;
}

.location-map__actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  align-items: baseline;
}

.location-map__toggle,
.location-map__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0;
  font: inherit;
  font-weight: 500;
  color: inherit;
  white-space: nowrap;
  cursor: pointer;
  background: none;
  border: 0;
  text-decoration: underline;
  text-decoration-color: var(--color-brass-line, currentColor);
  text-underline-offset: 3px;
}

.location-map__toggle:focus-visible,
.location-map__link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.location-map__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
