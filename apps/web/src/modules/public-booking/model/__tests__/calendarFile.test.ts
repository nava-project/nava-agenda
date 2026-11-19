// El .ics de «Añadir a mi calendario» (DEC-188): RFC 5545 válido, en UTC,
// escapado y plegado, sin la credencial del turno; y el enlace de WhatsApp.
import { describe, expect, it } from 'vitest'
import { buildCalendarFile, whatsAppLink } from '../calendarFile'

const event = {
  uid: 'turno-123@agenda.nava.wtf',
  startsAt: '2030-01-14T09:00:00-05:00',
  endsAt: '2030-01-14T09:45:00-05:00',
  summary: 'Corte clásico, Barbería Ejemplo',
  location: 'Calle 10 # 5-20; Bogotá',
}

describe('buildCalendarFile', () => {
  const ics = buildCalendarFile(event, new Date('2030-01-01T12:00:00Z'))

  it('writes a single VEVENT in UTC with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART:20300114T140000Z\r\n')
    expect(ics).toContain('DTEND:20300114T144500Z\r\n')
    expect(ics).toContain('DTSTAMP:20300101T120000Z\r\n')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('escapes commas and semicolons in text values', () => {
    expect(ics).toContain('SUMMARY:Corte clásico\\, Barbería Ejemplo')
    expect(ics).toContain('LOCATION:Calle 10 # 5-20\; Bogotá')
  })

  it('folds lines longer than 75 octets', () => {
    const long = buildCalendarFile({ ...event, description: 'x'.repeat(200) })
    for (const line of long.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(long).toContain('\r\n x')
  })
})

describe('whatsAppLink', () => {
  it('links to the business number with the greeting', () => {
    expect(whatsAppLink('+57 300 123 4567', 'Hola, reservé')).toBe(
      'https://wa.me/573001234567?text=Hola%2C%20reserv%C3%A9',
    )
  })

  it('offers nothing without a number', () => {
    expect(whatsAppLink(null, 'Hola')).toBeNull()
    expect(whatsAppLink('123', 'Hola')).toBeNull()
  })
})
