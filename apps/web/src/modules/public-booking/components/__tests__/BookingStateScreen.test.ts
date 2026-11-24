/**
 * Pruebas de BookingStateScreen (DEC-111): las cuatro pantallas de estado de
 * página de los pasos públicos conservan el copy, los roles y el reintento
 * que cada página repetía por su cuenta.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import BookingStateScreen from '../BookingStateScreen.vue'

function mountScreen(
  status: 'loading' | 'not-found' | 'network-error' | 'unexpected-error',
  requestId?: string,
) {
  return mount(BookingStateScreen, {
    props: { status, requestId, title: 'Elegir servicio', loadingHeadline: 'Cargando servicios…' },
  })
}

describe('BookingStateScreen', () => {
  it('always provides the hidden page heading and one <main>', () => {
    for (const status of ['loading', 'not-found', 'network-error', 'unexpected-error'] as const) {
      const wrapper = mountScreen(status)
      expect(wrapper.find('main').exists()).toBe(true)
      expect(wrapper.find('h1').text()).toBe('Elegir servicio')
    }
  })

  it('announces loading politely, without a retry action', () => {
    const wrapper = mountScreen('loading')
    expect(wrapper.text()).toContain('Cargando servicios…')
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('guides on a missing link instead of offering a retry that would change nothing', () => {
    const wrapper = mountScreen('not-found')
    expect(wrapper.find('[role="alert"]').text()).toContain('Este enlace no lleva a ninguna agenda')
    expect(wrapper.text()).toContain('Pide al negocio el enlace de nuevo')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows the connection copy as an alert that guides, without alarm labels', () => {
    const wrapper = mountScreen('network-error')
    expect(wrapper.find('[role="alert"]').text()).toContain('No pudimos conectar')
    expect(wrapper.text()).toContain('Revisa tu conexión')
    for (const status of ['not-found', 'network-error', 'unexpected-error'] as const)
      expect(mountScreen(status).text()).not.toMatch(/\b(Error|Atención)\b/)
  })

  it('reserves the page height so the footer never jumps (CLS)', () => {
    expect(mountScreen('not-found').get('main').classes()).toContain('bk-page')
  })

  it('shares the support request id only when the server provided one', () => {
    expect(mountScreen('unexpected-error', 'req-abc-123').text()).toContain('req-abc-123')
    const bare = mountScreen('unexpected-error')
    expect(bare.text()).toContain('Inténtalo de nuevo en unos segundos.')
    expect(bare.text()).not.toContain('código')
  })

  it('emits retry from the action in every recoverable failure state', async () => {
    for (const status of ['network-error', 'unexpected-error'] as const) {
      const wrapper = mountScreen(status)
      await wrapper.find('button').trigger('click')
      expect(wrapper.emitted('retry')).toHaveLength(1)
    }
  })

  it('has no accessibility violations in any state', async () => {
    for (const status of ['loading', 'not-found', 'network-error', 'unexpected-error'] as const) {
      const wrapper = mount(BookingStateScreen, {
        props: { status, title: 'Elegir servicio', loadingHeadline: 'Cargando…' },
        attachTo: document.body,
      })
      expect(await axe(wrapper.element)).toHaveNoViolations()
      wrapper.unmount()
    }
  })

  describe('el enlace que no lleva a ninguna agenda (#809)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('shows the family sun-diamond, still, instead of a half sun', () => {
      const wrapper = mountScreen('not-found')
      const mark = wrapper.get('.bk-state__mark')
      expect(mark.attributes('aria-hidden')).toBe('true')
      expect(mark.find('.sun-diamond--still').exists()).toBe(true)
      expect(wrapper.find('.bk-state__horizon').exists()).toBe(false)
    })

    it('tells what to do with a turn already booked', () => {
      const wrapper = mountScreen('not-found')
      expect(wrapper.get('.bk-state__hint').text()).toBe(
        '¿Ya tenías un turno? Ábrelo desde el enlace que te llegó por correo o WhatsApp.',
      )
      // Los errores conservan «Reintentar» y no llevan esa ayuda.
      const offline = mountScreen('network-error')
      expect(offline.find('.bk-state__hint').exists()).toBe(false)
      expect(offline.get('button').text()).toBe('Reintentar')
    })

    it('offers «Volver» only when there is a page to go back to', async () => {
      expect(mountScreen('not-found').find('button').exists()).toBe(false)
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      const wrapper = mountScreen('not-found')
      const button = wrapper.get('button')
      expect(button.text()).toBe('Volver')
      await button.trigger('click')
      expect(back).toHaveBeenCalledOnce()
    })

    it('keeps the page own wording for «Mi turno» without the booking hint', () => {
      const wrapper = mount(BookingStateScreen, {
        props: {
          status: 'not-found',
          title: 'Mi turno',
          loadingHeadline: 'Cargando tu turno…',
          notFound: { headline: 'Este enlace ya no sirve', body: 'Pide uno nuevo al negocio.' },
        },
      })
      expect(wrapper.text()).toContain('Este enlace ya no sirve')
      expect(wrapper.find('.bk-state__hint').exists()).toBe(false)
    })

    it('centers the block in the reserved height instead of leaving it on top', () => {
      const css = readFileSync(resolve(__dirname, '../BookingStateScreen.vue'), 'utf-8')
      expect(/\.bk-state \{([^}]*)\}/.exec(css)?.[1]).toContain('align-content: center')
    })
  })
})
