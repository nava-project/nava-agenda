import { describe, expect, it } from 'vitest'
import { minutesInWords } from '../durationWords'

describe('minutesInWords (#812)', () => {
  it('says whole hours in hours', () => {
    expect(minutesInWords(60)).toBe('1 hora')
    expect(minutesInWords(120)).toBe('2 horas')
    expect(minutesInWords(1440)).toBe('24 horas')
  })

  it('keeps any other value in minutes', () => {
    expect(minutesInWords(90)).toBe('90 minutos')
    expect(minutesInWords(45)).toBe('45 minutos')
    expect(minutesInWords(1)).toBe('1 minuto')
    expect(minutesInWords(0)).toBe('0 minutos')
  })
})
