import { describe, expect, it } from 'vitest'
import {
  HOME_ADDRESS_MAX_LENGTH,
  HOME_DETAILS_MAX_LENGTH,
  composeHomeAddress,
  normalizeHomeDetails,
} from '../homeAddress'

describe('homeAddress', () => {
  it('antepone los detalles a la dirección', () => {
    expect(composeHomeAddress('Cl. 85 #15-20, Bogotá', 'Torre 2, apto 304')).toBe(
      'Torre 2, apto 304 · Cl. 85 #15-20, Bogotá',
    )
  })

  it('sin detalles devuelve la dirección tal cual', () => {
    expect(composeHomeAddress('Cl. 85 #15-20, Bogotá', '')).toBe('Cl. 85 #15-20, Bogotá')
    expect(composeHomeAddress('Cl. 85 #15-20, Bogotá', '   \n ')).toBe('Cl. 85 #15-20, Bogotá')
  })

  it('limpia espacios y recorta los detalles al máximo', () => {
    expect(normalizeHomeDetails('  casa   azul \n portón negro ')).toBe('casa azul portón negro')
    expect([...normalizeHomeDetails('x'.repeat(500))]).toHaveLength(HOME_DETAILS_MAX_LENGTH)
  })

  it('nunca supera los 200 caracteres que acepta el servidor y conserva los detalles', () => {
    const details = 'd'.repeat(HOME_DETAILS_MAX_LENGTH)
    const composed = composeHomeAddress('a'.repeat(200), details)

    expect([...composed].length).toBeLessThanOrEqual(HOME_ADDRESS_MAX_LENGTH)
    expect(composed.startsWith(details)).toBe(true)
  })

  it('cuenta caracteres y no unidades UTF-16', () => {
    const composed = composeHomeAddress('🏠'.repeat(200), 'apto 1')
    expect([...composed].length).toBeLessThanOrEqual(HOME_ADDRESS_MAX_LENGTH)
  })
})
