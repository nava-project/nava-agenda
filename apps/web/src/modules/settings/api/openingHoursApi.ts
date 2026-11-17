// Cliente de `GET`/`PUT /private/settings/opening-hours` (HU-107, DEC-182): el
// horario de atención propio del local.
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import { isDayOfWeek, type OpeningSegment } from '@/shared/model/openingHours'
import type { OpeningHoursOutcome, OpeningHoursSettings } from '../model/openingHoursOutcome'

interface WireSettings {
  openingHours: { dayOfWeek: string; opens: string; closes: string }[]
  closedOnHolidays: boolean
}

function toSettings(data: WireSettings): OpeningHoursSettings | null {
  const segments: OpeningSegment[] = []
  for (const seg of data.openingHours) {
    if (!isDayOfWeek(seg.dayOfWeek)) return null
    segments.push({ dayOfWeek: seg.dayOfWeek, opens: seg.opens, closes: seg.closes })
  }
  return { openingHours: segments, closedOnHolidays: data.closedOnHolidays }
}

export async function fetchOpeningHours(): Promise<OpeningHoursOutcome> {
  try {
    const { data, error, response } = await httpClient.GET('/private/settings/opening-hours')
    const settings = response.ok && data ? toSettings(data) : null
    if (settings) return { kind: 'success', settings }
    return { kind: 'unexpected-error', requestId: isProblem(error) ? error.requestId : undefined }
  } catch {
    return { kind: 'network-error' }
  }
}

export async function saveOpeningHours(
  settings: OpeningHoursSettings,
): Promise<OpeningHoursOutcome> {
  try {
    const { data, error, response } = await httpClient.PUT('/private/settings/opening-hours', {
      body: settings,
    })
    const stored = response.ok && data ? toSettings(data) : null
    if (stored) return { kind: 'success', settings: stored }
    if (response.status === 422) return { kind: 'validation-error' }
    return { kind: 'unexpected-error', requestId: isProblem(error) ? error.requestId : undefined }
  } catch {
    return { kind: 'network-error' }
  }
}
