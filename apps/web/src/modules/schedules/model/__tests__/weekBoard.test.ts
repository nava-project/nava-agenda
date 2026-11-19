import { describe, expect, it } from 'vitest'
import {
  civilDateTile,
  computeScale,
  civilClockLabel,
  clockLabel,
  clockRangeLabel,
  durationBetween,
  formatHours,
  hourLabel,
  minutesToTime,
  nowInTimezone,
  scaleTicks,
  segmentGeometry,
  timeRangeLabel,
  timeToMinutes,
} from '../weekBoard'

describe('weekBoard', () => {
  it('convierte entre HH:MM y minutos del día', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(1500)).toBe('01:00')
  })

  it('mantiene la regla de 07 a 21 h salvo que un tramo se salga', () => {
    expect(computeScale([])).toEqual({ startMinute: 420, endMinute: 1260 })
    expect(computeScale([{ startsTime: '09:00', durationMinutes: 480 }])).toEqual({
      startMinute: 420,
      endMinute: 1260,
    })
    expect(computeScale([{ startsTime: '05:30', durationMinutes: 60 }]).startMinute).toBe(300)
    expect(computeScale([{ startsTime: '18:00', durationMinutes: 300 }]).endMinute).toBe(1380)
  })

  it('recorta un tramo nocturno al fin del día y lo marca', () => {
    const scale = computeScale([{ startsTime: '20:00', durationMinutes: 480 }])
    expect(scale.endMinute).toBe(1440)
    const geometry = segmentGeometry('20:00', 480, scale)
    expect(geometry.crossesMidnight).toBe(true)
    expect(geometry.from + geometry.span).toBeCloseTo(100)
    expect(clockRangeLabel('20:00', 480)).toBe('8:00 p. m. – 4:00 a. m. (+1)')
  })

  it('dice las horas en 12 h, como la agenda', () => {
    expect(clockLabel(0)).toBe('12:00 a. m.')
    expect(clockLabel(480)).toBe('8:00 a. m.')
    expect(clockLabel(750)).toBe('12:30 p. m.')
    expect(clockLabel(1200)).toBe('8:00 p. m.')
    expect(hourLabel(420)).toBe('7 a. m.')
    expect(hourLabel(720)).toBe('12 p. m.')
    expect(hourLabel(1440)).toBe('12 a. m.')
    expect(hourLabel(330)).toBe('5:30 a. m.')
    expect(clockRangeLabel('08:00', 720)).toBe('8:00 a. m. – 8:00 p. m.')
  })

  it('calcula la duración entre dos horas, cruzando la medianoche si hace falta', () => {
    expect(durationBetween('13:00', '14:00')).toBe(60)
    expect(durationBetween('12:00', '12:45')).toBe(45)
    expect(durationBetween('22:00', '01:00')).toBe(180)
    expect(durationBetween('00:00', '00:00')).toBe(1440)
  })

  it('ignora una hora a medio escribir al calcular la regla', () => {
    expect(computeScale([{ startsTime: '', durationMinutes: 60 }])).toEqual({
      startMinute: 420,
      endMinute: 1260,
    })
  })

  it('posiciona un tramo como porcentaje de la regla', () => {
    const scale = { startMinute: 420, endMinute: 1260 }
    const geometry = segmentGeometry('09:00', 240, scale)
    expect(geometry.from).toBeCloseTo((120 / 840) * 100)
    expect(geometry.span).toBeCloseTo((240 / 840) * 100)
    expect(geometry.crossesMidnight).toBe(false)
  })

  it('rotula la regla cada dos horas en una jornada normal', () => {
    const ticks = scaleTicks({ startMinute: 420, endMinute: 1260 })
    expect(ticks.map((t) => t.label)).toEqual([
      '7 a. m.',
      '9 a. m.',
      '11 a. m.',
      '1 p. m.',
      '3 p. m.',
      '5 p. m.',
      '7 p. m.',
      '9 p. m.',
    ])
    expect(ticks[0]!.percent).toBe(0)
    expect(ticks.at(-1)!.percent).toBe(100)
  })

  it('formatea horas legibles', () => {
    expect(formatHours(480)).toBe('8 h')
    expect(formatHours(450)).toBe('7 h 30 min')
    expect(formatHours(45)).toBe('45 min')
  })

  it('lee el día y la hora en la zona del negocio, no en la del dispositivo', () => {
    // 2026-10-05 03:30 UTC es domingo 4 a las 22:30 en Bogotá (UTC-5).
    const now = nowInTimezone('America/Bogota', new Date('2026-10-05T03:30:00Z'))
    expect(now).toEqual({ isoWeekday: 7, minute: 22 * 60 + 30 })
  })

  it('parte una fecha civil en día y mes abreviado sin tocar la zona del dispositivo', () => {
    expect(civilDateTile('2026-12-08')).toEqual({ day: '08', month: 'DIC' })
    expect(civilDateTile('2027-01-01')).toEqual({ day: '01', month: 'ENE' })
    expect(civilDateTile('')).toEqual({ day: '', month: '' })
  })

  it('ignora una duración inválida al calcular la regla', () => {
    expect(computeScale([{ startsTime: '09:00', durationMinutes: Number.NaN }])).toEqual({
      startMinute: 420,
      endMinute: 1260,
    })
  })

  it('describe un bloque como rango de horas y no como minutos', () => {
    expect(timeRangeLabel('13:00', 60)).toBe('1:00 p. m. – 2:00 p. m.')
    expect(timeRangeLabel('15:00', 120)).toBe('3:00 p. m. – 5:00 p. m.')
    expect(timeRangeLabel('23:00', 60)).toBe('11:00 p. m. – 12:00 a. m.')
    expect(timeRangeLabel('22:00', 240)).toBe('10:00 p. m. – 2:00 a. m. (día siguiente)')
    expect(civilClockLabel('13:30')).toBe('1:30 p. m.')
    expect(civilClockLabel('')).toBe('')
    expect(timeRangeLabel('00:00', 1440)).toBe('Todo el día')
  })
})
