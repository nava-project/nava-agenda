/**
 * Cliente tipado de la ventana por barbero (DEC-169): mapeo por `status`,
 * nunca por `detail`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
const putMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api/httpClient', () => ({
  httpClient: { GET: getMock, PUT: putMock, DELETE: deleteMock },
}))

const { fetchBarberWindows, saveBarberWindow, removeBarberWindow } =
  await import('../barberBookingPolicyApi')

const BARBER = '3f1c9a52-7d4e-4b8a-9c21-5e6f7a8b9c0d'

function ok(body: unknown, status = 200) {
  return { data: body, error: undefined, response: new Response(null, { status }) }
}
function problem(status: number) {
  return { data: undefined, error: {}, response: new Response(null, { status }) }
}

describe('barberBookingPolicyApi', () => {
  beforeEach(() => {
    getMock.mockReset()
    putMock.mockReset()
    deleteMock.mockReset()
  })

  it('loads barbers and their own windows together', async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/private/professionals'
          ? ok({
              items: [
                { id: BARBER, fullName: 'Ana', photoUpdatedAt: '2026-11-01T10:00:00Z' },
                { id: 'b2', fullName: 'Leo', photoUpdatedAt: null },
              ],
            })
          : ok({
              items: [
                {
                  professionalId: BARBER,
                  minAdvanceMinutes: 30,
                  maxAdvanceDays: 7,
                  slotGridMinutes: 40,
                },
              ],
            }),
      ),
    )

    const outcome = await fetchBarberWindows()

    expect(getMock).toHaveBeenCalledWith('/private/professionals', {
      params: { query: { limit: 50 } },
    })
    expect(getMock).toHaveBeenCalledWith('/private/settings/booking-policy/professionals')
    expect(outcome).toEqual({
      kind: 'success',
      barbers: [
        {
          id: BARBER,
          fullName: 'Ana',
          photoUrl: `/api/v1/private/professionals/${BARBER}/photo?v=2026-11-01T10%3A00%3A00Z`,
        },
        { id: 'b2', fullName: 'Leo', photoUrl: null },
      ],
      windows: [
        { barberId: BARBER, minAdvanceMinutes: 30, maxAdvanceDays: 7, slotGridMinutes: 40 },
      ],
    })
  })

  it('treats a failure of either list as an unexpected error, and a thrown fetch as network', async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(path === '/private/professionals' ? ok({ items: [] }) : problem(500)),
    )
    expect(await fetchBarberWindows()).toEqual({ kind: 'unexpected-error' })

    getMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchBarberWindows()).toEqual({ kind: 'network-error' })
  })

  it('saves a full window for the barber', async () => {
    const body = { minAdvanceMinutes: 30, maxAdvanceDays: 7, slotGridMinutes: 40 }
    putMock.mockResolvedValueOnce(ok({ professionalId: BARBER, ...body }))

    expect(await saveBarberWindow(BARBER, body)).toEqual({
      kind: 'success',
      window: { barberId: BARBER, ...body },
    })
    expect(putMock).toHaveBeenCalledWith(
      '/private/settings/booking-policy/professionals/{professionalId}',
      {
        params: { path: { professionalId: BARBER } },
        body,
      },
    )
  })

  it.each([
    [400, 'validation-error'],
    [422, 'validation-error'],
    [404, 'not-found'],
    [500, 'unexpected-error'],
  ])('maps a %i save to %s', async (status, kind) => {
    putMock.mockResolvedValueOnce(problem(status))
    expect(
      await saveBarberWindow(BARBER, {
        minAdvanceMinutes: 0,
        maxAdvanceDays: 1,
        slotGridMinutes: 5,
      }),
    ).toEqual({ kind })
  })

  it('removes the own window (204) and maps failures', async () => {
    deleteMock.mockResolvedValueOnce({
      data: undefined,
      response: new Response(null, { status: 204 }),
    })
    expect(await removeBarberWindow(BARBER)).toEqual({ kind: 'success' })
    expect(deleteMock).toHaveBeenCalledWith(
      '/private/settings/booking-policy/professionals/{professionalId}',
      {
        params: { path: { professionalId: BARBER } },
      },
    )

    deleteMock.mockResolvedValueOnce(problem(404))
    expect(await removeBarberWindow(BARBER)).toEqual({ kind: 'not-found' })
    deleteMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await removeBarberWindow(BARBER)).toEqual({ kind: 'network-error' })
  })
})
