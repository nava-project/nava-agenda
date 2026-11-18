/**
 * Ruta raíz (DEC-183, issue #658): la landing vive en nava.wtf; en la app `/`
 * lleva al panel, cuya guarda manda al acceso si no hay sesión.
 */
import { describe, it, expect } from 'vitest'
import { router } from '../index'

describe('ruta raíz', () => {
  it('redirige «/» al panel', () => {
    const root = router.getRoutes().find((route) => route.path === '/')
    expect(root?.name).toBe('inicio')
    expect(root?.redirect).toBe('/panel')
  })

  it('ya no sirve la landing ni los documentos legales', () => {
    for (const path of ['/privacidad', '/terminos']) {
      expect(router.resolve(path).name).toBe('no-encontrada')
    }
  })
})
