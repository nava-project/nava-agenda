/**
 * Pruebas del cliente tipado (`staffApi` sobre `shared/api/httpClient`):
 * mapeo por `status` (nunca por `detail`), mismo criterio que
 * `settings/api/__tests__/settingsApi.test.ts`. El recorrido de red real
 * vive en un E2E propio de HU-021.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
const patchMock = vi.hoisted(() => vi.fn())
const putMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api/httpClient', () => ({
  httpClient: {
    GET: getMock,
    POST: postMock,
    PATCH: patchMock,
    PUT: putMock,
    DELETE: deleteMock,
  },
}))

const {
  fetchProfessionals,
  fetchProfessionalPage,
  createProfessional,
  renameProfessional,
  uploadProfessionalPhoto,
  removeProfessionalPhoto,
  professionalPhotoUrl,
  fetchMyProfessional,
  linkMyProfessional,
  unlinkMyProfessional,
} = await import('../staffApi')

function ok(body: unknown) {
  return { data: body, error: undefined, response: new Response(null, { status: 200 }) }
}

function created(body: unknown) {
  return { data: body, error: undefined, response: new Response(null, { status: 201 }) }
}

function problem(status: number, body: Record<string, unknown> = {}) {
  return { data: undefined, error: body, response: new Response(null, { status }) }
}

const professionalBody = {
  id: '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4',
  fullName: 'Carlos Ramírez',
  createdAt: '2026-08-23T15:04:05Z',
  updatedAt: '2026-08-23T15:04:05Z',
  photoUpdatedAt: null,
  description: null,
  rating: null,
  ratingCount: 0,
}

describe('staffApi.fetchProfessionals', () => {
  beforeEach(() => getMock.mockReset())

  it('maps a 200 success body to a success outcome with items and nextCursor', async () => {
    getMock.mockResolvedValueOnce(ok({ items: [professionalBody], nextCursor: null }))

    const outcome = await fetchProfessionals()

    expect(outcome).toEqual({
      kind: 'success',
      page: { items: [professionalBody], nextCursor: null },
    })
  })

  it('forwards the cursor as a query parameter when provided', async () => {
    getMock.mockResolvedValueOnce(ok({ items: [], nextCursor: null }))

    await fetchProfessionals('opaque-cursor')

    expect(getMock).toHaveBeenCalledWith('/private/professionals', {
      params: { query: { cursor: 'opaque-cursor' } },
    })
  })

  it('sends no cursor query parameter for the first page', async () => {
    getMock.mockResolvedValueOnce(ok({ items: [], nextCursor: null }))

    await fetchProfessionals()

    expect(getMock).toHaveBeenCalledWith('/private/professionals', { params: { query: {} } })
  })

  it('maps any non-2xx status to unexpected-error (401 handled globally)', async () => {
    getMock.mockResolvedValueOnce(problem(401))

    const outcome = await fetchProfessionals()

    expect(outcome).toEqual({ kind: 'unexpected-error' })
  })

  it('maps a rejected request (no HTTP response) to network-error', async () => {
    getMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const outcome = await fetchProfessionals()

    expect(outcome).toEqual({ kind: 'network-error' })
  })
})

describe('staffApi.createProfessional', () => {
  beforeEach(() => postMock.mockReset())

  it('sends fullName and the Idempotency-Key header', async () => {
    postMock.mockResolvedValueOnce(created(professionalBody))

    await createProfessional('Carlos Ramírez', 'idem-key-1')

    expect(postMock).toHaveBeenCalledWith('/private/professionals', {
      params: { header: { 'Idempotency-Key': 'idem-key-1' } },
      body: { fullName: 'Carlos Ramírez' },
    })
  })

  it('sends a trimmed description when there is one (DEC-127)', async () => {
    postMock.mockResolvedValueOnce(created({ ...professionalBody, description: 'Fade y barba.' }))

    const outcome = await createProfessional('Carlos Ramírez', 'idem-key-1', '  Fade y barba.  ')

    expect(postMock).toHaveBeenCalledWith('/private/professionals', {
      params: { header: { 'Idempotency-Key': 'idem-key-1' } },
      body: { fullName: 'Carlos Ramírez', description: 'Fade y barba.' },
    })
    expect(outcome).toEqual({
      kind: 'success',
      professional: { ...professionalBody, description: 'Fade y barba.' },
    })
  })

  it('omits a blank description from the body', async () => {
    postMock.mockResolvedValueOnce(created(professionalBody))

    await createProfessional('Carlos Ramírez', 'idem-key-1', '   ')

    expect(postMock).toHaveBeenCalledWith('/private/professionals', {
      params: { header: { 'Idempotency-Key': 'idem-key-1' } },
      body: { fullName: 'Carlos Ramírez' },
    })
  })

  it('maps a 201 success body to a success outcome', async () => {
    postMock.mockResolvedValueOnce(created(professionalBody))

    const outcome = await createProfessional('Carlos Ramírez', 'idem-key-1')

    expect(outcome).toEqual({ kind: 'success', professional: professionalBody })
  })

  it('maps 422 to validation-error', async () => {
    postMock.mockResolvedValueOnce(problem(422, { code: 'validation-error' }))

    const outcome = await createProfessional('', 'idem-key-1')

    expect(outcome).toEqual({ kind: 'validation-error' })
  })

  it('maps 409 to idempotency-conflict', async () => {
    postMock.mockResolvedValueOnce(problem(409, { code: 'idempotency-conflict' }))

    const outcome = await createProfessional('Carlos Ramírez', 'reused-key')

    expect(outcome).toEqual({ kind: 'idempotency-conflict' })
  })

  it('maps a 500 to unexpected-error', async () => {
    postMock.mockResolvedValueOnce(problem(500, { code: 'internal-error' }))

    const outcome = await createProfessional('Carlos Ramírez', 'idem-key-1')

    expect(outcome).toEqual({ kind: 'unexpected-error' })
  })

  it('maps a rejected request (no HTTP response) to network-error', async () => {
    postMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const outcome = await createProfessional('Carlos Ramírez', 'idem-key-1')

    expect(outcome).toEqual({ kind: 'network-error' })
  })
})

describe('staffApi.renameProfessional', () => {
  beforeEach(() => patchMock.mockReset())

  it('sends the professionalId as a path parameter and fullName as the body', async () => {
    patchMock.mockResolvedValueOnce(ok(professionalBody))

    await renameProfessional(professionalBody.id, 'Nuevo Nombre')

    expect(patchMock).toHaveBeenCalledWith('/private/professionals/{professionalId}', {
      params: { path: { professionalId: professionalBody.id } },
      body: { fullName: 'Nuevo Nombre' },
    })
  })

  it('sends the description when it changed and null to remove it (DEC-127)', async () => {
    patchMock.mockResolvedValue(ok(professionalBody))

    await renameProfessional(professionalBody.id, 'Carlos', ' Fade y barba. ')
    await renameProfessional(professionalBody.id, 'Carlos', '   ')

    expect(patchMock).toHaveBeenNthCalledWith(1, '/private/professionals/{professionalId}', {
      params: { path: { professionalId: professionalBody.id } },
      body: { fullName: 'Carlos', description: 'Fade y barba.' },
    })
    expect(patchMock).toHaveBeenNthCalledWith(2, '/private/professionals/{professionalId}', {
      params: { path: { professionalId: professionalBody.id } },
      body: { fullName: 'Carlos', description: null },
    })
  })

  it('treats a missing description in a response as no description', async () => {
    const withoutDescription: Partial<typeof professionalBody> = { ...professionalBody }
    delete withoutDescription.description
    patchMock.mockResolvedValueOnce(ok(withoutDescription))

    const outcome = await renameProfessional(professionalBody.id, 'Carlos Ramírez')

    expect(outcome).toEqual({ kind: 'success', professional: professionalBody })
  })

  it('maps a 200 success body to a success outcome', async () => {
    patchMock.mockResolvedValueOnce(ok(professionalBody))

    const outcome = await renameProfessional(professionalBody.id, 'Carlos Ramírez')

    expect(outcome).toEqual({ kind: 'success', professional: professionalBody })
  })

  it('maps 404 to not-found', async () => {
    patchMock.mockResolvedValueOnce(problem(404, { code: 'not-found' }))

    const outcome = await renameProfessional('unknown-id', 'X')

    expect(outcome).toEqual({ kind: 'not-found' })
  })

  it('maps 422 to validation-error', async () => {
    patchMock.mockResolvedValueOnce(problem(422, { code: 'validation-error' }))

    const outcome = await renameProfessional(professionalBody.id, '')

    expect(outcome).toEqual({ kind: 'validation-error' })
  })

  it('maps a rejected request (no HTTP response) to network-error', async () => {
    patchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const outcome = await renameProfessional(professionalBody.id, 'X')

    expect(outcome).toEqual({ kind: 'network-error' })
  })
})

describe('staffApi professional photo mapping (DEC-104)', () => {
  beforeEach(() => getMock.mockReset())

  it('keeps photoUpdatedAt when the professional has a photo', async () => {
    const withPhoto = { ...professionalBody, photoUpdatedAt: '2026-09-30T12:00:00Z' }
    getMock.mockResolvedValueOnce(ok({ items: [withPhoto], nextCursor: null }))

    const outcome = await fetchProfessionals()

    expect(outcome).toEqual({ kind: 'success', page: { items: [withPhoto], nextCursor: null } })
  })

  it('treats a missing photoUpdatedAt (a replayed pre-DEC-104 response) as no photo', async () => {
    const { photoUpdatedAt: _omitted, ...legacy } = professionalBody
    void _omitted
    getMock.mockResolvedValueOnce(ok({ items: [legacy], nextCursor: null }))

    const outcome = await fetchProfessionals()

    expect(outcome).toEqual({
      kind: 'success',
      page: { items: [professionalBody], nextCursor: null },
    })
  })
})

describe('staffApi.professionalPhotoUrl', () => {
  it('returns null while the professional has no photo', () => {
    expect(professionalPhotoUrl({ id: 'b-1', photoUpdatedAt: null })).toBeNull()
  })

  it('versions the URL with photoUpdatedAt so a new photo never reuses a stale cache entry', () => {
    const url = professionalPhotoUrl({ id: 'b-1', photoUpdatedAt: '2026-09-30T12:00:00Z' })
    expect(url).toBe('/api/v1/private/professionals/b-1/photo?v=2026-09-30T12%3A00%3A00Z')
    expect(professionalPhotoUrl({ id: 'b-1', photoUpdatedAt: '2026-10-01T09:00:00Z' })).not.toBe(
      url,
    )
  })
})

describe('staffApi.uploadProfessionalPhoto', () => {
  beforeEach(() => putMock.mockReset())

  const blob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })

  it('sends the blob untouched with its own Content-Type and the professionalId as a path parameter', async () => {
    putMock.mockResolvedValueOnce(
      ok({ ...professionalBody, photoUpdatedAt: '2026-09-30T12:00:00Z' }),
    )

    await uploadProfessionalPhoto(professionalBody.id, blob)

    const [path, init] = putMock.mock.calls[0]!
    expect(path).toBe('/private/professionals/{professionalId}/photo')
    expect(init.params).toEqual({ path: { professionalId: professionalBody.id } })
    expect(init.headers).toEqual({ 'Content-Type': 'image/jpeg' })
    expect(init.body).toBe(blob)
    // El serializador deja pasar el Blob: nunca lo convierte a JSON.
    expect(init.bodySerializer(blob)).toBe(blob)
  })

  it('maps a 200 body to a success outcome with the new photoUpdatedAt', async () => {
    const updated = { ...professionalBody, photoUpdatedAt: '2026-09-30T12:00:00Z' }
    putMock.mockResolvedValueOnce(ok(updated))

    expect(await uploadProfessionalPhoto(professionalBody.id, blob)).toEqual({
      kind: 'success',
      professional: updated,
    })
  })

  it.each([
    [404, 'not-found'],
    [422, 'validation-error'],
    [500, 'unexpected-error'],
  ])('maps status %i to %s', async (status, kind) => {
    putMock.mockResolvedValueOnce(problem(status))
    expect(await uploadProfessionalPhoto(professionalBody.id, blob)).toEqual({ kind })
  })

  it('maps a rejected request (no HTTP response) to network-error', async () => {
    putMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await uploadProfessionalPhoto(professionalBody.id, blob)).toEqual({
      kind: 'network-error',
    })
  })
})

describe('staffApi.removeProfessionalPhoto', () => {
  beforeEach(() => deleteMock.mockReset())

  it('maps a 204 to success and sends the professionalId as a path parameter', async () => {
    deleteMock.mockResolvedValueOnce({
      data: undefined,
      response: new Response(null, { status: 204 }),
    })

    expect(await removeProfessionalPhoto(professionalBody.id)).toEqual({ kind: 'success' })
    expect(deleteMock).toHaveBeenCalledWith('/private/professionals/{professionalId}/photo', {
      params: { path: { professionalId: professionalBody.id } },
    })
  })

  it.each([
    [404, 'not-found'],
    [500, 'unexpected-error'],
  ])('maps status %i to %s', async (status, kind) => {
    deleteMock.mockResolvedValueOnce(problem(status))
    expect(await removeProfessionalPhoto(professionalBody.id)).toEqual({ kind })
  })

  it('maps a rejected request (no HTTP response) to network-error', async () => {
    deleteMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await removeProfessionalPhoto(professionalBody.id)).toEqual({ kind: 'network-error' })
  })
})

describe('staffApi.fetchProfessionalPage (#288)', () => {
  beforeEach(() => getMock.mockReset())
  it('requests the numbered mode and maps exact page metadata', async () => {
    getMock.mockResolvedValueOnce(
      ok({
        items: [professionalBody],
        nextCursor: null,
        page: 2,
        pageSize: 3,
        total: 4,
        totalPages: 2,
      }),
    )
    expect(await fetchProfessionalPage(2, 3)).toEqual({
      kind: 'success',
      page: { items: [professionalBody], page: 2, pageSize: 3, total: 4, totalPages: 2 },
    })
    expect(getMock).toHaveBeenCalledWith('/private/professionals', {
      params: { query: { page: 2, pageSize: 3 } },
    })
  })
  it('rejects a cursor response instead of inventing numbered metadata', async () => {
    getMock.mockResolvedValueOnce(ok({ items: [professionalBody], nextCursor: null }))
    expect(await fetchProfessionalPage(1, 3)).toEqual({ kind: 'unexpected-error' })
  })
})

// DEC-100: el vínculo propio actúa sobre la sesión, nunca sobre otro usuario.
describe('staffApi.fetchMyProfessional', () => {
  beforeEach(() => getMock.mockReset())

  it('maps a 200 to the linked professional and sends no user identifier', async () => {
    getMock.mockResolvedValueOnce(ok({ professional: professionalBody }))
    expect(await fetchMyProfessional()).toEqual({ kind: 'linked', professional: professionalBody })
    expect(getMock).toHaveBeenCalledWith('/private/me/professional')
  })

  // DEC-192 (#721): «sin ficha» es un estado del contrato, un 200 con professional null.
  it('maps a 200 with professional null to none: the link is optional, not an error', async () => {
    getMock.mockResolvedValueOnce(ok({ professional: null }))
    expect(await fetchMyProfessional()).toEqual({ kind: 'none' })
  })

  it('maps other statuses, including a 404 the contract no longer has, and a rejected request', async () => {
    getMock.mockResolvedValueOnce(problem(404))
    expect(await fetchMyProfessional()).toEqual({ kind: 'unexpected-error' })
    getMock.mockResolvedValueOnce(problem(500))
    expect(await fetchMyProfessional()).toEqual({ kind: 'unexpected-error' })
    getMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await fetchMyProfessional()).toEqual({ kind: 'network-error' })
  })
})

describe('staffApi.linkMyProfessional', () => {
  beforeEach(() => putMock.mockReset())

  it('sends only the professionalId in the body', async () => {
    putMock.mockResolvedValueOnce(ok(professionalBody))
    expect(await linkMyProfessional(professionalBody.id)).toEqual({
      kind: 'success',
      professional: professionalBody,
    })
    expect(putMock).toHaveBeenCalledWith('/private/me/professional', {
      body: { professionalId: professionalBody.id },
    })
  })

  it.each([
    [404, 'not-found'],
    [409, 'taken'],
    [500, 'unexpected-error'],
  ])('maps status %i to %s', async (status, kind) => {
    putMock.mockResolvedValueOnce(problem(status))
    expect(await linkMyProfessional(professionalBody.id)).toEqual({ kind })
  })

  it('maps a rejected request (no HTTP response) to network-error', async () => {
    putMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await linkMyProfessional(professionalBody.id)).toEqual({ kind: 'network-error' })
  })
})

describe('staffApi.unlinkMyProfessional', () => {
  beforeEach(() => deleteMock.mockReset())

  it('maps a 204 to success', async () => {
    deleteMock.mockResolvedValueOnce({
      data: undefined,
      response: new Response(null, { status: 204 }),
    })
    expect(await unlinkMyProfessional()).toEqual({ kind: 'success' })
    expect(deleteMock).toHaveBeenCalledWith('/private/me/professional')
  })

  it('maps other statuses and a rejected request', async () => {
    deleteMock.mockResolvedValueOnce(problem(500))
    expect(await unlinkMyProfessional()).toEqual({ kind: 'unexpected-error' })
    deleteMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await unlinkMyProfessional()).toEqual({ kind: 'network-error' })
  })
})
