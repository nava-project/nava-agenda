import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { agendaNavItems, agendaPrivateShellChildRoutes } from '@/modules/agenda'
import { authRoutes, privateShellChildRoutes, privateShellRoute } from '@/modules/auth'
import {
  barberServicesNavItems,
  barberServicesPrivateShellChildRoutes,
} from '@/modules/barberServices'
import { catalogNavItems, catalogPrivateShellChildRoutes } from '@/modules/catalog'
import { integrationsPrivateShellChildRoutes } from '@/modules/integrations'
import { landingRoutes } from '@/modules/landing'
import { legalRoutes } from '@/modules/legal'
import { customerAccessRoutes } from '@/modules/customer-access'
import { publicBookingRoutes } from '@/modules/public-booking'
import { schedulesNavItems, schedulesPrivateShellChildRoutes } from '@/modules/schedules'
import { settingsNavItems, settingsPrivateShellChildRoutes } from '@/modules/settings'
import { staffNavItems, staffPrivateShellChildRoutes } from '@/modules/staff'
import { installChunkLoadRecovery } from './chunkLoadRecovery'
import { installProfileRedirect } from './profileGuard'

// Cada ruta se carga de forma diferida (docs/04-arquitectura/frontend.md):
// un módulo futuro no aumenta el bundle inicial sin necesidad. `app/router`
// compone las rutas que cada módulo expone en su índice público; no conoce
// los componentes internos de ningún módulo (estandar-frontend-vue.md §3).
//
// El único cascarón privado (HU-012) se ensambla aquí (HU-020 en
// adelante): `privateShellRoute` recibe las hijas y las entradas de
// navegación combinadas de `auth` y de cada módulo con pantalla privada,
// sin que ningún módulo importe a otro (app → modules → shared).
const routes: RouteRecordRaw[] = [
  // DEC-151: la raíz presenta NAVA (landing pública) en lugar de redirigir al
  // acceso; «Iniciar sesión» lleva a /acceso. Sin sesión y fuera del cascarón
  // privado.
  ...landingRoutes,
  // Issue #545: política de privacidad y condiciones del servicio, públicas y
  // sin sesión. Sus URL se registran en la pantalla de consentimiento de OAuth
  // de Google, así que no se renombran.
  ...legalRoutes,
  ...authRoutes,
  // HU-090: entrada pública de reservas, sin sesión del barbero y aislada
  // del cascarón privado (CA-090-03: nunca pasa por requireSession).
  ...publicBookingRoutes,
  // HU-098: lectura del turno del cliente por la credencial de su enlace,
  // sin sesión ni cuenta y aislada del cascarón privado (CA-098-01).
  ...customerAccessRoutes,
  privateShellRoute(
    [
      ...privateShellChildRoutes,
      ...settingsPrivateShellChildRoutes,
      ...integrationsPrivateShellChildRoutes,
      ...staffPrivateShellChildRoutes.map((route) =>
        route.name === 'staff-barberos'
          ? {
              path: route.path,
              name: route.name,
              component: () => import('../pages/StaffWorkspacePage.vue'),
            }
          : route,
      ),
      ...catalogPrivateShellChildRoutes.map((route) =>
        route.name === 'catalog-servicios'
          ? {
              path: route.path,
              name: route.name,
              component: () => import('../pages/CatalogWorkspacePage.vue'),
            }
          : route,
      ),
      ...barberServicesPrivateShellChildRoutes,
      ...schedulesPrivateShellChildRoutes,
      ...agendaPrivateShellChildRoutes,
    ],
    [
      // Orden de los 5 destinos P0 del dock (especificacion-frontend-nava.md
      // §5.1): Agenda (entrada base de AppNav) · Servicios · Barberos ·
      // Horarios · Configuración (siempre última). barberServicesNavItems aporta un sexto
      // ítem temporal ("Servicios por barbero", ver su propio módulo) hasta
      // que la Fase 5 lo fusione dentro de "Servicios"; agendaNavItems
      // aporta un arreglo vacío desde la Fase 2 (issue #135, "Nuevo turno"
      // es la acción global del header, no un destino) y se conserva en el
      // spread para no crear un caso especial si vuelve a aportar algo.
      ...catalogNavItems,
      ...staffNavItems,
      ...schedulesNavItems,
      ...barberServicesNavItems,
      ...agendaNavItems,
      // Configuración siempre al final: es lo que menos se usa a diario.
      ...settingsNavItems,
    ],
  ),
  // Cualquier otra ruta: pantalla de «no encontrada» en vez de una página en blanco. Va al
  // final y sin guardas: no cambia la sesión exigida a las rutas reales ni revela cuáles existen.
  {
    path: '/:pathMatch(.*)*',
    name: 'no-encontrada',
    component: () => import('../pages/NotFoundPage.vue'),
  },
]

// Altura de la cabecera fija de la landing y de los documentos legales: el
// ancla de destino queda justo debajo.
const ANCHOR_OFFSET = 72

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // El pie del sitio enlaza secciones de la landing desde cualquier página
  // (`/#contacto`) y las pantallas públicas son largas: llegar a una ruta nueva
  // empieza arriba y un ancla se alcanza con desplazamiento suave (salvo si la
  // persona pidió menos movimiento). Atrás/adelante restauran la posición.
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) {
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      return { el: to.hash, top: ANCHOR_OFFSET, behavior: reduced ? 'auto' : 'smooth' }
    }
    return to.path === from.path ? false : { top: 0 }
  },
})

// Perfil de barbero individual (DEC-115): las rutas que ese perfil retira se desvían a
// un destino válido (ver profileGuard.ts).
installProfileRedirect(router)

// Sin red, la descarga diferida de una pantalla falla: se avisa y se puede reintentar.
installChunkLoadRecovery(router)
