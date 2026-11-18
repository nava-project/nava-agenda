// Modelo de dominio de la selección pública de profesional (HU-092).
// `PublicProfessional` es la forma que la página consume; `ListPublicProfessionalsOutcome`
// es lo único que `api/listPublicProfessionalsApi.ts` entrega. Ninguno de los dos
// expone la forma RFC 9457 (`Problem`) del contrato (docs/03-desarrollo/
// estandar-frontend-vue.md §6), mismo criterio que
// model/publicServiceListOutcome.ts.

/** Profesional público con asignación vigente al servicio activo elegido
 * (CA-092-02). Por DEC-127 incluye su descripción opcional y la versión de su
 * fotografía opcional (los bytes se piden aparte, ver `publicProfessionalPhotoUrl`);
 * nunca preferencia ni ningún otro dato interno. */
export interface PublicProfessional {
  id: string
  fullName: string
  /** Descripción corta que escribió el negocio, o null si no tiene. */
  description: string | null
  /** Versión de la fotografía, o null si no tiene (se muestra el monograma). */
  photoUpdatedAt: string | null
  /** Promedio de 1 decimal de sus reseñas visibles (DEC-128), o null sin ninguna. */
  rating: number | null
  /** Total de reseñas visibles. */
  ratingCount: number
}

/** Resultado discriminado de listar los profesionales elegibles contra el API
 * real. `not-found` cubre las mismas tres causas indistinguibles de
 * CA-090-02 (slug con forma inválida, desconocido, no publicable) que
 * `ListPublicServicesOutcome`; un `serviceId` ajeno, inexistente, ya no
 * asignado o de un servicio inactivo NUNCA produce `not-found`: llega como
 * `success` con `professionals: []` (CA-092-03, misma respuesta uniforme que
 * "cero profesionales asignados hoy"). `network-error` y `unexpected-error` son
 * las mismas fronteras defensivas del resto de la aplicación. */
export type ListPublicProfessionalsOutcome =
  | { kind: 'success'; professionals: PublicProfessional[] }
  | { kind: 'not-found' }
  | { kind: 'network-error' }
  | { kind: 'unexpected-error'; requestId?: string }
