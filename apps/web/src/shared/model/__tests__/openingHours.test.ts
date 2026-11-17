import { describe, expect, it } from 'vitest'
import {
  civilNow,
  clockToMinutes,
  formatClock,
  openingStatus,
  segmentsByDay,
  type OpeningToday,
} from '../openingHours'

const TZ = 'America/Bogota'
// 2026-11-17 (martes) a las HH:MM de Bogotá (UTC-5, sin horario de verano).
const at = (hh: number, mm = 0) => new Date(Date.UTC(2026, 10, 17, hh + 5, mm))

const TODAY: OpeningToday = {
  date: '2026-11-17',
  dayOfWeek: 'TUESDAY',
  holiday: null,
  hours: [
    { opens: '09:00', closes: '12:30' },
    { opens: '14:00', closes: '24:00' },
  ],
}

describe('openingHours', () => {
  it('lee y escribe horas', () => {
    expect(clockToMinutes('00:00')).toBe(0)
    expect(clockToMinutes('24:00')).toBe(1440)
    expect(clockToMinutes('24:01')).toBeNull()
    expect(clockToMinutes('9:00')).toBeNull()
    expect(formatClock('09:00')).toBe('9:00 a. m.')
    expect(formatClock('12:30')).toBe('12:30 p. m.')
    expect(formatClock('00:15')).toBe('12:15 a. m.')
    expect(formatClock('19:05')).toBe('7:05 p. m.')
    expect(formatClock('24:00')).toBe('medianoche')
  })

  it('agrupa por día y ordena por apertura', () => {
    const days = segmentsByDay([
      { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
      { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:00' },
    ])
    expect(days.MONDAY.map((i) => i.opens)).toEqual(['09:00', '14:00'])
    expect(days.SUNDAY).toEqual([])
  })

  it('la fecha y la hora salen de la zona del local, no del dispositivo', () => {
    expect(civilNow(TZ, new Date(Date.UTC(2026, 10, 18, 4, 30)))).toEqual({
      date: '2026-11-17',
      minutes: 23 * 60 + 30,
    })
  })

  it('dice si está abierto, abre más tarde o ya cerró', () => {
    expect(openingStatus(TODAY, TZ, at(8))).toEqual({ state: 'opens-later', opens: '09:00' })
    expect(openingStatus(TODAY, TZ, at(10))).toEqual({ state: 'open', closes: '12:30' })
    expect(openingStatus(TODAY, TZ, at(12, 30))).toEqual({ state: 'opens-later', opens: '14:00' })
    expect(openingStatus(TODAY, TZ, at(18))).toEqual({ state: 'open', closes: '24:00' })
    expect(
      openingStatus({ ...TODAY, hours: [{ opens: '09:00', closes: '12:00' }] }, TZ, at(15)),
    ).toEqual({
      state: 'closed-now',
    })
    expect(openingStatus({ ...TODAY, hours: [] }, TZ, at(10))).toEqual({ state: 'closed-today' })
  })

  it('no afirma nada si el perfil es de otro día', () => {
    expect(openingStatus(TODAY, TZ, new Date(Date.UTC(2026, 10, 18, 15)))).toBeNull()
  })
})
