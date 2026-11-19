// useArrival (DEC-188): la llegada no existe con movimiento reducido, se retira
// sola antes de 1,5 s y un clic o una tecla la terminan al instante.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { ARRIVAL_MS, useArrival } from '../useArrival'

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

const Probe = defineComponent({
  setup() {
    const { arriving } = useArrival()
    return () => h('div', { class: { arriving: arriving.value } })
  },
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  delete document.documentElement.dataset.motion
})

describe('useArrival', () => {
  it('arrives from the first frame and retires itself within 1.5 s', async () => {
    setReducedMotion(false)
    const wrapper = mount(Probe)
    expect(wrapper.classes()).toContain('arriving')
    expect(ARRIVAL_MS).toBeLessThanOrEqual(1500)
    vi.advanceTimersByTime(ARRIVAL_MS)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('arriving')
  })

  it('ends at once on a click or a key', async () => {
    setReducedMotion(false)
    const wrapper = mount(Probe)
    window.dispatchEvent(new Event('pointerdown'))
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('arriving')

    const other = mount(Probe)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    await other.vm.$nextTick()
    expect(other.classes()).not.toContain('arriving')
  })

  it('does not exist with reduced motion, from the system or from Settings', () => {
    setReducedMotion(true)
    expect(mount(Probe).classes()).not.toContain('arriving')

    setReducedMotion(false)
    document.documentElement.dataset.motion = 'reduced'
    expect(mount(Probe).classes()).not.toContain('arriving')
  })
})
