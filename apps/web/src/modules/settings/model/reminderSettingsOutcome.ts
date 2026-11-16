// Anticipación del recordatorio al cliente (DEC-174) y resultados de leerla y
// guardarla, mismo criterio que `loginOtpOutcome.ts`: sin `Problem`, `status`
// HTTP crudo ni cabeceras. Un 401 real lo intercepta `installSessionHandling`.
export const REMINDER_LEAD_OPTIONS = [10, 20, 30, 40, 50, 60] as const
export type ReminderLeadMinutes = (typeof REMINDER_LEAD_OPTIONS)[number]

export function isReminderLeadMinutes(value: unknown): value is ReminderLeadMinutes {
  return typeof value === 'number' && (REMINDER_LEAD_OPTIONS as readonly number[]).includes(value)
}

export type ReminderSettingsOutcome =
  | { kind: 'success'; leadMinutes: ReminderLeadMinutes }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error' }
