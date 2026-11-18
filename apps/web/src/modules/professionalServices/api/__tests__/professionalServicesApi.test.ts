/**
 * Pruebas del cliente tipado (`professionalServicesApi` sobre
 * `shared/api/httpClient`): mapeo por `status`/`code` (nunca por `detail`),
 * mismo criterio que `staff/api/__tests__/staffApi.test.ts`. El recorrido de
 * red real vive en un E2E propio de HU-023.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
const putMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api/httpClient', () => ({
  httpClient: { GET: getMock, PUT: putMock, DELETE: deleteMock },
}))

const {
  fetchProfessionalSummaries,
  fetchServiceSummaries,
  fetchAssignments,
  assignService,
  unassignService,
} = await import('../professionalServicesApi')

function ok(body: unknown) {
  return { data: body, error: undefined, response: new Response(null, { status: 200 }) }
}

function created(body: unknown) {
  return { data: body, error: undefined, response: new Response(null, { status: 201 }) }
}

function problem(status: number, body: Record<string, unknown> = {}) {
  return { data: undefined, error: body, response: new Response(null, { status }) }
}

describe('professionalServicesApi.fetchProfessionalSummaries', () => {
  beforeEach(() => getMock.mockReset())

  it('maps a 200 success body to a minimal summary, dropping timestamps', async () => {
    getMock.mockResolvedValueOnce(
      ok({
        items: [
          {
            id: 'b-1',
            fullName: 'Carlos Ramírez',
            createdAt: '2026-08-24T15:04:05Z',
            updatedAt: '2026-08-24T15:04:05Z',
          },
        ],
        nextCursor: null,
      }),
    )

    const outcome = await fetchProfessionalSummaries()

    expect(outcome).toEqual({ kind: 'success', items: [{ id: 'b-1', fullName: 'Carlos Ramírez' }] })
    expect(getMock).toHaveBeenCalledWith('/private/professionals', {
      params: { query: { limit: 50 } },
    })
  })

  it('maps a network failure to network-error', async () => {
    getMock.mockRejectedValueOnce(new Error('fetch failed'))
    expect(await fetchProfessionalSummaries()).toEqual({ kind: 'network-error' })
  })
})

describe('professionalServicesApi.fetchServiceSummaries', () => {
  beforeEach(() => getMock.mockReset())

  it('maps a 200 success body to a minimal summary, dropping duration/price', async () => {
    getMock.mockResolvedValueOnce(
      ok({
        items: [
          {
            id: 's-1',
            name: 'Corte clásico',
            description: null,
            durationMinutes: 30,
            price: '45000.00',
            currency: 'COP',
            createdAt: '2026-08-24T15:04:05Z',
            updatedAt: '2026-08-24T15:04:05Z',
          },
        ],
        nextCursor: null,
      }),
    )

    const outcome = await fetchServiceSummaries()

    expect(outcome).toEqual({ kind: 'success', items: [{ id: 's-1', name: 'Corte clásico' }] })
  })
})

describe('professionalServicesApi.fetchAssignments', () => {
  beforeEach(() => getMock.mockReset())

  it('maps a 200 success body to a page of assignments', async () => {
    getMock.mockResolvedValueOnce(
      ok({
        items: [{ professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' }],
        nextCursor: null,
      }),
    )

    const outcome = await fetchAssignments('b-1')

    expect(outcome).toEqual({
      kind: 'success',
      page: {
        items: [{ professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' }],
        nextCursor: null,
      },
    })
    expect(getMock).toHaveBeenCalledWith('/private/professionals/{professionalId}/services', {
      params: { path: { professionalId: 'b-1' }, query: {} },
    })
  })

  it('maps a 404 to not-found (CA-023-04: unknown or cross-tenant professional)', async () => {
    getMock.mockResolvedValueOnce(problem(404))
    expect(await fetchAssignments('unknown')).toEqual({ kind: 'not-found' })
  })

  it('forwards the cursor as a query parameter when provided', async () => {
    getMock.mockResolvedValueOnce(ok({ items: [], nextCursor: null }))
    await fetchAssignments('b-1', 'opaque-cursor')
    expect(getMock).toHaveBeenCalledWith('/private/professionals/{professionalId}/services', {
      params: { path: { professionalId: 'b-1' }, query: { cursor: 'opaque-cursor' } },
    })
  })
})

describe('professionalServicesApi.assignService', () => {
  beforeEach(() => putMock.mockReset())

  it('maps a 201 success body to a success outcome', async () => {
    putMock.mockResolvedValueOnce(
      created({ professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' }),
    )

    const outcome = await assignService('b-1', 's-1')

    expect(outcome).toEqual({
      kind: 'success',
      assignment: { professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' },
    })
    expect(putMock).toHaveBeenCalledWith(
      '/private/professionals/{professionalId}/services/{serviceId}',
      {
        params: { path: { professionalId: 'b-1', serviceId: 's-1' } },
      },
    )
  })

  it('maps a 200 replay body to a success outcome too (CA-023-02)', async () => {
    putMock.mockResolvedValueOnce(
      ok({ professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' }),
    )
    const outcome = await assignService('b-1', 's-1')
    expect(outcome.kind).toBe('success')
  })

  it('maps a 404 to not-found', async () => {
    putMock.mockResolvedValueOnce(problem(404))
    expect(await assignService('unknown', 's-1')).toEqual({ kind: 'not-found' })
  })

  it('maps a network failure to network-error', async () => {
    putMock.mockRejectedValueOnce(new Error('fetch failed'))
    expect(await assignService('b-1', 's-1')).toEqual({ kind: 'network-error' })
  })
})

describe('professionalServicesApi.unassignService', () => {
  beforeEach(() => deleteMock.mockReset())

  it('maps a 204 success to a success outcome', async () => {
    deleteMock.mockResolvedValueOnce({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    })
    expect(await unassignService('b-1', 's-1')).toEqual({ kind: 'success' })
  })

  it('maps a 404 to not-found', async () => {
    deleteMock.mockResolvedValueOnce(problem(404))
    expect(await unassignService('unknown', 's-1')).toEqual({ kind: 'not-found' })
  })

  it('maps any other failure status, including 409, to unexpected-error', async () => {
    deleteMock.mockResolvedValueOnce(problem(409, { code: 'conflict' }))
    expect(await unassignService('b-1', 's-1')).toEqual({ kind: 'unexpected-error' })
  })

  it('maps a network failure to network-error', async () => {
    deleteMock.mockRejectedValueOnce(new Error('fetch failed'))
    expect(await unassignService('b-1', 's-1')).toEqual({ kind: 'network-error' })
  })
})
