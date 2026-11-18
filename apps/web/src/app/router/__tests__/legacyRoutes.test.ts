/**
 * Rutas y query anteriores a DEC-183 (#662): `/panel/barberia…`, `/panel/barberos`,
 * `/panel/servicios-por-barbero`, los pasos públicos `…/barbero/:barberId/…` y
 * `?barberId=` llevan a la forma nueva conservando query y ancla. El retorno de
 * Google Calendar registrado en producción llega a la ruta vieja con `code` y `state`.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { integrationsPrivateShellChildRoutes } from '@/modules/integrations'
import { professionalServicesPrivateShellChildRoutes } from '@/modules/professionalServices'
import { publicBookingRoutes } from '@/modules/public-booking'
import { settingsPrivateShellChildRoutes } from '@/modules/settings'
import { staffPrivateShellChildRoutes } from '@/modules/staff'
import { router as appRouter } from '../index'
import { legacyQueryRedirect } from '../legacyQuery'

const Stub = { template: '<div />' }

// Las mismas rutas de los módulos, con un componente vacío en vez del diferido: la
// prueba mira la navegación, no carga pantallas reales.
function stubbed(records: RouteRecordRaw[]): RouteRecordRaw[] {
  return records.map((record) => {
    if ('redirect' in record && record.redirect) return record
    const children = record.children ? stubbed(record.children) : undefined
    return { ...record, component: Stub, ...(children ? { children } : {}) } as RouteRecordRaw
  })
}

function testRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/panel',
        component: Stub,
        children: stubbed([
          { path: '', name: 'panel', component: Stub },
          ...settingsPrivateShellChildRoutes,
          ...integrationsPrivateShellChildRoutes,
          ...staffPrivateShellChildRoutes,
          ...professionalServicesPrivateShellChildRoutes,
        ]),
      },
      ...stubbed(publicBookingRoutes),
    ],
  })
  router.beforeEach((to) => legacyQueryRedirect(to) ?? true)
  return router
}

describe('rutas anteriores a DEC-183 (#662)', () => {
  it('el retorno viejo de Google Calendar conserva code y state', async () => {
    const router = testRouter()
    await router.push('/panel/barberia/google-calendar/callback?code=codigo-1&state=estado-1')
    const route = router.currentRoute.value
    expect(route.name).toBe('integraciones-google-calendar-retorno')
    expect(route.path).toBe('/panel/negocio/google-calendar/callback')
    expect(route.query).toEqual({ code: 'codigo-1', state: 'estado-1' })
  })

  it.each([
    ['/panel/barberia', '/panel/negocio', 'configuracion-negocio'],
    [
      '/panel/barberia/google-calendar',
      '/panel/negocio/google-calendar',
      'integraciones-google-calendar',
    ],
    ['/panel/barberos', '/panel/profesionales', 'staff-profesionales'],
    ['/panel/servicios-por-barbero', '/panel/servicios-por-profesional', 'professional-services'],
  ])('%s lleva a %s con su query y su ancla', async (from, to, name) => {
    const router = testRouter()
    await router.push(`${from}?origen=correo#configuracion-horario`)
    const route = router.currentRoute.value
    expect(route.name).toBe(name)
    expect(route.path).toBe(to)
    expect(route.query).toEqual({ origen: 'correo' })
    expect(route.hash).toBe('#configuracion-horario')
  })

  it('los pasos públicos …/barbero/:barberId/… pasan a …/profesional/:professionalId/…', async () => {
    const router = testRouter()
    await router.push('/reservar/mi-negocio/servicios/s-1/barbero?vista=lista')
    expect(router.currentRoute.value.name).toBe('reserva-publica-profesional')
    expect(router.currentRoute.value.fullPath).toBe(
      '/reservar/mi-negocio/servicios/s-1/profesional?vista=lista',
    )

    await router.push('/reservar/mi-negocio/servicios/s-1/barbero/p-1/horario')
    expect(router.currentRoute.value.name).toBe('reserva-publica-horario')
    expect(router.currentRoute.value.params.professionalId).toBe('p-1')
    expect(router.currentRoute.value.path).toBe(
      '/reservar/mi-negocio/servicios/s-1/profesional/p-1/horario',
    )

    const startsAt = '2099-01-05T15:00:00Z'
    await router.push(`/reservar/mi-negocio/servicios/s-1/barbero/p-1/horario/${startsAt}/cliente`)
    expect(router.currentRoute.value.name).toBe('reserva-publica-cliente')
    expect(router.currentRoute.value.params).toMatchObject({ professionalId: 'p-1', startsAt })
  })

  it('?barberId= pasa a ?professionalId= sin tocar el resto', async () => {
    const router = testRouter()
    await router.push('/panel?date=2026-11-02&barberId=p-1#turno')
    const route = router.currentRoute.value
    expect(route.name).toBe('panel')
    expect(route.query).toEqual({ date: '2026-11-02', professionalId: 'p-1' })
    expect(route.hash).toBe('#turno')
  })

  it('el router de la app registra las mismas redirecciones', () => {
    const redirects = appRouter
      .getRoutes()
      .filter((route) => route.redirect)
      .map((route) => route.path)
    expect(redirects).toEqual(
      expect.arrayContaining([
        '/panel/barberia',
        '/panel/barberia/google-calendar',
        '/panel/barberia/google-calendar/callback',
        '/panel/barberos',
        '/panel/servicios-por-barbero',
        '/reservar/:slug/servicios/:serviceId/barbero',
        '/reservar/:slug/servicios/:serviceId/barbero/:barberId/horario',
        '/reservar/:slug/servicios/:serviceId/barbero/:barberId/horario/:startsAt/cliente',
      ]),
    )
  })
})
