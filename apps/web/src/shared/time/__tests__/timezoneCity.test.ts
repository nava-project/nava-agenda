import { describe, expect, it } from 'vitest'
import { cityOf, offsetLabel, zoneClockLabel } from '../timezoneCity'

describe('zona del negocio para leer (#791)', () => {
  it('dice la ciudad con tilde y el desfase, nunca el id IANA', () => {
    expect(zoneClockLabel('America/Bogota')).toBe('Hora en Bogotá · UTC−5')
    expect(zoneClockLabel('America/Mexico_City', new Date('2026-07-01T12:00:00Z'))).toBe(
      'Hora en Ciudad de México · UTC−6',
    )
  })

  it('una zona sin nombre propio se lee desde su identificador, sin guiones bajos', () => {
    expect(cityOf('America/Port_au_Prince')).toBe('Port au Prince')
    expect(offsetLabel('UTC')).toBe('UTC')
  })
})
