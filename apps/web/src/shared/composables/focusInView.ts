// El control que recibe el foco por teclado debe verse entero, con su anillo,
// dentro de cada zona con desplazamiento que lo contiene (WCAG 2.4.11, #804).
// Chromium desplaza al enfocar un control que asoma solo en parte; Firefox no,
// y el renglón o el botón quedaba cortado contra el dock. Aquí se corrige con
// scrollIntoView, que en ambos respeta `scroll-margin` y `scroll-padding`.
// Mismo criterio que el tablero semanal (#769), generalizado al contenido del
// panel.

/** Aire alrededor del control enfocado: el anillo (2 + 2 px) y un respiro.
 * Coincide con `--space-2`, el `scroll-margin-block` del contenido. */
export const FOCUS_VIEW_MARGIN_PX = 8

function scrollsVertically(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY
  return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight
}

/**
 * Manejador de `focusin` para un contenedor: si el control enfocado con
 * `:focus-visible` no cabe entero (más el margen) en alguna zona con
 * desplazamiento entre él y el contenedor, lo trae a la vista lo justo.
 * El foco con puntero no desplaza nada, y un control más alto que la zona
 * (una región entera) se deja como está.
 */
export function keepFocusInView(event: FocusEvent, margin = FOCUS_VIEW_MARGIN_PX): void {
  const container = event.currentTarget
  const target = event.target
  if (!(container instanceof HTMLElement) || !(target instanceof HTMLElement)) return
  if (!target.matches(':focus-visible')) return

  const rect = target.getBoundingClientRect()
  for (let el = target.parentElement; el; el = el.parentElement) {
    if (scrollsVertically(el)) {
      const top = el.getBoundingClientRect().top + el.clientTop
      const bottom = top + el.clientHeight
      const fits = rect.height + margin * 2 <= el.clientHeight
      if (fits && (rect.top - margin < top || rect.bottom + margin > bottom)) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        return
      }
    }
    if (el === container) return
  }
}
