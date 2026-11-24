/**
 * El destino que el acceso conserva (CA-012-02, #810 CA-4): solo una ruta
 * interna segura, nunca un destino externo ni un ciclo hacia el acceso o la
 * recuperación.
 */
import { describe, it, expect } from 'vitest'
import { isSafeInternalRedirect } from '../redirectTarget'

describe('isSafeInternalRedirect', () => {
  it.each([
    '/panel',
    '/panel/servicios?q=corte',
    '/panel?date=2026-11-24#hoy',
    '/panel/servicios?q=cort%C3%A9',
  ])('accepts the internal route %s', (path) => {
    expect(isSafeInternalRedirect(path)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['relative', 'panel'],
    ['protocol-relative', '//evil.example.test/panel'],
    ['absolute URL', 'https://evil.example.test/panel'],
    ['embedded scheme', '/x?next=https://evil.example.test'],
    ['cycle to acceso', '/acceso?redirect=/panel'],
    ['cycle to recovery', '/recuperar-acceso'],
    ['backslash', '/\\evil.example.test'],
    ['tab before a slash', '/\t/evil.example.test'],
    ['newline', '/panel\nx'],
    ['DEL', '/panel\u007f'],
    ['encoded backslash', '/%5Cevil.example.test'],
    ['encoded backslash, lower case', '/%5cevil.example.test'],
    ['encoded tab', '/%09/evil.example.test'],
  ])('rejects %s', (_label, path) => {
    expect(isSafeInternalRedirect(path)).toBe(false)
  })

  it('rejects anything that is not a string', () => {
    expect(isSafeInternalRedirect(undefined)).toBe(false)
    expect(isSafeInternalRedirect(['/panel'])).toBe(false)
  })
})
