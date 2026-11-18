/**
 * Cliente tipado de la ventana por profesional (DEC-169): mapeo por `status`,
 * nunca por `detail`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
const putMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api/httpClient', () => ({
  httpClient: { GET: getMock, PUT: putMock, DELETE: deleteMock },
}))

const { fetchProfessionalWindows, saveProfessionalWindow, removeProfessionalWindow } =
  await import('../professionalBookingPolicyApi')

const PROFESSIONAL = '3f1c9a52-7d4e-4b8a-9c21-5e6f7a8b9c0d'

function ok(body: unknown, status = 200) {
  return { data: body, error: undefined, response: new Response(null, { status }) }
}
function problem(status: number) {
  return { data: undefined, error: {}, response: new Response(null, { status }) }
}

describe('professionalBookingPolicyApi', () => {
  beforeEach(() => {
    getMock.mockReset()
    putMock.mockReset()
    deleteMock.mockReset()
  })

  it('loads professionals and their own windows together', async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/private/professionals'
          ? ok({
              items: [
                { id: PROFESSIONAL, fullName: 'Ana', photoUpdatedAt: '2026-11-01T10:00:00Z' },
                { id: 'b2', fullName: 'Leo', photoUpdatedAt: null },
              ],
            })
          : ok({
              items: [
                {
                  professionalId: PROFESSIONAL,
                  minAdvanceMinutes: 30,
                  maxAdvanceDays: 7,
                  slotGridMinutes: 40,
                },
              ],
            }),
      ),
    )

    const outcome = await fetchProfessionalWindows()

    expect(getMock).toHaveBeenCalledWith('/private/professionals', {
      params: { query: { limit: 50 } },
    })
    expect(getMock).toHaveBeenCalledWith('/private/settings/booking-policy/professionals')
    expect(outcome).toEqual({
      kind: 'success',
      professionals: [
        {
          id: PROFESSIONAL,
          fullName: 'Ana',
          photoUrl: `/api/v1/private/professionals/${PROFESSIONAL}/photo?v=2026-11-01T10%3A00%3A00Z`,
        },
        { id: 'b2', fullName: 'Leo', photoUrl: null },
      ],
      windows: [
        {
          professionalId: PROFESSIONAL,
          minAdvanceMinutes: 30,
          maxAdvanceDays: 7,
          slotGridMinutes: 40,
        },
      ],
    })
  })

  it('treats a failure of either list as an unexpected error, and a thrown fetch as network', async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(path === '/private/professionals' ? ok({ items: [] }) : problem(500)),
    )
    expect(await fetchProfessionalWindows()).toEqual({ kind: 'unexpected-error' })

    getMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchProfessionalWindows()).toEqual({ kind: 'network-error' })
  })

  it('saves a full window for the professional', async () => {
    const body = { minAdvanceMinutes: 30, maxAdvanceDays: 7, slotGridMinutes: 40 }
    putMock.mockResolvedValueOnce(ok({ professionalId: PROFESSIONAL, ...body }))

    expect(await saveProfessionalWindow(PROFESSIONAL, body)).toEqual({
      kind: 'success',
      window: { professionalId: PROFESSIONAL, ...body },
    })
    expect(putMock).toHaveBeenCalledWith(
      '/private/settings/booking-policy/professionals/{professionalId}',
      {
        params: { path: { professionalId: PROFESSIONAL } },
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
      await saveProfessionalWindow(PROFESSIONAL, {
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
    expect(await removeProfessionalWindow(PROFESSIONAL)).toEqual({ kind: 'success' })
    expect(deleteMock).toHaveBeenCalledWith(
      '/private/settings/booking-policy/professionals/{professionalId}',
      {
        params: { path: { professionalId: PROFESSIONAL } },
      },
    )

    deleteMock.mockResolvedValueOnce(problem(404))
    expect(await removeProfessionalWindow(PROFESSIONAL)).toEqual({ kind: 'not-found' })
    deleteMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await removeProfessionalWindow(PROFESSIONAL)).toEqual({ kind: 'network-error' })
  })
})
