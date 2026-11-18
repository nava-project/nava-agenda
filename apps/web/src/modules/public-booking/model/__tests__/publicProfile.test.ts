/**
 * Perfil público compartido (DEC-119): una sola petición en vuelo por enlace, y el
 * vocabulario queda disponible tras cualquier lectura exitosa, incluida la de un
 * reintento posterior a un fallo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveBusinessMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/resolveBusinessApi', () => ({ resolveBusiness: resolveBusinessMock }))

import { loadPublicProfile, publicTermsFor, resetPublicProfileCache } from '../publicProfile'

const vocabulary = {
  businessTerm: 'estudio',
  businessTermGender: 'masculine',
  professionalTerm: 'tatuadora',
  professionalTermPlural: 'tatuadoras',
  professionalTermGender: 'feminine',
} as const

const success = {
  kind: 'success' as const,
  profile: {
    name: 'Estudio Lila',
    timezone: 'America/Bogota',
    contactEmail: null,
    contactPhone: null,
    vocabulary,
  },
}

beforeEach(() => {
  resolveBusinessMock.mockReset()
  resetPublicProfileCache()
})

describe('loadPublicProfile', () => {
  it('shares one request between simultaneous callers for the same slug', async () => {
    resolveBusinessMock.mockResolvedValueOnce(success)

    const [a, b] = await Promise.all([loadPublicProfile('lila'), loadPublicProfile('lila')])

    expect(resolveBusinessMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('keeps the vocabulary of each slug apart', async () => {
    resolveBusinessMock.mockResolvedValueOnce(success)
    await loadPublicProfile('lila')

    expect(publicTermsFor('lila')).toEqual(vocabulary)
    expect(publicTermsFor('otra')).toBeNull()
  })

  it('does not remember a failure: a retry asks again and then exposes the vocabulary', async () => {
    resolveBusinessMock.mockResolvedValueOnce({ kind: 'network-error' })
    await loadPublicProfile('lila')
    expect(publicTermsFor('lila')).toBeNull()

    resolveBusinessMock.mockResolvedValueOnce(success)
    await loadPublicProfile('lila')

    expect(resolveBusinessMock).toHaveBeenCalledTimes(2)
    expect(publicTermsFor('lila')).toEqual(vocabulary)
  })
})
