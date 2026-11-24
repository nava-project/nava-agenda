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
/** El fundido de entrada de `DiamondLoader` (y de los esqueletos que asoman con él). */
export const LOADER_FADE_MS = 200
// Lo que puede tardar en pintarse el contenido tras soltarlo (la pantalla que
// llega se monta en ese cuadro). Si la respuesta llega a menos de esto de la
// aparición, el cargador alcanzaría a asomar un cuadro (con movimiento
// reducido aparece de golpe, sin fundido), así que se trata como ya visible.
const FRAME_MARGIN_MS = 80

export interface LoaderGrace {
  /** Marca el instante en que se montó la espera (y su cargador). */
  start: () => void
  /**
   * Marca que el cargador empieza a verse ahora (su `animationstart`). Para una
   * espera montada antes de mostrarse, dentro de algo oculto que se abre después:
   * su retardo de aparición no corre mientras está oculta (#843).
   */
  markAppeared: () => void
  /** Se resuelve cuando ya se puede quitar la espera sin que el cargador destelle. */
  settled: () => Promise<void>
}

export interface LoaderGraceOptions {
  /**
   * Cuánto se queda a la vista, contado desde que empieza a aparecer. Por omisión
   * LOADER_MIN_VISIBLE_MS; un diálogo pide LOADER_FADE_MS + LOADER_MIN_VISIBLE_MS
   * para que esos 300 ms sean de cargador pleno, no de fundido (#843).
   */
  minVisibleMs?: number
}

export function useLoaderGrace(options: LoaderGraceOptions = {}): LoaderGrace {
  const minVisibleMs = options.minVisibleMs ?? LOADER_MIN_VISIBLE_MS
  let startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  function start() {
    clearTimeout(timer)
    startedAt = Date.now()
  }

  function markAppeared() {
    startedAt = Date.now() - LOADER_APPEAR_MS
  }

  function settled(): Promise<void> {
    clearTimeout(timer)
    const elapsed = Date.now() - startedAt
    if (elapsed < LOADER_APPEAR_MS - FRAME_MARGIN_MS) return Promise.resolve()
    const remaining = LOADER_APPEAR_MS + minVisibleMs - elapsed
    if (remaining <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      timer = setTimeout(resolve, remaining)
    })
  }

  onUnmounted(() => clearTimeout(timer))

  return { start, markAppeared, settled }
}
