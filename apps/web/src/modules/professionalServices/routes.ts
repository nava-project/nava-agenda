// Ruta hija privada de `professionalServices`, cargada de forma diferida
// (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md §7.8). `app/router/index.ts`
// la combina con las hijas privadas de `auth`/`settings`/`staff`/`catalog`
// (y de cualquier otro módulo) antes de pasarlas a `auth.privateShellRoute`;
// este módulo no monta su propio cascarón ni repite el guard de sesión
// (HU-023, mismo patrón que HU-020/HU-021/HU-022).
import type { RouteRecordRaw } from 'vue-router'

export const professionalServicesPrivateShellChildRoutes: RouteRecordRaw[] = [
  {
    path: 'servicios-por-profesional',
    name: 'professional-services',
    component: () => import('./pages/ProfessionalServicesPage.vue'),
  },
]
