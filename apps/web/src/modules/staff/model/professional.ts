// Espejo tipado del cuerpo real del contrato (CA-021-01/02/07, DEC-104):
// id, fullName, createdAt, updatedAt, photoUpdatedAt y description (DEC-127). `photoUpdatedAt` es
// null mientras el profesional no tiene fotografía (la pantalla muestra su
// monograma) y, cuando existe, la versión de la imagen: se añade a la URL para
// que un cambio de fotografía nunca se sirva desde una caché vieja.
// `description` es null mientras el profesional no tiene descripción: texto público
// que la reserva pública muestra junto a su nombre y su foto.
export interface Professional {
  id: string
  fullName: string
  createdAt: string
  updatedAt: string
  photoUpdatedAt: string | null
  description: string | null
  /** Promedio de 1 decimal de sus reseñas visibles (DEC-128), o null sin ninguna. */
  rating: number | null
  /** Total de reseñas visibles. */
  ratingCount: number
}

/** Página paginada por cursor (CA-021-02): mismo `items`/`nextCursor` que
 * ProfessionalListResponse. */
export interface ProfessionalPage {
  items: Professional[]
  nextCursor: string | null
}

export interface NumberedProfessionalPage {
  items: Professional[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
