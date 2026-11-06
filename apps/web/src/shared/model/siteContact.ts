// Canales públicos de contacto comercial de NAVA (DEC-151). Los consumen la
// sección de contacto de la landing y el pie del sitio, que se repite en las
// páginas legales: un solo archivo evita que un cambio de teléfono o de correo
// deje datos distintos en pantallas distintas.
export const SITE_PHONE_E164 = '+573016823624'
export const SITE_PHONE_DISPLAY = '+57 301 682 3624'
export const SITE_EMAIL = 'bacg20044@gmail.com'

/** Asunto con el que se abre el correo para contratar NAVA. */
export const SITE_MAIL_SUBJECT = 'Quiero contratar NAVA'

export const SITE_CALL_HREF = `tel:${SITE_PHONE_E164}`
export const SITE_MAIL_HREF = `mailto:${SITE_EMAIL}?subject=${encodeURIComponent(SITE_MAIL_SUBJECT)}`
