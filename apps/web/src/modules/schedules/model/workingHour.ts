// Espejo tipado del cuerpo real del contrato (HU-040, CA-040-01/02/03):
// exactamente id, isoWeekday, startsTime, durationMinutes, createdAt,
// updatedAt. businessId/professionalId nunca aparecen: el tenant se deriva de
// la sesión y el profesional de la ruta.
export interface WorkingHour {
  id: string
  isoWeekday: number
  startsTime: string
  durationMinutes: number
  createdAt: string
  updatedAt: string
}

/** Página paginada por cursor (CA-040-01): mismo `items`/`nextCursor` que
 * WorkingHourListResponse. */
export interface WorkingHourPage {
  items: WorkingHour[]
  nextCursor: string | null
}

// ISO_WEEKDAYS es la lista fija de los siete días (1 = lunes … 7 = domingo,
// DEC-020): la pantalla siempre los muestra en este orden, con o sin
// tramos configurados (CA-040-01).
export const ISO_WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
]

// Iniciales de las fichas de día. X para miércoles: M ya es martes y repetirla confundiría.
export const WEEKDAY_INITIALS: Record<number, string> = {
  1: 'L',
  2: 'M',
  3: 'X',
  4: 'J',
  5: 'V',
  6: 'S',
  7: 'D',
}

export function weekdayLabel(isoWeekday: number): string {
  return ISO_WEEKDAYS.find((d) => d.value === isoWeekday)?.label ?? `Día ${isoWeekday}`
}

// «lunes, miércoles y viernes» (en minúscula, para insertar en una frase).
export function joinWeekdayNames(days: number[]): string {
  const names = days.map((day) => weekdayLabel(day).toLowerCase())
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

// Describe un conjunto de días para una ficha: «Todos los días», un rango
// corrido («Lunes a viernes») o la lista («Lunes, miércoles y viernes»).
export function describeWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  let text: string
  if (sorted.length === 7) text = 'todos los días'
  else if (sorted.length >= 3 && sorted[sorted.length - 1]! - sorted[0]! === sorted.length - 1) {
    text = `${weekdayLabel(sorted[0]!).toLowerCase()} a ${weekdayLabel(sorted[sorted.length - 1]!).toLowerCase()}`
  } else text = joinWeekdayNames(sorted)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ProfessionalSummary es un subconjunto deliberadamente mínimo del recurso real
// de `staff` (id, el nombre visible y la URL de su retrato para el selector),
// obtenido por este módulo directamente del cliente HTTP compartido -nunca
// importando staffApi.ts, privado de su propio módulo
// (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §3), mismo criterio que
// professionalServices.ProfessionalSummary.
export interface ProfessionalSummary {
  id: string
  fullName: string
  /** Retrato del profesional, o null cuando no tiene (se muestra su monograma). */
  photoUrl: string | null
}
