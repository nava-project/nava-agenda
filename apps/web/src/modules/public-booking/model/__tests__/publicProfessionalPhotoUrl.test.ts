import { describe, it, expect } from 'vitest'
import { publicProfessionalPhotoUrl } from '../publicProfessionalPhotoUrl'

describe('publicProfessionalPhotoUrl (DEC-127)', () => {
  it('returns null while the professional has no photo', () => {
    expect(publicProfessionalPhotoUrl('mi-barberia', { id: 'a', photoUpdatedAt: null })).toBeNull()
  })

  it('builds the public photo URL versioned with photoUpdatedAt', () => {
    expect(
      publicProfessionalPhotoUrl('mi-barberia', {
        id: 'a',
        photoUpdatedAt: '2026-09-30T12:00:00Z',
      }),
    ).toBe('/api/v1/public/businesses/mi-barberia/professionals/a/photo?v=2026-09-30T12%3A00%3A00Z')
  })

  it('encodes the slug and the professional id', () => {
    expect(
      publicProfessionalPhotoUrl('a/b?c', { id: 'x y', photoUpdatedAt: '2026-09-30T12:00:00Z' }),
    ).toContain('/businesses/a%2Fb%3Fc/professionals/x%20y/photo')
  })
})
