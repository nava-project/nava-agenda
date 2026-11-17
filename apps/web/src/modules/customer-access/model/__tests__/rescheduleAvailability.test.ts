// Pista local de la reprogramación (HU-104, DEC-178): misma regla que el servidor.
import { describe, expect, it } from 'vitest'
import {
  groupStartsByCivilDate,
  rescheduleAvailability,
  sameInstant,
} from '../rescheduleAvailability'

const STARTS_AT = '2027-03-15T15:00:00Z'
const deadlineMs = Date.parse(STARTS_AT) - 20 * 60_000

function appt(over: Partial<Parameters<typeof rescheduleAvailability>[0]> = {}) {
  return {
    status: 'confirmed' as const,
    startsAt: STARTS_AT,
    cancellationDeadlineMinutes: 20,
    rescheduleRemaining: 2,
    ...over,
  }
}

describe('rescheduleAvailability', () => {
  it('se ofrece hasta el límite inclusive y dice cuántos cambios quedan', () => {
    expect(rescheduleAvailability(appt(), deadlineMs)).toEqual({
      mode: 'available',
      remaining: 2,
      deadlineMs,
    })
  })

  it('un milisegundo después del límite ya está cerrado', () => {
    expect(rescheduleAvailability(appt(), deadlineMs + 1)).toEqual({
      mode: 'unavailable',
      reason: 'window-closed',
    })
  })

  it('con plazo 0 nunca se ofrece: no hay reprogramación tardía', () => {
    expect(
      rescheduleAvailability(appt({ cancellationDeadlineMinutes: 0 }), deadlineMs - 3_600_000),
    ).toEqual({ mode: 'unavailable', reason: 'window-closed' })
  })

  it('sin cambios restantes no se ofrece', () => {
    expect(rescheduleAvailability(appt({ rescheduleRemaining: 0 }), 0)).toEqual({
      mode: 'unavailable',
      reason: 'limit-reached',
    })
  })

  it('el estado manda sobre el plazo y el límite', () => {
    expect(
      rescheduleAvailability(appt({ status: 'completed', rescheduleRemaining: 0 }), deadlineMs + 1),
    ).toEqual({ mode: 'unavailable', reason: 'not-confirmed' })
  })

  it('el plazo manda sobre el límite (mismo orden que el servidor)', () => {
    expect(rescheduleAvailability(appt({ rescheduleRemaining: 0 }), deadlineMs + 1)).toEqual({
      mode: 'unavailable',
      reason: 'window-closed',
    })
  })
})

describe('groupStartsByCivilDate', () => {
  it('agrupa por el día civil de la barbería, no del dispositivo', () => {
    // 04:30Z del 16 sigue siendo el 15 en Bogotá (UTC-5).
    const days = groupStartsByCivilDate(
      ['2027-03-15T22:00:00Z', '2027-03-16T04:30:00Z', '2027-03-16T14:00:00Z'],
      'America/Bogota',
    )
    expect(days).toEqual([
      { civilDate: '2027-03-15', starts: ['2027-03-15T22:00:00Z', '2027-03-16T04:30:00Z'] },
      { civilDate: '2027-03-16', starts: ['2027-03-16T14:00:00Z'] },
    ])
  })

  it('sin inicios no hay días', () => {
    expect(groupStartsByCivilDate([], 'America/Bogota')).toEqual([])
  })
})

describe('sameInstant', () => {
  it('compara el instante, no el texto', () => {
    expect(sameInstant('2027-03-15T15:00:00Z', '2027-03-15T15:00:00.000Z')).toBe(true)
    expect(sameInstant('2027-03-15T15:00:00Z', '2027-03-15T10:00:00-05:00')).toBe(true)
    expect(sameInstant('2027-03-15T15:00:00Z', '2027-03-15T15:30:00Z')).toBe(false)
  })
})
