import { describe, expect, it } from 'vitest'
import {
  PHONE_COUNTRIES,
  composePhone,
  flagEmoji,
  groupNationalDigits,
  phoneCountry,
  phoneParts,
  splitInternationalPhone,
} from '../phoneCountries'

describe('phoneCountries', () => {
  it('dibuja la bandera a partir del código ISO', () => {
    expect(flagEmoji('CO')).toBe('🇨🇴')
    expect(flagEmoji('mx')).toBe('🇲🇽')
  })

  it('no repite prefijos: prefijo → país es una función', () => {
    const dials = PHONE_COUNTRIES.map((country) => country.dial)
    expect(new Set(dials).size).toBe(dials.length)
  })

  it('cae en Colombia ante un ISO desconocido', () => {
    expect(phoneCountry('ZZ').iso).toBe('CO')
  })

  it('compone el E.164 con prefijo y solo dígitos', () => {
    expect(composePhone('CO', '300 123-4567')).toBe('+573001234567')
    expect(composePhone('US', '(415) 555 0100')).toBe('+14155550100')
  })

  it('separa un número pegado con +, con 00 o con espacios', () => {
    expect(splitInternationalPhone('+57 300 123 4567')).toEqual({
      country: 'CO',
      national: '3001234567',
    })
    expect(splitInternationalPhone('0052 55 1234 5678')).toEqual({
      country: 'MX',
      national: '5512345678',
    })
  })

  it('elige el prefijo más largo: +593 es Ecuador, no un +59 inexistente', () => {
    expect(splitInternationalPhone('+593991234567')).toEqual({
      country: 'EC',
      national: '991234567',
    })
  })

  it('no toca lo que no trae prefijo ni lo que no reconoce', () => {
    expect(splitInternationalPhone('3001234567')).toBeNull()
    expect(splitInternationalPhone('+81 90 1234 5678')).toBeNull()
  })
})

describe('formato de lectura del teléfono', () => {
  it('agrupa el número nacional', () => {
    expect(groupNationalDigits('3001234567')).toBe('300 123 4567')
    expect(groupNationalDigits('30012345')).toBe('3001 2345')
    expect(groupNationalDigits('300123456')).toBe('300 123 456')
    expect(groupNationalDigits('3001234')).toBe('300 1234')
    expect(groupNationalDigits('3001234567890')).toBe('300 123 456 7890')
    expect(groupNationalDigits('300 123-4567')).toBe('300 123 4567')
    expect(groupNationalDigits('')).toBe('')
  })

  it('parte un E.164 en bandera, prefijo y número', () => {
    expect(phoneParts('+573001234567')).toEqual({
      iso: 'CO',
      flag: '🇨🇴',
      dial: '+57',
      national: '300 123 4567',
    })
    expect(phoneParts('+593991234567')).toMatchObject({ iso: 'EC', dial: '+593' })
  })

  it('no inventa país: sin prefijo reconocido o sin número devuelve null', () => {
    expect(phoneParts('3001234567')).toBeNull()
    expect(phoneParts('+999123456')).toBeNull()
    expect(phoneParts('+57')).toBeNull()
  })
})
