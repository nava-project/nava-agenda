// La zona del negocio para leer: «Bogotá» y «UTC−5», nunca el identificador
// IANA en crudo. La usan Configuración (selector de zona) y el panel de
// bloqueos (#791). El identificador que se guarda y se envía no cambia.

/** "UTC−5", "UTC+5:30", "UTC" en el instante `at` (respeta el horario de verano). */
export function offsetLabel(timezone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    if (!part || part === 'GMT') return 'UTC'
    // "GMT-05:00" → "UTC−5", "GMT+05:30" → "UTC+5:30".
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part)
    if (!match) return part.replace('GMT', 'UTC')
    if (Number(match[2]) === 0 && match[3] === '00') return 'UTC'
    const sign = match[1] === '-' ? '−' : '+'
    const hours = String(Number(match[2]))
    return `UTC${sign}${hours}${match[3] === '00' ? '' : `:${match[3]}`}`
  } catch {
    return ''
  }
}

/**
 * Nombre visible en español de las zonas cuyo identificador IANA no se escribe
 * igual (sin tildes o en inglés). Solo cambia lo que se lee: el identificador
 * que se guarda y se envía sigue siendo el IANA («America/Bogota»). Las demás
 * zonas se leen desde su identificador, con espacios en lugar de «_».
 */
const CITY_NAMES: Readonly<Record<string, string>> = {
  'America/Bogota': 'Bogotá',
  'America/Mexico_City': 'Ciudad de México',
  'America/Merida': 'Mérida',
  'America/Cancun': 'Cancún',
  'America/Mazatlan': 'Mazatlán',
  'America/Bahia_Banderas': 'Bahía de Banderas',
  'America/Panama': 'Panamá',
  'America/Havana': 'La Habana',
  'America/Asuncion': 'Asunción',
  'America/Sao_Paulo': 'São Paulo',
  'America/Belem': 'Belém',
  'America/Cuiaba': 'Cuiabá',
  'America/Maceio': 'Maceió',
  'America/Araguaina': 'Araguaína',
  'America/Santarem': 'Santarém',
  'America/Bahia': 'Bahía',
  'America/Manaus': 'Manaos',
  'America/Argentina/Cordoba': 'Córdoba',
  'America/Argentina/Tucuman': 'Tucumán',
  'America/Port_of_Spain': 'Puerto España',
  'America/New_York': 'Nueva York',
  'America/Los_Angeles': 'Los Ángeles',
  'America/St_Johns': 'San Juan de Terranova',
  'Pacific/Galapagos': 'Galápagos',
  'Pacific/Easter': 'Isla de Pascua',
  'Atlantic/Canary': 'Canarias',
  'Europe/London': 'Londres',
  'Europe/Paris': 'París',
  'Europe/Rome': 'Roma',
  'Europe/Lisbon': 'Lisboa',
  'Europe/Berlin': 'Berlín',
  'Asia/Tokyo': 'Tokio',
}

/** "America/Bogota" → "Bogotá" para leer; el identificador va aparte y no cambia. */
export function cityOf(timezone: string): string {
  const named = CITY_NAMES[timezone]
  if (named) return named
  const last = timezone.split('/').pop() ?? timezone
  return last.replace(/_/g, ' ')
}

/** «Hora en Bogotá · UTC−5»: la zona como rótulo junto a unas horas. */
export function zoneClockLabel(timezone: string, at: Date = new Date()): string {
  const offset = offsetLabel(timezone, at)
  return offset ? `Hora en ${cityOf(timezone)} · ${offset}` : `Hora en ${cityOf(timezone)}`
}
