import { describe, it, expect } from 'vitest'
import { ticketMoment } from '../ticketMoment'

const TZ = 'America/Bogota'

describe('ticketMoment', () => {
  it('reads the leaf and the time in the business timezone', () => {
    // 16:00Z es 11:00 a. m. en Bogotá.
    const m = ticketMoment('2026-11-26T16:00:00Z', '2026-11-26T16:45:00Z', TZ)
    expect(m.weekday).toBe('Jueves')
    expect(m.month).toBe('NOV')
    expect(m.day).toBe('26')
    expect(m.time.replace(/\s/g, ' ')).toBe('11:00 a. m.')
    expect(m.at).toBe(11 * 60)
  })

  it('uses the published hours as the ruler window', () => {
    const m = ticketMoment('2026-11-26T16:00:00Z', '2026-11-26T16:45:00Z', TZ, [
      { start: 9 * 60, end: 12 * 60 },
      { start: 14 * 60, end: 18 * 60 + 30 },
    ])
    expect(m.from).toBe(9 * 60)
    expect(m.to).toBe(19 * 60)
  })

  it('falls back to a 7 a. m. to 7 p. m. day widened to hold the appointment', () => {
    // 01:00Z es 8:00 p. m. del día anterior en Bogotá.
    const m = ticketMoment('2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z', TZ)
    expect(m.from).toBe(7 * 60)
    expect(m.to).toBe(21 * 60)
  })
})
