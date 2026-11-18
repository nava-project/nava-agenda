// Rutas hijas privadas de `integrations`, cargadas de forma diferida
// (docs/03-desarrollo/estandar-frontend-vue.md §7.8). `app/router/index.ts` las
// combina con las de los demás módulos antes de pasarlas al cascarón privado;
// este módulo no monta su propio cascarón ni repite el guard de sesión.
//
// La ruta de retorno es la que se registra en Google Cloud como URI de
// redirección (GOOGLE_CALENDAR_REDIRECT_URI): cambiarla exige cambiar también el
// cliente OAuth y la variable (apps/api/README.md).
import type { RouteRecordRaw } from 'vue-router'

export const integrationsPrivateShellChildRoutes: RouteRecordRaw[] = [
  {
    path: 'negocio/google-calendar',
    name: 'integraciones-google-calendar',
    component: () => import('./pages/GoogleCalendarPage.vue'),
  },
  {
    path: 'negocio/google-calendar/callback',
    name: 'integraciones-google-calendar-retorno',
    component: () => import('./pages/GoogleCalendarCallbackPage.vue'),
  },
  // Rutas anteriores a DEC-183 (#662). La de retorno es la URI registrada en Google
  // Cloud hasta que se cambie por la nueva: la redirección conserva `code` y `state`
  // (vue-router mantiene query y hash al redirigir a un nombre).
  { path: 'barberia/google-calendar', redirect: { name: 'integraciones-google-calendar' } },
  {
    path: 'barberia/google-calendar/callback',
    redirect: { name: 'integraciones-google-calendar-retorno' },
  },
]
