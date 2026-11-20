/**
 * DayRuler (DEC-189, #730): la regla del día. El dibujo es decorativo y se lee
 * entero por su etiqueta; numerales, rombos y el Sol caen en su minuto.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import DayRuler from '../DayRuler.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }
const base = { from: 8 * 60, to: 20 * 60, label: 'Tu turno, jueves a las 2:00 p. m.' }

describe('DayRuler', () => {
  it('is one image with its reading as the accessible name', async () => {
    const wrapper = mount(DayRuler, { props: base, attachTo: document.body })
    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe(base.label)
    expect(wrapper.get('.day-ruler__body').attributes('aria-hidden')).toBe('true')
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })

  it('centres major numerals on their hour with the suffix hanging', () => {
    const wrapper = mount(DayRuler, { props: base })
    const numerals = wrapper.findAll('.day-ruler__numeral')
    const first = numerals[0]!
    expect(first.text()).toBe('8a. m.')
    expect(first.attributes('style')).toContain('left: 0%')
    const noon = numerals.find((n) => n.text().startsWith('12'))!
    expect(noon.get('small').text()).toBe('p. m.')
    expect(noon.attributes('style')).toContain('left: 33.3333')
    const last = numerals.at(-1)!
    expect(last.text()).toBe('8p. m.')
    expect(last.attributes('style')).toContain('left: 100%')
  })

  it('places marks at their minute and skips those outside the window', () => {
    const wrapper = mount(DayRuler, {
      props: {
        ...base,
        marks: [
          { at: 14 * 60, kind: 'mine' as const },
          { at: 7 * 60, kind: 'confirmed' as const },
          { at: 9 * 60, kind: 'cancelled' as const },
        ],
      },
    })
    const marks = wrapper.findAll('.day-ruler__mark')
    expect(marks).toHaveLength(2)
    expect(marks[0]!.classes()).toContain('day-ruler__mark--mine')
    expect(marks[0]!.attributes('style')).toContain('left: 50%')
    expect(marks[1]!.classes()).toContain('day-ruler__mark--cancelled')
  })

  it('draws the Sun only when now falls inside the window', () => {
    expect(
      mount(DayRuler, { props: { ...base, now: 11 * 60 } })
        .find('.day-ruler__sun')
        .exists(),
    ).toBe(true)
    expect(
      mount(DayRuler, { props: { ...base, now: 21 * 60 } })
        .find('.day-ruler__sun')
        .exists(),
    ).toBe(false)
  })
})
