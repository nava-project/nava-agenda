// Contador que cuenta (#743, punto 3 del pulido): una cifra que aparece o
// cambia sube (o baja) hasta su valor en vez de saltar. Es finito (600 ms,
// con frenada al final) y solo cambia el texto; quien lo use reserva el ancho
// con cifras tabulares para que la cuenta no mueva el layout.
//
// Con movimiento reducido (sistema o Configuración) la cifra llega en seco. Lo
// mismo donde no hay matchMedia ni requestAnimationFrame (pruebas en jsdom):
// ahí no hay quien vea la cuenta y el valor final debe estar de inmediato.
import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'

export const COUNT_UP_MS = 600

function shouldAnimate(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  if (typeof window.requestAnimationFrame !== 'function') return false
  if (document.documentElement.dataset.motion === 'reduced') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Frenada final: rápido al principio, se asienta sobre el valor. */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

/**
 * Devuelve la cifra que se muestra mientras `source` cambia. La primera vez
 * cuenta desde 0; después, desde la cifra mostrada hasta la nueva.
 */
export function useCountUp(source: () => number, durationMs = COUNT_UP_MS): Ref<number> {
  const shown = ref(0)
  let frame = 0

  const stop = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  watch(
    source,
    (target) => {
      stop()
      if (!shouldAnimate() || !Number.isFinite(target)) {
        shown.value = target
        return
      }
      const from = shown.value
      if (from === target) return
      const start = performance.now()
      const tick = (now: number) => {
        // El sello de requestAnimationFrame es el inicio del cuadro y puede
        // ser anterior a `start`: sin el tope en 0 la cuenta arrancaba en
        // negativo («-3 h»).
        const t = Math.min(1, Math.max(0, (now - start) / durationMs))
        shown.value = from + (target - from) * easeOutCubic(t)
        frame = t < 1 ? requestAnimationFrame(tick) : 0
        if (t >= 1) shown.value = target
      }
      frame = requestAnimationFrame(tick)
    },
    { immediate: true },
  )

  if (getCurrentScope()) onScopeDispose(stop)
  return shown
}
