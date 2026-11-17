import { describe, expect, it } from 'vitest'
import {
  copyDay,
  draftFromSettings,
  newInterval,
  settingsFromDraft,
  validateDraft,
} from '../openingHoursDraft'

const base = () =>
  draftFromSettings({
    openingHours: [
      { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
      { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:00' },
      { dayOfWeek: 'FRIDAY', opens: '20:00', closes: '24:00' },
      { dayOfWeek: 'SATURDAY', opens: '00:00', closes: '02:00' },
    ],
    closedOnHolidays: true,
  })

describe('openingHoursDraft', () => {
  it('ida y vuelta: ordena por apertura y 24:00 se edita como 00:00', () => {
    const draft = base()
    expect(draft.days.map((d) => d.open)).toEqual([true, false, false, false, true, true, false])
    expect(draft.days[0].intervals.map((i) => i.opens)).toEqual(['09:00', '14:00'])
    expect(draft.days[4].intervals[0].closes).toBe('00:00')
    expect(settingsFromDraft(draft)).toEqual({
      openingHours: [
        { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:00' },
        { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
        { dayOfWeek: 'FRIDAY', opens: '20:00', closes: '24:00' },
        { dayOfWeek: 'SATURDAY', opens: '00:00', closes: '02:00' },
      ],
      closedOnHolidays: true,
    })
  })

  it('un día cerrado no se envía aunque conserve horarios escritos', () => {
    const draft = base()
    draft.days[0].open = false
    expect(settingsFromDraft(draft).openingHours.some((s) => s.dayOfWeek === 'MONDAY')).toBe(false)
  })

  it('valida lo mismo que el servidor, día por día', () => {
    const draft = base()
    expect(validateDraft(draft)).toEqual({})

    draft.days[1].open = true // martes abierto sin horarios
    draft.days[2].open = true
    draft.days[2].intervals = [newInterval('19:00', '09:00')]
    draft.days[3].open = true
    draft.days[3].intervals = [newInterval('09:00', '13:00'), newInterval('12:00', '18:00')]
    draft.days[6].open = true
    draft.days[6].intervals = [
      newInterval('06:00', '07:00'),
      newInterval('08:00', '09:00'),
      newInterval('10:00', '11:00'),
      newInterval('12:00', '13:00'),
      newInterval('14:00', '15:00'),
    ]
    const errors = validateDraft(draft)
    expect(errors.TUESDAY).toContain('Añade al menos un horario')
    expect(errors.WEDNESDAY).toBe('La hora de cierre debe ser después de la de apertura.')
    expect(errors.THURSDAY).toBe('Dos horarios del mismo día se cruzan.')
    expect(errors.SUNDAY).toContain('como máximo 4')
    expect(errors.MONDAY).toBeUndefined()
  })

  it('dos horarios contiguos no se cruzan y abrir a las 00:00 hasta las 00:00 es el día entero', () => {
    const draft = base()
    draft.days[1].open = true
    draft.days[1].intervals = [newInterval('09:00', '12:00'), newInterval('12:00', '18:00')]
    draft.days[2].open = true
    draft.days[2].intervals = [newInterval('00:00', '00:00')]
    expect(validateDraft(draft)).toEqual({})
  })

  it('copiar un día reemplaza los destinos con copias independientes', () => {
    const draft = base()
    copyDay(draft, 'MONDAY', ['TUESDAY', 'SATURDAY'])
    expect(draft.days[1].intervals.map((i) => `${i.opens}-${i.closes}`)).toEqual([
      '09:00-12:00',
      '14:00-19:00',
    ])
    expect(draft.days[5].intervals).toHaveLength(2)
    draft.days[1].intervals[0].opens = '10:00'
    expect(draft.days[0].intervals[0].opens).toBe('09:00')
  })
})
