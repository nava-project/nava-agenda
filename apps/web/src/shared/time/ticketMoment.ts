// Lo que la tarjeta de turno (AppointmentTicket, DEC-189) pinta de un turno:
// la hoja de calendario, la hora y la ventana de la regla del día. Todo en la
// zona del negocio, nunca en la del dispositivo (RN-DIS-07, CA-098-04).
import { getCivilDateInTimezone, minutesSinceCivilMidnight } from './civilDate'
import { formatTimeInTimezone } from './formatInstant'
import { formatClock } from '@/shared/model/openingHours'

export interface TicketMoment {
  /** «Jueves». */
  weekday: string
  /** «NOV». */
  month: string
  /** «26». */
  day: string
  /** «11:00 a. m.». */
  time: string
  /** «11:45 a. m.». */
  endTime: string
  /** Inicio del turno, en minutos desde la medianoche civil. */
  at: number
  /** Ventana de la regla, en minutos desde la medianoche civil. */
  from: number
  to: number
}

export interface OpenInterval {
  start: number
  end: number
}

// Sin horario publicado, la regla muestra el día de 7 a. m. a 7 p. m.: no se
// inventa un horario, solo se da contexto. En los dos casos la ventana se
// ensancha hasta contener el turno, en horas enteras.
const DEFAULT_WINDOW: OpenInterval = { start: 7 * 60, end: 19 * 60 }

function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase('es-CO') + text.slice(1) : text
}

export function ticketMoment(
  startsAt: string,
  endsAt: string,
  timezone: string,
  open: OpenInterval[] | null = null,
): TicketMoment {
  const civilDate = getCivilDateInTimezone(timezone, new Date(startsAt))
  const at = minutesSinceCivilMidnight(startsAt, civilDate, timezone)
  const end = minutesSinceCivilMidnight(endsAt, civilDate, timezone)
  const hours = open && open.length > 0 ? open : [DEFAULT_WINDOW]
  const from = Math.floor(Math.min(at, ...hours.map((h) => h.start)) / 60) * 60
  const to = Math.ceil(Math.max(end, ...hours.map((h) => h.end)) / 60) * 60

  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(startsAt))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''

  return {
    weekday: capitalize(part('weekday')),
    month: part('month').replace('.', '').toLocaleUpperCase('es-CO'),
    day: part('day'),
    time: formatTimeInTimezone(startsAt, timezone),
    endTime: formatTimeInTimezone(endsAt, timezone),
    at,
    from: Math.max(0, from),
    to: Math.min(24 * 60, Math.max(to, from + 60)),
  }
}

/**
 * El mismo momento para un turno que aún no existe: el borrador de «Nuevo
 * turno» (#833) tiene una fecha y una hora civiles en la zona del negocio, no
 * un instante. La ventana de la regla se calcula igual que en `ticketMoment`
 * (7 a. m. a 7 p. m., ensanchada en horas enteras hasta contener el turno).
 */
export function civilTicketMoment(
  civilDate: string,
  clock: string,
  durationMinutes: number,
): TicketMoment | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate)
  const time = /^(\d{2}):(\d{2})/.exec(clock)
  if (!date || !time || !(durationMinutes > 0)) return null
  const at = Number(time[1]) * 60 + Number(time[2])
  const end = at + durationMinutes
  const from = Math.floor(Math.min(at, DEFAULT_WINDOW.start) / 60) * 60
  const to = Math.ceil(Math.max(end, DEFAULT_WINDOW.end) / 60) * 60
  const noon = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), 12))
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).formatToParts(noon)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const endClock = `${pad(Math.floor((end % 1440) / 60))}:${pad(end % 60)}`
  return {
    weekday: capitalize(part('weekday')),
    month: part('month').replace('.', '').toLocaleUpperCase('es-CO'),
    day: part('day'),
    time: formatClock(`${time[1]}:${time[2]}`),
    endTime: formatClock(endClock),
    at,
    from: Math.max(0, from),
    to: Math.min(24 * 60, Math.max(to, from + 60)),
  }
}
