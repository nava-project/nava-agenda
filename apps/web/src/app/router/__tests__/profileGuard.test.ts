import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'
import { installProfileRedirect, profileRedirect } from '../profileGuard'

describe('profileRedirect (DEC-115)', () => {
  it('sends «Servicios por profesional» to «Servicios» for the solo profile', () => {
    expect(profileRedirect({ name: 'professional-services' }, 'solo')).toEqual({
      name: 'catalog-servicios',
    })
  })

  it.each(['catalog-servicios', 'configuracion-negocio'])(
    'sends «%s» to the agenda for the employee profile (DEC-134)',
    (name) => {
      expect(profileRedirect({ name }, 'employee')).toEqual({ name: 'panel' })
    },
  )

  // DEC-173: el empleado configura sus servicios ofrecidos y su ventana de reserva.
  it.each([
    'panel',
    'staff-profesionales',
    'schedules-horarios',
    'agenda-nuevo-turno',
    'professional-services',
    'configuracion-reserva-publica',
  ])('keeps «%s» available for the employee profile', (name) => {
    expect(profileRedirect({ name }, 'employee')).toBeNull()
  })

  it('leaves every route alone in the full panel', () => {
    expect(profileRedirect({ name: 'professional-services' }, 'shop')).toBeNull()
    expect(profileRedirect({ name: 'staff-profesionales' }, 'shop')).toBeNull()
  })

  it.each([
    'panel',
    'catalog-servicios',
    'staff-profesionales',
    'schedules-horarios',
    'configuracion-negocio',
  ])('keeps «%s» available in the solo profile', (name) => {
    expect(profileRedirect({ name }, 'solo')).toBeNull()
  })

  it('ignores unnamed routes', () => {
    expect(profileRedirect({ name: undefined }, 'solo')).toBeNull()
    expect(profileRedirect({ name: Symbol('x') }, 'solo')).toBeNull()
  })
})

describe('installProfileRedirect (DEC-115)', () => {
  async function routerAt(path: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/panel/servicios', name: 'catalog-servicios', component: { template: '<div />' } },
        {
          path: '/panel/servicios-por-profesional',
          name: 'professional-services',
          component: { template: '<div />' },
        },
      ],
    })
    installProfileRedirect(router)
    await router.push(path)
    await router.isReady()
    return router
  }

  beforeEach(() => resetBrand())

  it('redirects on navigation when the profile is already known', async () => {
    setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })

    const router = await routerAt('/panel/servicios-por-profesional')

    expect(router.currentRoute.value.name).toBe('catalog-servicios')
  })

  it('does not touch the full panel', async () => {
    const router = await routerAt('/panel/servicios-por-profesional')

    expect(router.currentRoute.value.name).toBe('professional-services')
  })

  it('moves a visitor who is already on a retired route when the profile arrives later', async () => {
    // Primera visita sin copia local: la marca llega con la sesión, después de la ruta.
    const router = await routerAt('/panel/servicios-por-profesional')
    expect(router.currentRoute.value.name).toBe('professional-services')

    setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('catalog-servicios'))
  })

  it('also corrects the route when the profile arrives while the first navigation is still pending', async () => {
    // La sesión se comprueba antes de mostrar la ruta; la marca llega en ese lapso.
    let finishSession: () => void = () => {}
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/panel/servicios', name: 'catalog-servicios', component: { template: '<div />' } },
        {
          path: '/panel/servicios-por-profesional',
          name: 'professional-services',
          component: { template: '<div />' },
          beforeEnter: () => new Promise<void>((resolve) => (finishSession = resolve)),
        },
      ],
    })
    installProfileRedirect(router)
    const first = router.push('/panel/servicios-por-profesional')

    setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
    finishSession()
    await first

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('catalog-servicios'))
  })

  it('leaves a visitor on an available route alone when the profile arrives', async () => {
    const router = await routerAt('/panel/servicios')

    setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
    await Promise.resolve()

    expect(router.currentRoute.value.name).toBe('catalog-servicios')
  })
})
