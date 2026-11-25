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
  // La espera de un settled() que aún retiene la carga, para reprogramarla.
  let pending: (() => void) | null = null

  function release() {
    clearTimeout(timer)
    const resolve = pending
    pending = null
    resolve?.()
  }

  function hold() {
    clearTimeout(timer)
    const remaining = LOADER_APPEAR_MS + minVisibleMs - (Date.now() - startedAt)
    if (remaining <= 0) release()
    else timer = setTimeout(release, remaining)
  }

  function start() {
    clearTimeout(timer)
    pending = null
    startedAt = Date.now()
  }

  // Si los datos ya llegaron (hay un settled() pendiente), su espera se contó
  // desde start(): con la espera montada oculta, el cargador asomaría al final
  // y se iría a medio fundido (#843 r1, C2). Se vuelve a contar desde ahora.
  function markAppeared() {
    startedAt = Date.now() - LOADER_APPEAR_MS
    if (pending) hold()
  }

  function settled(): Promise<void> {
    // Como start(): una espera anterior sin soltar se abandona, no se resuelve.
    clearTimeout(timer)
    pending = null
    const elapsed = Date.now() - startedAt
    if (elapsed < LOADER_APPEAR_MS - FRAME_MARGIN_MS) return Promise.resolve()
    if (LOADER_APPEAR_MS + minVisibleMs - elapsed <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      pending = resolve
      hold()
    })
  }

  onUnmounted(() => {
    clearTimeout(timer)
    pending = null
  })

  return { start, markAppeared, settled }
}
