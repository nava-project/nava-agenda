// El cielo v2 «La luz del día» (DEC-188): cada color cae en su hora real del
// día. Lo comparten la franja del día de la reserva (DaylightStrip) y la regla
// del día (DayRuler, DEC-189), para que el cielo sea uno solo.
//
// Los colores son el material fijo de la regla: no cambian entre Día y Noche.
// La franja los declara también como `--dl-*` en su CSS; una prueba vigila que
// coincidan.

export type SkyTone = 'night' | 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk'

/** Paradas del cielo: [hora del día, tono]. Fuera de la ventana también, para que los bordes tengan su tono. */
export const SKY_STOPS: readonly (readonly [number, SkyTone])[] = [
  [0, 'night'],
  [5, 'night'],
  [6.5, 'dawn'],
  [8.5, 'morning'],
  [12.5, 'noon'],
  [16, 'afternoon'],
  [18, 'dusk'],
  [19.5, 'night'],
  [24, 'night'],
]

export const SKY_COLORS: Readonly<Record<SkyTone, string>> = {
  night: '#2a2e66',
  dawn: '#f08a7a',
  morning: '#ffc96b',
  noon: '#ffeab8',
  afternoon: '#ffb27e',
  dusk: '#d9577a',
}

/**
 * Degradado del cielo para una ventana [from, to] en minutos desde la medianoche
 * civil. Las paradas fuera de la ventana quedan con porcentajes por debajo de 0 o
 * por encima de 100: CSS las interpola y los bordes toman el tono de su hora.
 */
export function skyGradient(from: number, to: number): string {
  const span = Math.max(1, to - from)
  const stops = SKY_STOPS.map(
    ([hour, tone]) => `${SKY_COLORS[tone]} ${(((hour * 60 - from) / span) * 100).toFixed(2)}%`,
  )
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
