// Rutas públicas de los documentos legales. Son las URL que se registran en la
// pantalla de consentimiento de OAuth de Google (Google Cloud Console), así que
// su ruta es un contrato externo: renombrarla invalida esa configuración y
// cualquier enlace ya publicado. Fuera del cascarón privado: nunca pasan por
// `requireSession`.
import type { RouteRecordRaw } from 'vue-router'

export const LEGAL_PRIVACY_PATH = '/privacidad'
export const LEGAL_TERMS_PATH = '/terminos'

export const legalRoutes: RouteRecordRaw[] = [
  {
    path: LEGAL_PRIVACY_PATH,
    name: 'privacidad',
    component: () => import('./pages/PrivacyPolicyPage.vue'),
  },
  {
    path: LEGAL_TERMS_PATH,
    name: 'terminos',
    component: () => import('./pages/TermsPage.vue'),
  },
]
