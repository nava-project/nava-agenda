import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import AccordionItem from '../AccordionItem.vue'

function mountItem(props: Partial<{ open: boolean; badge: string }> = {}) {
  return mount(AccordionItem, {
    attachTo: document.body,
    props: { id: 'demo', title: 'Excepciones de jornada', open: false, ...props },
    slots: { default: '<p>Contenido del apartado</p>' },
  })
}

describe('AccordionItem', () => {
  it('names the region after its trigger and wires aria-controls', () => {
    const wrapper = mountItem()
    const trigger = wrapper.get('button')
    const region = wrapper.get('[role="region"]')

    expect(trigger.attributes('aria-controls')).toBe(region.attributes('id'))
    expect(region.attributes('aria-labelledby')).toBe(trigger.attributes('id'))
    expect(wrapper.get('h2').find('button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('reflects open/closed in aria-expanded and in the open modifier', async () => {
    const wrapper = mountItem()
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    expect(wrapper.classes()).not.toContain('accordion-item--open')

    await wrapper.setProps({ open: true })
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.classes()).toContain('accordion-item--open')
    wrapper.unmount()
  })

  it('asks its owner to toggle instead of changing state itself', async () => {
    const wrapper = mountItem()
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('shows the badge next to the title only when given', async () => {
    const wrapper = mountItem()
    expect(wrapper.find('.accordion-item__badge').exists()).toBe(false)

    await wrapper.setProps({ badge: '3' })
    expect(wrapper.get('.accordion-item__badge').text()).toBe('3')
    wrapper.unmount()
  })

  it('has no accessibility violations open or closed', async () => {
    const wrapper = mountItem({ open: true, badge: '2' })
    expect(await axe(wrapper.element)).toHaveNoViolations()

    await wrapper.setProps({ open: false })
    expect(await axe(wrapper.element)).toHaveNoViolations()
    wrapper.unmount()
  })

  // Revisión de #783: con más contenido del que cabe, el cuerpo se desplaza y
  // ningún hijo se encoge (a 1440 «Agregar excepción» quedaba en 16 px). jsdom no
  // calcula el flex, así que se vigila la hoja.
  it('never shrinks a child of the body to make it fit', () => {
    const source = readFileSync(join(__dirname, '../AccordionItem.vue'), 'utf8')
    const css = source.slice(source.indexOf('<style'))
    expect(css).toMatch(/\.accordion-item__body\s*\{[^}]*overflow-y:\s*auto/)
    expect(css).toMatch(/\.accordion-item__body\s*>\s*:deep\(\*\)\s*\{[^}]*flex-shrink:\s*0/)
  })
})
