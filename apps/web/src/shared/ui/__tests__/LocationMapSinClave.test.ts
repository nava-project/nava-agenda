/**
 * LocationMap sin forma de incrustar el mapa (producción sin clave de
 * navegador, DEC-130; #749): queda el plano, la dirección y el enlace, sin
 * ofrecer «Ver mapa».
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../../model/mapEnv', () => ({ readMapEnv: () => ({ key: undefined, dev: false }) }))

const { default: LocationMap } = await import('../LocationMap.vue')

describe('LocationMap sin clave', () => {
  it('dibuja el plano y el enlace, y no ofrece «Ver mapa»', () => {
    const wrapper = mount(LocationMap, {
      props: { latitude: 4.598056, longitude: -74.076111, address: 'Calle 10 # 5-20, Bogotá' },
    })
    expect(wrapper.find('svg.location-map__art').exists()).toBe(true)
    expect(wrapper.find('button.location-map__toggle').exists()).toBe(false)
    expect(wrapper.get('a').attributes('href')).toContain('https://www.google.com/maps/search/')
  })
})
