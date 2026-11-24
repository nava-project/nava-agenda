/**
 * Pruebas de PrivateShell (HU-012): estados globales de arranque/carga,
 * conexión perdida con Reintentar y composición de cabecera+navegación+
 * contenido solo cuando hay sesión autenticada. `sessionStore` se
 * sustituye por un doble de prueba controlable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { axe } from 'vitest-axe'
import type { BootstrapState } from '../../model/sessionStore'

const mockState = vi.hoisted(() => ({ bootstrap: { status: 'checking' } as BootstrapState }))
const retryBootstrapMock = vi.hoisted(() => vi.fn())

vi.mock('../../model/sessionStore', () => ({
  sessionState: mockState,
  retryBootstrap: retryBootstrapMock,
}))
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { GET: vi.fn(), POST: vi.fn() } }))

const { default: PrivateShell } = await import('../PrivateShell.vue')

async function mountShell() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/panel', name: 'panel', component: { template: '<p>contenido del panel</p>' } },
      { path: '/acceso', name: 'acceso', component: { template: '<div />' } },
      {
        path: '/panel/nuevo-turno',
        name: 'agenda-nuevo-turno',
        component: { template: '<div />' },
      },
    ],
  })
  await router.push('/panel')
  await router.isReady()
  return mount(PrivateShell, { global: { plugins: [router] } })
}

describe('PrivateShell', () => {
  beforeEach(() => {
    retryBootstrapMock.mockReset()
  })

  it('shows a non-blank checking state without header or nav', async () => {
    mockState.bootstrap = { status: 'checking' }
    const wrapper = await mountShell()

    expect(wrapper.text().length).toBeGreaterThan(0)
    expect(wrapper.find('header').exists()).toBe(false)
    expect(wrapper.find('nav').exists()).toBe(false)
  })

  it('renders header, nav and content when authenticated (CA-012-04)', async () => {
    mockState.bootstrap = {
      status: 'authenticated',
      businessId: 'shop-1',
      businessName: 'Barbería El Corte',
      expiresAt: new Date().toISOString(),
    }
    const wrapper = await mountShell()

    expect(wrapper.find('header').exists()).toBe(true)
    expect(wrapper.find('nav').exists()).toBe(true)
    expect(wrapper.text()).toContain('Barbería El Corte')
    expect(wrapper.text()).toContain('contenido del panel')
  })

  it('reads header, then navigation, then content (the desktop rail sits before main)', async () => {
    mockState.bootstrap = {
      status: 'authenticated',
      businessId: 'shop-1',
      businessName: 'Barbería El Corte',
      expiresAt: new Date().toISOString(),
    }
    const wrapper = await mountShell()

    const order = [...wrapper.element.querySelectorAll('header, nav, main')].map((el) =>
      el.tagName.toLowerCase(),
    )
    expect(order).toEqual(['header', 'nav', 'main'])
  })

  it('brings a keyboard-focused control fully into view inside the content (#804)', async () => {
    mockState.bootstrap = {
      status: 'authenticated',
      businessId: 'shop-1',
      businessName: 'Barbería El Corte',
      expiresAt: new Date().toISOString(),
    }
    const wrapper = await mountShell()
    const content = wrapper.find('main.private-shell__content').element as HTMLElement
    // El contenido se desplaza (86–635) y el control asoma a medias sobre el dock.
    content.style.overflowY = 'auto'
    Object.defineProperty(content, 'clientHeight', { value: 549 })
    Object.defineProperty(content, 'scrollHeight', { value: 1200 })
    const box = (top: number, height: number) =>
      ({
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 320,
        width: 320,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(box(86, 549))
    const control = document.createElement('button')
    content.append(control)
    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(box(617, 36))
    vi.spyOn(control, 'matches').mockImplementation((selector) => selector === ':focus-visible')
    control.scrollIntoView = vi.fn()

    control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(control.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    wrapper.unmount()
  })

  it('shows a recoverable connection-lost state with Reintentar (CA-012-05)', async () => {
    mockState.bootstrap = { status: 'connection-lost' }
    const wrapper = await mountShell()

    expect(wrapper.text()).toContain('No pudimos conectar')
    await wrapper.get('button').trigger('click')
    expect(retryBootstrapMock).toHaveBeenCalledTimes(1)
  })

  it('never shows a blank screen for unauthenticated (transient, guard already redirects)', async () => {
    mockState.bootstrap = { status: 'unauthenticated' }
    const wrapper = await mountShell()

    expect(wrapper.html().trim().length).toBeGreaterThan(0)
  })

  it('has no axe violations in the authenticated state', async () => {
    mockState.bootstrap = {
      status: 'authenticated',
      businessId: 'shop-1',
      businessName: 'Barbería El Corte',
      expiresAt: new Date().toISOString(),
    }
    const wrapper = await mountShell()
    const results = await axe(wrapper.element, { rules: { region: { enabled: false } } })
    expect(results).toHaveNoViolations()
  })

  describe('preferencias de pantalla y marca (DEC-110)', () => {
    const authenticated = () => {
      mockState.bootstrap = {
        status: 'authenticated',
        businessId: 'shop-1',
        businessName: 'Barbería El Corte',
        expiresAt: new Date().toISOString(),
      }
    }

    it('paints the theme on <html> while the shell is mounted and removes it on leaving', async () => {
      authenticated()
      const wrapper = await mountShell()

      expect(document.documentElement.dataset.appTheme).toBe('ink')

      wrapper.unmount()
      // El acceso y la reserva pública nunca heredan el tema del panel.
      expect(document.documentElement.dataset.appTheme).toBeUndefined()
    })
  })
})
