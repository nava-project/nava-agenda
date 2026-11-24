/**
 * AppointmentTicket (DEC-189, #730): la misma tarjeta en el resumen, la
 * confirmación y mi turno. El estado se lee en palabras; la ceremonia es una
 * clase que el CSS anima solo con movimiento permitido.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  describe('el borrador que se llena (#833)', () => {
    const empty = {
      businessName: 'Barbería de prueba',
      serviceName: '',
      weekday: '',
      month: '',
      day: '',
      time: '',
      state: 'draft' as const,
      stateLabel: 'Por registrar',
      filling: true,
    }

    it('reserves every gap with a silhouette, names the blanks for assistive tech and keeps the ruler without a mark', async () => {
      const wrapper = mount(AppointmentTicket, { props: empty, attachTo: document.body })
      expect(wrapper.findAll('.appointment-ticket__blank')).toHaveLength(8)
      expect(wrapper.text()).toContain('Servicio por elegir')
      expect(wrapper.text()).toContain('Día y hora por elegir')
      expect(wrapper.get('.appointment-ticket__pending').text()).toContain('Por registrar')
      expect(wrapper.find('.appointment-ticket__ruler-wrap--blank').exists()).toBe(true)
      expect(wrapper.find('.day-ruler__mark').exists()).toBe(false)
      expect(wrapper.text()).not.toMatch(/undefined|NaN|Invalid Date/)
      expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
      wrapper.unmount()
    })

    it('draws nothing extra outside the filling mode: the other screens keep their card', () => {
      const wrapper = mount(AppointmentTicket, {
        props: {
          ...props,
          meta: undefined,
          timeNote: undefined,
          professionalName: undefined,
          ruler: undefined,
          state: 'confirmed' as const,
        },
      })
      expect(wrapper.find('.appointment-ticket__blank').exists()).toBe(false)
      expect(wrapper.find('.appointment-ticket__meta').exists()).toBe(false)
      expect(wrapper.find('.appointment-ticket__foot').exists()).toBe(false)
      expect(wrapper.find('.appointment-ticket__ruler-wrap').exists()).toBe(false)
    })

    it('replaces each silhouette by its datum as it arrives', () => {
      const wrapper = mount(AppointmentTicket, {
        props: { ...empty, ...props, state: 'draft' as const },
      })
      expect(wrapper.find('.appointment-ticket__blank').exists()).toBe(false)
      expect(wrapper.find('.day-ruler__mark--draft').exists()).toBe(true)
    })
  })

  describe('la ceremonia corta (#833)', () => {
    const css = readFileSync(join(__dirname, '../AppointmentTicket.vue'), 'utf8')

    it('marks the card with its own class, never the full script', () => {
      const wrapper = mount(AppointmentTicket, {
        props: { ...props, state: 'confirmed' as const, ceremony: 'short' as const },
      })
      expect(wrapper.classes()).toContain('appointment-ticket--ceremony-short')
      expect(wrapper.classes()).not.toContain('appointment-ticket--ceremony')
    })

    it('only stamps the seal and turns the diamond into the Sun, within 500 ms, and only with motion allowed', () => {
      const block = css.slice(css.indexOf('/* Ceremonia corta (#833)'))
      const media = block.slice(0, block.indexOf('@keyframes'))
      expect(media).toContain('@media (prefers-reduced-motion: no-preference)')
      expect(media).toContain(":root:not([data-motion='reduced'])")
      const rules = [
        ...media.matchAll(
          /animation:\s*([\w-]+)\s+(\d+)ms(?:\s+calc\(var\(--ticket-ceremony-delay\) \+ (\d+)ms\)|\s+var\(--ticket-ceremony-delay\))/g,
        ),
      ]
      expect(rules.map((r) => r[1])).toEqual(['ticket-stamp', 'ticket-mark'])
      for (const [, , duration, delay] of rules) {
        expect(Number(duration) + Number(delay ?? 0)).toBeLessThanOrEqual(500)
      }
    })
  })
})
