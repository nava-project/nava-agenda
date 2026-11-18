// Dirección de un turno a domicilio (DEC-138, DEC-155). El servidor guarda UN texto de hasta
// 200 caracteres junto con las coordenadas (`appointment_home_service_ck`); el cliente escribe
// además los detalles que el mapa no sabe (torre, apartamento, casa, una referencia). Esos
// detalles se anteponen al texto de la dirección: el profesional lee primero lo que necesita para
// tocar el timbre y el contrato del API no cambia.

/** Largo máximo de los detalles que escribe la persona. */
export const HOME_DETAILS_MAX_LENGTH = 80

/** Largo máximo de la dirección completa que acepta el servidor. */
export const HOME_ADDRESS_MAX_LENGTH = 200

const SEPARATOR = ' · '

/** Los detalles tal como se envían: sin espacios sobrantes y sin superar el máximo. */
export function normalizeHomeDetails(details: string): string {
  return [...details.trim().replace(/\s+/g, ' ')].slice(0, HOME_DETAILS_MAX_LENGTH).join('')
}

/** `«Torre 2, apto 304 · Cl. 85 #15-20, Bogotá»`; sin detalles, solo la dirección. */
export function composeHomeAddress(address: string, details: string): string {
  const extra = normalizeHomeDetails(details)
  if (extra === '') return address
  // Si hace falta recortar, se recorta la dirección aproximada: los detalles los escribió la persona.
  const room = HOME_ADDRESS_MAX_LENGTH - [...extra].length - SEPARATOR.length
  return `${extra}${SEPARATOR}${[...address].slice(0, Math.max(room, 0)).join('')}`
}
