import type { Router } from 'vue-router'

/**
 * Retira el arranque del panel que pinta `index.html` (DEC-188, entrega 5a).
 *
 * En `/panel`, un script en línea aplica el modo guardado (`data-app-theme`,
 * `data-motion`) y muestra el sol del logo con «Abriendo tu agenda…» mientras
 * `requireSession` resuelve la sesión. Cuando termina la primera navegación:
 * - se quita el cargador y la marca `data-boot`;
 * - si la navegación acabó fuera del panel (p. ej. sin sesión, en `/acceso`),
 *   se retira también el modo, que solo pinta el cascarón privado mientras
 *   está montado (`attachWorkspaceTheme`).
 */
export function releaseBootLoader(router: Router, root: HTMLElement = document.documentElement) {
  const release = () => {
    // El marcado vive en `index.html` en toda ruta (oculto fuera del panel).
    document.getElementById('boot-loader')?.remove()
    if (root.dataset.boot === undefined) return
    delete root.dataset.boot
    if (!router.currentRoute.value.path.startsWith('/panel')) {
      delete root.dataset.appTheme
      delete root.dataset.motion
    }
  }
  // Si la primera navegación falla, el cargador no puede quedarse para siempre.
  return router.isReady().then(release, release)
}
