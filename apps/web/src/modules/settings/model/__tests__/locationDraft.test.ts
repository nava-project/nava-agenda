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

  it('el borrador de un negocio sin dirección empieza con el campo vacío', () => {
    expect(draftFromSaved(DEFAULT_LOCATION)).toEqual({
      hasPhysicalLocation: true,
      address: '',
      offersHomeService: false,
      pin: null,
    })
  })

  it('una dirección sin cambios reales (solo espacios) no cuenta como cambio', () => {
    const draft = {
      hasPhysicalLocation: true,
      address: '  Calle 10   # 5-20, Bogotá ',
      offersHomeService: false,
      pin: null,
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
          pin: null,
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
          pin: null,
        },
        saved,
      ),
    ).toEqual({ address: 'Carrera 7 # 32-16' })
  })

  it('el interruptor de domicilio se envía solo si cambió (DEC-131)', () => {
    const base = { hasPhysicalLocation: true, address: 'Calle 10 # 5-20, Bogotá', pin: null }
    expect(locationChange({ ...base, offersHomeService: true }, saved)).toEqual({
      offersHomeService: true,
    })
    expect(sameLocation({ ...base, offersHomeService: true }, saved)).toBe(false)
    expect(locationChange({ ...base, offersHomeService: false, pin: null }, saved)).toEqual({})
  })

  it('una dirección vacía se envía como null para quitarla', () => {
    expect(
      locationChange(
        { hasPhysicalLocation: true, address: '  ', offersHomeService: false, pin: null },
        saved,
      ),
    ).toEqual({
      address: null,
    })
  })

  it('vaciar un campo que ya estaba sin dirección no es un cambio', () => {
    expect(
      locationChange(
        { hasPhysicalLocation: true, address: '', offersHomeService: false, pin: null },
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

  // DEC-170: el dueño ajusta a mano el punto del mapa; viaja con la dirección
  // escrita y el servidor lo guarda sin geocodificar.
  describe('punto ajustado a mano en el mapa', () => {
    const pin = { latitude: 4.553358, longitude: -75.656683 }

    it('un punto distinto del guardado es un cambio y viaja con la dirección', () => {
      const draft = { ...draftFromSaved(saved), pin }
      expect(sameLocation(draft, saved)).toBe(false)
      expect(locationChange(draft, saved)).toEqual({
        address: 'Calle 10 # 5-20, Bogotá',
        latitude: 4.553358,
        longitude: -75.656683,
      })
    })

    it('el mismo punto guardado (dentro de ~1 m) no es un cambio', () => {
      const draft = { ...draftFromSaved(saved), pin: { latitude: 4.598057, longitude: -74.07611 } }
      expect(sameLocation(draft, saved)).toBe(true)
      expect(locationChange(draft, saved)).toEqual({})
    })

    it('con el punto sin mover pero la dirección nueva, envía ambos y no geocodifica', () => {
      const draft = {
        ...draftFromSaved(saved),
        address: 'Calle 10 # 5-20, Local 3, Bogotá',
        pin: { latitude: 4.598056, longitude: -74.076111 },
      }
      expect(locationChange(draft, saved)).toEqual({
        address: 'Calle 10 # 5-20, Local 3, Bogotá',
        latitude: 4.598056,
        longitude: -74.076111,
      })
    })

    it('ubica a mano una dirección que nunca tuvo punto', () => {
      const unlocated: LocationSettings = { ...saved, latitude: null, longitude: null }
      const draft = { ...draftFromSaved(unlocated), pin }
      expect(locationChange(draft, unlocated)).toEqual({
        address: 'Calle 10 # 5-20, Bogotá',
        latitude: 4.553358,
        longitude: -75.656683,
      })
    })

    it('exige una dirección escrita para acompañar el punto', () => {
      expect(validateAddress('', pin)).toContain('dirección')
      expect(validateAddress('   ', pin)).toContain('dirección')
      expect(validateAddress('Calle 1', pin)).toBeUndefined()
      expect(validateAddress('')).toBeUndefined()
    })

    it('el borrador recién cargado no trae punto marcado', () => {
      expect(draftFromSaved(saved).pin).toBeNull()
    })
  })
})
