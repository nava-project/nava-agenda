// Resultados discriminados de las operaciones de la integración con Google
// Calendar, tal como los recibe la página. Ninguno expone `Problem`, `status`
// HTTP crudo ni cabeceras (docs/03-desarrollo/estandar-frontend-vue.md §6). Un
// 401 real ya lo intercepta la coordinación única de `installSessionHandling`.
import type { GoogleCalendarCallbackResult, GoogleCalendarConnection } from './googleCalendar'

type Failure = { kind: 'network-error' } | { kind: 'unexpected-error' }

export type FetchConnectionOutcome =
  { kind: 'success'; connection: GoogleCalendarConnection } | Failure

// 409: integración sin configurar o sin barbero vinculado.
export type StartConnectOutcome =
  { kind: 'success'; authorizationUrl: string } | { kind: 'unavailable' } | Failure

// 400: state inválido, vencido, usado o ajeno (siempre el mismo desenlace).
export type CompleteCallbackOutcome =
  | { kind: 'success'; result: GoogleCalendarCallbackResult }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }
  | Failure

export type SyncNowOutcome =
  | { kind: 'success'; pendingSyncJobs: number; failedSyncJobs: number }
  | { kind: 'not-connected' }
  | { kind: 'unavailable' }
  | Failure

export type DisconnectOutcome = { kind: 'success' } | Failure

export type UpdateReminderOutcome =
  | { kind: 'success'; connection: GoogleCalendarConnection }
  | { kind: 'validation-error' }
  | { kind: 'not-connected' }
  | Failure

// Vínculo automático del independiente (DEC-155): `success` si quedó vinculada su
// única ficha; `not-applicable` si no hay una sola ficha elegible (varias, ninguna,
// ya tomada por otro usuario), caso en que la pantalla conserva el flujo manual.
export type LinkSoleBarberOutcome = { kind: 'success' } | { kind: 'not-applicable' } | Failure
