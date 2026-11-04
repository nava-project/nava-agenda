import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import PhoneDisplay from '../PhoneDisplay.vue'

describe('PhoneDisplay', () => {
  it('separa bandera, prefijo y número agrupado', () => {
    const wrapper = mount(PhoneDisplay, { props: { value: '+573001234567' } })

    expect(wrapper.get('.phone-display__flag').text()).toBe('🇨🇴')
    expect(wrapper.get('.phone-display__dial').text()).toBe('+57')
    expect(wrapper.get('.phone-display__number').text()).toBe('300 123 4567')
  })

  it('la bandera es decorativa y el texto accesible es prefijo + número', () => {
    const wrapper = mount(PhoneDisplay, { props: { value: '+525512345678' } })

    expect(wrapper.get('.phone-display__flag').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.phone-display__dial').text()).toBe('+52')
    expect(wrapper.get('.phone-display__number').text()).toBe('551 234 5678')
  })

  it('con un prefijo que no reconoce muestra el valor tal cual', () => {
    const wrapper = mount(PhoneDisplay, { props: { value: '+999123456' } })

    expect(wrapper.text()).toBe('+999123456')
    expect(wrapper.find('.phone-display__flag').exists()).toBe(false)
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const wrapper = mount(PhoneDisplay, {
      props: { value: '+573001234567' },
      attachTo: document.body,
    })
    expect(await axe(wrapper.element.parentElement as HTMLElement)).toHaveNoViolations()
    wrapper.unmount()
  })
})
