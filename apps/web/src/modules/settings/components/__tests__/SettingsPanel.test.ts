/**
 * SettingsPanel (DEC-110): sección con encabezado y alcance.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import SettingsPanel from '../SettingsPanel.vue'

describe('SettingsPanel', () => {
  it('is a region named by its own heading, with the content in the slot', () => {
    const wrapper = mount(SettingsPanel, {
      props: { id: 'marca', title: 'Marca', description: 'Nombre y color.' },
      slots: { default: '<p>contenido</p>' },
    })

    const section = wrapper.get('section')
    expect(section.attributes('id')).toBe('marca')
    expect(section.attributes('aria-labelledby')).toBe('marca-title')
    expect(wrapper.get('#marca-title').text()).toBe('Marca')
    expect(wrapper.text()).toContain('Nombre y color.')
    expect(wrapper.text()).toContain('contenido')
  })

  it('shows no ordinal number: the sections are independent settings, not steps', () => {
    const wrapper = mount(SettingsPanel, { props: { id: 'x', title: 'Hora' } })

    expect(wrapper.get('header').text()).toBe('Hora')
    expect(wrapper.find('.settings-panel__number').exists()).toBe(false)
  })

  it('says where a change applies, in words and not only in color', () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        id: 'x',
        title: 'Pantalla',
        scope: 'device',
        scopeLabel: 'Solo este dispositivo',
      },
    })

    expect(wrapper.get('.settings-panel__scope--device').text()).toBe('Solo este dispositivo')
  })

  it('marks the business scope apart from the device one, so its diamond is filled (#759)', () => {
    const shop = mount(SettingsPanel, {
      props: { id: 'x', title: 'Marca', scope: 'shop', scopeLabel: 'Para el negocio' },
    })

    const label = shop.get('.settings-panel__scope')
    expect(label.classes()).toContain('settings-panel__scope--shop')
    expect(label.classes()).not.toContain('settings-panel__scope--device')
    expect(label.text()).toBe('Para el negocio')
  })

  it('shows no scope when none is given', () => {
    const wrapper = mount(SettingsPanel, { props: { id: 'x', title: 'Reservas' } })

    expect(wrapper.find('.settings-panel__scope').exists()).toBe(false)
  })

  it('has no axe violations', async () => {
    const wrapper = mount(SettingsPanel, {
      attachTo: document.body,
      props: {
        id: 'x',
        title: 'Pantalla',
        scope: 'shop',
        scopeLabel: 'Para la barbería',
      },
      slots: { default: '<p>contenido</p>' },
    })
    expect(await axe(wrapper.element)).toHaveNoViolations()
    wrapper.unmount()
  })
})
