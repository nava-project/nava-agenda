// Resultados discriminados de las operaciones de DEC-169 tal como los recibe
// el panel; ninguno expone `Problem` ni `status` HTTP crudo
// (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §6).
import type {
  ProfessionalBookingWindow,
  ProfessionalWindowOption,
} from './professionalBookingPolicy'

export type FetchProfessionalWindowsOutcome =
  | {
      kind: 'success'
      professionals: ProfessionalWindowOption[]
      windows: ProfessionalBookingWindow[]
    }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type SaveProfessionalWindowOutcome =
  | { kind: 'success'; window: ProfessionalBookingWindow }
  | { kind: 'validation-error' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type RemoveProfessionalWindowOutcome =
  | { kind: 'success' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }
