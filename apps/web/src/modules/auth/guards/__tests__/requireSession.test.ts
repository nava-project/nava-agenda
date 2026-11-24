/**
 * Los caminos al acceso (#810, A4). El 401 del arranque no distingue una
 * sesión vencida de alguien que nunca entró; la marca local sí. Las cuatro
 * situaciones de la aprobación:
 * - nunca entró;
 * - venció al arrancar;
 * - venció a mitad de sesión;
 * - cerró sesión a propósito, aquí o en otra pestaña.
 * Las dos primeras se prueban en el guard; el 401 en uso, en la instalación
 * del 401; el cierre de sesión, con `useLogout` real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

const fetchSessionContextMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/sessionContextApi', () => ({ fetchSessionContext: fetchSessionContextMock }))
const useMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { use: useMock, POST: postMock } }))

const { requireSession } = await import('../requireSession')
const { installSessionHandling } = await import('../../bootstrap/installSessionHandling')
const { resetForFreshLogin } = await import('../../model/sessionStore')
const { hadSessionHere } = await import('../../model/sessionMarker')
const { useLogout } = await import('../../model/logout')

const authenticated = {
  kind: 'authenticated',
  businessId: 'negocio-1',
  businessName: 'Negocio de prueba',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
}

const Blank = { template: '<div />' }

function buildRouter(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/acceso', name: 'acceso', component: Blank },
      { path: '/panel', name: 'panel', component: Blank, beforeEnter: requireSession },
      {
        path: '/panel/servicios',
        name: 'servicios',
        component: Blank,
        beforeEnter: requireSession,
      },
    ],
  })
  return router
}

/** Abre la app con una sesión válida: el arranque autenticado pone la marca. */
async function startAuthenticated(): Promise<Router> {
  fetchSessionContextMock.mockResolvedValueOnce(authenticated)
  const router = buildRouter()
  await router.push('/panel')
  await router.isReady()
  return router
}

/** Recarga: estado `checking` de nuevo y el arranque responde 401. */
async function reloadWithExpiredCookie(path: string): Promise<Router> {
  resetForFreshLogin()
  fetchSessionContextMock.mockResolvedValueOnce({ kind: 'unauthenticated' })
  const router = buildRouter()
  await router.push(path)
  await router.isReady()
  return router
}

describe('caminos al acceso (#810)', () => {
  beforeEach(() => {
    fetchSessionContextMock.mockReset()
    useMock.mockReset()
    postMock.mockReset()
    window.localStorage.clear()
    resetForFreshLogin()
  })

  it('1. nunca entró: acceso normal, sin aviso, conservando el destino', async () => {
    const router = await reloadWithExpiredCookie('/panel/servicios')
    expect(router.currentRoute.value.name).toBe('acceso')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/panel/servicios' })
  })

  it('2. venció al arrancar: el aviso de sesión vencida y el destino', async () => {
    await startAuthenticated()
    expect(hadSessionHere()).toBe(true)

    const router = await reloadWithExpiredCookie('/panel/servicios?q=corte')
    expect(router.currentRoute.value.name).toBe('acceso')
    expect(router.currentRoute.value.query).toEqual({
      motivo: 'sesion-expirada',
      redirect: '/panel/servicios?q=corte',
    })
  })

  it('3. venció a mitad de sesión: el 401 en uso avisa y conserva la ruta', async () => {
    const router = await startAuthenticated()
    await router.push('/panel?date=2026-11-24')
    installSessionHandling(router)
    const { onResponse } = useMock.mock.calls[0]![0] as {
      onResponse: (a: { request: Request; response: Response }) => unknown
    }

    onResponse({
      request: new Request('http://localhost/api/v1/private/appointments/daily-agenda'),
      response: new Response(null, { status: 401 }),
    })
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('acceso')
    expect(router.currentRoute.value.query).toEqual({
      motivo: 'sesion-expirada',
      redirect: '/panel?date=2026-11-24',
    })
  })

  it('4. cerró sesión a propósito: el próximo acceso es el normal', async () => {
    const router = await startAuthenticated()
    postMock.mockResolvedValueOnce({ response: new Response(null, { status: 204 }) })
    const Host = defineComponent({
      setup: () => useLogout(),
      template: '<button @click="logout">Cerrar sesión</button>',
    })
    const wrapper = mount(Host, { global: { plugins: [router] } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('acceso')
    expect(hadSessionHere()).toBe(false)

    const next = await reloadWithExpiredCookie('/panel')
    expect(next.currentRoute.value.query).toEqual({ redirect: '/panel' })
  })

  it('4b. cerró sesión en otra pestaña: el 401 en uso de esta lleva al acceso normal', async () => {
    const router = await startAuthenticated()
    installSessionHandling(router)
    const { onResponse } = useMock.mock.calls[0]![0] as {
      onResponse: (a: { request: Request; response: Response }) => unknown
    }
    // La otra pestaña comparte `localStorage`: su «Cerrar sesión» quita la marca.
    window.localStorage.removeItem('nava.session.v1')

    onResponse({
      request: new Request('http://localhost/api/v1/private/services'),
      response: new Response(null, { status: 401 }),
    })
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('acceso')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/panel' })
  })

  it('falls back to the plain acceso when localStorage throws (private mode)', async () => {
    await startAuthenticated()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      const router = await reloadWithExpiredCookie('/panel')
      expect(router.currentRoute.value.query).toEqual({ redirect: '/panel' })
    } finally {
      vi.restoreAllMocks()
    }
  })
})
