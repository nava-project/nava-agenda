import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BasePagination from '../BasePagination.vue'

function mountPager(props: Partial<InstanceType<typeof BasePagination>['$props']> = {}) {
  return mount(BasePagination, {
    props: {
      currentPage: 1,
      totalPages: 3,
      countLabel: '34 servicios',
      navLabel: 'Paginación de servicios',
      ...props,
    },
    attachTo: document.body,
  })
}

describe('BasePagination', () => {
  it('con una sola página muestra solo el conteo', () => {
    const wrapper = mountPager({ totalPages: 1 })

    expect(wrapper.get('.base-pagination__count').text()).toBe('34 servicios')
    expect(wrapper.find('nav').exists()).toBe(false)
    expect(wrapper.find('.base-pagination__track').exists()).toBe(false)
    wrapper.unmount()
  })

  it('con varias páginas muestra «Página X de Y», la cinta y la página vigente', () => {
    const wrapper = mountPager({ currentPage: 2 })

    expect(wrapper.text()).toContain('Página 2 de 3')
    expect(wrapper.get('nav').attributes('aria-label')).toBe('Paginación de servicios')
    expect(wrapper.get('button[aria-label="Página 2"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('button[aria-label="Página 1"]').attributes('aria-current')).toBeUndefined()
    expect(wrapper.attributes('style')).toContain('--pager-progress: 0.666')
    wrapper.unmount()
  })

  it('emite change con la página elegida y con anterior/siguiente', async () => {
    const wrapper = mountPager({ currentPage: 2 })

    await wrapper.get('button[aria-label="Página siguiente"]').trigger('click')
    await wrapper.get('button[aria-label="Página anterior"]').trigger('click')
    await wrapper.get('button[aria-label="Página 3"]').trigger('click')

    expect(wrapper.emitted('change')).toEqual([[3], [1], [3]])
    wrapper.unmount()
  })

  it('deshabilita anterior en la primera página y siguiente en la última', () => {
    const first = mountPager({ currentPage: 1 })
    expect(first.get('button[aria-label="Página anterior"]').attributes('disabled')).toBeDefined()
    expect(
      first.get('button[aria-label="Página siguiente"]').attributes('disabled'),
    ).toBeUndefined()
    first.unmount()

    const last = mountPager({ currentPage: 3 })
    expect(last.get('button[aria-label="Página siguiente"]').attributes('disabled')).toBeDefined()
    last.unmount()
  })

  it('bloquea toda la navegación mientras carga', async () => {
    const wrapper = mountPager({ currentPage: 2, disabled: true })

    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    await wrapper.get('button[aria-label="Página 3"]').trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('con muchas páginas ancla extremos y vecindad con puntos suspensivos', () => {
    const wrapper = mountPager({ currentPage: 10, totalPages: 30 })

    const labels = wrapper
      .findAll('nav > *')
      .map((node) => (node.element.tagName === 'SPAN' ? '…' : node.text()))
    expect(labels).toEqual(['‹', '1', '…', '9', '10', '11', '…', '30', '›'])
    wrapper.unmount()
  })

  it('devuelve el foco a la página vigente si el botón enfocado queda deshabilitado', async () => {
    const wrapper = mountPager({ currentPage: 2 })
    await wrapper.setProps({ onChange: (page: number) => wrapper.setProps({ currentPage: page }) })
    const next = wrapper.get('button[aria-label="Página siguiente"]')
    ;(next.element as HTMLButtonElement).focus()

    await next.trigger('click')
    await wrapper.vm.$nextTick()

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Página 3')
    wrapper.unmount()
  })
})
