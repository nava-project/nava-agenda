// El nombre de la zona del negocio en español, para leer junto a una hora
// («hora de Colombia»). Nunca el identificador IANA en crudo: «Bogota» sin tilde
// o «America/Bogota» no son nombres que el cliente diga.
//
// Las zonas de los mercados donde opera Agenda van en un mapa propio, porque el
// nombre de Intl cambia entre motores (Chromium dice «hora de Colombia»; el ICU de
// Node, «hora estándar de Colombia»). Las demás usan Intl en español; si Intl no
// da un nombre en palabras (solo «GMT-5»), se dice «hora local del negocio».
const NAMES: Record<string, string> = {
  'America/Bogota': 'hora de Colombia',
  'America/Lima': 'hora de Perú',
  'America/Guayaquil': 'hora de Ecuador',
  'America/Panama': 'hora de Panamá',
  'America/Caracas': 'hora de Venezuela',
  'America/Santiago': 'hora de Chile',
  'America/Argentina/Buenos_Aires': 'hora de Argentina',
  'America/Mexico_City': 'hora del centro de México',
  'America/Santo_Domingo': 'hora de República Dominicana',
  'America/Costa_Rica': 'hora de Costa Rica',
  'Europe/Madrid': 'hora de España peninsular',
}

const FALLBACK = 'hora local del negocio'

/** «America/Bogota» → «hora de Colombia». En minúscula, para ir dentro de una frase. */
export function timezoneName(timezone: string): string {
  const known = NAMES[timezone]
  if (known) return known
  try {
    const name = new Intl.DateTimeFormat('es', { timeZone: timezone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value
    if (name && /^hora\b/i.test(name)) return name.replace(/\s+estándar\b/i, '').toLowerCase()
  } catch {
    // Zona desconocida para el motor: se dice sin nombre.
  }
  return FALLBACK
}

/** «Hora de Colombia», para ir sola como rótulo. */
export function timezoneLabel(timezone: string): string {
  const name = timezoneName(timezone)
  return name.charAt(0).toUpperCase() + name.slice(1)
}
