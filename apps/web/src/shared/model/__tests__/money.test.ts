/**
 * Formato de importes exactos (issue #577): el precio llega como decimal en
 * texto y nunca se convierte a número.
 */
import { describe, expect, it } from 'vitest'
import { formatMoney, moneyParts, readableMoney } from '../money'

describe('moneyParts', () => {
  it('groups thousands with a dot and drops all-zero decimals for COP', () => {
    expect(moneyParts('25000.00', 'COP')).toEqual({
      symbol: '$',
      amount: '25.000',
      currency: 'COP',
    })
    expect(moneyParts('1250000', 'COP').amount).toBe('1.250.000')
    expect(moneyParts('900.00', 'COP').amount).toBe('900')
  })

  it('keeps significant decimals with a comma, digit for digit', () => {
    expect(moneyParts('1250.50', 'COP').amount).toBe('1.250,5')
    expect(moneyParts('0.05', 'COP').amount).toBe('0,05')
    // Más dígitos de los que cabrían en un double: no se pierde ninguno.
    expect(moneyParts('12345678901234567890.12', 'COP').amount).toBe(
      '12.345.678.901.234.567.890,12',
    )
  })

  it('uses the symbol of the real currency, never assumes pesos', () => {
    expect(moneyParts('10.00', 'USD').symbol).toBe('US$')
    expect(moneyParts('10.00', 'EUR').symbol).not.toBe('$')
  })

  it('returns an unparseable amount untouched', () => {
    expect(moneyParts('gratis', 'COP')).toEqual({ symbol: '$', amount: 'gratis', currency: 'COP' })
  })
})

describe('formatMoney', () => {
  it('joins symbol and amount with a non-breaking space', () => {
    expect(formatMoney('25000.00', 'COP')).toBe('$ 25.000')
  })
})

describe('readableMoney (#833)', () => {
  it('formats a readable decimal like formatMoney', () => {
    expect(readableMoney('35000.00', 'COP')).toBe(formatMoney('35000.00', 'COP'))
  })

  it('returns null instead of a price that is not one', () => {
    expect(readableMoney('gratis', 'COP')).toBeNull()
    expect(readableMoney('', 'COP')).toBeNull()
    expect(readableMoney('35000.00', '')).toBeNull()
  })
})
