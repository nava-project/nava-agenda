/**
 * SettingsIndex (DEC-110): navegación por anclas con la sección vigente marcada.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import SettingsIndex from '../SettingsIndex.vue'

const items = [
  { id: 'uno', label: 'Pantalla' },
  { id: 'dos', label: 'Marca' },
] as const

describe('SettingsIndex', () => {
  it('is a labelled navigation of real links to each section', () => {
    const wrapper = mount(SettingsIndex, { props: { items, active: 'uno' } })

    expect(wrapper.get('nav').attributes('aria-label')).toBe('Secciones de configuración')
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toEqual(['#uno', '#dos'])
  })

  it('marks only the active section with aria-current', () => {
    const wrapper = mount(SettingsIndex, { props: { items, active: 'dos' } })

    const current = wrapper.findAll('a').map((a) => a.attributes('aria-current'))
    expect(current).toEqual([undefined, 'location'])
    // Solo el nombre: sin numerales, las secciones no son una secuencia.
    expect(wrapper.get('[aria-current]').text()).toBe('Marca')
  })

  it('gives only the active link the brass rail mark class', () => {
    const wrapper = mount(SettingsIndex, { props: { items, active: 'dos' } })

    const active = wrapper.findAll('a.settings-index__link--active')
    expect(active).toHaveLength(1)
    expect(active[0]!.attributes('aria-current')).toBe('location')
  })

  it('emits the section instead of jumping, so the page can scroll smoothly', async () => {
    const wrapper = mount(SettingsIndex, { props: { items, active: 'uno' } })

    await wrapper.findAll('a')[1]!.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['dos']])
  })

  describe('fila de pestañas que no cabe (#759)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
    })

    // jsdom no mide: la fila se simula de 300 px visibles sobre 900 px de pestañas.
    function overflowing(scrollLeft = 0) {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
      let left = scrollLeft
      vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(() => left)
      return { scrollTo: (to: number) => (left = to) }
    }

    it('says there are more tabs to the right, and on both sides once scrolled', async () => {
      const row = overflowing()
      const wrapper = mount(SettingsIndex, { props: { items, active: 'uno' } })
      await wrapper.vm.$nextTick()

      const nav = wrapper.get('nav')
      expect(nav.classes()).toContain('settings-index--more-end')
      expect(nav.classes()).not.toContain('settings-index--more-start')
      expect(wrapper.get('.settings-index__more').attributes('aria-hidden')).toBe('true')

      row.scrollTo(300)
      await wrapper.get('ol').trigger('scroll')
      expect(nav.classes()).toEqual(
        expect.arrayContaining(['settings-index--more-start', 'settings-index--more-end']),
      )

      row.scrollTo(600)
      await wrapper.get('ol').trigger('scroll')
      expect(nav.classes()).not.toContain('settings-index--more-end')
    })

    it('brings the tab of the visible section into view when it changes', async () => {
      overflowing()
      const scrollTo = vi.fn()
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        value: scrollTo,
        configurable: true,
      })
      vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.textContent?.includes('Marca') ? 700 : 0
      })
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
      const wrapper = mount(SettingsIndex, { props: { items, active: 'uno' } })

      await wrapper.setProps({ active: 'dos' })
      await wrapper.vm.$nextTick()

      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 700 + 80 - 300 + 32 }))
    })

    it('shows no fade when every tab fits', async () => {
      const wrapper = mount(SettingsIndex, { props: { items, active: 'uno' } })
      await wrapper.vm.$nextTick()

      expect(wrapper.get('nav').classes()).toEqual(['settings-index'])
    })
  })

  it('has no axe violations', async () => {
    const wrapper = mount(SettingsIndex, {
      attachTo: document.body,
      props: { items, active: 'uno' },
    })
    expect(await axe(wrapper.element)).toHaveNoViolations()
    wrapper.unmount()
  })
})
