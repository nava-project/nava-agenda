/**
 * Vocabulario del negocio (DEC-110, DEC-183): los valores iniciales hablan de
 * "negocio" y "profesional"; un negocio que guardó sus palabras conserva cada
 * frase idéntica; con otros términos, concuerda en género y número.
 */
import { describe, expect, it } from 'vitest'
import {
  buildVocabulary,
  capitalize,
  DEFAULT_BRAND,
  normalizeTerm,
  validateTerm,
  type BrandSettings,
} from '../vocabulary'

// Lo que un negocio guardó antes de DEC-183: sus frases no cambian.
const business: BrandSettings = {
  ...DEFAULT_BRAND,
  businessTerm: 'barbería',
  businessTermGender: 'feminine',
  professionalTerm: 'barbero',
  professionalTermPlural: 'barberos',
  professionalTermGender: 'masculine',
}

const stylist: BrandSettings = {
  ...DEFAULT_BRAND,
  businessTerm: 'salón de belleza',
  businessTermGender: 'masculine',
  professionalTerm: 'estilista',
  professionalTermPlural: 'estilistas',
  professionalTermGender: 'feminine',
}

describe('buildVocabulary con los valores iniciales', () => {
  const v = buildVocabulary(DEFAULT_BRAND)

  it('speaks of the business and the professional in generic words (DEC-183)', () => {
    expect(v.Professionals).toBe('Profesionales')
    expect(v.Professional).toBe('Profesional')
    expect(`Agregar ${v.professional}`).toBe('Agregar profesional')
    expect(`Aún no tienes ${v.professionalsRegistered}.`).toBe(
      'Aún no tienes profesionales registrados.',
    )
    expect(`Selecciona ${v.aProfessional}`).toBe('Selecciona un profesional')
    expect(`Elige ${v.toTheProfessional} y el servicio.`).toBe(
      'Elige al profesional y el servicio.',
    )
    expect(`No pudimos cargar la agenda ${v.ofThisProfessional}`).toBe(
      'No pudimos cargar la agenda de este profesional',
    )
    expect(`Servicios ${v.ofTheBusiness}`).toBe('Servicios del negocio')
    expect(`Elige ${v.anotherProfessional} ${v.professional} en la lista.`).toBe(
      'Elige otro profesional en la lista.',
    )
    expect(`es ${v.theOnlyProfessional} asignad${v.professionalEnding}`).toBe(
      'es el único profesional asignado',
    )
    expect(`${v.ThisProfessional} ya no está disponible`).toBe(
      'Este profesional ya no está disponible',
    )
    expect(`Cancelado ${v.byTheProfessional}`).toBe('Cancelado por el profesional')
    expect(`${v.ThisBusiness} todavía no tiene servicios`).toBe(
      'Este negocio todavía no tiene servicios',
    )
    expect(`contacta ${v.toTheBusiness}`).toBe('contacta al negocio')
    expect(`Para ${v.allTheBusiness}`).toBe('Para todo el negocio')
    expect(`pertenecer a ${v.anotherBusiness}`).toBe('pertenecer a otro negocio')
    expect(`guardad${v.businessEnding}`).toBe('guardado')
  })
})

describe('buildVocabulary con el vocabulario de un negocio', () => {
  const v = buildVocabulary(business)

  it('reproduces, word for word, the phrases the interface had before DEC-110', () => {
    expect(v.Professionals).toBe('Barberos')
    expect(v.Professional).toBe('Barbero')
    expect(`Agregar ${v.professional}`).toBe('Agregar barbero')
    expect(`Aún no tienes ${v.professionalsRegistered}.`).toBe(
      'Aún no tienes barberos registrados.',
    )
    expect(`Selecciona ${v.aProfessional}`).toBe('Selecciona un barbero')
    expect(`Elige ${v.toTheProfessional} y el servicio.`).toBe('Elige al barbero y el servicio.')
    expect(`${capitalize(v.thisProfessional)} ya no está disponible`).toBe(
      'Este barbero ya no está disponible',
    )
    expect(`No pudimos cargar la agenda ${v.ofThisProfessional}`).toBe(
      'No pudimos cargar la agenda de este barbero',
    )
    expect(`Servicios ${v.ofTheBusiness}`).toBe('Servicios de la barbería')
    expect(`Elige ${v.anotherProfessional} ${v.professional} en la lista.`).toBe(
      'Elige otro barbero en la lista.',
    )
    expect(`Agrega ${v.oneProfessional} en la sección`).toBe('Agrega uno en la sección')
    expect(`es ${v.theOnlyProfessional} asignad${v.professionalEnding}`).toBe(
      'es el único barbero asignado',
    )
    expect(`${v.Professional} agregad${v.professionalEnding}`).toBe('Barbero agregado')
    expect(`${v.ThisProfessional} ya no está disponible`).toBe('Este barbero ya no está disponible')
    expect(`${v.TheProfessional} o el servicio elegidos`).toBe('El barbero o el servicio elegidos')
    expect(`Cancelado ${v.byTheProfessional}`).toBe('Cancelado por el barbero')
    expect(`${v.ThisBusiness} todavía no tiene servicios`).toBe(
      'Esta barbería todavía no tiene servicios',
    )
    expect(`contacta ${v.toTheBusiness}`).toBe('contacta a la barbería')
    expect(`Para ${v.allTheBusiness}`).toBe('Para toda la barbería')
    expect(`pertenecer a ${v.anotherBusiness}`).toBe('pertenecer a otra barbería')
  })
})

