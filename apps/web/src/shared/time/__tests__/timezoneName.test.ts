import { describe, expect, it } from 'vitest'
import { timezoneLabel, timezoneName } from '../timezoneName'

describe('timezoneName', () => {
  it('nombra las zonas de los mercados de Agenda en español, sin el identificador IANA', () => {
    expect(timezoneName('America/Bogota')).toBe('hora de Colombia')
    expect(timezoneName('America/Mexico_City')).toBe('hora del centro de México')
    expect(timezoneLabel('America/Bogota')).toBe('Hora de Colombia')
  })

  it('usa Intl en español para las demás zonas y nunca devuelve el identificador', () => {
    const name = timezoneName('Asia/Tokyo')
    expect(name).toMatch(/^hora /)
    expect(name).not.toMatch(/Asia|Tokyo|\//)
    expect(name).not.toMatch(/estándar/)
  })

  it('dice «hora local del negocio» si la zona no tiene nombre en palabras o no existe', () => {
    expect(timezoneName('UTC')).toBe('hora local del negocio')
    expect(timezoneName('Zona/Inexistente')).toBe('hora local del negocio')
  })
})
