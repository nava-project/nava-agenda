// «La luz del día» (DEC-188): agrupación por día civil y parte del día en la
// zona del NEGOCIO (RN-DIS-07), filtro por profesional, unión sin duplicados
// para «Cualquiera» y luz libre relativa al día más libre.
import { describe, expect, it } from 'vitest'
import { buildDaylightDays, partOfDay, professionalForSlot, withoutMeridiem } from '../daylight'

const TZ = 'America/Bogota'
const A = 'pro-a'
const B = 'pro-b'
const slot = (professionalId: string, startsAt: string) => ({ professionalId, startsAt })

const slots = [
  slot(A, '2026-11-20T09:00:00-05:00'),
  slot(B, '2026-11-20T09:00:00-05:00'),
  slot(A, '2026-11-20T14:00:00-05:00'),
  slot(B, '2026-11-20T18:30:00-05:00'),
  slot(A, '2026-11-21T10:00:00-05:00'),
]

describe('partOfDay', () => {
  it('splits the day at noon and at six in the evening', () => {
    expect(partOfDay(0)).toBe('morning')
    expect(partOfDay(11 * 60 + 59)).toBe('morning')
    expect(partOfDay(12 * 60)).toBe('afternoon')
    expect(partOfDay(17 * 60 + 59)).toBe('afternoon')
    expect(partOfDay(18 * 60)).toBe('night')
  })
})

describe('buildDaylightDays', () => {
  it('with «Cualquiera» joins every professional, once per start, keeping who offers it', () => {
    const days = buildDaylightDays(slots, TZ, null)
    expect(days.map((d) => d.civilDate)).toEqual(['2026-11-20', '2026-11-21'])
    const first = days[0]!
    expect(first.slots).toHaveLength(3)
    expect(first.slots[0]!.professionalIds).toEqual([A, B])
    expect(first.groups.map((g) => g.label)).toEqual(['Mañana', 'Tarde', 'Noche'])
  })

  it('filters by the chosen professional', () => {
    const days = buildDaylightDays(slots, TZ, B)
    expect(days).toHaveLength(1)
    expect(days[0]!.slots.map((s) => s.professionalIds)).toEqual([[B], [B]])
    expect(days[0]!.groups.map((g) => g.part)).toEqual(['morning', 'night'])
  })

  it('groups by the business hour, never the device zone', () => {
    // 23:30 UTC del 20 son las 6:30 p. m. del 20 en Bogotá: noche del 20.
    const [day] = buildDaylightDays([slot(A, '2026-11-20T23:30:00Z')], TZ, null)
    expect(day!.civilDate).toBe('2026-11-20')
    expect(day!.slots[0]!.part).toBe('night')
  })

  it('labels every hour fully for assistive technology and briefly inside its group', () => {
    const [day] = buildDaylightDays([slot(A, '2026-11-20T14:00:00-05:00')], TZ, null)
    const hour = day!.slots[0]!
    expect(hour.label).toMatch(/^2:00\s?p\.\s?m\.$/)
    expect(hour.shortLabel).toBe('2:00')
    expect(hour.spokenLabel).toMatch(/^2:00\s?p\.\s?m\., tarde$/)
  })

  it('measures the free light of each day against the freest day, from real data only', () => {
    const days = buildDaylightDays(slots, TZ, null)
    expect(days.map((d) => d.freeRatio)).toEqual([1, 1 / 3])
    expect(buildDaylightDays([], TZ, null)).toEqual([])
  })
})

describe('helpers', () => {
  it('strips the meridiem, whatever spaces Intl uses', () => {
    expect(withoutMeridiem('9:15 a. m.')).toBe('9:15')
    expect(withoutMeridiem('9:15 p. m.')).toBe('9:15')
  })

  it('assigns «Cualquiera» to the first professional the server lists for that start', () => {
    const [day] = buildDaylightDays(slots, TZ, null)
    expect(professionalForSlot(day!.slots[0]!)).toBe(A)
  })
})
