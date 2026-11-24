// photoUrl: fotografía del profesional (DEC-104) o null/ausente si no tiene; sin ella
// se muestra su monograma.
export type ProfessionalSummary = { id: string; fullName: string; photoUrl?: string | null }
// Precio y duración del catálogo: los mismos que el servidor aplica al
// registrar un turno manual (no hay precio ni duración por profesional). La
// tarjeta del borrador los muestra antes de registrar (#833).
export type ServiceSummary = {
  id: string
  name: string
  durationMinutes: number
  price: string
  currency: string
}
