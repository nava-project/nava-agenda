// Borrador editable del horario de atención (HU-107, DEC-182): siete días, cada
// uno abierto o cerrado y con sus tramos. Valida lo mismo que el servidor
// (`shops.NormalizeOpeningHours`) para que el dueño vea el error junto al día,
// antes de enviar.
//
// El selector de hora del panel llega hasta 23:59, así que un cierre «00:00»
// significa medianoche: se envía como `24:00` y `24:00` vuelve como «00:00».
import {
  clockToMinutes,
  DAY_LABELS,
  DAYS_OF_WEEK,
  segmentsByDay,
  type DayOfWeek,
  type OpeningSegment,
} from '@/shared/model/openingHours'
import type { OpeningHoursSettings } from './openingHoursOutcome'

export const MAX_SEGMENTS_PER_DAY = 4

export interface DraftInterval {
  /** Clave estable para el v-for: los tramos se añaden y quitan. */
  key: number
  opens: string
  closes: string
}

export interface DraftDay {
  day: DayOfWeek
  open: boolean
  intervals: DraftInterval[]
}

export interface OpeningHoursDraft {
  days: DraftDay[]
  closedOnHolidays: boolean
}

let nextKey = 1
export function newInterval(opens = '09:00', closes = '19:00'): DraftInterval {
  return { key: nextKey++, opens, closes }
}

export function draftFromSettings(settings: OpeningHoursSettings): OpeningHoursDraft {
  const byDay = segmentsByDay(settings.openingHours)
  return {
    closedOnHolidays: settings.closedOnHolidays,
    days: DAYS_OF_WEEK.map((day) => ({
      day,
      open: byDay[day].length > 0,
      intervals: byDay[day].map((i) =>
        newInterval(i.opens, i.closes === '24:00' ? '00:00' : i.closes),
      ),
    })),
  }
}

export function settingsFromDraft(draft: OpeningHoursDraft): OpeningHoursSettings {
  const openingHours: OpeningSegment[] = []
  for (const d of draft.days) {
    if (!d.open) continue
    for (const i of d.intervals) {
      openingHours.push({
        dayOfWeek: d.day,
        opens: i.opens,
        closes: i.closes === '00:00' ? '24:00' : i.closes,
      })
    }
  }
  return { openingHours, closedOnHolidays: draft.closedOnHolidays }
}

/** Huella para saber si hay cambios sin guardar (las claves no cuentan). */
export function draftSignature(draft: OpeningHoursDraft): string {
  return JSON.stringify(settingsFromDraft(draft))
}

/** Error por día; un día sin error no aparece. */
export function validateDraft(draft: OpeningHoursDraft): Partial<Record<DayOfWeek, string>> {
  const errors: Partial<Record<DayOfWeek, string>> = {}
  for (const d of draft.days) {
    if (!d.open) continue
    if (d.intervals.length === 0) {
      errors[d.day] =
        `Añade al menos un horario o marca el ${DAY_LABELS[d.day].toLowerCase()} como cerrado.`
      continue
    }
    if (d.intervals.length > MAX_SEGMENTS_PER_DAY) {
      errors[d.day] = `Un día admite como máximo ${MAX_SEGMENTS_PER_DAY} horarios.`
      continue
    }
    const ranges = d.intervals.map((i) => ({
      opens: clockToMinutes(i.opens),
      closes: i.closes === '00:00' ? 24 * 60 : clockToMinutes(i.closes),
    }))
    if (ranges.some((r) => r.opens === null || r.closes === null)) {
      errors[d.day] = 'Elige la hora de apertura y la de cierre.'
      continue
    }
    if (ranges.some((r) => (r.closes as number) <= (r.opens as number))) {
      errors[d.day] = 'La hora de cierre debe ser después de la de apertura.'
      continue
    }
    const sorted = [...ranges].sort((a, b) => (a.opens as number) - (b.opens as number))
    if (sorted.some((r, i) => i > 0 && (r.opens as number) < (sorted[i - 1].closes as number))) {
      errors[d.day] = 'Dos horarios del mismo día se cruzan.'
    }
  }
  return errors
}

/** Copia los horarios de `from` a los días `to` (abiertos o no). */
export function copyDay(draft: OpeningHoursDraft, from: DayOfWeek, to: readonly DayOfWeek[]): void {
  const source = draft.days.find((d) => d.day === from)
  if (!source) return
  for (const d of draft.days) {
    if (d.day === from || !to.includes(d.day)) continue
    d.open = source.open
    d.intervals = source.intervals.map((i) => newInterval(i.opens, i.closes))
  }
}
