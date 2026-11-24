/**
 * Movimiento de la familia, 2.ª entrega (#743). Red estática sobre el CSS y
 * las plantillas: «Más» con la esencia de Agenda, el velo suave en Día, los
 * avisos con resorte que no tapan la acción, y el escalonado de listas que no
 * pasa de 300 ms. Todo se apaga con movimiento reducido.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../..')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

const nav = read('modules/auth/components/AppNav.vue')
const tokens = read('styles/tokens.css')
const toasts = read('shared/ui/ToastRegion.vue')
const shell = read('modules/auth/layouts/PrivateShell.vue')
const motion = read('styles/motion.css')

describe('movimiento de la familia, 2.ª entrega (#743)', () => {
  it('«Más» tiene título serif, rombos de latón, filetes de latón y la salida aparte', () => {
    expect(nav).toMatch(/content-class="app-nav__more-sheet"/)
    expect(nav).toMatch(
      /\.app-nav__more-sheet \.base-dialog__title \{\s*font-family: var\(--font-display\);/,
    )
    expect(nav).toMatch(/<span class="app-nav__more-mark" aria-hidden="true" \/>/)
    expect(nav).toMatch(
      /\.app-nav__more-link--active \.app-nav__more-mark \{\s*background-color: var\(--color-brass-line\);/,
    )
    expect(nav).toMatch(
      /\.app-nav__more-item \{\s*border-bottom: 1px solid color-mix\(in srgb, var\(--color-brass-line\)/,
    )
    expect(nav).toMatch(/\.app-nav__more-item--logout \{[^}]*border-top: 3px double/)
    // Sin los separadores grises de RecordRow.
    expect(nav).not.toMatch(/<RecordRow/)
  })

  it('las filas de «Más» entran escalonadas en menos de 300 ms y se quedan quietas con reducido', () => {
    expect(nav).toMatch(/animation: app-nav-more-in 140ms/)
    expect(nav).toMatch(/animation-delay: calc\(min\(var\(--i, 0\), 6\) \* 40ms\);/)
    expect(nav).toMatch(/:root\[data-motion='reduced'\] \.app-nav__more-item \{\s*animation: none;/)
  })

  it('el velo de Día es suave (28 %)', () => {
    expect(tokens).toMatch(/--color-overlay-scrim: rgb\(16 27 43 \/ 28%\);/)
  })

  it('los avisos caen con resorte, se van de lado y se reacomodan', () => {
    expect(toasts).toMatch(/<TransitionGroup name="toast-motion"[ >]/)
    expect(toasts).toMatch(
      /\.toast-motion-enter-active \{\s*animation: toast-motion-in 420ms var\(--motion-ease-spring/,
    )
    expect(toasts).toMatch(/\.toast-motion-leave-active \{[^}]*animation: toast-motion-out 200ms/)
    expect(toasts).toMatch(/\.toast-motion-move \{\s*transition: transform 260ms/)
    expect(toasts).toMatch(
      /:root\[data-motion='reduced'\] \.toast-motion-move \{\s*transition: none;/,
    )
  })

  it('en el panel los avisos van abajo, dentro del visor que excluye la barra', () => {
    expect(toasts).toMatch(
      /\.toast-region--host \{\s*position: absolute;\s*top: auto;\s*bottom: var\(--space-3\);/,
    )
    expect(shell).toMatch(
      /<div class="private-shell__viewport">\s*<main class="private-shell__content"[^>]*>[\s\S]*?<ToastRegion placement="host" \/>\s*<\/div>/,
    )
  })

  it('el escalonado de listas termina en 300 ms como máximo y se apaga con reducido', () => {
    expect(motion).toMatch(
      /\.nv-stagger \{\s*animation: nava-rise 180ms var\(--motion-ease-out\) backwards;\s*animation-delay: calc\(min\(var\(--i, 0\), 6\) \* 20ms\);/,
    )
    expect(motion).toMatch(/:root\[data-motion='reduced'\] \.nv-stagger,/)
    for (const page of [
      'modules/catalog/pages/CatalogPage.vue',
      'modules/staff/pages/StaffPage.vue',
      'modules/agenda/pages/DailyAgendaPage.vue',
    ]) {
      expect(read(page)).toMatch(/nv-stagger"\s*:style="\{ '--i': index \}"/)
    }
  })
})
