import { createApp as createVueApp, watch, type App as VueApp } from 'vue'
import App from '@/App.vue'
import { router } from '@/app/router'
import { agendaContextInvalidation, forgetAgendaContext } from '@/modules/agenda'
import { installSessionHandling, sessionStatus } from '@/modules/auth'
import { loadWorkspaceBrand } from '@/modules/settings'
import { httpClient } from '@/shared/api/httpClient'
import { resetBrand } from '@/shared/model'

/**
 * Construye la instancia de Vue con sus proveedores globales (router, y los
 * que se agreguen con una necesidad real). No contiene reglas de negocio:
 * eso vive en los módulos, según nava-docs/agenda/04-arquitectura/frontend.md.
 */
export function createApplication(): VueApp {
  const app = createVueApp(App)
  app.use(router)
  // HU-012: coordinación única de 401 sobre rutas privadas. Se conecta aquí
  // (no dentro de `modules/auth`) porque es el único punto que posee la
  // instancia real del router.
  installSessionHandling(router)
  // #822: lo que la Agenda guarda (profesionales y zona) se olvida tras una
  // escritura que pueda cambiarlo y cada vez que la sesión deja de estar
  // autenticada, para no mostrar nunca datos de otra sesión.
  httpClient.use(agendaContextInvalidation)
  // DEC-110: la marca y el vocabulario del negocio viajan con la sesión. Se
  // piden al autenticarse y se descartan al salir, para que la siguiente
  // negocio nunca herede el acento ni las palabras de la anterior.
  watch(
    sessionStatus,
    (status) => {
      if (status === 'authenticated') void loadWorkspaceBrand()
      else if (status === 'unauthenticated') resetBrand()
      if (status !== 'authenticated') forgetAgendaContext()
    },
    { immediate: true },
  )
  return app
}
