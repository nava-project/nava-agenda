/**
 * keepFocusInView (#804): el control enfocado por teclado se trae entero, con
 * su anillo, a la vista de cada zona con desplazamiento que lo contiene. jsdom
 * no maqueta: las cajas, el desbordamiento y `:focus-visible` se simulan.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOCUS_VIEW_MARGIN_PX, keepFocusInView } from '../focusInView'

interface Box {
  top: number
  height: number
}

function place(el: HTMLElement, box: Box) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: box.top,
    bottom: box.top + box.height,
    height: box.height,
    left: 0,
    right: 320,
    width: 320,
    x: 0,
    y: box.top,
    toJSON: () => ({}),
  })
}

/** Zona con desplazamiento vertical: visible en `box`, contenido más alto. */
function scroller(box: Box): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowY = 'auto'
  Object.defineProperty(el, 'clientHeight', { value: box.height })
  Object.defineProperty(el, 'scrollHeight', { value: box.height * 3 })
  place(el, box)
  return el
}

function control(box: Box, focusVisible = true): HTMLElement {
  const el = document.createElement('button')
  place(el, box)
  el.scrollIntoView = vi.fn()
  const matches = el.matches.bind(el)
  vi.spyOn(el, 'matches').mockImplementation((selector: string) =>
    selector === ':focus-visible' ? focusVisible : matches(selector),
  )
  return el
}

function focusIn(container: HTMLElement, target: HTMLElement) {
  const handler = vi.fn((event: FocusEvent) => keepFocusInView(event))
  container.addEventListener('focusin', handler)
  target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  container.removeEventListener('focusin', handler)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('keepFocusInView (#804)', () => {
  it('trae a la vista un renglón que asoma a medias sobre el dock', () => {
    // Contenido de 86 a 635 (el dock empieza en 635); el renglón llega a 653.
    const content = scroller({ top: 86, height: 549 })
    const row = control({ top: 617, height: 36 })
    content.append(row)
    document.body.append(content)

    focusIn(content, row)

    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('también cuando solo el anillo quedaría cortado', () => {
    const content = scroller({ top: 86, height: 549 })
    const row = control({ top: 590, height: 40 })
    content.append(row)
    document.body.append(content)

    focusIn(content, row)

    // 630 + 8 > 635: el anillo y el respiro no caben.
    expect(590 + 40 + FOCUS_VIEW_MARGIN_PX).toBeGreaterThan(635)
    expect(row.scrollIntoView).toHaveBeenCalled()
  })

  it('no desplaza un control que ya se ve entero con su anillo', () => {
    const content = scroller({ top: 86, height: 549 })
    const row = control({ top: 300, height: 60 })
    content.append(row)
    document.body.append(content)

    focusIn(content, row)

    expect(row.scrollIntoView).not.toHaveBeenCalled()
  })

  it('no desplaza con el foco del puntero (sin :focus-visible)', () => {
    const content = scroller({ top: 86, height: 549 })
    const row = control({ top: 617, height: 36 }, false)
    content.append(row)
    document.body.append(content)

    focusIn(content, row)

    expect(row.scrollIntoView).not.toHaveBeenCalled()
  })

  it('deja como está una región más alta que la zona', () => {
    const content = scroller({ top: 86, height: 693 })
    const region = control({ top: 86, height: 701 })
    content.append(region)
    document.body.append(content)

    focusIn(content, region)

    expect(region.scrollIntoView).not.toHaveBeenCalled()
  })

  it('mira la lista con desplazamiento propio, no solo el contenido', () => {
    // La lista de la agenda (506–759) se desplaza dentro del contenido.
    const content = document.createElement('main')
    const list = scroller({ top: 506, height: 253 })
    const row = control({ top: 725, height: 60 })
    list.append(row)
    content.append(list)
    document.body.append(content)

    focusIn(content, row)

    expect(row.scrollIntoView).toHaveBeenCalled()
  })
})
