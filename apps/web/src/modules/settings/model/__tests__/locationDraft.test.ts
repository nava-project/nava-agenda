import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCATION, type LocationSettings } from '../brandOutcome'
import {
  addressChanged,
  draftFromSaved,
  locationChange,
  needsGeocoding,
  normalizeAddress,
  sameLocation,
  validateAddress,
} from '../locationDraft'

const saved: LocationSettings = {
  hasPhysicalLocation: true,
  address: 'Calle 10 # 5-20, Bogotá',
  latitude: 4.598056,
  longitude: -74.076111,
  offersHomeService: false,
}

describe('locationDraft', () => {
  it('normaliza la dirección como el servidor: recorta y colapsa espacios', () => {
    expect(normalizeAddress('  Calle 10   # 5-20 \n Bogotá ')).toBe('Calle 10 # 5-20 Bogotá')
    expect(normalizeAddress('   ')).toBe('')
  })

  it('valida el largo máximo de 200 caracteres contando letras, no bytes', () => {
    expect(validateAddress('ñ'.repeat(200))).toBeUndefined()
    expect(validateAddress('ñ'.repeat(201))).toContain('200')
    expect(validateAddress('')).toBeUndefined()
  })

  it('el borrador de una barbería sin dirección empieza con el campo vacío', () => {
    expect(draftFromSaved(DEFAULT_LOCATION)).toEqual({
      hasPhysicalLocation: true,
      address: '',
      offersHomeService: false,
    })
  })

  it('una dirección sin cambios reales (solo espacios) no cuenta como cambio', () => {
    const draft = {
      hasPhysicalLocation: true,
      address: '  Calle 10   # 5-20, Bogotá ',
      offersHomeService: false,
    }
    expect(addressChanged(draft, saved)).toBe(false)
    expect(sameLocation(draft, saved)).toBe(true)
    expect(locationChange(draft, saved)).toEqual({})
  })

  it('solo envía lo que cambió', () => {
    expect(
      locationChange(
        {
          hasPhysicalLocation: false,
          address: 'Calle 10 # 5-20, Bogotá',
          offersHomeService: false,
        },
        saved,
      ),
    ).toEqual({ hasPhysicalLocation: false })
    expect(
      locationChange(
        {
          hasPhysicalLocation: true,
          address: 'Carrera 7 # 32-16',
          offersHomeService: false,
        },
        saved,
      ),
    ).toEqual({ address: 'Carrera 7 # 32-16' })
  })

  it('el interruptor de domicilio se envía solo si cambió (DEC-131)', () => {
    const base = { hasPhysicalLocation: true, address: 'Calle 10 # 5-20, Bogotá' }
    expect(locationChange({ ...base, offersHomeService: true }, saved)).toEqual({
      offersHomeService: true,
    })
    expect(sameLocation({ ...base, offersHomeService: true }, saved)).toBe(false)
    expect(locationChange({ ...base, offersHomeService: false }, saved)).toEqual({})
  })

  it('una dirección vacía se envía como null para quitarla', () => {
    expect(
      locationChange({ hasPhysicalLocation: true, address: '  ', offersHomeService: false }, saved),
    ).toEqual({
      address: null,
    })
  })

  it('vaciar un campo que ya estaba sin dirección no es un cambio', () => {
    expect(
      locationChange(
        { hasPhysicalLocation: true, address: '', offersHomeService: false },
        DEFAULT_LOCATION,
      ),
    ).toEqual({})
  })

  // Issue #589: una dirección cargada fuera del panel quedó sin punto en el mapa
  // y el panel no tenía cómo ubicarla, porque solo envía lo que cambió.
  describe('dirección guardada sin punto en el mapa', () => {
    const unlocated: LocationSettings = { ...saved, latitude: null, longitude: null }

    it('la detecta solo cuando hay dirección y le faltan coordenadas', () => {
      expect(needsGeocoding(unlocated)).toBe(true)
      expect(needsGeocoding(saved)).toBe(false)
      expect(needsGeocoding({ ...unlocated, address: null })).toBe(false)
    })

    it('cuenta como pendiente de guardar y envía la dirección para ubicarla', () => {
      const draft = draftFromSaved(unlocated)
      expect(sameLocation(draft, unlocated)).toBe(false)
      expect(locationChange(draft, unlocated)).toEqual({ address: 'Calle 10 # 5-20, Bogotá' })
    })

    it('borrar la dirección la quita, sin intentar ubicar la anterior', () => {
      const draft = { ...draftFromSaved(unlocated), address: '' }
      expect(locationChange(draft, unlocated)).toEqual({ address: null })
    })

    it('una dirección ya ubicada y sin tocar sigue sin enviarse', () => {
      expect(locationChange(draftFromSaved(saved), saved)).toEqual({})
      expect(sameLocation(draftFromSaved(saved), saved)).toBe(true)
    })
  })
})
