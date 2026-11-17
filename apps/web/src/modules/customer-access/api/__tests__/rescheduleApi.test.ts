// Clientes de la reprogramación del cliente (HU-104): lista de franjas y envío.
// Se mapean por `status` y `code`, nunca por `detail`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { GET: getMock, POST: postMock } }))

const { listRescheduleSlots } = await import('../listRescheduleSlotsApi')
const { rescheduleCustomerAppointment } = await import('../rescheduleCustomerAppointmentApi')

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: 'req-1',
})

function respondPost(status: number, error?: unknown) {
  postMock.mockResolvedValueOnce({
    data:
      status === 200
        ? { startsAt: '2027-03-16T14:00:00Z', endsAt: '2027-03-16T14:30:00Z' }
        : undefined,
    error,
    response: { ok: status >= 200 && status < 300, status } as Response,
  })
}

beforeEach(() => {
  getMock.mockReset()
  postMock.mockReset()
})

describe('listRescheduleSlots', () => {
  it('devuelve la zona y los inicios del servidor', async () => {
    getMock.mockResolvedValueOnce({
      data: { timezone: 'America/Bogota', starts: ['2027-03-16T14:00:00Z'] },
      error: undefined,
      response: { ok: true, status: 200 } as Response,
    })
    expect(await listRescheduleSlots('tok')).toEqual({
      kind: 'success',
      slots: { timezone: 'America/Bogota', starts: ['2027-03-16T14:00:00Z'] },
    })
    expect(getMock).toHaveBeenCalledWith('/customer/appointments/{token}/reschedule-slots', {
      params: { path: { token: 'tok' } },
    })
  })

  it('404 es el enlace que ya no sirve; 500 es inesperado con requestId', async () => {
    getMock.mockResolvedValueOnce({
      data: undefined,
      error: problem(404, 'not-found'),
      response: { ok: false, status: 404 } as Response,
    })
    expect(await listRescheduleSlots('tok')).toEqual({ kind: 'not-found' })
    getMock.mockResolvedValueOnce({
      data: undefined,
      error: problem(500, 'internal-error'),
      response: { ok: false, status: 500 } as Response,
    })
    expect(await listRescheduleSlots('tok')).toEqual({
      kind: 'unexpected-error',
      requestId: 'req-1',
    })
  })

  it('un fallo de fetch es error de red', async () => {
    getMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await listRescheduleSlots('tok')).toEqual({ kind: 'network-error' })
  })
})

describe('rescheduleCustomerAppointment', () => {
  it('envía token, Idempotency-Key, If-Match y la hora nueva', async () => {
    respondPost(200)
    const outcome = await rescheduleCustomerAppointment(
      'tok',
      'v-1',
      'key-1',
      '2027-03-16T14:00:00Z',
    )

    expect(outcome).toEqual({
      kind: 'success',
      startsAt: '2027-03-16T14:00:00Z',
      endsAt: '2027-03-16T14:30:00Z',
    })
    expect(postMock).toHaveBeenCalledWith('/customer/appointments/{token}/reschedule', {
      params: {
        path: { token: 'tok' },
        header: { 'Idempotency-Key': 'key-1', 'If-Match': 'v-1' },
      },
      body: { startsAt: '2027-03-16T14:00:00Z' },
    })
  })

  it.each([
    [409, 'slot-conflict', 'slot-taken'],
    [409, 'idempotency-locked', 'idempotency-in-progress'],
    [409, 'version-conflict', 'changed'],
    [409, 'invalid-state', 'changed'],
    [422, 'reschedule-window-closed', 'window-closed'],
    [422, 'reschedule-limit-reached', 'limit-reached'],
    [422, 'validation-error', 'validation-error'],
    [400, 'invalid-request', 'validation-error'],
    [404, 'not-found', 'not-found'],
  ])('mapea %i/%s a %s', async (status, code, kind) => {
    respondPost(status, problem(status, code))
    expect((await rescheduleCustomerAppointment('tok', 'v', 'k', 's')).kind).toBe(kind)
  })

  it('un 500 es inesperado y conserva el requestId; un fallo de fetch es de red', async () => {
    respondPost(500, problem(500, 'internal-error'))
    expect(await rescheduleCustomerAppointment('tok', 'v', 'k', 's')).toEqual({
      kind: 'unexpected-error',
      requestId: 'req-1',
    })
    postMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await rescheduleCustomerAppointment('tok', 'v', 'k', 's')).toEqual({
      kind: 'network-error',
    })
  })
})
