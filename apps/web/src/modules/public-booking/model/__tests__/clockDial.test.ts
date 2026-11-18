import { describe, it, expect } from 'vitest'
import { dialAngles, formatCoordinates } from '../clockDial'

describe('dialAngles', () => {
  it('dibuja la hora de la zona del negocio, no la del dispositivo', () => {
    // 19:00 UTC son las 14:00 en Bogotá (UTC−5): aguja de horas en las 2.
    expect(dialAngles(new Date('2026-09-15T19:00:00Z'), 'America/Bogota')).toEqual({
      hour: 60,
      minute: 0,
    })
  })

  it('mueve la aguja de las horas con los minutos', () => {
    expect(dialAngles(new Date('2026-09-15T19:30:00Z'), 'America/Bogota')).toEqual({
      hour: 75,
      minute: 180,
    })
  })

  it('trata la medianoche y el mediodía como las 12 (0°)', () => {
    expect(dialAngles(new Date('2026-09-15T05:00:00Z'), 'America/Bogota')?.hour).toBe(0)
    expect(dialAngles(new Date('2026-09-15T17:00:00Z'), 'America/Bogota')?.hour).toBe(0)
  })

  it('respeta una zona con desfase de media hora', () => {
    // 00:00 UTC son las 05:30 en Nueva Delhi.
    expect(dialAngles(new Date('2026-09-15T00:00:00Z'), 'Asia/Kolkata')).toEqual({
      hour: 165,
      minute: 180,
    })
  })

  it('devuelve null con una zona inválida en vez de dibujar una hora falsa', () => {
    expect(dialAngles(new Date('2026-09-15T19:00:00Z'), 'No/Existe')).toBeNull()
  })
})

describe('formatCoordinates', () => {
  it('rotula hemisferio norte/oeste con cuatro decimales', () => {
    expect(formatCoordinates(4.65810001, -74.0549)).toBe('4.6581° N · 74.0549° O')
  })

  it('rotula hemisferio sur/este', () => {
    expect(formatCoordinates(-33.8688, 151.2093)).toBe('33.8688° S · 151.2093° E')
  })
})
