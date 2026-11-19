// Lectura temporal del turno para el boleto de «Mi turno» (issue #573): hoja de
// calendario, franja de horas, cuenta regresiva y progreso. Es solo presentación
// derivada de `startsAt`/`endsAt`; no decide nada de la política (eso es
// `cancellationAvailability` y, en última instancia, el servidor). Toda fecha se
// expresa en la zona del negocio, nunca en la del dispositivo (CA-098-04).

export type AppointmentPhase = 'upcoming' | 'in-progress' | 'ended'

export interface CalendarLeaf {
  /** Mes abreviado sin punto: «nov». */
  month: string
  /** Día del mes: «13». */
  day: string
  /** Día de la semana completo: «viernes». */
  weekday: string
  /** Fecha larga sin el día de la semana: «13 de noviembre de 2026». */
  longDate: string
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? ''
}

export function calendarLeaf(isoInstant: string, timezone: string): CalendarLeaf {
  const date = new Date(isoInstant)
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).formatToParts(date)
  const longDate = new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
  return {
    month: part(parts, 'month').replace('.', ''),
    day: part(parts, 'day'),
    weekday: part(parts, 'weekday'),
    longDate,
  }
}

export function appointmentPhase(
  startsAt: string,
  endsAt: string,
  nowMs: number,
): AppointmentPhase {
  if (nowMs < Date.parse(startsAt)) return 'upcoming'
  if (nowMs < Date.parse(endsAt)) return 'in-progress'
  return 'ended'
}

/** Fracción transcurrida del turno, entre 0 y 1. */
export function appointmentProgress(startsAt: string, endsAt: string, nowMs: number): number {
  const start = Date.parse(startsAt)
  const span = Date.parse(endsAt) - start
  if (!(span > 0)) return nowMs >= start ? 1 : 0
  return Math.min(1, Math.max(0, (nowMs - start) / span))
}

// Día civil (YYYY-MM-DD) de un instante en la zona dada, como número de días
// desde la época: permite contar días de calendario sin depender de bloques de 24 h.
function civilDayNumber(ms: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms))
  const year = Number(part(parts, 'year'))
  const month = Number(part(parts, 'month'))
  const day = Number(part(parts, 'day'))
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
}

function hoursAndMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/**
 * Cuenta regresiva legible: «En 3 días», «Mañana», «Hoy · en 2 h 15 min»,
 * «En 12 min», «En curso · quedan 20 min» o «La hora ya pasó».
 */
export function countdownLabel(
  startsAt: string,
  endsAt: string,
  timezone: string,
  nowMs: number,
): string {
  const phase = appointmentPhase(startsAt, endsAt, nowMs)
  if (phase === 'in-progress') {
    const left = Math.max(1, Math.ceil((Date.parse(endsAt) - nowMs) / 60_000))
    return `En curso · quedan ${hoursAndMinutes(left)}`
  }
  if (phase === 'ended') return 'La hora del turno ya pasó'

  const startMs = Date.parse(startsAt)
  const days = civilDayNumber(startMs, timezone) - civilDayNumber(nowMs, timezone)
  if (days >= 2) return `En ${days} días`
  if (days === 1) return 'Mañana'
  const minutes = Math.max(1, Math.ceil((startMs - nowMs) / 60_000))
  return minutes < 60 ? `En ${minutes} min` : `Hoy · en ${hoursAndMinutes(minutes)}`
}
