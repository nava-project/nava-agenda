/**
 * Prueba de integración de enrutamiento (HU-090): `/reservar/:slug` es una
 * ruta pública real, matched, sin ningún guard de sesión (CA-090-03) y sin
 * depender del cascarón privado.
 */
import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { publicBookingRoutes } from '../index'

// Las cinco pantallas son hijas de un único cascarón (`PublicBookingLayout`):
// la ruta raíz del registro es la del cascarón y cada pantalla conserva su
// ruta absoluta. Los `paths` registrados son los del cascarón más los de sus
// hijas.
const registeredPaths = [
  ...publicBookingRoutes.map((route) => route.path),
  ...publicBookingRoutes.flatMap((route) => (route.children ?? []).map((child) => child.path)),
]

// Una franja futura: la ruta de «Tus datos» descarta las pasadas (F-RQ-02, #436).
const futureStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString()

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [...publicBookingRoutes],
  })
}

const S = '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4'
const P = 'a1111111-1111-1111-1111-111111111111'

describe('publicBookingRoutes', () => {
  it('hosts every screen under one shared shell, with the step in the route meta (DEC-188)', async () => {
    expect(publicBookingRoutes.filter((route) => !route.redirect)).toHaveLength(1)
    const router = buildRouter()
    const expected: Array<[string, string, number]> = [
      ['/reservar/a', 'reserva-publica-entrada', 1],
      ['/reservar/a/servicios/s/horario', 'reserva-publica-horario', 2],
      [
        `/reservar/a/servicios/s/profesional/b/horario/${futureStart}/cliente`,
        'reserva-publica-cliente',
        3,
      ],
    ]
    for (const [path, name, step] of expected) {
      await router.push(path)
      const current = router.currentRoute.value
      // Cascarón + pantalla: dos registros coincidentes en cada ruta.
      expect(current.matched).toHaveLength(2)
      expect(current.name).toBe(name)
      expect(current.meta.bookingStep).toBe(step)
    }
  })

  it('registers /reservar/:slug and resolves it without any session guard', async () => {
    expect(registeredPaths).toContain('/reservar/:slug')
    const router = buildRouter()
    await router.push('/reservar/barberia-ejemplo')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('reserva-publica-entrada')
    expect(router.currentRoute.value.params.slug).toBe('barberia-ejemplo')
  })

  it('passes «Cualquiera» as a null professional and a chosen one from ?profesional=', async () => {
    const router = buildRouter()
    await router.push(`/reservar/barberia-ejemplo/servicios/${S}/horario`)
    const any = router.currentRoute.value
    const props = any.matched[1]!.props.default as (r: typeof any) => Record<string, unknown>
    expect(props(any)).toEqual({ slug: 'barberia-ejemplo', serviceId: S, professionalId: null })

    await router.push(`/reservar/barberia-ejemplo/servicios/${S}/horario?profesional=${P}`)
    const chosen = router.currentRoute.value
    expect(props(chosen)).toEqual({ slug: 'barberia-ejemplo', serviceId: S, professionalId: P })
  })

  it.each([
    ['/reservar/a/servicios', { name: 'reserva-publica-entrada', query: {} }],
    [`/reservar/a/servicios/${S}/profesional`, { name: 'reserva-publica-horario', query: {} }],
    [
      `/reservar/a/servicios/${S}/profesional/${P}/horario`,
      { name: 'reserva-publica-horario', query: { profesional: P } },
    ],
  ])('keeps the v1 link %s working by redirecting it', async (path, expected) => {
    const router = buildRouter()
    await router.push(path)
    const current = router.currentRoute.value
    expect(current.name).toBe(expected.name)
    expect(current.query).toEqual(expected.query)
    expect(current.params.slug).toBe('a')
  })

  it('resolves the customer details route with the four params as props, without any session guard', async () => {
    const router = buildRouter()
    await router.push(
      `/reservar/barberia-ejemplo/servicios/${S}/profesional/${P}/horario/${encodeURIComponent(futureStart)}/cliente`,
    )
    await router.isReady()
    const current = router.currentRoute.value
    expect(current.name).toBe('reserva-publica-cliente')
    expect(current.params).toMatchObject({
      slug: 'barberia-ejemplo',
      serviceId: S,
      professionalId: P,
      startsAt: futureStart,
    })
  })

  // F-RQ-02 (#436)
  it.each(['no-es-fecha', '2020-01-01T15:00:00Z'])(
    'sends an unreadable or past startsAt (%s) back to the day and hour instead of the form',
    async (startsAt) => {
      const router = buildRouter()
      await router.push(`/reservar/a/servicios/s/profesional/b/horario/${startsAt}/cliente`)
      const current = router.currentRoute.value
      expect(current.name).toBe('reserva-publica-horario')
      expect(current.params).toMatchObject({ slug: 'a', serviceId: 's' })
      expect(current.query).toEqual({ profesional: 'b' })
    },
  )

  it('returns to «Cualquiera» when the unreadable start came from it', async () => {
    const router = buildRouter()
    await router.push(
      '/reservar/a/servicios/s/profesional/b/horario/no-es-fecha/cliente?cualquiera=1',
    )
    expect(router.currentRoute.value.name).toBe('reserva-publica-horario')
    expect(router.currentRoute.value.query).toEqual({})
  })
})
