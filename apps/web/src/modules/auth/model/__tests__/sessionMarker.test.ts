/**
 * Marca local «aquí hubo una sesión» (#810, A4): solo un «1», sin datos
 * personales ni tokens, y si el almacenamiento falla cuenta como «sin marca».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearSessionMarker, hadSessionHere, markSessionStarted } from '../sessionMarker'

describe('sessionMarker', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts without a marker, sets it and clears it', () => {
    expect(hadSessionHere()).toBe(false)
    markSessionStarted()
    expect(hadSessionHere()).toBe(true)
    clearSessionMarker()
    expect(hadSessionHere()).toBe(false)
  })

  it('stores a bare flag and nothing else: no personal data or tokens', () => {
    markSessionStarted()
    expect(window.localStorage.length).toBe(1)
    const key = window.localStorage.key(0)!
    expect(key).toBe('nava.session.v1')
    expect(window.localStorage.getItem(key)).toBe('1')
  })

  it('treats a storage that throws as «no marker» and never throws itself', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => markSessionStarted()).not.toThrow()
    expect(hadSessionHere()).toBe(false)
    expect(() => clearSessionMarker()).not.toThrow()
  })
})
