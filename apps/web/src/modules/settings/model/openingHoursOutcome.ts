// Resultados de leer y guardar el horario de atención del local (HU-107,
// DEC-182), mismo criterio que `reminderSettingsOutcome.ts`: sin `Problem`,
// `status` HTTP crudo ni cabeceras. Un 401 real lo intercepta
// `installSessionHandling`.
import type { OpeningSegment } from '@/shared/model/openingHours'

export interface OpeningHoursSettings {
  openingHours: OpeningSegment[]
  closedOnHolidays: boolean
}

export type OpeningHoursOutcome =
  | { kind: 'success'; settings: OpeningHoursSettings }
  /**
   * El servidor rechazó el horario (422). La pantalla valida lo mismo antes de
   * enviar, así que solo llega con un cliente desfasado; no se muestra `detail`
   * (estandar-frontend-vue.md §6).
   */
  | { kind: 'validation-error' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
