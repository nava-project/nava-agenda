// La hora que el cliente eligió en «Día y hora», a mano para cuando vuelve
// desde «Tus datos» (H7, #824): con «atrás» del navegador o con el enlace
// «Día y hora», la hora vuelve marcada y el pase listo para seguir. Antes la
// pantalla volvía a leer las horas y olvidaba la elección.
//
// Solo la vuelta desde «Tus datos» trae la hora a la vista
// (`markReturnFromDetails`); entrar de nuevo desde Servicios la deja marcada
// pero empieza arriba, con el foco en el título, como toda entrada nueva.
//
// Vive solo en memoria y por negocio y servicio. Se olvida al confirmar el
// turno y al pedir otro horario tras un conflicto: ahí ya no hay nada que
// recuperar.

const bySlugAndService = new Map<string, string>()

const returningFromDetails = new Set<string>()

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
  returningFromDetails.delete(keyFor(slug, serviceId))
}

/** «Tus datos» se deja hacia «Día y hora» del mismo servicio (atrás o el enlace). */
export function markReturnFromDetails(slug: string, serviceId: string): void {
  returningFromDetails.add(keyFor(slug, serviceId))
}

/** Si esta llegada a «Día y hora» es la vuelta desde «Tus datos»; la marca se consume. */
export function takeReturnFromDetails(slug: string, serviceId: string): boolean {
  return returningFromDetails.delete(keyFor(slug, serviceId))
}

/** Solo para pruebas: olvida todo. */
export function resetChosenStarts(): void {
  bySlugAndService.clear()
  returningFromDetails.clear()
}
