// Ruta del módulo landing. `/` deja de redirigir al acceso (DEC-151): la raíz
// presenta NAVA y ofrece «Iniciar sesión», que lleva a `/acceso`. Es pública
// y está fuera del cascarón privado: nunca pasa por `requireSession`.
import type { RouteRecordRaw } from 'vue-router'

export const landingRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'inicio',
    component: () => import('./pages/LandingPage.vue'),
  },
]
