// «Añadir a mi calendario» (DEC-188): un archivo .ics generado en el
// navegador con lo que la confirmación ya trae. No sale nada nuevo hacia
// ningún servidor y no lleva la credencial de acceso al turno (DEC-089): el
// enlace para consultarlo llega por correo.

export interface CalendarEvent {
  /** Identificador estable del evento (el mismo turno no se duplica). */
  uid: string
  startsAt: string
  endsAt: string
  summary: string
  location?: string | null
  description?: string | null
}

/** «20261120T134500Z»: instante en UTC, como pide RFC 5545. */
function utc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** Escapa un texto según RFC 5545 §3.3.11. */
function text(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Pliega una línea a 75 octetos (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder()
  const out: string[] = []
  let current = ''
  for (const char of line) {
    const limit = out.length === 0 ? 75 : 74
    if (bytes.encode(current + char).length > limit) {
      out.push(current)
      current = char
    } else current += char
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildCalendarFile(event: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nava//Agenda//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utc(now.toISOString())}`,
    `DTSTART:${utc(event.startsAt)}`,
    `DTEND:${utc(event.endsAt)}`,
    `SUMMARY:${text(event.summary)}`,
    ...(event.location ? [`LOCATION:${text(event.location)}`] : []),
    ...(event.description ? [`DESCRIPTION:${text(event.description)}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(event.summary)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Descarga el archivo en el navegador, sin pasar por ningún servidor. */
export function downloadCalendarFile(content: string, fileName = 'turno.ics'): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // El navegador ya tomó el archivo; liberar la URL en el mismo turno puede
  // cancelar la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Enlace de WhatsApp al número del negocio (E.164), con un saludo que cita el
 * turno. Sin número (o sin dígitos suficientes) no hay enlace.
 */
export function whatsAppLink(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

/** Enlace «Cómo llegar» a las coordenadas que el negocio publicó (DEC-138). Se abre
 * en la app de mapas del teléfono o en Google Maps en el navegador. */
export function directionsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}
