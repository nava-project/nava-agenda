/**
 * Tests for EmptyScene (DEC-113): una escena por tipo de vacío, slots de
 * titular/ayuda/acción, ilustración decorativa y sin violaciones axe.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import EmptyScene from '../EmptyScene.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

describe('EmptyScene', () => {
  it.each(['agenda', 'services', 'team', 'assignments', 'search'] as const)(
    'draws the %s scene and marks it as a modifier class',
    (scene) => {
      const wrapper = mount(EmptyScene, { props: { scene } })
      expect(wrapper.classes()).toContain(`empty-scene--${scene}`)
      expect(wrapper.find('svg').exists()).toBe(true)
    },
  )

  it('keeps the illustration decorative for assistive technology', () => {
    const wrapper = mount(EmptyScene, { props: { scene: 'team' } })
    expect(wrapper.find('.empty-scene__art').attributes('aria-hidden')).toBe('true')
  })

  it('renders the title, the hint and the action from its slots', () => {
    const wrapper = mount(EmptyScene, {
      props: { scene: 'services' },
      slots: {
        title: 'Aún no tienes servicios registrados.',
        hint: 'Crea el primero.',
        action: '<button type="button">Agregar servicio</button>',
      },
    })
    expect(wrapper.text()).toContain('Aún no tienes servicios registrados.')
    expect(wrapper.text()).toContain('Crea el primero.')
    expect(wrapper.find('button').text()).toBe('Agregar servicio')
  })

  it('omits the hint and the action when their slots are empty', () => {
    const wrapper = mount(EmptyScene, { props: { scene: 'search' }, slots: { title: 'Nada.' } })
    expect(wrapper.find('.empty-scene__hint').exists()).toBe(false)
    expect(wrapper.find('.empty-scene__action').exists()).toBe(false)
  })

  it('has no axe violations with a title, a hint and an action', async () => {
    const wrapper = mount(EmptyScene, {
      props: { scene: 'agenda' },
      slots: {
        title: 'No hay turnos hoy.',
        hint: 'Aparecerán aquí.',
        action: '<button type="button">Nuevo turno</button>',
      },
      attachTo: document.body,
    })
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })

  it('speaks the family: serif title from 20 px and a brass drawing (#809, DEC-189)', () => {
    const css = readFileSync(resolve(__dirname, '../EmptyScene.vue'), 'utf-8')
    const title = /\.empty-scene__title \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(title).toContain('font-family: var(--font-display)')
    expect(title).toContain('font-weight: 400')
    // Ni la serif por debajo de 20 px (DEC-189): en ningún ancho.
    for (const m of css.matchAll(/\.empty-scene__title \{[^}]*font-size: (\d+)px/g))
      expect(Number(m[1])).toBeGreaterThanOrEqual(20)
    expect(/\.empty-scene__art \{([^}]*)\}/.exec(css)?.[1]).toContain('var(--color-brass-line)')
  })
})
