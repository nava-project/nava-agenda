/**
 * StarRating (DEC-128, HU-100): una imagen para el lector con el texto completo, relleno
 * proporcional y «Sin reseñas todavía» en vez de «0».
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import StarRating from '../StarRating.vue'

// Ancho recortado de cada diamante (de 24): la fracción pintada (issue #489).
const filledWidths = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('clipPath rect').map((r) => r.attributes('width'))

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

describe('StarRating', () => {
  it('es una sola imagen con el resumen completo como nombre accesible', () => {
    const wrapper = mount(StarRating, { props: { rating: 4.5, count: 12 } })
    const image = wrapper.get('[role="img"]')
    expect(image.attributes('aria-label')).toBe('4,5 de 5 · 12 reseñas')
    expect(wrapper.findAll('svg')).toHaveLength(5)
    expect(wrapper.get('.star-rating__value').attributes('aria-hidden')).toBe('true')
    expect(wrapper.text()).toContain('4,5')
    expect(wrapper.text()).toContain('12 reseñas')
  })

  it('rellena cada diamante en proporción al promedio', () => {
    const wrapper = mount(StarRating, { props: { rating: 3.5, count: 2 } })
    expect(filledWidths(wrapper)).toEqual(['24', '24', '24', '12', '0'])
  })

  it('sin reseñas muestra diamantes vacíos y «Sin reseñas todavía»', () => {
    const wrapper = mount(StarRating, { props: { rating: null, count: 0 } })
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Sin reseñas todavía')
    expect(wrapper.text()).toContain('Sin reseñas todavía')
    expect(wrapper.text()).not.toContain('0')
    expect(filledWidths(wrapper)).toEqual(['0', '0', '0', '0', '0'])
    expect(wrapper.findAll('.rating-gem__facet')).toHaveLength(0)
  })

  it('puede ocultar el texto visible y conservar el nombre accesible', () => {
    const wrapper = mount(StarRating, { props: { rating: 5, count: 1, showValue: false } })
    expect(wrapper.find('.star-rating__value').exists()).toBe(false)
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('5,0 de 5 · 1 reseña')
  })

  it('no tiene violaciones de axe', async () => {
    const wrapper = mount(StarRating, {
      props: { rating: 4.5, count: 12 },
      attachTo: document.body,
    })
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })
})

describe('StarRating · etiqueta propia', () => {
  it('uses the given label instead of the average summary (a single review is not an average)', () => {
    const wrapper = mount(StarRating, {
      props: { rating: 4, count: 1, showValue: false, label: '4 de 5 estrellas' },
    })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('4 de 5 estrellas')
  })
})
