// DaylightStrip (DEC-188): la franja pinta las horas reales que el negocio
// atiende, raya lo cerrado, marca los tramos libres y usa Sol para la hora
// elegida o «ahora», nunca para las dos a la vez.
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import DaylightStrip from '../DaylightStrip.vue'

const open = [
  { start: 9 * 60, end: 13 * 60 },
  { start: 14 * 60, end: 17 * 60 },
]

describe('DaylightStrip', () => {
  it('shades what is closed, including the lunch gap', () => {
    const wrapper = mount(DaylightStrip, { props: { open } })
    // La ventana va de 8 a. m. a 6 p. m.: antes de abrir, el almuerzo y después de cerrar.
    expect(wrapper.findAll('.daylight__closed')).toHaveLength(3)
  })

  it('marks the chosen hour with the sun and leaves «now» out', () => {
    const wrapper = mount(DaylightStrip, { props: { open, selected: 15 * 60, now: 10 * 60 } })
    const markers = wrapper.findAll('.daylight__marker')
    expect(markers).toHaveLength(1)
    expect(markers[0]!.classes()).toContain('daylight__marker--selected')
  })

  it('marks «now» only inside the visible window', () => {
    expect(
      mount(DaylightStrip, { props: { open, now: 10 * 60 } })
        .find('.daylight__marker--now')
        .exists(),
    ).toBe(true)
    expect(
      mount(DaylightStrip, { props: { open, now: 2 * 60 } })
        .find('.daylight__marker')
        .exists(),
    ).toBe(false)
  })

  it('draws one segment per free stretch', () => {
    const free = [
      { start: 9 * 60, end: 10 * 60 },
      { start: 16 * 60, end: 17 * 60 },
    ]
    expect(mount(DaylightStrip, { props: { open, free } }).findAll('.daylight__free')).toHaveLength(
      2,
    )
  })

  it('is decorative without a label and an image with one', async () => {
    const decorative = mount(DaylightStrip, { props: { open } })
    expect(decorative.attributes('aria-hidden')).toBe('true')
    const labelled = mount(DaylightStrip, {
      props: { open, label: 'Hoy atiende de 9:00 a. m. a 5:00 p. m.' },
      attachTo: document.body,
    })
    expect(labelled.attributes('role')).toBe('img')
    expect(labelled.attributes('aria-label')).toContain('Hoy atiende')
    expect(await axe(labelled.element)).toHaveNoViolations()
    labelled.unmount()
  })
})
