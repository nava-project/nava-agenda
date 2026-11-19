// Llegada (DEC-188): el único momento orquestado al abrir una pantalla de
// entrada (reserva pública, acceso, panel). Las reglas, iguales a las de Pedidos:
//
// - No bloquea: no hay capas encima ni `pointer-events: none`; se puede usar la
//   pantalla desde el primer cuadro.
// - Un clic o una tecla la terminan al instante: toda animación de llegada se
//   llama `llega-*` y se completa con `finish()`.
// - Con movimiento reducido (sistema o Configuración) no existe: `arriving`
//   nace en `false` y se ve el estado final directo.
// - Dura menos de 1,5 s; pasado ese tiempo la clase se retira sola.
import { onBeforeUnmount, onMounted, ref } from 'vue'

export const ARRIVAL_MS = 1500

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  if (document.documentElement.dataset.motion === 'reduced') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Termina en seco cada animación de llegada que siga en curso. */
export function finishArrival(root: Document | Element = document): void {
  const animations =
    'getAnimations' in root && typeof root.getAnimations === 'function'
      ? root.getAnimations({ subtree: true } as GetAnimationsOptions)
      : []
  for (const animation of animations) {
    const name = (animation as CSSAnimation).animationName ?? ''
    if (name.startsWith('llega-')) animation.finish()
  }
}

export function useArrival() {
  // Se decide antes del primer cuadro: si la clase llegara después, el estado
  // final se vería un instante y luego «saltaría» al inicio de la animación.
  const arriving = ref(!prefersReducedMotion())
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    if (!arriving.value) return
    finishArrival()
    arriving.value = false
    clearTimeout(timer)
    window.removeEventListener('pointerdown', stop, true)
    window.removeEventListener('keydown', stop, true)
  }

  onMounted(() => {
    if (!arriving.value) return
    timer = setTimeout(stop, ARRIVAL_MS)
    window.addEventListener('pointerdown', stop, true)
    window.addEventListener('keydown', stop, true)
  })

  onBeforeUnmount(stop)

  return { arriving, stop }
}
