// Borrador de la ubicación del negocio en Configuración (DEC-130, HU-102):
// ayudas puras para normalizar la dirección como la guardará el servidor, saber
// si cambió y qué enviar. Sin Vue ni red, para probarlas sin montar nada.
import { samePoint, type LatLng } from '@/shared/model/mapPicker'
import type { LocationChange, LocationSettings } from './brandOutcome'

/** Largo máximo de la dirección, igual que `business_address_ck`. */
export const ADDRESS_MAX_LENGTH = 200

/** Recorta y colapsa espacios, igual que el servidor; `''` si no queda nada. */
export function normalizeAddress(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * Mensaje de error de la dirección, o `undefined` si es válida. Puede ir vacía,
 * salvo que haya un punto marcado a mano en el mapa (DEC-170): el punto siempre
 * viaja con su dirección escrita.
 */
export function validateAddress(raw: string, pin: LatLng | null = null): string | undefined {
  const normalized = normalizeAddress(raw)
  if ([...normalized].length > ADDRESS_MAX_LENGTH) {
    return `La dirección no puede superar ${ADDRESS_MAX_LENGTH} caracteres.`
  }
  if (pin && normalized === '') {
    return 'Escribe la dirección del local: acompaña al punto que marcaste en el mapa.'
  }
  return undefined
}

export interface LocationDraft {
  hasPhysicalLocation: boolean
  /** Texto del campo, tal como se escribe. */
  address: string
  offersHomeService: boolean
  /**
   * Punto que el dueño marcó a mano en el mapa en esta edición (DEC-170), o
   * `null` si no tocó el mapa: entonces el servidor geocodifica la dirección
   * escrita, como siempre.
   */
  pin: LatLng | null
}

export function draftFromSaved(saved: LocationSettings): LocationDraft {
  return {
    hasPhysicalLocation: saved.hasPhysicalLocation,
    address: saved.address ?? '',
    offersHomeService: saved.offersHomeService,
    pin: null,
  }
}

/** Punto guardado del negocio, o `null` si aún no tiene coordenadas. */
export function savedPoint(saved: LocationSettings): LatLng | null {
  return saved.latitude !== null && saved.longitude !== null
    ? { latitude: saved.latitude, longitude: saved.longitude }
    : null
}

/** El dueño marcó en el mapa un punto distinto del guardado. */
function pinChanged(draft: LocationDraft, saved: LocationSettings): boolean {
  if (!draft.pin) return false
  const current = savedPoint(saved)
  return current === null || !samePoint(draft.pin, current)
}

export function addressChanged(draft: LocationDraft, saved: LocationSettings): boolean {
  return normalizeAddress(draft.address) !== (saved.address ?? '')
}

/**
 * Dirección guardada que nunca se ubicó en el mapa (issue #589): por ejemplo,
 * cargada fuera del panel. El servidor la geocodifica si se le vuelve a
 * enviar, pero el panel solo envía lo que cambió; sin esto, el dueño no tenía
 * forma de ubicarla salvo editando el texto.
 */
export function needsGeocoding(saved: LocationSettings): boolean {
  return !!saved.address && (saved.latitude === null || saved.longitude === null)
}

/** El borrador conserva la dirección guardada y esa dirección aún no tiene punto. */
function pendingGeocoding(draft: LocationDraft, saved: LocationSettings): boolean {
  return needsGeocoding(saved) && !addressChanged(draft, saved)
}

export function sameLocation(draft: LocationDraft, saved: LocationSettings): boolean {
  return (
    draft.hasPhysicalLocation === saved.hasPhysicalLocation &&
    draft.offersHomeService === saved.offersHomeService &&
    !addressChanged(draft, saved) &&
    !pendingGeocoding(draft, saved) &&
    !pinChanged(draft, saved)
  )
}

/**
 * Lo que hay que enviar para llevar `saved` al borrador: solo lo que cambió, más
 * la dirección guardada cuando aún no tiene punto en el mapa. Una dirección
 * vacía se envía como `null` (la quita junto a sus coordenadas).
 */
export function locationChange(draft: LocationDraft, saved: LocationSettings): LocationChange {
  const change: LocationChange = {}
  if (draft.hasPhysicalLocation !== saved.hasPhysicalLocation) {
    change.hasPhysicalLocation = draft.hasPhysicalLocation
  }
  if (draft.offersHomeService !== saved.offersHomeService) {
    change.offersHomeService = draft.offersHomeService
  }
  const normalized = normalizeAddress(draft.address)
  if (
    draft.pin &&
    normalized !== '' &&
    (pinChanged(draft, saved) || addressChanged(draft, saved))
  ) {
    // Punto marcado a mano (DEC-170): viaja con la dirección escrita y el
    // servidor lo guarda tal cual, sin geocodificar.
    change.address = normalized
    change.latitude = draft.pin.latitude
    change.longitude = draft.pin.longitude
  } else if (addressChanged(draft, saved) || pendingGeocoding(draft, saved)) {
    change.address = normalized === '' ? null : normalized
  }
  return change
}
