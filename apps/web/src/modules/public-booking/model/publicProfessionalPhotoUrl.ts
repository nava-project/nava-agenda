// URL de la fotografía pública de un profesional
// (GET /public/businesses/{slug}/professionals/{professionalId}/photo, DEC-127), lista para
// el `src` de una imagen: no lleva sesión. `photoUpdatedAt` va como parámetro de
// consulta solo para que el navegador no reutilice la copia de una fotografía
// anterior; el servidor lo ignora. Devuelve null cuando el profesional no tiene
// fotografía (se muestra su monograma). Mismo patrón que
// `shared/api/professionalPhotoUrl.ts`, que sirve a la fotografía privada del panel.
export function publicProfessionalPhotoUrl(
  slug: string,
  professional: { id: string; photoUpdatedAt: string | null },
): string | null {
  if (!professional.photoUpdatedAt) return null
  return `/api/v1/public/businesses/${encodeURIComponent(slug)}/professionals/${encodeURIComponent(professional.id)}/photo?v=${encodeURIComponent(professional.photoUpdatedAt)}`
}
