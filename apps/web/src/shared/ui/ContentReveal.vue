<script setup lang="ts">
/**
 * ContentReveal - El paso de la carga al contenido sin parpadeo (#817).
 *
 * Antes cada pantalla usaba un `<Transition mode="out-in">`: el esqueleto se
 * desvanecía hasta 0 y solo entonces entraba el contenido, también desde 0.
 * Unos 200 ms de pantalla casi en blanco entre los dos: el «parpadeo» que vio
 * la dueña.
 *
 * Aquí el contenido y el esqueleto comparten la misma celda de un grid:
 * - El contenido (slot por defecto) se monta debajo mientras el esqueleto
 *   (slot `loading`) sigue encima, opaco.
 * - Al terminar la carga, el contenido ya está al 100 % y el esqueleto se
 *   desvanece por encima. En ningún fotograma deja de verse algo entero.
 * - El alto de la celda es el del más alto de los dos: el cambio no empuja
 *   nada (CLS 0). Lo que viene detrás de la página está dentro del contenido.
 * - El esqueleto saliente lleva `aria-hidden` e `inert` desde que empieza a
 *   irse: el lector de pantalla no lee dos veces y nada en él se enfoca.
 * - Las llegadas del contenido (`nv-stagger` de las filas…) se dan por
 *   terminadas al destaparlo: el fundido del esqueleto ya es la llegada, y dos
 *   fundidos a la vez volverían a dejar un hueco. Lo que llegue después
 *   (buscar, cambiar de página) se anima como siempre.
 * - Con movimiento reducido (sistema o Configuración) las transiciones ya
 *   duran 0.01 ms (base.css): el cambio es instantáneo.
 *
 * Quien lo usa decide cuándo `loading` deja de ser verdadero. Si el
 * contenido necesita medirse antes de verse (el ajuste de filas de una
 * lista), la carga sigue «en curso» hasta que esa medida termina.
 */
import { ref } from 'vue'

interface Props {
  /** Mientras es verdadero, el esqueleto tapa el contenido. */
  loading: boolean
}

defineProps<Props>()

const root = ref<HTMLElement | null>(null)

function settleArrivals(cover: Element): void {
  const stage = root.value
  if (!stage || typeof stage.getAnimations !== 'function') return
  for (const animation of stage.getAnimations({ subtree: true })) {
    const target = (animation.effect as KeyframeEffect | null)?.target
    if (!target || cover.contains(target)) continue
    // Solo las finitas: `finish()` en una infinita lanza un error.
    if (animation.effect?.getComputedTiming().endTime === Infinity) continue
    animation.finish()
  }
}

function quiet(el: Element): void {
  el.setAttribute('aria-hidden', 'true')
  ;(el as HTMLElement).inert = true
  settleArrivals(el)
}
</script>

<template>
  <div ref="root" class="content-reveal">
    <slot />
    <Transition name="content-reveal" @before-leave="quiet">
      <div v-if="loading" class="content-reveal__cover">
        <slot name="loading" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.content-reveal {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

/* Todo en la misma celda, arriba: el esqueleto tapa al contenido sin moverlo. */
.content-reveal > :deep(*) {
  grid-area: 1 / 1;
  align-self: start;
  min-width: 0;
}

.content-reveal > .content-reveal__cover {
  position: relative;
  z-index: 1;
}

.content-reveal-leave-active {
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);
}

.content-reveal-leave-to {
  opacity: 0;
}
</style>
