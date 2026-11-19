import { beforeEach, describe, expect, it } from 'vitest'

import {
  confirmedVisitKey,
  readConfirmedVisit,
  saveConfirmedVisit,
  toConfirmedVisit,
} from '../confirmedVisit'

const APPOINTMENT = {
  attendeeName: 'Ana Ríos',
  businessName: 'Barbería Ejemplo',
  serviceName: 'Corte clásico',
  durationMinutes: 30,
  priceAmount: '20000.00',
  currency: 'COP',
  startsAt: '2026-09-20T14:30:00Z',
  endsAt: '2026-09-20T15:00:00Z',
  timezone: 'America/Bogota',
  accessToken: 'token-que-no-se-guarda',
  customerNote: 'nota',
}

const KEY = confirmedVisitKey('barberia-ejemplo', 's1', 'p1', APPOINTMENT.startsAt)

describe('confirmedVisit', () => {
  beforeEach(() => sessionStorage.clear())

  it('drops the access token and the note when building the visit', () => {
    const visit = toConfirmedVisit(APPOINTMENT, false, null)
    expect(visit).not.toHaveProperty('accessToken')
    expect(visit).not.toHaveProperty('customerNote')
    expect(JSON.stringify(visit)).not.toContain(APPOINTMENT.accessToken)
  })

  it('round-trips through sessionStorage under a key per turn', () => {
    const visit = toConfirmedVisit(APPOINTMENT, true, 'Carrera 7 # 1-2, apto 301')
    saveConfirmedVisit(KEY, visit)
    expect(readConfirmedVisit(KEY)).toEqual(visit)
    expect(
      readConfirmedVisit(confirmedVisitKey('barberia-ejemplo', 's1', 'p1', '2026-09-21T14:30:00Z')),
    ).toBeNull()
  })

  it('ignores what it cannot trust: malformed JSON or another shape', () => {
    sessionStorage.setItem(KEY, '{no es json')
    expect(readConfirmedVisit(KEY)).toBeNull()
    sessionStorage.setItem(KEY, JSON.stringify({ serviceName: 'Corte' }))
    expect(readConfirmedVisit(KEY)).toBeNull()
  })
})
