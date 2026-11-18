// Espejo tipado del cuerpo real del contrato (CA-020-07): exactamente los
// cuatro campos autorizados. contactEmail/contactPhone son `string | null`
// porque el servidor los devuelve como `null` explícito cuando el negocio
// no tiene ese contacto configurado (nunca cadena vacía, CA-020-06).
export interface BusinessSettings {
  name: string
  timezone: string
  contactEmail: string | null
  contactPhone: string | null
}

/** Forma editable del formulario: los cuatro campos como texto, contacto
 * vacío representando "sin contacto" en el alambre (igual convención que
 * el request real, ver UpdateBusinessSettingsRequest.yaml). */
export interface BusinessSettingsFormValues {
  name: string
  timezone: string
  contactEmail: string
  contactPhone: string
}

export function toFormValues(settings: BusinessSettings): BusinessSettingsFormValues {
  return {
    name: settings.name,
    timezone: settings.timezone,
    contactEmail: settings.contactEmail ?? '',
    contactPhone: settings.contactPhone ?? '',
  }
}
