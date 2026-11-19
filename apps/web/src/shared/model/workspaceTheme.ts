// Pinta en <html> las preferencias de pantalla y la marca mientras el
// cascarón privado está montado (DEC-110): `data-app-theme` (Tinta/Marfil),
// `data-motion`, el acento como variables CSS y el tamaño de texto como `zoom`.
// Al desmontarse lo retira todo, así el acceso, la recuperación y la reserva
// pública nunca heredan el tema ni el acento del panel.
//
// Tamaño de texto: casi todo el CSS del producto declara píxeles, así que el
// escalado por `rem` no alcanzaría; `zoom` sobre <html> escala texto y
// geometría a la vez y llega también a los diálogos teletransportados al
// <body>. Se limita para que el ancho efectivo nunca baje de 320 px
// (`ancho / 320`), de modo que "Muy grande" en un teléfono angosto no
// desborda. `--ui-zoom` expone el factor real para compensar `100dvh`.
import { computed, effectScope, ref, watchEffect, type EffectScope } from 'vue'
import { appearance, TEXT_SCALES } from './appearanceStore'
import { accentByKey, DEFAULT_BRAND_ACCENT, paintBusinessAccent } from './brandPalette'
import { effectiveAccent } from './brandStore'

/** Ancho mínimo efectivo que debe conservar la interfaz al escalar. */
export const MIN_EFFECTIVE_WIDTH = 320

/** Factor de escala real: el elegido, sin dejar el ancho efectivo bajo 320 px. */
export function effectiveZoom(factor: number, viewportWidth: number): number {
  if (factor <= 1) return factor
  return Math.min(factor, Math.max(1, viewportWidth / MIN_EFFECTIVE_WIDTH))
}

const systemPrefersLight = ref(false)
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)

export const resolvedTheme = computed<'ink' | 'ivory'>(() => {
  if (appearance.theme === 'auto') return systemPrefersLight.value ? 'ivory' : 'ink'
  return appearance.theme
})

let scope: EffectScope | null = null
let detach: (() => void) | null = null

/**
 * Empieza a pintar las preferencias en <html>. Idempotente: una segunda
 * llamada devuelve el mismo `detach`. Devuelve la función que lo deshace.
 */
export function attachWorkspaceTheme(): () => void {
  if (detach) return detach

  const root = document.documentElement
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null
  systemPrefersLight.value = media?.matches ?? false
  viewportWidth.value = window.innerWidth

  const onMedia = (event: MediaQueryListEvent) => {
    systemPrefersLight.value = event.matches
  }
  const onResize = () => {
    viewportWidth.value = window.innerWidth
  }
  media?.addEventListener('change', onMedia)
  window.addEventListener('resize', onResize)

  scope = effectScope(true)
  scope.run(() => {
    watchEffect(() => {
      const theme = resolvedTheme.value
      const accent = accentByKey(effectiveAccent.value)

      root.dataset.appTheme = theme
      if (appearance.motion === 'reduced') root.dataset.motion = 'reduced'
      else delete root.dataset.motion

      // DEC-188: el acento por omisión es el Alba de tokens.css. Un acento
      // elegido (DEC-110) entrega su valor medido para cada modo y tokens.css
      // toma el del modo activo. El foco ya no sigue al acento.
      paintBusinessAccent(root, accent.key === DEFAULT_BRAND_ACCENT ? null : accent)

      const zoom = effectiveZoom(TEXT_SCALES[appearance.textScale].factor, viewportWidth.value)
      if (zoom === 1) {
        root.style.removeProperty('zoom')
        root.style.removeProperty('--ui-zoom')
      } else {
        root.style.setProperty('zoom', String(zoom))
        root.style.setProperty('--ui-zoom', String(zoom))
      }
    })
  })

  detach = () => {
    scope?.stop()
    scope = null
    media?.removeEventListener('change', onMedia)
    window.removeEventListener('resize', onResize)
    delete root.dataset.appTheme
    delete root.dataset.motion
    paintBusinessAccent(root, null)
    root.style.removeProperty('zoom')
    root.style.removeProperty('--ui-zoom')
    detach = null
  }
  return detach
}
