/**
 * useInView (issue #515): la animación de cada sección empieza al llegar a
 * ella, pero el contenido nunca depende de ello.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useInView } from '../../composables/useInView'

function host() {
  return defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null)
      const state = useInView(el)
      return () => h('div', { ref: el, 'data-seen': String(state.seen.value) })
    },
  })
}

describe('useInView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sin IntersectionObserver el elemento cuenta como visto', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const wrapper = mount(host())
    await nextTick()
    expect(wrapper.attributes('data-seen')).toBe('true')
  })

  it('con movimiento reducido cuenta como visto sin observar', async () => {
    const observe = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(() => ({ observe, disconnect: vi.fn() })),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    const wrapper = mount(host())
    await nextTick()
    expect(wrapper.attributes('data-seen')).toBe('true')
    expect(observe).not.toHaveBeenCalled()
  })

  it('espera a que el elemento entre en pantalla y entonces deja de observar', async () => {
    let callback: IntersectionObserverCallback = () => undefined
    const disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((cb: IntersectionObserverCallback) => {
        callback = cb
        return { observe: vi.fn(), disconnect }
      }),
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    const wrapper = mount(host())
    expect(wrapper.attributes('data-seen')).toBe('false')

    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await wrapper.vm.$nextTick()

    expect(wrapper.attributes('data-seen')).toBe('true')
    expect(disconnect).toHaveBeenCalled()
  })
})
