// Rutas del módulo public-booking, cargadas de forma diferida (nava-docs/agenda/03-
// desarrollo/estandar-frontend-vue.md §7.8) y registradas desde
// `app/router`. Este archivo es la API pública de rutas del módulo:
// `app/router/index.ts` las importa y las compone, sin conocer los
// componentes internos del módulo.
//
// v2 «La luz del día» (DEC-188): tres pasos y la confirmación.
//
// - `/reservar/:slug` es la entrada y a la vez el catálogo (Servicio, paso 1).
// - `/reservar/:slug/servicios/:serviceId/horario` es «Día y hora» (paso 2): el
//   profesional es un filtro de la misma pantalla (`?profesional=<id>`), con
//   «Cualquiera» cuando no se indica.
// - `…/profesional/:professionalId/horario/:startsAt/cliente` es «Tus datos»
//   (paso 3) y la confirmación. Lleva el profesional que atiende: el elegido o,
//   con «Cualquiera», el primero que ofrece esa hora (`?cualquiera=1`).
//
// Las rutas v1 de catálogo, profesional y horario por profesional redirigen a
// sus equivalentes, así que ningún enlace compartido se rompe. Todas cuelgan de
// un único cascarón (`PublicBookingLayout`) y ninguna exige sesión (CA-090-03).
// `props: true` entrega los parámetros como props: las páginas se prueban sin
// router. `startsAt` no se revalida aquí (lo hace el servidor al confirmar,
// HU-097); la ruta solo descarta un valor ilegible o ya pasado (`beforeEnter`).
import type { RouteRecordRaw } from 'vue-router'
import { isBookableStart } from './model/bookableStart'

export const publicBookingRoutes: RouteRecordRaw[] = [
  {
    path: '/reservar/:slug',
    component: () => import('./layouts/PublicBookingLayout.vue'),
    children: [
      {
        path: '',
        name: 'reserva-publica-entrada',
        component: () => import('./pages/PublicBusinessEntryPage.vue'),
        props: true,
        meta: { bookingStep: 1 },
      },
      {
        path: '/reservar/:slug/servicios',
        name: 'reserva-publica-servicios',
        redirect: (to) => ({ name: 'reserva-publica-entrada', params: { slug: to.params.slug } }),
      },
      {
        path: '/reservar/:slug/servicios/:serviceId/profesional',
        name: 'reserva-publica-profesional',
        redirect: (to) => ({
          name: 'reserva-publica-horario',
          params: { slug: to.params.slug, serviceId: to.params.serviceId },
        }),
      },
      {
        path: '/reservar/:slug/servicios/:serviceId/horario',
        name: 'reserva-publica-horario',
        component: () => import('./pages/PublicDayTimePage.vue'),
        props: (to) => ({
          slug: String(to.params.slug),
          serviceId: String(to.params.serviceId),
          professionalId: typeof to.query.profesional === 'string' ? to.query.profesional : null,
        }),
        meta: { bookingStep: 2 },
      },
      {
        path: '/reservar/:slug/servicios/:serviceId/profesional/:professionalId/horario',
        name: 'reserva-publica-horario-profesional',
        redirect: (to) => ({
          name: 'reserva-publica-horario',
          params: { slug: to.params.slug, serviceId: to.params.serviceId },
          query: { profesional: to.params.professionalId },
        }),
      },
      {
        path: '/reservar/:slug/servicios/:serviceId/profesional/:professionalId/horario/:startsAt/cliente',
        name: 'reserva-publica-cliente',
        component: () => import('./pages/PublicCustomerDetailsPage.vue'),
        props: (to) => ({
          slug: String(to.params.slug),
          serviceId: String(to.params.serviceId),
          professionalId: String(to.params.professionalId),
          startsAt: String(to.params.startsAt),
          anyProfessional: to.query.cualquiera === '1',
          // Puesto al confirmar (replace): recargar redibuja la confirmación y no el formulario.
          confirmed: to.query.confirmado === '1',
        }),
        meta: { bookingStep: 3 },
        // Un `startsAt` ilegible o pasado (enlace viejo, URL tocada) devuelve a la
        // hora en vez de abrir un formulario que acabaría en «Invalid Date».
        beforeEnter: (to) =>
          isBookableStart(to.params.startsAt)
            ? true
            : {
                name: 'reserva-publica-horario',
                params: { slug: to.params.slug, serviceId: to.params.serviceId },
                query: to.query.cualquiera === '1' ? {} : { profesional: to.params.professionalId },
                replace: true,
              },
      },
    ],
  },
]
