/**
 * AuthSplitLayout v2 «La luz del día» (DEC-188, entrega 3): el cielo de la marca es
 * decorativo, «Volver» lleva a la sección de Agenda de nava.wtf con un nombre que
 * dice adónde va, los enlaces legales cierran la columna, la llegada se termina
 * con cualquier gesto y el contenido de la página es el encabezado real.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import AuthSplitLayout from '../AuthSplitLayout.vue'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

function mountLayout(
  props: Record<string, unknown> = {},
  slotHtml = '<h1>Accede a Nava Agenda</h1>',
) {
  return mount(AuthSplitLayout, { props, slots: { default: slotHtml }, attachTo: document.body })
}

describe('AuthSplitLayout', () => {
  it('«Volver» lleva a la sección de Agenda de nava.wtf y dice adónde va', () => {
    const wrapper = mountLayout()
    const link = wrapper.get('nav[aria-label="Sitio"] a')
    expect(link.attributes('href')).toBe('https://nava.wtf/#agenda')
    expect(link.text()).toBe('Volver')
    // El nombre accesible contiene el texto visible y el destino (WCAG 2.5.3).
    expect(link.attributes('aria-label')).toBe('Volver a Nava Agenda en nava.wtf')
    // Va antes del formulario: es lo primero que se alcanza con Tab.
    expect(wrapper.get('.au-card').find('nav[aria-label="Sitio"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('enlaza la privacidad y las condiciones al final de la columna (issue #545)', () => {
    const wrapper = mountLayout()
    const card = wrapper.get('.au-card')
    const legal = card.get('nav[aria-label="Documentos legales"]')
    expect(legal.get('a[href="https://nava.wtf/privacidad"]').text()).toBe('Privacidad')
    expect(legal.get('a[href="https://nava.wtf/terminos"]').text()).toBe('Condiciones')
    expect(card.element.lastElementChild).toBe(legal.element)
    wrapper.unmount()
  })

  it('el cielo de la marca es decorativo: con el sol del logo y sin texto para el lector', () => {
    const wrapper = mountLayout()
    const sky = wrapper.get('.au-sky')
    expect(sky.attributes('aria-hidden')).toBe('true')
    expect(sky.find('.au-sky__sun svg').exists()).toBe(true)
    expect(sky.get('.au-sky__tagline').text()).toBe('Tu agenda y tu equipo, a la luz del día.')
    wrapper.unmount()
  })

  it('acepta otra frase para el cielo', () => {
    const wrapper = mountLayout({ tagline: 'Recupera el acceso a tu cuenta.' })
    expect(wrapper.get('.au-sky__tagline').text()).toBe('Recupera el acceso a tu cuenta.')
    wrapper.unmount()
  })

  it('un clic o una tecla terminan la llegada: nunca hace esperar', async () => {
    const byKey = mountLayout()
    expect(byKey.get('main').classes()).not.toContain('au--settled')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await byKey.vm.$nextTick()
    expect(byKey.get('main').classes()).toContain('au--settled')
    byKey.unmount()

    const byPointer = mountLayout()
    window.dispatchEvent(new Event('pointerdown'))
    await byPointer.vm.$nextTick()
    expect(byPointer.get('main').classes()).toContain('au--settled')
    byPointer.unmount()
  })

  it('el contenido de la página es el encabezado real', () => {
    const wrapper = mountLayout()
    expect(wrapper.get('h1').text()).toBe('Accede a Nava Agenda')
    wrapper.unmount()
  })

  describe('Accesibilidad automatizada (axe-core, CA-009-05)', () => {
    it('sin violaciones con el contenido real de una pantalla', async () => {
      const wrapper = mountLayout(
        {},
        '<h1>Accede a Nava Agenda</h1><label for="c">Correo</label><input id="c" />',
      )
      expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
      wrapper.unmount()
    })
  })
})
