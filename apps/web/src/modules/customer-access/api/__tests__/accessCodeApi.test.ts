// Clientes del acceso con código (HU-105): pedir y verificar. Se mapean por `status`,
// nunca por `detail`, y ninguno deja ver `Problem` a la página.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { POST: postMock } }))

const { requestAccessCode } = await import('../requestAccessCodeApi')
const { verifyAccessCode } = await import('../verifyAccessCodeApi')

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: 'req-1',
})

const reply = (status: number, data?: unknown, error?: unknown, headers: HeadersInit = {}) =>
  postMock.mockResolvedValueOnce({
    data,
    error,
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
    } as Response,
  })

beforeEach(() => postMock.mockReset())

describe('requestAccessCode', () => {
  it('envía el contacto tal cual y la ruta con el slug', async () => {
    reply(202, { expiresInSeconds: 600, resendAfterSeconds: 60 })
    const outcome = await requestAccessCode('mi-barberia', ' Ana@Correo.Test ')

    expect(postMock).toHaveBeenCalledWith('/public/barbershops/{slug}/customer-access/challenge', {
      params: { path: { slug: 'mi-barberia' } },
      body: { contact: ' Ana@Correo.Test ' },
    })
    expect(outcome).toEqual({ kind: 'sent', expiresInSeconds: 600, resendAfterSeconds: 60 })
  })

  it('lee Retry-After del 429 y usa un valor por defecto si falta o no es válido', async () => {
    reply(429, undefined, problem(429, 'rate-limited'), { 'Retry-After': '540' })
    expect(await requestAccessCode('s', 'a@b.co')).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: 540,
    })

    reply(429, undefined, problem(429, 'rate-limited'))
    expect(await requestAccessCode('s', 'a@b.co')).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: 60,
    })

    reply(429, undefined, problem(429, 'rate-limited'), { 'Retry-After': 'pronto' })
    expect(await requestAccessCode('s', 'a@b.co')).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: 60,
    })
  })

  it('traduce 400/422 a contacto inválido y 404 a barbería inexistente', async () => {
    reply(422, undefined, problem(422, 'validation'))
    expect(await requestAccessCode('s', 'x')).toEqual({ kind: 'invalid-contact' })
    reply(400, undefined, problem(400, 'invalid-request'))
    expect(await requestAccessCode('s', 'x')).toEqual({ kind: 'invalid-contact' })
    reply(404, undefined, problem(404, 'not-found'))
    expect(await requestAccessCode('s', 'x')).toEqual({ kind: 'barbershop-not-found' })
  })

  it('devuelve el requestId en un error inesperado y network-error si no hay respuesta', async () => {
    reply(500, undefined, problem(500, 'internal'))
    expect(await requestAccessCode('s', 'x')).toEqual({
      kind: 'unexpected-error',
      requestId: 'req-1',
    })
    postMock.mockRejectedValueOnce(new TypeError('fallo de red'))
    expect(await requestAccessCode('s', 'x')).toEqual({ kind: 'network-error' })
  })
})

describe('verifyAccessCode', () => {
  const granted = {
    timezone: 'America/Bogota',
    appointments: [
      {
        accessToken: 'tok-1',
        startsAt: '2027-03-15T15:00:00Z',
        serviceName: 'Corte',
        barberName: 'Juan',
      },
    ],
  }

  it('devuelve el acceso concedido con un token por turno', async () => {
    reply(200, granted)
    const outcome = await verifyAccessCode('mi-barberia', 'a@b.co', '482913')

    expect(postMock).toHaveBeenCalledWith('/public/barbershops/{slug}/customer-access/verify', {
      params: { path: { slug: 'mi-barberia' } },
      body: { contact: 'a@b.co', code: '482913' },
    })
    expect(outcome).toEqual({ kind: 'granted', grant: granted })
  })

  it('cualquier 401 es el mismo código inválido', async () => {
    reply(401, undefined, problem(401, 'unauthorized'))
    expect(await verifyAccessCode('s', 'a@b.co', '111111')).toEqual({ kind: 'invalid-code' })
  })

  it('traduce 400/422, 404, error inesperado y red', async () => {
    reply(422, undefined, problem(422, 'validation'))
    expect(await verifyAccessCode('s', 'x', '1')).toEqual({ kind: 'invalid-contact' })
    reply(404, undefined, problem(404, 'not-found'))
    expect(await verifyAccessCode('s', 'a@b.co', '111111')).toEqual({
      kind: 'barbershop-not-found',
    })
    reply(503, undefined, problem(503, 'unavailable'))
    expect(await verifyAccessCode('s', 'a@b.co', '111111')).toEqual({
      kind: 'unexpected-error',
      requestId: 'req-1',
    })
    postMock.mockRejectedValueOnce(new TypeError('fallo de red'))
    expect(await verifyAccessCode('s', 'a@b.co', '111111')).toEqual({ kind: 'network-error' })
  })
})

// HU-106: el enlace de Odin canjea una referencia + el código por el acceso a ese turno.
describe('verifyAccessRef', () => {
  it('envía la referencia y el código a la ruta con el slug y devuelve el acceso y el propósito', async () => {
    const { verifyAccessRef } = await import('../verifyAccessRefApi')
    reply(200, { accessToken: 'tok-1', purpose: 'cancel' })
    const outcome = await verifyAccessRef('mi-barberia', 'ref-opaca', '482913')

    expect(postMock).toHaveBeenCalledWith('/public/barbershops/{slug}/customer-access/verify-ref', {
      params: { path: { slug: 'mi-barberia' } },
      body: { accessRef: 'ref-opaca', code: '482913' },
    })
    expect(outcome).toEqual({ kind: 'granted', accessToken: 'tok-1', purpose: 'cancel' })
  })

  it('traduce por status: 401 a código inválido, 400/422 a entrada inválida y 404 a barbería inexistente', async () => {
    const { verifyAccessRef } = await import('../verifyAccessRefApi')
    reply(401, undefined, problem(401, 'unauthorized'))
    expect(await verifyAccessRef('s', 'r', '111111')).toEqual({ kind: 'invalid-code' })
    reply(422, undefined, problem(422, 'validation'))
    expect(await verifyAccessRef('s', 'r', '1')).toEqual({ kind: 'invalid-input' })
    reply(400, undefined, problem(400, 'invalid-request'))
    expect(await verifyAccessRef('s', 'r', '1')).toEqual({ kind: 'invalid-input' })
    reply(404, undefined, problem(404, 'not-found'))
    expect(await verifyAccessRef('s', 'r', '111111')).toEqual({ kind: 'barbershop-not-found' })
  })

  it('devuelve el requestId en un error inesperado y network-error si no hay respuesta', async () => {
    const { verifyAccessRef } = await import('../verifyAccessRefApi')
    reply(500, undefined, problem(500, 'internal'))
    expect(await verifyAccessRef('s', 'r', '111111')).toEqual({
      kind: 'unexpected-error',
      requestId: 'req-1',
    })
    postMock.mockRejectedValueOnce(new TypeError('fallo de red'))
    expect(await verifyAccessRef('s', 'r', '111111')).toEqual({ kind: 'network-error' })
  })
})
