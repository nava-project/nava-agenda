/**
 * listPublicServiceAvailability (DEC-162, usada por la v2 de DEC-188): traduce la
 * disponibilidad agregada del servicio a un resultado de dominio; 404 es el
 * enlace inexistente uniforme y cualquier otro fallo es inesperado o de red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { GET: getMock } }))

const { listPublicServiceAvailability } = await import('../listPublicServiceAvailabilityApi')

beforeEach(() => getMock.mockReset())

describe('listPublicServiceAvailability', () => {
  it('asks for every professional of the service in one call and keeps the server order', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        slots: [
          { professionalId: 'b', startsAt: '2030-01-14T09:00:00-05:00' },
          { professionalId: 'a', startsAt: '2030-01-14T09:15:00-05:00' },
        ],
        durationMinutes: 45,
        timezone: 'America/Bogota',
        slotGridMinutes: 15,
      },
      error: undefined,
      response: { ok: true, status: 200 } as Response,
    })
    const outcome = await listPublicServiceAvailability('barberia', 'svc')
    expect(getMock).toHaveBeenCalledWith(
      '/public/businesses/{slug}/services/{serviceId}/availability',
      { params: { path: { slug: 'barberia', serviceId: 'svc' } } },
    )
    expect(outcome).toEqual({
      kind: 'success',
      availability: {
        slots: [
          { professionalId: 'b', startsAt: '2030-01-14T09:00:00-05:00' },
          { professionalId: 'a', startsAt: '2030-01-14T09:15:00-05:00' },
        ],
        durationMinutes: 45,
        timezone: 'America/Bogota',
        slotGridMinutes: 15,
      },
    })
  })

  it('maps 404 to not-found, other statuses to unexpected and a failed fetch to network', async () => {
    getMock.mockResolvedValueOnce({
      data: undefined,
      error: {},
      response: { ok: false, status: 404 },
    })
    expect(await listPublicServiceAvailability('x', 's')).toEqual({ kind: 'not-found' })

    getMock.mockResolvedValueOnce({
      data: undefined,
      error: { status: 500, code: 'internal', title: 'Error', requestId: 'req-1' },
      response: { ok: false, status: 500 },
    })
    expect(await listPublicServiceAvailability('x', 's')).toEqual({
      kind: 'unexpected-error',
      requestId: 'req-1',
    })

    getMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await listPublicServiceAvailability('x', 's')).toEqual({ kind: 'network-error' })
  })
})
