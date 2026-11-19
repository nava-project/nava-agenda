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
        .find('.daylight__marker--sun')
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
    const map = mount(DaylightStrip, { props: { open, free, variant: 'map' } })
    expect(map.findAll('.daylight__free')).toHaveLength(2)
    // Lo abierto sin horas se apaga: 9–13 y 14–17 menos los dos tramos libres.
    expect(map.findAll('.daylight__busy')).toHaveLength(2)
    expect(map.find('.daylight__legend').text()).toContain('Libre')
  })

  it('draws the moon at night and keeps the sun higher at noon than at opening', () => {
    expect(
      mount(DaylightStrip, { props: { open: [{ start: 17 * 60, end: 23 * 60 }], now: 21 * 60 } })
        .find('.daylight__marker--moon')
        .exists(),
    ).toBe(true)
    const top = (now: number) =>
      parseFloat(
        mount(DaylightStrip, { props: { open, now } })
          .get('.daylight__marker')
          .attributes('style')!
          .match(/top:\s*([\d.]+)%/)![1]!,
      )
    expect(top(12 * 60)).toBeLessThan(top(9 * 60))
  })

  it('labels opening, noon and closing without overlapping', () => {
    const labels = mount(DaylightStrip, { props: { open: [{ start: 8 * 60, end: 20 * 60 }] } })
      .findAll('.daylight__hours span')
      .map((l) => l.text())
    expect(labels).toEqual(['8 a. m.', '12 p. m.', '8 p. m.'])
  })

  it('a tap on a free stretch picks those minutes', async () => {
    const free = [{ start: 9 * 60, end: 10 * 60 }]
    const map = mount(DaylightStrip, { props: { open, free, variant: 'map' } })
    const track = map.get('.daylight__track').element as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect
    // La ventana va de 8 a. m. a 6 p. m.: x = 150 de 1000 son las 9:30.
    await map.get('.daylight__free').trigger('click', { clientX: 150 })
    expect(map.emitted('pick')![0]).toEqual([9 * 60 + 30])
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
