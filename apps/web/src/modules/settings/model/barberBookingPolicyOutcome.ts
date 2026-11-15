// Resultados discriminados de las operaciones de DEC-169 tal como los recibe
// el panel; ninguno expone `Problem` ni `status` HTTP crudo
// (docs/03-desarrollo/estandar-frontend-vue.md §6).
import type { BarberBookingWindow, BarberWindowOption } from './barberBookingPolicy'

export type FetchBarberWindowsOutcome =
  | { kind: 'success'; barbers: BarberWindowOption[]; windows: BarberBookingWindow[] }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type SaveBarberWindowOutcome =
  | { kind: 'success'; window: BarberBookingWindow }
  | { kind: 'validation-error' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type RemoveBarberWindowOutcome =
  | { kind: 'success' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }
