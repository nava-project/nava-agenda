// Único punto del módulo `public-booking` que llama a
// `GET /public/businesses/{slug}/professionals/{professionalId}/reviews` (HU-100).
import { httpClient } from '@/shared/api/httpClient'
import { isProblem } from '@/shared/api/problem'
import type { ListPublicProfessionalReviewsOutcome } from '../model/publicProfessionalReviewsOutcome'

/**
 * Lista las reseñas visibles del profesional. Mapea por `status`: 404 cubre slug o
 * profesional inexistente (indistinguibles a propósito); cualquier otro no-2xx es
 * inesperado y un fallo de `fetch` es error de red.
 */
export async function listPublicProfessionalReviews(
  slug: string,
  professionalId: string,
): Promise<ListPublicProfessionalReviewsOutcome> {
  try {
    const { data, error, response } = await httpClient.GET(
      '/public/businesses/{slug}/professionals/{professionalId}/reviews',
      { params: { path: { slug, professionalId: professionalId } } },
    )

    if (response.ok && data) {
      return {
        kind: 'success',
        reviews: {
          rating: data.rating ?? null,
          ratingCount: data.ratingCount,
          items: data.items.map((item) => ({
            rating: item.rating,
            comment: item.comment ?? null,
            createdAt: item.createdAt,
          })),
        },
      }
    }

    if (response.status === 404) return { kind: 'not-found' }
    return { kind: 'unexpected-error', requestId: isProblem(error) ? error.requestId : undefined }
  } catch {
    return { kind: 'network-error' }
  }
}
