// Sitio de la familia NAVA (DEC-183, issue #658): la landing y los documentos
// legales viven en otro proyecto, servido en nava.wtf; esta app vive en
// agenda.nava.wtf y los enlaza por URL absoluta. Las rutas legales están
// registradas en la pantalla de consentimiento de OAuth de Google: no cambian.
export const NAVA_SITE_URL = 'https://nava.wtf'
export const NAVA_PRIVACY_URL = `${NAVA_SITE_URL}/privacidad`
export const NAVA_TERMS_URL = `${NAVA_SITE_URL}/terminos`
