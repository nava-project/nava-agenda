// Módulo: asignación de servicios a profesionales (HU-023). API pública mínima
// para `app`, según docs/03-desarrollo/estandar-frontend-vue.md: la ruta
// hija privada (cargada de forma diferida) y la entrada de navegación que la
// representa. `app/router/index.ts` combina esto con las rutas de
// `auth`/`settings`/`staff`/`catalog` (y de cualquier otro módulo con
// pantalla privada) antes de pasarlas a `auth.privateShellRoute`; este
// módulo no monta su propio cascarón ni importa internos de `staff` ni de
// `catalog` (colabora con ambos SOLO a través del cliente HTTP compartido,
// nunca de sus clientes API privados). Página, modelo y cliente API internos
// permanecen privados.
// "Servicios por profesional" no es uno de los 5 destinos P0 del dock NAVA
// (especificacion-frontend-nava.md §5.1 agrupa "catálogo y asignación de
// servicios por profesional" bajo un único destino "Servicios"). La Fase 2
// (issue #135) intentó mover el enlace a un texto dentro de
// `CatalogPage.vue`, pero esa pantalla tiene una prueba de HU-022 que
// verifica expresamente que su copy nunca mencione "profesional" (fuera de
// su alcance de una sola preocupación); forzar el enlace ahí habría
// violado esa disciplina. Hasta que la Fase 5 fusione de verdad esta
// capacidad dentro de "Servicios", esta entrada se conserva como sexto
// ítem temporal del dock en vez de quedar inalcanzable.
import type { NavItem } from '@/shared/navigation/navItem'

export { professionalServicesPrivateShellChildRoutes } from './routes'

// «Lo ofrezco» (DEC-115): la asignación de HU-023 vista desde cada servicio, para que
// `app` la componga dentro de «Servicios» sin que `catalog` importe este módulo.
export { useProfessionalOffering } from './model/professionalOffering'
export type { ProfessionalOffering } from './model/professionalOffering'
export { default as OfferServiceSwitch } from './components/OfferServiceSwitch.vue'

export const professionalServicesNavItems: NavItem[] = [
  {
    to: { name: 'professional-services' },
    label: 'Servicios por profesional',
    labelFor: (v) => `Servicios por ${v.professional}`,
    // Con un solo profesional la matriz no tiene sentido: «Servicios» ofrece cada servicio (DEC-115).
    // El empleado no tiene «Servicios» (el catálogo es del negocio): aquí elige
    // cuáles del catálogo ofrece él (DEC-173).
    profiles: { solo: { hidden: true }, employee: { label: 'Mis servicios' } },
  },
]
