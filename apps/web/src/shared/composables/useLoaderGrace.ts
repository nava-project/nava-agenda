// El cargador de una pantalla, o no se ve, o se ve lo bastante para leerse
// (#820, auditoría de parpadeos F3). `DiamondLoader` aparece a los
// LOADER_APPEAR_MS: si los datos llegan antes, el contenido entra sin que el
// cargador asome; si llegan justo después, el cargador se quedaría unos
// cuadros y se iría (el destello de 50–100 ms que midió nava). Aquí, una vez
// que pudo verse, se queda al menos LOADER_MIN_VISIBLE_MS.
//
// Distinto de useMinHoldLoading, que retiene siempre un mínimo desde el
// inicio: este no retrasa nada cuando la respuesta es rápida.
import { onUnmounted } from 'vue'

/** Retardo de aparición de `DiamondLoader` (su `animation-delay`). */
export const LOADER_APPEAR_MS = 300
/** Lo mínimo que un cargador ya visible se queda a la vista. */
export const LOADER_MIN_VISIBLE_MS = 300
// Lo que puede tardar en pintarse el contenido tras soltarlo (la pantalla que
// llega se monta en ese cuadro). Si la respuesta llega a menos de esto de la
// aparición, el cargador alcanzaría a asomar un cuadro (con movimiento
// reducido aparece de golpe, sin fundido), así que se trata como ya visible.
const FRAME_MARGIN_MS = 80

export interface LoaderGrace {
  /** Marca el instante en que se montó la espera (y su cargador). */
  start: () => void
  /** Se resuelve cuando ya se puede quitar la espera sin que el cargador destelle. */
  settled: () => Promise<void>
}

export function useLoaderGrace(): LoaderGrace {
  let startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  function start() {
    clearTimeout(timer)
    startedAt = Date.now()
  }

  function settled(): Promise<void> {
    clearTimeout(timer)
    const elapsed = Date.now() - startedAt
    if (elapsed < LOADER_APPEAR_MS - FRAME_MARGIN_MS) return Promise.resolve()
    const remaining = LOADER_APPEAR_MS + LOADER_MIN_VISIBLE_MS - elapsed
    if (remaining <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      timer = setTimeout(resolve, remaining)
    })
  }

  onUnmounted(() => clearTimeout(timer))

  return { start, settled }
}
