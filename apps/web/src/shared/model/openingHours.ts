// Horario de atención del local (HU-107, DEC-182), compartido por Configuración
// (que lo edita) y la reserva pública (que lo muestra). Las horas viajan como
// `HH:MM` en la hora civil del negocio; `24:00` es «hasta medianoche». Nada
// aquí usa la zona del dispositivo: «ahora» se calcula siempre en la zona del
// local (RN-DIS-07).

export const DAYS_OF_WEEK = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Lunes',
  TUESDAY: 'Martes',
  WEDNESDAY: 'Miércoles',
  THURSDAY: 'Jueves',
  FRIDAY: 'Viernes',
  SATURDAY: 'Sábado',
  SUNDAY: 'Domingo',
}

export function isDayOfWeek(value: unknown): value is DayOfWeek {
  return typeof value === 'string' && (DAYS_OF_WEEK as readonly string[]).includes(value)
}

/** Tramo `[opens, closes)` de un día de la semana. */
export interface OpeningSegment {
  dayOfWeek: DayOfWeek
  opens: string
  closes: string
}

/** Tramo de hoy, sin el día. */
export interface OpeningInterval {
  opens: string
  closes: string
}

/** Lo que rige hoy en la fecha civil del local, con el festivo aplicado. */
export interface OpeningToday {
  date: string
  dayOfWeek: DayOfWeek
  holiday: string | null
  /** Vacío: hoy cierra. */
  hours: OpeningInterval[]
}

const CLOCK = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/

/** Minutos desde medianoche de `HH:MM` (`24:00` = 1440); `null` si no es una hora. */
export function clockToMinutes(clock: string): number | null {
  const match = CLOCK.exec(clock)
  if (!match) return null
  const hours = Number(match[1] ?? match[3])
  const minutes = Number(match[2] ?? match[4])
  return hours * 60 + minutes
}

/**
 * Hora para leer, en el estilo de 12 horas que ya usa la reserva («9:00 a. m.»,
 * «7:30 p. m.»). `24:00` se lee «medianoche» para que nadie dude de qué día es.
 */
export function formatClock(clock: string): string {
  const total = clockToMinutes(clock)
  if (total === null) return clock
  if (total === 24 * 60) return 'medianoche'
  const hours = Math.floor(total / 60)
  const minutes = String(total % 60).padStart(2, '0')
  const suffix = hours < 12 ? 'a. m.' : 'p. m.'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${minutes} ${suffix}`
}

export function formatInterval(interval: OpeningInterval): string {
  return `${formatClock(interval.opens)} – ${formatClock(interval.closes)}`
}

/** Tramos agrupados por día, en orden de semana y apertura. */
export function segmentsByDay(
  segments: readonly OpeningSegment[],
): Record<DayOfWeek, OpeningInterval[]> {
  const days = Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, [] as OpeningInterval[]])) as Record<
    DayOfWeek,
    OpeningInterval[]
  >
  for (const seg of segments) days[seg.dayOfWeek].push({ opens: seg.opens, closes: seg.closes })
  for (const day of DAYS_OF_WEEK) {
    days[day].sort((a, b) => (clockToMinutes(a.opens) ?? 0) - (clockToMinutes(b.opens) ?? 0))
  }
  return days
}

/** Fecha civil (`YYYY-MM-DD`) y minuto del día de `at` en la zona `timezone`. */
export function civilNow(
  timezone: string,
  at: Date = new Date(),
): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export type OpeningStatus =
  | { state: 'open'; closes: string }
  | { state: 'opens-later'; opens: string }
  | { state: 'closed-today' }
  | { state: 'closed-now' }

/**
 * Estado del local en este momento según el horario de hoy. Si el día del
 * perfil ya no es el de hoy en la zona del local (la página quedó abierta
 * pasada la medianoche), no se inventa nada: `null`.
 */
export function openingStatus(
  today: OpeningToday,
  timezone: string,
  at: Date = new Date(),
): OpeningStatus | null {
  const now = civilNow(timezone, at)
  if (now.date !== today.date) return null
  if (today.hours.length === 0) return { state: 'closed-today' }
  for (const interval of today.hours) {
    const opens = clockToMinutes(interval.opens) ?? 0
    const closes = clockToMinutes(interval.closes) ?? 0
    if (now.minutes >= opens && now.minutes < closes)
      return { state: 'open', closes: interval.closes }
    if (now.minutes < opens) return { state: 'opens-later', opens: interval.opens }
  }
  return { state: 'closed-now' }
}
