// La hora que el cliente eligió en «Día y hora», a mano para cuando vuelve
// desde «Tus datos» (H7, #824): con «atrás» del navegador o con el enlace
// «Día y hora», la hora vuelve marcada y el pase listo para seguir. Antes la
// pantalla volvía a leer las horas y olvidaba la elección.
//
// Vive solo en memoria y por negocio y servicio. Se olvida al confirmar el
// turno y al pedir otro horario tras un conflicto: ahí ya no hay nada que
// recuperar.

const bySlugAndService = new Map<string, string>()

const keyFor = (slug: string, serviceId: string) => `${slug}\u0000${serviceId}`

export function rememberChosenStart(slug: string, serviceId: string, startsAt: string): void {
  bySlugAndService.set(keyFor(slug, serviceId), startsAt)
}

/** El inicio de la última hora elegida para el servicio, o `null`. */
export function chosenStartFor(slug: string, serviceId: string): string | null {
  return bySlugAndService.get(keyFor(slug, serviceId)) ?? null
}

export function forgetChosenStart(slug: string, serviceId: string): void {
  bySlugAndService.delete(keyFor(slug, serviceId))
}

/** Solo para pruebas: olvida todo. */
export function resetChosenStarts(): void {
  bySlugAndService.clear()
}
