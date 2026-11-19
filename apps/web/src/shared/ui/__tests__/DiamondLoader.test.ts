/**
 * Tests for DiamondLoader v2 (DEC-188, entrega 5): el texto de la espera a la
 * vista y accesible, el dibujo del sol decorativo y sin temporizadores (ya no
 * rota frases).
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import DiamondLoader from '../DiamondLoader.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

describe('DiamondLoader', () => {
  it('says what it waits for in visible text and hides the drawing', () => {
    const wrapper = mount(DiamondLoader, { props: { label: 'Cargando el equipo…' } })
    expect(wrapper.text()).toBe('Cargando el equipo…')
    expect(wrapper.get('.diamond-loader__stage').attributes('aria-hidden')).toBe('true')
    // Sin la voz v1: ni frases rotativas ni rombo.
    expect(wrapper.find('.diamond-loader__phrase').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(false)
    wrapper.unmount()
  })

  it('applies the layout modifier', () => {
    const wrapper = mount(DiamondLoader, { props: { label: 'Cargando', layout: 'inline' } })
    expect(wrapper.classes()).toContain('diamond-loader--inline')
    wrapper.unmount()
  })

  it('leaves no timer behind', () => {
    vi.useFakeTimers()
    const wrapper = mount(DiamondLoader, { props: { label: 'Cargando' } })
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('has no obvious accessibility violations', async () => {
    const wrapper = mount(DiamondLoader, {
      props: { label: 'Cargando' },
      attachTo: document.body,
    })
    expect(await axe(wrapper.element as HTMLElement, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })
})
