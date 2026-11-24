// Atrás/adelante entre los pasos de la reserva (H7, #824).
//
// El router restaura la posición en cuanto el paso se monta, pero el paso
// llega con su esqueleto, más corto que su contenido. Si la posición guardada
// era más baja que lo que el esqueleto deja desplazar (una hora de la noche),
// el navegador la recorta. Y, mientras tanto, la vista queda donde estaba el
// esqueleto. Aquí, cuando el paso se destapa (`main` sin `aria-busy`), se
// vuelve a aplicar la posición guardada en la misma tarea en que llega el
// contenido, antes de pintarse: la hora elegida aparece ya en su sitio.
//
// Si la persona desplaza mientras tanto (rueda, toque o teclado), manda ella y
// no se toca nada.

export interface ScrollPosition {
  left: number
  top: number
}

// La espera más larga que se cubre: una red muy lenta. Pasado ese tiempo, la
// posición ya no es de esta navegación.
const GIVE_UP_MS = 20_000

let cancelPending: (() => void) | null = null

function stepIsReady(root: ParentNode): boolean {
  return (
    root.querySelector('main:not([aria-busy="true"])') !== null &&
    root.querySelector('main[aria-busy="true"]') === null
  )
}

/** Vuelve a aplicar `position` cuando el paso termina de cargar, si hace falta. */
export function restoreWhenStepReady(position: ScrollPosition, root: ParentNode = document): void {
  cancelPending?.()

  const apply = () => {
    cancel()
    if (Math.abs(window.scrollY - position.top) < 1 && Math.abs(window.scrollX - position.left) < 1)
      return
    window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' })
  }

  const observer = new MutationObserver(() => {
    if (stepIsReady(root)) apply()
  })
  const userScrolls = ['wheel', 'touchmove', 'keydown'] as const
  const timer = window.setTimeout(() => cancel(), GIVE_UP_MS)

  function cancel() {
    observer.disconnect()
    window.clearTimeout(timer)
    for (const type of userScrolls) window.removeEventListener(type, cancel, true)
    if (cancelPending === cancel) cancelPending = null
  }

  cancelPending = cancel
  for (const type of userScrolls)
    window.addEventListener(type, cancel, { capture: true, passive: true })

  // El paso ya llegó con su contenido (lo tenía en memoria): la restauración
  // del router basta.
  if (stepIsReady(root)) {
    cancel()
    return
  }
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-busy'],
  })
}
