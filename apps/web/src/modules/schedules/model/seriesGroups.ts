import type { TimeBlockSeries } from './timeBlock'

// Un grupo es el conjunto de series semanales que dicen lo mismo y solo se
// distinguen por el día de la semana (las que crea «Agregar bloqueo por días»
// al marcar varios días, DEC-147). La lista las muestra como una sola ficha para
// no saturarla. Las series por fechas nunca se agrupan: cada una lleva sus
// propias fechas y excepciones.
export interface SeriesGroup {
  // Estable mientras el contenido compartido no cambie; sirve de clave de lista.
  key: string
  // Miembros ordenados por día de la semana (en series por fechas, uno solo).
  items: TimeBlockSeries[]
  // Días ISO de los miembros (vacío en series por fechas).
  weekdays: number[]
}

function groupKey(item: TimeBlockSeries): string {
  if (item.recurrenceKind !== 'weekly') return `dates:${item.id}`
  return [
    'weekly',
    item.blockType,
    item.startsTime,
    item.durationMinutes,
    item.effectiveFrom,
    item.effectiveUntil ?? '',
    item.reason ?? '',
  ].join('|')
}

// Agrupa conservando el orden de aparición del primer miembro de cada grupo.
export function groupSeries(series: TimeBlockSeries[]): SeriesGroup[] {
  const groups = new Map<string, SeriesGroup>()
  for (const item of series) {
    const key = groupKey(item)
    let group = groups.get(key)
    if (!group) {
      group = { key, items: [], weekdays: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => (a.isoWeekday ?? 0) - (b.isoWeekday ?? 0))
    group.weekdays = group.items.flatMap((item) => (item.isoWeekday ? [item.isoWeekday] : []))
  }
  return [...groups.values()]
}
