// Modelo de las reseñas públicas de un profesional (HU-100, DEC-128). La página
// solo ve estos tipos; la forma RFC 9457 queda dentro de
// `api/listPublicProfessionalReviewsApi.ts`.

/** Reseña visible: anónima para el visitante (sin turno ni cliente). */
export interface PublicProfessionalReview {
  rating: number
  comment: string | null
  createdAt: string
}

export interface PublicProfessionalReviews {
  rating: number | null
  ratingCount: number
  items: PublicProfessionalReview[]
}

export type ListPublicProfessionalReviewsOutcome =
  | { kind: 'success'; reviews: PublicProfessionalReviews }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
