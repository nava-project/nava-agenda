/**
 * LocationMap (DEC-130, HU-102; #749): en reposo, un plano ilustrado de la
 * familia que no carga nada de Google; el iframe solo al tocar «Ver mapa».
 * Siempre, la dirección en texto y el enlace para abrir Google Maps. En los
 * tests `import.meta.env.DEV` es true, así que hay incrustado sin clave.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import LocationMap from '../LocationMap.vue'

// jsdom no resuelve el contenido del iframe: axe revisa el resto (título, enlace).
const axeOptions = {
  iframes: false,
  rules: { region: { enabled: false }, 'color-contrast': { enabled: false } },
}
const props = { latitude: 4.598056, longitude: -74.076111, address: 'Calle 10 # 5-20, Bogotá' }

describe('LocationMap', () => {
  it('en reposo dibuja el plano ilustrado y no carga Google (#749)', () => {
    const wrapper = mount(LocationMap, { props })
    expect(wrapper.find('iframe').exists()).toBe(false)
    const art = wrapper.get('svg.location-map__art')
    expect(art.attributes('aria-hidden')).toBe('true')
    expect(art.find('.location-map__diamond').exists()).toBe(true)
    expect(wrapper.get('.location-map__address').text()).toBe('Calle 10 # 5-20, Bogotá')
    expect(wrapper.html()).not.toContain('google.com/maps/embed')
  })

  it('cada local tiene su plano: el ángulo sale de las coordenadas', () => {
    const transform = (latitude: number) =>
      mount(LocationMap, { props: { ...props, latitude } })
        .get('svg g')
        .attributes('transform')
    expect(transform(4.598056)).toBe(transform(4.598056))
    expect(transform(4.598056)).not.toBe(transform(6.244203))
  })

  it('carga el mapa de Google solo al tocar «Ver mapa» y vuelve al plano (CA-102-04)', async () => {
    const wrapper = mount(LocationMap, { props })
    const toggle = wrapper.get('button.location-map__toggle')
    expect(toggle.text()).toBe('Ver mapa')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe(
      wrapper.get('.location-map__canvas').attributes('id'),
    )

    await toggle.trigger('click')
    const frame = wrapper.get('iframe')
    expect(frame.attributes('src')).toContain('4.598056')
    expect(frame.attributes('src')).toContain('-74.076111')
    expect(frame.attributes('title')).toBe('Mapa de Calle 10 # 5-20, Bogotá')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.text()).toBe('Ocultar mapa')
    // Hasta que carga, el plano se ve debajo: nunca un recuadro vacío.
    expect(frame.classes()).not.toContain('location-map__frame--ready')
    await frame.trigger('load')
    expect(frame.classes()).toContain('location-map__frame--ready')

    await toggle.trigger('click')
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('svg.location-map__art').exists()).toBe(true)
  })

  it('vuelve al plano si cambia el punto', async () => {
    const wrapper = mount(LocationMap, { props })
    await wrapper.get('button.location-map__toggle').trigger('click')
    await wrapper.setProps({ latitude: 6.244203 })
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('ofrece un enlace seguro para abrir Google Maps en otra pestaña', () => {
    const link = mount(LocationMap, { props }).get('a')
    expect(link.attributes('href')).toContain('https://www.google.com/maps/search/')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
    expect(link.text()).toContain('se abre en una pestaña nueva')
  })

  it('con un punto inválido no pinta nada (nunca un mapa sin coordenadas reales)', () => {
    const wrapper = mount(LocationMap, { props: { ...props, latitude: 120 } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('Calle 10')
  })

  it('no tiene violaciones de accesibilidad, en reposo ni con el mapa vivo', async () => {
    const wrapper = mount(LocationMap, { props, attachTo: document.body })
    expect(await axe(wrapper.element as HTMLElement, axeOptions)).toHaveNoViolations()
    await wrapper.get('button.location-map__toggle').trigger('click')
    expect(await axe(wrapper.element as HTMLElement, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })
})
