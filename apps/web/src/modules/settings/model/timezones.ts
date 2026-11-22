// Catálogo de zonas horarias para el selector de Configuración (DEC-110).
// Sale de `Intl.supportedValuesOf('timeZone')`, la misma base IANA del
// navegador, sin tabla propia ni dependencia nueva. El servidor sigue siendo la
// autoridad (CA-020-03): confirma cada zona contra `pg_timezone_names` y
// responde 422 si no la reconoce; este catálogo solo evita que la persona
// tenga que teclear de memoria un identificador exacto.

import { cityOf, offsetLabel } from '@/shared/time/timezoneCity'

// cityOf y offsetLabel viven en shared/time: el panel de bloqueos también dice la
// zona como «Hora en Bogotá · UTC−5» (#791). Se reexportan para Configuración.
export { cityOf, offsetLabel }

/** Respaldo cuando el navegador no expone la lista (muy antiguo o entorno de prueba). */
const FALLBACK_TIMEZONES = [
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Caracas',
  'America/Guayaquil',
  'America/Lima',
  'America/Mexico_City',
  'America/Montevideo',
  'America/New_York',
  'America/Panama',
  'America/Santiago',
  'America/Sao_Paulo',
  'Europe/Madrid',
  'UTC',
]

export function listTimezones(extra: readonly string[] = []): string[] {
  let zones: string[] = []
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf
    zones = supported ? supported('timeZone') : []
  } catch {
    zones = []
  }
  if (zones.length === 0) zones = [...FALLBACK_TIMEZONES]
  // La zona vigente del negocio siempre aparece, aunque el navegador no la liste.
  const all = new Set([...zones, ...extra.filter(Boolean)])
  return [...all].sort((a, b) => a.localeCompare(b, 'en'))
}

/** Zona del dispositivo, solo como sugerencia: nunca sustituye la configurada (RN-DIS-07). */
export function detectDeviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** `true` si el navegador reconoce `timezone` como zona IANA. */
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('es-CO', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** Reloj de la zona en 12 h, como todo lo que lee el dueño («3:36 p. m.», con el
 * mismo sufijo que `formatClock`), sin segundos. */
export function clockParts(
  timezone: string,
  at: Date = new Date(),
): { hours: string; minutes: string; meridiem: string; day: string } | null {
  try {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const rawDay = new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(at)
    const day = rawDay.charAt(0).toLocaleUpperCase('es') + rawDay.slice(1)
    const hour24 = Number(time.find((p) => p.type === 'hour')?.value)
    if (!Number.isFinite(hour24)) return null
    return {
      hours: String(hour24 % 12 === 0 ? 12 : hour24 % 12),
      minutes: time.find((p) => p.type === 'minute')?.value ?? '--',
      meridiem: hour24 < 12 ? 'a. m.' : 'p. m.',
      day,
    }
  } catch {
    return null
  }
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_/]/g, ' ')
}

/** Filtra por cualquier fragmento del identificador ("bogota", "new york", "america") o del desfase ("utc-5"). */
export function filterTimezones(zones: readonly string[], query: string, at: Date = new Date()) {
  const needle = fold(query.trim()).replace('−', '-')
  if (!needle) return [...zones]
  const terms = needle.split(/\s+/).filter(Boolean)
  return zones.filter((zone) => {
    const haystack = `${fold(zone)} ${fold(cityOf(zone))} ${offsetLabel(zone, at).toLowerCase().replace('−', '-')}`
    return terms.every((term) => haystack.includes(term))
  })
}
