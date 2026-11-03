/**
 * Ruta raíz (DEC-151, issue #515): `/` presenta la landing pública en lugar de
 * redirigir al acceso, sin pasar por el guard de sesión.
 */
import { describe, it, expect } from 'vitest'
import { landingRoutes } from '@/modules/landing'

describe('landingRoutes', () => {
  it('registra «/» como una ruta pública con nombre y sin redirección', () => {
    expect(landingRoutes).toHaveLength(1)
    const [route] = landingRoutes
    expect(route.path).toBe('/')
    expect(route.name).toBe('inicio')
    expect(route.redirect).toBeUndefined()
    expect(route.beforeEnter).toBeUndefined()
    expect(route.meta?.requiresAuth).toBeUndefined()
  })
})
