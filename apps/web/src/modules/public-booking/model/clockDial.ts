// Ángulos de las agujas del reloj de la entrada pública, en la zona del
// negocio. Igual que `formatInstantInTimezone`, la zona es explícita y nunca
// la del dispositivo: el instante solo se construye en el dispositivo, la hora
// civil que se dibuja la decide `timeZone`. Es presentación pura (sin estado ni
// red) para que sus casos —medianoche, mediodía, zonas con minutos de desfase—
// se prueben sin montar nada.

export interface DialAngles {
  /** Grados de la aguja de las horas, en el sentido del reloj desde las 12. */
  hour: number
  /** Grados de la aguja de los minutos, en el sentido del reloj desde las 12. */
  minute: number
}

/** `null` si la zona no es una zona IANA válida: el reloj simplemente no se dibuja. */
export function dialAngles(at: Date, timeZone: string): DialAngles | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at)
  } catch {
    return null
  }
  const hours = Number(parts.find((part) => part.type === 'hour')?.value)
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return {
    // La aguja de las horas avanza con los minutos, como en un reloj real.
    hour: (hours % 12) * 30 + minutes * 0.5,
    minute: minutes * 6,
  }
}

/** «4.6581° N · 74.0549° O»: cifras fijas en cuatro decimales (≈ 11 m). */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? 'E' : 'O'}`
  return `${lat} · ${lon}`
}
