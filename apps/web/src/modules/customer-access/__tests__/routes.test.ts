/**
 * Prueba de integración de enrutamiento (HU-098): `/mi-turno/:token` es una
 * ruta pública real, matched, sin ningún guard de sesión (CA-098-01) y sin
 * depender del cascarón privado ni del cascarón público de reserva.
 */
import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { customerAccessRoutes } from '../index'

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [...customerAccessRoutes],
  })
}

describe('customerAccessRoutes', () => {
  it('registers /mi-turno/:token', () => {
    const paths = customerAccessRoutes.map((route) => route.path)
    expect(paths).toContain('/mi-turno/:token')
  })

  it('resolves a real, matched destination without any session guard', async () => {
    const router = buildRouter()
    await router.push('/mi-turno/3n9F1sQe2z8mM5wYtR7pL0oXhC4bV6dK1aE9jU2gN8i')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('mi-turno')
    expect(router.currentRoute.value.matched.length).toBeGreaterThan(0)
  })

  it('passes the route param as a component prop (props: true)', async () => {
    const router = buildRouter()
    await router.push('/mi-turno/3n9F1sQe2z8mM5wYtR7pL0oXhC4bV6dK1aE9jU2gN8i')
    await router.isReady()
    expect(router.currentRoute.value.params.token).toBe(
      '3n9F1sQe2z8mM5wYtR7pL0oXhC4bV6dK1aE9jU2gN8i',
    )
  })
})

describe('rutas del acceso con código (HU-105 y HU-106)', () => {
  it('el enlace de Odin abre /reservar/:slug/mi-turno/:accessRef sin sesión y con sus props', async () => {
    const router = buildRouter()
    await router.push('/reservar/mi-barberia/mi-turno/ref-opaca-de-un-uso')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('mi-turno-acceso-ref')
    expect(router.currentRoute.value.params).toMatchObject({
      slug: 'mi-barberia',
      accessRef: 'ref-opaca-de-un-uso',
    })
  })

  it('la pantalla general y la del enlace de Odin son rutas distintas', async () => {
    const router = buildRouter()
    await router.push('/reservar/mi-barberia/mi-turno')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('mi-turno-acceso')
  })

  it('?accion=cancelar deja el foco en la cancelación y cualquier otro valor se ignora', async () => {
    const router = buildRouter()
    const record = router.getRoutes().find((r) => r.name === 'mi-turno')!
    const propsFn = record.props.default as (route: unknown) => Record<string, unknown>
    const route = (accion?: unknown) => ({ params: { token: 'tok' }, query: { accion } })

    expect(propsFn(route('cancelar'))).toEqual({ token: 'tok', focus: 'cancel' })
    expect(propsFn(route('otra-cosa'))).toEqual({ token: 'tok', focus: undefined })
    expect(propsFn(route(undefined))).toEqual({ token: 'tok', focus: undefined })
  })
})