describe('buildVocabulary con un vocabulario propio', () => {
  const v = buildVocabulary(stylist)

  it('agrees the articles with the grammatical gender of the professional', () => {
    expect(v.aProfessional).toBe('una estilista')
    expect(v.theProfessional).toBe('la estilista')
    expect(v.theProfessionals).toBe('las estilistas')
    expect(v.thisProfessional).toBe('esta estilista')
    expect(v.ofThisProfessional).toBe('de esta estilista')
    expect(v.toTheProfessional).toBe('a la estilista')
    expect(v.ofTheProfessional).toBe('de la estilista')
    expect(v.anotherProfessional).toBe('otra')
    expect(v.oneProfessional).toBe('una')
    expect(v.theOnlyProfessional).toBe('la única estilista')
    expect(v.ThisProfessional).toBe('Esta estilista')
    expect(v.TheProfessional).toBe('La estilista')
    expect(v.byTheProfessional).toBe('por la estilista')
  })

  it('agrees participles and adjectives', () => {
    expect(v.professionalsRegistered).toBe('estilistas registradas')
    expect(`${v.Professional} agregad${v.professionalEnding}`).toBe('Estilista agregada')
  })

  it('uses the contractions del / al for a masculine word', () => {
    expect(v.ofTheBusiness).toBe('del salón de belleza')
    expect(v.theBusiness).toBe('el salón de belleza')
    expect(v.thisBusiness).toBe('este salón de belleza')
    expect(v.businessEnding).toBe('o')
    expect(v.toTheBusiness).toBe('al salón de belleza')
    expect(v.allTheBusiness).toBe('todo el salón de belleza')
    expect(v.anotherBusiness).toBe('otro salón de belleza')
    expect(
      buildVocabulary({ ...stylist, professionalTermGender: 'masculine' }).toTheProfessional,
    ).toBe('al estilista')
  })

  it('capitalizes the first letter only, with the Spanish locale', () => {
    expect(v.Business).toBe('Salón de belleza')
    expect(capitalize('ñandú')).toBe('Ñandú')
    expect(capitalize('')).toBe('')
  })
})

describe('normalizeTerm', () => {
  it('trims, collapses inner spaces and lowercases, exactly like the server', () => {
    expect(normalizeTerm('  Salón   de \t Belleza ')).toBe('salón de belleza')
    expect(normalizeTerm('ESTILISTA')).toBe('estilista')
    expect(normalizeTerm('   ')).toBe('')
  })
})

describe('validateTerm', () => {
  it.each(['barbería', 'salón de belleza', "o'brien", 'centro de estética-spa', 'ñandú', 'Spa'])(
    'accepts %s',
    (term) => expect(validateTerm(term)).toBeUndefined(),
  )

  it.each([
    ['', 'Escribe una palabra.'],
    ['   ', 'Escribe una palabra.'],
    ['s', 'Usa al menos 2 letras.'],
    ['a'.repeat(31), 'Usa como máximo 30 caracteres.'],
    ['salón 24', 'Usa solo letras, espacios, guion o apóstrofo.'],
    ['<b>salón</b>', 'Usa solo letras, espacios, guion o apóstrofo.'],
    ['-salón', 'Usa solo letras, espacios, guion o apóstrofo.'],
    ['salón!', 'Usa solo letras, espacios, guion o apóstrofo.'],
  ])('rejects %j with a clear reason', (term, message) => {
    expect(validateTerm(term)).toBe(message)
  })

  it('measures the length in characters, not bytes', () => {
    expect(validateTerm('ñ'.repeat(30))).toBeUndefined()
    expect(validateTerm('ñ'.repeat(31))).toBe('Usa como máximo 30 caracteres.')
  })
})
