// «La luz del día» (DEC-188): el modelo que convierte los inicios reales de la
// disponibilidad en lo que la reserva pinta. Las horas se agrupan en Mañana,
// Tarde y Noche según la hora civil del NEGOCIO (RN-DIS-07), y cada día lleva
// cuánta «luz libre» le queda: sus horas libres frente al día más libre de la
// ventana. Todo sale de datos ya recibidos; nunca se inventa un valor.
import { getCivilDateInTimezone, minutesSinceCivilMidnight } from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import type { PublicServiceSlot } from './publicServiceAvailabilityOutcome'

export type PartOfDay = 'morning' | 'afternoon' | 'night'

export const PART_OF_DAY_LABEL: Record<PartOfDay, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
}

/** Mañana hasta las 12:00, tarde hasta las 18:00 y noche desde entonces. */
export function partOfDay(minutesOfDay: number): PartOfDay {
  if (minutesOfDay < 12 * 60) return 'morning'
  if (minutesOfDay < 18 * 60) return 'afternoon'
  return 'night'
}

/** Una hora libre: el inicio y los profesionales que pueden atenderla. */
export interface DaylightSlot {
  startsAt: string
  professionalIds: string[]
  /** «2:00 p. m.»: la hora completa en la zona del negocio. */
  label: string
  /** «2:00»: la hora sin el sufijo, para la píldora dentro de su grupo. */
  shortLabel: string
  /** «2:00 p. m., tarde»: lo que oye un lector de pantalla. */
  spokenLabel: string
  part: PartOfDay
}

export interface DaylightGroup {
  part: PartOfDay
  label: string
  slots: DaylightSlot[]
}

export interface DaylightDay {
  civilDate: string
  slots: DaylightSlot[]
  groups: DaylightGroup[]
  /** Horas libres del día frente al día más libre de la ventana, de 0 a 1. */
  freeRatio: number
}

/** Quita «a. m.»/«p. m.» (con espacios normales o finos) de una hora formateada. */
export function withoutMeridiem(label: string): string {
  return label.replace(/\s*[ap]\.\s?m\.?$/i, '').trim()
}

/**
 * Agrupa los inicios por día civil y parte del día, filtrando por
 * `professionalId` (null = cualquiera: la unión de todos). Un mismo inicio
 * ofrecido por varios profesionales aparece una sola vez.
 */
export function buildDaylightDays(
  slots: PublicServiceSlot[],
  timezone: string,
  professionalId: string | null,
): DaylightDay[] {
  const byDay = new Map<string, Map<string, string[]>>()
  for (const slot of slots) {
    if (professionalId !== null && slot.professionalId !== professionalId) continue
    const civilDate = getCivilDateInTimezone(timezone, new Date(slot.startsAt))
    const day = byDay.get(civilDate) ?? new Map<string, string[]>()
    byDay.set(civilDate, day)
    const owners = day.get(slot.startsAt) ?? []
    owners.push(slot.professionalId)
    day.set(slot.startsAt, owners)
  }

  const days = Array.from(byDay.entries(), ([civilDate, starts]) => {
    const daySlots = Array.from(starts.entries(), ([startsAt, professionalIds]): DaylightSlot => {
      const label = formatTimeInTimezone(startsAt, timezone)
      const part = partOfDay(minutesSinceCivilMidnight(startsAt, civilDate, timezone))
      return {
        startsAt,
        professionalIds,
        label,
        shortLabel: withoutMeridiem(label),
        spokenLabel: `${label}, ${PART_OF_DAY_LABEL[part].toLowerCase()}`,
        part,
      }
    })
    const groups = (['morning', 'afternoon', 'night'] as const)
      .map((part) => ({
        part,
        label: PART_OF_DAY_LABEL[part],
        slots: daySlots.filter((s) => s.part === part),
      }))
      .filter((group) => group.slots.length > 0)
    return { civilDate, slots: daySlots, groups, freeRatio: 0 }
  })

  const most = Math.max(0, ...days.map((d) => d.slots.length))
  for (const day of days) day.freeRatio = most === 0 ? 0 : day.slots.length / most
  return days
}

/** El profesional que atiende un inicio con «Cualquiera»: el primero que lo
 * ofrece en el orden del servidor, para que la elección sea estable. */
export function professionalForSlot(slot: DaylightSlot): string {
  return slot.professionalIds[0] ?? ''
}
