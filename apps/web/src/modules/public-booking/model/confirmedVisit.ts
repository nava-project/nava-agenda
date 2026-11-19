// La confirmación sobrevive a una recarga (DEC-188, revisión de #707).
//
// Tras «Tu turno quedó agendado», la URL de «Tus datos» se reemplaza por la
// misma con `?confirmado=1`. Sin esto, recargar mostraba el formulario vacío
// para una hora ya reservada: el cliente creía que no se había guardado,
// volvía a enviar y, con «Cualquiera», el segundo turno podía caer en otro
// profesional a la misma hora.
//
// Se guarda lo que la pantalla necesita para redibujar el pase, en
// `sessionStorage` (solo esta pestaña, se borra al cerrarla) y nunca la
// credencial del turno (DEC-089): el enlace para consultarlo llega por correo.
// Si el almacenamiento no está disponible, la página no ofrece el formulario:
// dice que el turno ya quedó reservado.
import type { ConfirmedPublicAppointment } from './confirmPublicAppointmentOutcome'

export type ConfirmedVisit = Omit<ConfirmedPublicAppointment, 'accessToken' | 'customerNote'> & {
  /** Verdadero si el turno es para otra persona: el pase dice «Turno para …». */
  forSomeoneElse: boolean
  /** Dirección del domicilio, si el turno es a domicilio; null si es en el local. */
  homeAddress: string | null
}

const PREFIX = 'nava.reserva.confirmada:'

export function confirmedVisitKey(
  slug: string,
  serviceId: string,
  professionalId: string,
  startsAt: string,
): string {
  return `${PREFIX}${slug}/${serviceId}/${professionalId}/${startsAt}`
}

export function saveConfirmedVisit(key: string, visit: ConfirmedVisit): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(visit))
  } catch {
    // Almacenamiento bloqueado o lleno: la recarga mostrará el aviso genérico.
  }
}

export function readConfirmedVisit(key: string): ConfirmedVisit | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return isConfirmedVisit(value) ? value : null
  } catch {
    return null
  }
}

export function toConfirmedVisit(
  appointment: ConfirmedPublicAppointment,
  forSomeoneElse: boolean,
  homeAddress: string | null,
): ConfirmedVisit {
  // Se copia campo a campo para que la credencial no viaje ni por descuido.
  return {
    attendeeName: appointment.attendeeName,
    businessName: appointment.businessName,
    serviceName: appointment.serviceName,
    durationMinutes: appointment.durationMinutes,
    priceAmount: appointment.priceAmount,
    currency: appointment.currency,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    timezone: appointment.timezone,
    forSomeoneElse,
    homeAddress,
  }
}

function isConfirmedVisit(value: unknown): value is ConfirmedVisit {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const strings = [
    'attendeeName',
    'businessName',
    'serviceName',
    'priceAmount',
    'currency',
    'startsAt',
    'endsAt',
    'timezone',
  ]
  return (
    strings.every((field) => typeof v[field] === 'string') &&
    typeof v.durationMinutes === 'number' &&
    typeof v.forSomeoneElse === 'boolean' &&
    (v.homeAddress === null || typeof v.homeAddress === 'string')
  )
}
