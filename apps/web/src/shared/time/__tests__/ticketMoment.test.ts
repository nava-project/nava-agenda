import { describe, it, expect } from 'vitest'
import { civilTicketMoment, ticketMoment } from '../ticketMoment'

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

describe('civilTicketMoment (#833)', () => {
  it('reads the leaf and the time of a turn that does not exist yet, from its civil date and time', () => {
    const m = civilTicketMoment('2026-11-26', '11:00', 45)!
    expect(m.weekday).toBe('Jueves')
    expect(m.month).toBe('NOV')
    expect(m.day).toBe('26')
    expect(m.time.replace(/\s/g, ' ')).toBe('11:00 a. m.')
    expect(m.endTime.replace(/\s/g, ' ')).toBe('11:45 a. m.')
    expect([m.at, m.from, m.to]).toEqual([11 * 60, 7 * 60, 19 * 60])
  })

  it('widens the ruler in whole hours to contain the turn, as ticketMoment does', () => {
    const m = civilTicketMoment('2026-11-26', '18:30', 90)!
    expect([m.from, m.to]).toEqual([7 * 60, 20 * 60])
    const early = civilTicketMoment('2026-11-26', '06:15', 30)!
    expect([early.from, early.to]).toEqual([6 * 60, 19 * 60])
  })

  it('refuses what it cannot read instead of inventing a date', () => {
    expect(civilTicketMoment('', '11:00', 45)).toBeNull()
    expect(civilTicketMoment('2026-11-26', '', 45)).toBeNull()
    expect(civilTicketMoment('2026-11-26', '11:00', 0)).toBeNull()
  })
})
