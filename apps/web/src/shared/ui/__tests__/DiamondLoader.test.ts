/**
 * Tests for DiamondLoader (DEC-188, entrega 5; #735): el texto de la espera a
 * la vista y accesible, el diamante dentro del sol decorativo, sin
 * temporizadores, y su región viva solo cuando se pide (`announce`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import DiamondLoader from '../DiamondLoader.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

describe('DiamondLoader', () => {
  it('says what it waits for in visible text and hides the drawing', () => {
    const wrapper = mount(DiamondLoader, { props: { label: 'Cargando el equipo…' } })
    expect(wrapper.text()).toBe('Cargando el equipo…')
    // La marca es el diamante dentro del sol (SunDiamond), decorativa.
    const mark = wrapper.get('svg.sun-diamond')
    expect(mark.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.diamond-loader__phrase').exists()).toBe(false)
    wrapper.unmount()
  })

  it('announces itself only when asked, so it never nests two live regions', () => {
    const quiet = mount(DiamondLoader, { props: { label: 'Cargando' } })
    expect(quiet.attributes('role')).toBeUndefined()
    quiet.unmount()
    const loud = mount(DiamondLoader, { props: { label: 'Abriendo la reserva…', announce: true } })
    expect(loud.attributes('role')).toBe('status')
    expect(loud.attributes('aria-live')).toBe('polite')
    loud.unmount()
  })

  it('overlay sits on the skeleton without taking height of its own', () => {
    const wrapper = mount(DiamondLoader, { props: { label: 'Cargando', layout: 'overlay' } })
    expect(wrapper.classes()).toContain('diamond-loader--overlay')
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

  it('keeps its 300 ms delay with reduced motion: it only loses the fade, never flashes (#820)', () => {
    const source = readFileSync(resolve(__dirname, '../DiamondLoader.vue'), 'utf8')
    // base.css deja la animación en 0,01 ms y conserva el retardo; quitarla
    // entera la hacía visible desde el primer cuadro.
    expect(source).not.toMatch(/animation:\s*none/)
    expect(source).toMatch(/animation: diamond-loader-in 200ms ease-out 300ms backwards;/)
  })
})
