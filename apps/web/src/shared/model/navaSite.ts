// Sitio de la familia NAVA (DEC-183, issue #658): la landing y los documentos
// legales viven en otro proyecto, servido en nava.wtf; esta app vive en
// agenda.nava.wtf y los enlaza por URL absoluta. Las rutas legales están
// registradas en la pantalla de consentimiento de OAuth de Google: no cambian.
export const NAVA_SITE_URL = 'https://nava.wtf'
// La sección de Agenda en la presentación: adonde vuelve quien entró desde ella
// (DEC-188, entrega 3: el «Volver» del acceso y la recuperación).
export const NAVA_AGENDA_URL = `${NAVA_SITE_URL}/#agenda`
export const NAVA_PRIVACY_URL = `${NAVA_SITE_URL}/privacidad`
export const NAVA_TERMS_URL = `${NAVA_SITE_URL}/terminos`
