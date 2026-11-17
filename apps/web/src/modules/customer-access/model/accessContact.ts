// Presentación del contacto en el acceso al turno (HU-105). Solo se muestra el
// contacto que la propia persona acaba de escribir, y siempre enmascarado: la
// pantalla no revela nada que ella no sepa y evita dejar un correo o un número
// completos a la vista de quien mire por encima del hombro.

/** Un contacto con «@» es un correo; lo demás se trata como celular. */
export function isEmailContact(contact: string): boolean {
  return contact.includes('@')
}

/** «ana.perez@correo.test» → «a•••@correo.test»; «300 123 4567» → «••• ••• 4567». */
export function maskContact(raw: string): string {
  const contact = raw.trim()
  if (isEmailContact(contact)) {
    const at = contact.lastIndexOf('@')
    const local = contact.slice(0, at)
    return `${local.slice(0, 1)}•••${contact.slice(at)}`
  }
  const digits = contact.replace(/\D/g, '')
  return `••• ••• ${digits.slice(-4)}`
}

/** Segundos → «m:ss» para la cuenta atrás del reenvío. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Minutos enteros hacia arriba para «vuelve a intentarlo en N minutos». */
export function waitMinutes(totalSeconds: number): number {
  return Math.max(1, Math.ceil(totalSeconds / 60))
}
