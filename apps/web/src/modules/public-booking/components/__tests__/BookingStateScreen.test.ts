/**
 * Pruebas de BookingStateScreen (DEC-111): las cuatro pantallas de estado de
 * página de los pasos públicos conservan el copy, los roles y el reintento
 * que cada página repetía por su cuenta.
 */
import { describe, it, expect } from 'vitest'
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
})
