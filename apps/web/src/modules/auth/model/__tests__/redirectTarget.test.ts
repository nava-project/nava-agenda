/**
 * El destino que el acceso conserva (CA-012-02, #810 CA-4): solo una ruta
 * interna segura, nunca un destino externo ni un ciclo hacia el acceso o la
 * recuperación.
 */
import { describe, it, expect } from 'vitest'
import { isSafeInternalRedirect } from '../redirectTarget'

describe('isSafeInternalRedirect', () => {
  it.each(['/panel', '/panel/servicios?q=corte', '/panel?date=2026-11-24#hoy'])(
    'accepts the internal route %s',
    (path) => {
      expect(isSafeInternalRedirect(path)).toBe(true)
    },
  )

  it.each([
    ['empty', ''],
    ['relative', 'panel'],
    ['protocol-relative', '//evil.example.test/panel'],
    ['absolute URL', 'https://evil.example.test/panel'],
    ['embedded scheme', '/x?next=https://evil.example.test'],
    ['cycle to acceso', '/acceso?redirect=/panel'],
    ['cycle to recovery', '/recuperar-acceso'],
  ])('rejects %s', (_label, path) => {
    expect(isSafeInternalRedirect(path)).toBe(false)
  })

  it('rejects anything that is not a string', () => {
    expect(isSafeInternalRedirect(undefined)).toBe(false)
    expect(isSafeInternalRedirect(['/panel'])).toBe(false)
  })
})
