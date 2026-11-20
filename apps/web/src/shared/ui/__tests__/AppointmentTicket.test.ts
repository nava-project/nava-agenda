/**
 * AppointmentTicket (DEC-189, #730): la misma tarjeta en el resumen, la
 * confirmación y mi turno. El estado se lee en palabras; la ceremonia es una
 * clase que el CSS anima solo con movimiento permitido.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import AppointmentTicket from '../AppointmentTicket.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }
const props = {
  businessName: 'Barbería de prueba',
  serviceName: 'Corte clásico',
  meta: '45 min · $ 35.000',
  weekday: 'Jueves',
  month: 'NOV',
  day: '26',
  time: '11:00 a. m.',
  timeNote: 'Hora de Colombia',
  professionalName: 'Persona Profesional',
  ruler: { from: 8 * 60, to: 20 * 60, at: 11 * 60, label: 'Tu turno en el día' },
}

describe('AppointmentTicket', () => {
  it('reads as a named article with the confirmed seal', async () => {
    const wrapper = mount(AppointmentTicket, {
      props: { ...props, state: 'confirmed' as const },
      attachTo: document.body,
    })
    expect(wrapper.element.tagName).toBe('ARTICLE')
    expect(wrapper.attributes('aria-label')).toBe('Tu turno')
    expect(wrapper.get('.appointment-ticket__seal').text()).toBe('Confirmado')
    expect(wrapper.get('.appointment-ticket__time').text().replace(/\s/g, ' ')).toBe('11:00 a. m.')
    expect(wrapper.find('.day-ruler__mark--mine').exists()).toBe(true)
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })

  it('shows a pending note in brass, not a seal, before confirming', () => {
    const wrapper = mount(AppointmentTicket, { props: { ...props, state: 'draft' as const } })
    expect(wrapper.classes()).toContain('appointment-ticket--draft')
    expect(wrapper.find('.appointment-ticket__seal').exists()).toBe(false)
    expect(wrapper.get('.appointment-ticket__pending').text()).toBe('Por confirmar')
    expect(wrapper.find('.day-ruler__mark--draft').exists()).toBe(true)
  })

  it('names each closed state in its seal', () => {
    for (const [state, text] of [
      ['cancelled', 'Cancelado'],
      ['completed', 'Atendido'],
      ['no-show', 'No asistió'],
    ] as const) {
      const wrapper = mount(AppointmentTicket, { props: { ...props, state } })
      expect(wrapper.get('.appointment-ticket__seal').text()).toBe(text)
    }
  })

  it('says how far away the turn is in a brass chip beside the time (#747)', () => {
    const wrapper = mount(AppointmentTicket, {
      props: { ...props, state: 'confirmed' as const, relative: 'mañana' },
    })
    const chip = wrapper.get('.appointment-ticket__time .appointment-ticket__relative')
    expect(chip.text()).toBe('mañana')
    expect(chip.find('.appointment-ticket__relative-mark').attributes('aria-hidden')).toBe('true')
    expect(
      mount(AppointmentTicket, { props: { ...props, state: 'confirmed' as const } })
        .find('.appointment-ticket__relative')
        .exists(),
    ).toBe(false)
  })

  it('marks the ceremony only when asked and omits the ruler without one', () => {
    const quiet = mount(AppointmentTicket, {
      props: { ...props, ruler: null, state: 'confirmed' as const },
    })
    expect(quiet.classes()).not.toContain('appointment-ticket--ceremony')
    expect(quiet.find('.day-ruler').exists()).toBe(false)
    const ceremony = mount(AppointmentTicket, {
      props: { ...props, state: 'confirmed' as const, ceremony: true },
    })
    expect(ceremony.classes()).toContain('appointment-ticket--ceremony')
  })
})
