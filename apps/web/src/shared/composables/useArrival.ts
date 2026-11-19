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
// - Ocurre una sola vez. Con `deferred`, empieza cuando la pantalla tiene su
//   contenido (`begin()`), no al montar: así la coreografía no se consume
//   durante la carga. Si antes de eso hubo un clic o una tecla, ya no ocurre.
import { onBeforeUnmount, onMounted, ref, type InjectionKey, type Ref } from 'vue'

export const ARRIVAL_MS = 1500

export interface Arrival {
  arriving: Ref<boolean>
  /** Empieza la llegada (solo la primera vez y si nadie la interrumpió). */
  begin: () => void
  /** La termina en seco. */
  stop: () => void
}

/** El cascarón ofrece su llegada a las pantallas que aloja. */
export const arrivalKey: InjectionKey<Arrival> = Symbol('arrival')

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

export function useArrival(options: { deferred?: boolean } = {}): Arrival {
  const enabled = !prefersReducedMotion()
  // Se decide antes del primer cuadro: si la clase llegara después, el estado
  // final se vería un instante y luego «saltaría» al inicio de la animación.
  const arriving = ref(enabled && !options.deferred)
  let used = !enabled
  let timer: ReturnType<typeof setTimeout> | undefined

  const detach = () => {
    window.removeEventListener('pointerdown', interrupt, true)
    window.removeEventListener('keydown', interrupt, true)
  }

  const stop = () => {
    clearTimeout(timer)
    if (!arriving.value) return
    finishArrival()
    arriving.value = false
    detach()
  }

  function interrupt() {
    used = true
    stop()
    detach()
  }

  const begin = () => {
    if (used) return
    used = true
    arriving.value = true
    timer = setTimeout(stop, ARRIVAL_MS)
  }

  onMounted(() => {
    if (!enabled) return
    window.addEventListener('pointerdown', interrupt, true)
    window.addEventListener('keydown', interrupt, true)
    if (!options.deferred) {
      used = false
      begin()
    }
  })

  onBeforeUnmount(() => {
    stop()
    detach()
  })

  return { arriving, begin, stop }
}
