/**
 * Movimiento de la familia (#741, punto 3 del pulido). Red estática sobre el
 * CSS: los diálogos abren y cierran con resorte y velo, la tarjeta de servicio
 * se levanta con su rombo, y todo eso se apaga con movimiento reducido (por
 * sistema o por Configuración). Las animaciones son finitas y solo de
 * transform y opacity.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../..')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

const dialog = read('shared/ui/BaseDialog.vue')
const booking = read('modules/public-booking/styles/bookingV2.css')
const button = read('shared/ui/BaseButton.vue')
const nav = read('modules/auth/components/AppNav.vue')
const detail = read('modules/agenda/pages/AppointmentDetailPage.vue')

function keyframes(source: string, prefix: string): Record<string, string> {
  return Object.fromEntries(
    [
      ...source.matchAll(new RegExp(`@keyframes (${prefix}[\\w-]*) \\{([\\s\\S]*?)\\n\\}`, 'g')),
    ].map((m) => [m[1] ?? '', m[2] ?? '']),
  )
}

describe('movimiento de la familia (#741)', () => {
  it('el diálogo anima entrada y salida con <Transition> y duración explícita', () => {
    expect(dialog).toMatch(/<Transition name="base-dialog-motion" :duration="dialogMotion\(\)">/)
    expect(dialog).toMatch(/const DIALOG_MOTION = \{ enter: 460, leave: 200 \} as const/)
    // Con movimiento reducido la duración es 0: cierra en seco, sin esperar.
    expect(dialog).toMatch(/prefersReducedMotion\(\) \? 0 : DIALOG_MOTION/)
    expect(dialog).toMatch(/dataset\.motion === 'reduced'/)
  })

  it('el velo del diálogo desenfoca el fondo', () => {
    expect(dialog).toMatch(/\.base-dialog__overlay \{[^}]*backdrop-filter: blur\(6px\);/)
  })

  it('los keyframes del diálogo solo mueven transform y opacity', () => {
    const frames = keyframes(dialog, 'base-dialog-')
    expect(Object.keys(frames).sort()).toEqual([
      'base-dialog-pop-in',
      'base-dialog-pop-out',
      'base-dialog-sheet-in',
      'base-dialog-sheet-out',
      'base-dialog-veil-in',
      'base-dialog-veil-out',
    ])
    for (const body of Object.values(frames)) {
      const props = [...body.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1])
      expect(props.every((p) => p === 'opacity' || p === 'transform')).toBe(true)
    }
    expect(dialog).not.toMatch(/base-dialog-[\w-]+ [^;]*infinite/)
  })

  it('el diálogo se queda quieto con movimiento reducido, por sistema y por Configuración', () => {
    expect(dialog).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.base-dialog-motion-enter-active,[\s\S]*?animation: none;/,
    )
    expect(dialog).toMatch(
      /:root\[data-motion='reduced'\] \.base-dialog-motion-enter-active,[\s\S]*?animation: none;/,
    )
  })

  it('el renglón de la carta deja asomar un rombo en el margen con resorte (#745)', () => {
    expect(booking).toMatch(/\.bk-service::before \{[^}]*rotate\(45deg\) scale\(0\.2\)/)
    expect(booking).toMatch(/\.bk-service::before \{[^}]*transform 420ms var\(--motion-ease-spring/)
    expect(booking).toMatch(
      /\.bk-service:hover::before,\s*\.bk-service:focus-visible::before \{\s*opacity: 1;\s*transform: translateX\(0\) rotate\(45deg\) scale\(1\);/,
    )
    // Sin flecha de texto ni tarjeta que se levanta: es un renglón de carta.
    expect(booking).not.toMatch(/bk-service__go/)
  })

  it('con movimiento reducido el rombo del renglón y los botones no se desplazan', () => {
    expect(booking).toMatch(
      /\.bk-service:hover::before,\s*\.bk-service:focus-visible::before,\s*\.bk-service:active::before \{\s*transform: rotate\(45deg\);/,
    )
    expect(button).toMatch(
      /:root\[data-motion='reduced'\] \.base-button:hover:not\(:disabled\):not\(\.base-button--loading\),/,
    )
  })

  it('la elevación del botón va antes de :active, para que la presión gane', () => {
    const lift = button.indexOf('transform: translateY(-1px);')
    const press = button.indexOf('transform: translateY(1px) scale(0.985);')
    expect(lift).toBeGreaterThan(-1)
    expect(press).toBeGreaterThan(lift)
  })

  it('«Más» sale como sheet desde abajo por debajo de 640 px, con asa y resorte', () => {
    expect(nav).toMatch(/<BaseDialog[^>]*title="Más"[^>]*placement="sheet-mobile"/)
    const mobile = dialog.slice(dialog.indexOf('@media (max-width: 639.98px)'))
    expect(mobile).toMatch(/\.base-dialog__overlay--sheet-mobile \{\s*align-items: flex-end;/)
    expect(mobile).toMatch(/\.base-dialog__overlay--sheet-mobile \.base-dialog::before \{/)
    expect(mobile).toMatch(
      /--sheet-mobile \.base-dialog \{\s*animation-name: base-dialog-sheet-in;/,
    )
    expect(mobile).toMatch(
      /--sheet-mobile \.base-dialog \{\s*animation-name: base-dialog-sheet-out;/,
    )
  })

  it('la carga del detalle es el sol grande sobre un esqueleto, no una línea', () => {
    expect(detail).toMatch(
      /<DiamondLoader layout="overlay" label="Cargando el detalle del turno…" \/>\s*<div class="appointment-detail-page__skeleton" aria-hidden="true">/,
    )
    expect(detail).toMatch(
      /:root\[data-motion='reduced'\] \.appointment-detail-page__skeleton-bar \{\s*animation: none;/,
    )
  })

  it('el sobrepaso del sheet sube tela, no abre hueco, y el velo no se desplaza', () => {
    const mobile = dialog.slice(dialog.indexOf('@media (max-width: 639.98px)'))
    for (const css of [dialog, mobile]) {
      expect(css).toMatch(
        /--(bottom|sheet-mobile) \.base-dialog::after \{[^}]*top: calc\(100% - 1px\);[^}]*height: max\(96px, 24%\);[^}]*background-color: inherit;/,
      )
    }
    // clip, no hidden: hidden lo vuelve contenedor de scroll y el foco lo desplaza.
    expect(dialog).toMatch(/\.base-dialog__overlay--bottom \{[^}]*overflow: clip;/)
    expect(mobile).toMatch(/\.base-dialog__overlay--sheet-mobile \{\s*overflow: clip;/)
  })
})
