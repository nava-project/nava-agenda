import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelStepScrollRestore, restoreWhenStepReady } from '../stepScroll'

// H7 (#824): la posición que restaura el router se vuelve a aplicar cuando el
// paso de la reserva se destapa, salvo que la persona ya haya desplazado.
describe('restoreWhenStepReady', () => {
  let root: HTMLDivElement
  let scrollTo: ReturnType<typeof vi.fn>

  function mountStep(busy: boolean): HTMLElement {
    root.replaceChildren()
    const main = document.createElement('main')
    if (busy) main.setAttribute('aria-busy', 'true')
    root.append(main)
    return main
  }

  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
    scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 270 })
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 })
  })

  afterEach(() => {
    root.remove()
    vi.unstubAllGlobals()
  })

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('re-applies the saved position once the skeleton step is replaced by its content', async () => {
    mountStep(true)
    restoreWhenStepReady({ left: 0, top: 977 }, root)
    await flush()
    expect(scrollTo).not.toHaveBeenCalled()

    mountStep(false)
    await flush()
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 977, behavior: 'instant' })
  })

  it('also reacts when the same main drops aria-busy', async () => {
    const main = mountStep(true)
    restoreWhenStepReady({ left: 0, top: 500 }, root)
    main.removeAttribute('aria-busy')
    await flush()
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the step already arrived with its content', async () => {
    mountStep(false)
    restoreWhenStepReady({ left: 0, top: 977 }, root)
    mountStep(true)
    mountStep(false)
    await flush()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('does not scroll when the view is already at the saved position', async () => {
    mountStep(true)
    restoreWhenStepReady({ left: 0, top: 270 }, root)
    mountStep(false)
    await flush()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it.each(['wheel', 'touchmove', 'pointerdown', 'keydown'])(
    'leaves the view alone once the person scrolls (%s)',
    async (type) => {
      mountStep(true)
      restoreWhenStepReady({ left: 0, top: 977 }, root)
      window.dispatchEvent(new Event(type))
      mountStep(false)
      await flush()
      expect(scrollTo).not.toHaveBeenCalled()
    },
  )

  it('another navigation cancels the pending restore, so the next screen never inherits it', async () => {
    mountStep(true)
    restoreWhenStepReady({ left: 0, top: 977 }, root)
    cancelStepScrollRestore()
    mountStep(false)
    await flush()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('a newer navigation replaces the pending restore', async () => {
    mountStep(true)
    restoreWhenStepReady({ left: 0, top: 977 }, root)
    restoreWhenStepReady({ left: 0, top: 600 }, root)
    mountStep(false)
    await flush()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 600, behavior: 'instant' })
  })
})
