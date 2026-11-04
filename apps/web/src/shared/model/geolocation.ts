// Detección de la ubicación del cliente con la API de geolocalización del navegador
// (DEC-138, HU-103, DEC-155). Se invoca al elegir «a domicilio» o al pulsar «Usar mi
// ubicación»; el navegador pide su propio permiso y, si se niega, la persona marca el punto en
// el mapa.
//
// La posición es dato personal (RN-DAT-02): no se registra ni se guarda; quien llama la usa
// para centrar el mapa y la persona decide si la confirma.
import { isValidPoint, roundPoint, type LatLng } from './mapPicker'

export type LocateResult =
  | { kind: 'success'; point: LatLng; accuracyMeters: number | null }
  /** La persona (o el navegador) negó el permiso. */
  | { kind: 'denied' }
  /** El dispositivo no pudo determinar la posición. */
  | { kind: 'unavailable' }
  | { kind: 'timeout' }
  /** Este navegador o contexto (p. ej. sin HTTPS) no ofrece geolocalización. */
  | { kind: 'unsupported' }

/** Espera máxima de una detección: lo bastante para un GPS en frío sin dejar la pantalla colgada. */
export const LOCATE_TIMEOUT_MS = 12_000

/** Precisión (metros) con la que una lectura se da por buena sin esperar más (DEC-155). */
export const GOOD_ACCURACY_METERS = 25

/** Tras este tiempo se entrega la mejor lectura que haya, aunque no llegue a la precisión buena. */
export const REFINE_WINDOW_MS = 8_000

/** Precisión bajo la cual una posición detectada sola se marca sin que la persona la confirme. */
export const AUTO_MARK_ACCURACY_METERS = 150

/** `true` si este navegador ofrece geolocalización. */
export type GeolocationLike = Pick<Geolocation, 'getCurrentPosition'> &
  Partial<Pick<Geolocation, 'watchPosition' | 'clearWatch'>>

export function isGeolocationSupported(
  geo: GeolocationLike | undefined = currentGeolocation(),
): boolean {
  return typeof geo?.getCurrentPosition === 'function'
}

function currentGeolocation(): GeolocationLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.geolocation
}

const FIX_OPTIONS = { enableHighAccuracy: true, maximumAge: 0 } as const

function errorKind(code: number): 'denied' | 'unavailable' | 'timeout' {
  // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
  if (code === 1) return 'denied'
  if (code === 3) return 'timeout'
  return 'unavailable'
}

function toFix(position: GeolocationPosition): Extract<LocateResult, { kind: 'success' }> | null {
  const point = roundPoint({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  })
  if (!isValidPoint(point)) return null
  const accuracy = position.coords.accuracy
  return {
    kind: 'success',
    point,
    accuracyMeters: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
  }
}

/**
 * Detecta la posición actual. Nunca lanza: cada fallo es un resultado explícito.
 *
 * La primera lectura de un teléfono o de un equipo de escritorio suele ser una aproximación por
 * red de cientos de metros o kilómetros (la causa de que el mapa «caiga al centro»): se escucha
 * la posición unos segundos y se entrega la de mejor precisión, en cuanto una baja de
 * `GOOD_ACCURACY_METERS` o al cumplirse `REFINE_WINDOW_MS`. Sin `watchPosition` (navegadores o
 * pruebas mínimas) basta una lectura.
 */
export function locateUser(
  geo: GeolocationLike | undefined = currentGeolocation(),
  timeoutMs: number = LOCATE_TIMEOUT_MS,
  refineMs: number = REFINE_WINDOW_MS,
): Promise<LocateResult> {
  if (!isGeolocationSupported(geo)) return Promise.resolve({ kind: 'unsupported' })
  const source = geo!

  const watch = source.watchPosition?.bind(source)
  if (!watch) {
    return new Promise<LocateResult>((resolve) => {
      source.getCurrentPosition(
        (position) => resolve(toFix(position) ?? { kind: 'unavailable' }),
        (error) => resolve({ kind: errorKind(error.code) }),
        { ...FIX_OPTIONS, timeout: timeoutMs },
      )
    })
  }

  return new Promise<LocateResult>((resolve) => {
    let best: Extract<LocateResult, { kind: 'success' }> | null = null
    let lastError: 'unavailable' | 'timeout' = 'unavailable'
    let done = false
    let watchId: number | undefined = undefined
    const timers: ReturnType<typeof setTimeout>[] = []

    const finish = (result: LocateResult) => {
      if (done) return
      done = true
      timers.forEach(clearTimeout)
      if (watchId !== undefined) source.clearWatch?.(watchId)
      resolve(result)
    }

    // Pasado el tiempo de afinar, vale la mejor lectura que haya; sin ninguna, el último error.
    timers.push(setTimeout(() => best && finish(best), refineMs))
    timers.push(setTimeout(() => finish(best ?? { kind: lastError }), timeoutMs))

    const id = watch(
      (position) => {
        const fix = toFix(position)
        if (!fix) return
        const better =
          best === null || (fix.accuracyMeters ?? Infinity) < (best.accuracyMeters ?? Infinity)
        if (better) best = fix
        if (best && (best.accuracyMeters ?? Infinity) <= GOOD_ACCURACY_METERS) finish(best)
      },
      (error) => {
        const kind = errorKind(error.code)
        if (kind === 'denied') finish({ kind })
        else lastError = kind
      },
      { ...FIX_OPTIONS, timeout: timeoutMs },
    )
    watchId = id
    // Si el resultado ya se resolvió de forma síncrona (una lectura inmediata), se suelta ahora.
    if (done) source.clearWatch?.(id)
  })
}

/** Zoom con el que se acerca una posición detectada: cuanto menos precisa, más abierto. */
export function zoomForAccuracy(accuracyMeters: number | null): number {
  if (accuracyMeters === null || accuracyMeters <= 60) return 17
  if (accuracyMeters <= AUTO_MARK_ACCURACY_METERS) return 16
  if (accuracyMeters <= 600) return 15
  return 14
}
