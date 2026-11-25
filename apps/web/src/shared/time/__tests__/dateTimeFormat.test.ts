import { describe, expect, it } from 'vitest'
import { dateTimeFormat } from '../dateTimeFormat'

describe('dateTimeFormat (#836)', () => {
  it('reuses one formatter per locale and options, and gives the same result as a new one', () => {
    const options = {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    } as const
    const a = dateTimeFormat('en-GB', options)
    expect(dateTimeFormat('en-GB', { ...options })).toBe(a)
    const at = new Date(Date.UTC(2026, 10, 19, 15, 7))
    expect(a.format(at)).toBe(new Intl.DateTimeFormat('en-GB', options).format(at))
  })

  it('keeps zones and locales apart', () => {
    const at = new Date(Date.UTC(2026, 10, 19, 3, 0))
    const day = (timeZone: string) =>
      dateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(at)
    expect(day('America/Bogota')).toBe('2026-11-18')
    expect(day('Asia/Tokyo')).toBe('2026-11-19')
    expect(dateTimeFormat('es-CO', { timeZone: 'UTC' })).not.toBe(
      dateTimeFormat('en-CA', { timeZone: 'UTC' }),
    )
  })

  it('still throws on an invalid zone, without caching it', () => {
    expect(() => dateTimeFormat('en-CA', { timeZone: 'No/Existe' })).toThrow(RangeError)
    expect(() => dateTimeFormat('en-CA', { timeZone: 'No/Existe' })).toThrow(RangeError)
  })
})
