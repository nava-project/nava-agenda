// Presentación del contacto en el acceso con código (HU-105).
import { describe, expect, it } from 'vitest'
import { formatCountdown, isEmailContact, maskContact, waitMinutes } from '../accessContact'

describe('maskContact', () => {
  it('deja del correo solo la inicial y el dominio', () => {
    expect(maskContact('ana.perez@correo.test')).toBe('a•••@correo.test')
    expect(maskContact('  ana.perez@correo.test ')).toBe('a•••@correo.test')
  })

  it('deja del celular solo los últimos cuatro dígitos, sin importar cómo se escribió', () => {
    expect(maskContact('300 123 4567')).toBe('••• ••• 4567')
    expect(maskContact('+57 300-123-4567')).toBe('••• ••• 4567')
  })

  it('nunca devuelve el contacto completo', () => {
    expect(maskContact('ana.perez@correo.test')).not.toContain('perez')
    expect(maskContact('3001234567')).not.toContain('300123')
  })
})

describe('isEmailContact', () => {
  it('distingue correo de celular por la arroba', () => {
    expect(isEmailContact('a@b.co')).toBe(true)
    expect(isEmailContact('300 123 4567')).toBe(false)
  })
})

describe('formatCountdown', () => {
  it('formatea segundos como m:ss', () => {
    expect(formatCountdown(60)).toBe('1:00')
    expect(formatCountdown(59.2)).toBe('1:00')
    expect(formatCountdown(9)).toBe('0:09')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-4)).toBe('0:00')
  })
})

describe('waitMinutes', () => {
  it('redondea hacia arriba y nunca devuelve cero', () => {
    expect(waitMinutes(1)).toBe(1)
    expect(waitMinutes(60)).toBe(1)
    expect(waitMinutes(61)).toBe(2)
    expect(waitMinutes(540)).toBe(9)
    expect(waitMinutes(0)).toBe(1)
  })
})
