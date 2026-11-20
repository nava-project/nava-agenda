/**
 * Armar la cita (#745, entrega E1). Red estática sobre el CSS de la reserva:
 * la carta con puntos guía, «Tu hora» dentro de su píldora sin crecer, las
 * flechas de los días fuera de los días, la pista de los chips, la barra que
 * reserva su alto bajo el pie y los pasos con nombre también en el teléfono.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  join(__dirname, '../../../modules/public-booking/styles/bookingV2.css'),
  'utf8',
)

describe('armar la cita (#745)', () => {
  it('la carta une nombre y precio con puntos guía y separa renglones con latón', () => {
    expect(css).toMatch(/\.bk-service__line \{\s*display: flex;[^}]*align-items: baseline;/)
    expect(css).toMatch(/\.bk-service__leader \{[^}]*flex: 1 1 var\(--space-6\);/)
    expect(css).toMatch(/\.bk-service__leader \{[^}]*radial-gradient/)
    expect(css).toMatch(
      /\.bk-services__list li \+ li \{\s*border-top: 1px solid color-mix\(in srgb, var\(--color-brass-line\)/,
    )
  })

  it('«Tu hora» lleva su rombo dentro y la píldora no crece', () => {
    const chosen = css.match(/\.bk-min\[aria-checked='true'\] \{([^}]*)\}/)?.[1] ?? ''
    expect(chosen).not.toMatch(/transform|scale/)
    expect(css).toMatch(/\.bk-min\[aria-checked='true'\]::before \{[^}]*flex: none;/)
    expect(css).not.toMatch(/\.bk-min\[aria-checked='true'\]::after/)
    // Con movimiento reducido el rombo aparece sin salto.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.bk-min\[aria-checked='true'\]::before \{\s*animation: none;/,
    )
  })

  it('las flechas de los días van en su propia columna y se apagan sin moverse', () => {
    expect(css).toMatch(
      /\.bk-days-wrap \{[^}]*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;/,
    )
    expect(css).toMatch(/\.bk-days__nav:disabled \{[^}]*opacity: 0\.35;/)
    const nav = css.match(/\.bk-days__nav \{([^}]*)\}/)?.[1] ?? ''
    expect(nav).not.toMatch(/position: absolute/)
  })

  it('los chips y los días avisan con un fundido que la fila sigue', () => {
    expect(css).toMatch(/\.bk-chips--after \{\s*--bk-fade-after: 40px;/)
    expect(css).toMatch(/\.bk-days \{\s*mask-image: linear-gradient\(/)
  })

  it('la barra del pase reserva su alto bajo el pie, no bajo «Noche»', () => {
    expect(css).toMatch(
      /\.bk:has\(\.bk-daytime\) \.bk-foot \{\s*padding-bottom: calc\(var\(--space-8\) \+ 77px/,
    )
    expect(css).not.toMatch(/\.bk-daytime \{\s*padding-bottom: calc\(var\(--space-12\) \+ 96px\)/)
  })

  it('los pasos llevan su nombre visible también en el teléfono', () => {
    expect(css).toMatch(/\.bk-steps \{\s*display: grid;[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
    expect(css).not.toMatch(/\.bk-steps__item:not\(\.bk-steps__item--current\) \.bk-steps__label/)
  })
})
