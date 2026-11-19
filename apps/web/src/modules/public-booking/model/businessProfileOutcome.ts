// Modelo de dominio de la resolución pública de un negocio (HU-090).
// `PublicBusinessProfile` es la forma que la página consume;
// `ResolveBusinessOutcome` es lo único que `api/resolveBusinessApi.ts`
// entrega. Ninguno de los dos expone la forma RFC 9457 (`Problem`) del
// contrato (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §6): un slug mal
// formado, desconocido o no publicable llegan TODOS como `not-found`
// (CA-090-02), nunca distinguidos.

import type { BrandAccentKey, VocabularyTerms } from '@/shared/model'
import type { OpeningSegment, OpeningToday } from '@/shared/model/openingHours'

/** Contexto público mínimo de un negocio habilitado (CA-090-01,
 * CA-090-04). contactEmail/contactPhone son `null` cuando el negocio no
 * tiene ese contacto configurado. */
export interface PublicBusinessLocation {
  address: string
  latitude: number
  longitude: number
}

export interface PublicBusinessProfile {
  name: string
  timezone: string
  contactEmail: string | null
  contactPhone: string | null
  /** Palabras con las que el negocio nombra a su negocio y a su profesional (DEC-119). */
  vocabulary: VocabularyTerms
  /**
   * Dónde queda el local (DEC-130, HU-102). `null` si el negocio no muestra
   * uno: interruptor apagado o sin dirección geocodificada. Nunca se pinta un
   * mapa sin coordenadas reales.
   */
  location: PublicBusinessLocation | null
  /** Si el negocio atiende a domicilio (DEC-131, HU-103). */
  offersHomeService: boolean
  /** Color de marca que el negocio eligió en Configuración (DEC-171). */
  brandAccent: BrandAccentKey
  /**
   * Horario de atención del local (DEC-182, HU-107). Vacío: el negocio no lo
   * configuró y la reserva no pinta ningún horario.
   */
  openingHours: OpeningSegment[]
  /** El local cierra los festivos colombianos. */
  closedOnHolidays: boolean
  /** Lo que rige hoy con el festivo aplicado; `null` sin horario. */
  today: OpeningToday | null
}

/** Resultado discriminado de resolver un enlace público contra el API
 * real. `not-found` cubre las tres causas indistinguibles de CA-090-02
 * (forma inválida, desconocido, no publicable); `network-error` y
 * `unexpected-error` son las mismas fronteras defensivas que el resto de
 * la aplicación ya usa (ver auth/model/loginOutcome.ts). */
export type ResolveBusinessOutcome =
  | { kind: 'success'; profile: PublicBusinessProfile }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
