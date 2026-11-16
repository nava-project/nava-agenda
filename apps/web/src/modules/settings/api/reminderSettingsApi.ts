// Cliente de `GET`/`PATCH /private/settings/reminders` (DEC-174): con cuánta
// anticipación sale el recordatorio al cliente.
import { httpClient } from '@/shared/api/httpClient'
import {
  isReminderLeadMinutes,
  type ReminderLeadMinutes,
  type ReminderSettingsOutcome,
} from '../model/reminderSettingsOutcome'

export async function fetchReminderSettings(): Promise<ReminderSettingsOutcome> {
  try {
    const { data, response } = await httpClient.GET('/private/settings/reminders')
    if (response.ok && data && isReminderLeadMinutes(data.leadMinutes)) {
      return { kind: 'success', leadMinutes: data.leadMinutes }
    }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function saveReminderLead(
  leadMinutes: ReminderLeadMinutes,
): Promise<ReminderSettingsOutcome> {
  try {
    const { data, response } = await httpClient.PATCH('/private/settings/reminders', {
      body: { leadMinutes },
    })
    if (response.ok && data && isReminderLeadMinutes(data.leadMinutes)) {
      return { kind: 'success', leadMinutes: data.leadMinutes }
    }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}
