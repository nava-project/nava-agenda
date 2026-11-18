// Moderación de reseñas desde el panel (HU-100, DEC-128): único punto del módulo
// `staff` que llama a `GET /private/professionals/{professionalId}/reviews` y a
// `PATCH /private/professionals/{professionalId}/reviews/{reviewId}`. Mapea por `status`;
// el 401 lo atiende el cliente global.
import { httpClient } from '@/shared/api/httpClient'
import type {
  ProfessionalReview,
  ListProfessionalReviewsOutcome,
  SetReviewHiddenOutcome,
} from '../model/review'

interface ReviewWire {
  id: string
  rating: number
  comment?: string | null
  hiddenAt?: string | null
  createdAt: string
}

function toReview(data: ReviewWire): ProfessionalReview {
  return {
    id: data.id,
    rating: data.rating,
    comment: data.comment ?? null,
    hiddenAt: data.hiddenAt ?? null,
    createdAt: data.createdAt,
  }
}

export async function listProfessionalReviews(
  professionalId: string,
): Promise<ListProfessionalReviewsOutcome> {
  try {
    const { data, response } = await httpClient.GET(
      '/private/professionals/{professionalId}/reviews',
      {
        params: { path: { professionalId: professionalId } },
      },
    )
    if (response.ok && data) {
      return {
        kind: 'success',
        reviews: {
          rating: data.rating ?? null,
          ratingCount: data.ratingCount,
          items: data.items.map(toReview),
        },
      }
    }
    if (response.status === 404) return { kind: 'not-found' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}

/** Oculta (`hidden: true`) o vuelve a mostrar (`false`) una reseña. Reversible. */
export async function setReviewHidden(
  professionalId: string,
  reviewId: string,
  hidden: boolean,
): Promise<SetReviewHiddenOutcome> {
  try {
    const { data, response } = await httpClient.PATCH(
      '/private/professionals/{professionalId}/reviews/{reviewId}',
      { params: { path: { professionalId: professionalId, reviewId } }, body: { hidden } },
    )
    if (response.ok && data) return { kind: 'success', review: toReview(data) }
    if (response.status === 404) return { kind: 'not-found' }
    return { kind: 'unexpected-error' }
  } catch {
    return { kind: 'network-error' }
  }
}
