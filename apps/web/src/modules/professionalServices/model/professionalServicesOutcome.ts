// Resultados discriminados de las operaciones de HU-023, tal como los recibe
// la página coordinadora. Ninguno expone `Problem`, `status` HTTP crudo ni
// cabeceras (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §6), mismo criterio
// que staffOutcome.ts/catalogOutcome.ts. Un 401 real de estas rutas ya lo
// intercepta la coordinación única de `installSessionHandling`; todos igual
// declaran `unexpected-error` como frontera defensiva.
import type { Assignment, AssignmentPage, ProfessionalSummary, ServiceSummary } from './assignment'

export type FetchProfessionalSummariesOutcome =
  | { kind: 'success'; items: ProfessionalSummary[] }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type FetchServiceSummariesOutcome =
  | { kind: 'success'; items: ServiceSummary[] }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type FetchAssignmentsOutcome =
  | { kind: 'success'; page: AssignmentPage }
  // El propio profesional seleccionado ya no existe/es de otro negocio
  // (RN-TEN-01): la pantalla lo trata igual que una carga fallida.
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type AssignServiceOutcome =
  | { kind: 'success'; assignment: Assignment }
  // CA-023-04: profesional o servicio inexistente/ajeno, indistinguibles.
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }

export type UnassignServiceOutcome =
  | { kind: 'success' }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }
