/**
 * Finalizar la cita (#747, entrega E2). Red estática sobre el CSS: el sello de
 * la tarjeta en latón, la ceremonia de «Todo listo» orquestada y acotada, los
 * puntos guía, el riel «Tu cita» y los detalles de la revisión de E1.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(__dirname, path), 'utf8')
const css = read('../../../modules/public-booking/styles/bookingV2.css')
const ticket = read('../AppointmentTicket.vue')
const details = read('../../../modules/public-booking/pages/PublicCustomerDetailsPage.vue')
const daytime = read('../../../modules/public-booking/pages/PublicDayTimePage.vue')
const layout = read('../../../modules/public-booking/layouts/PublicBookingLayout.vue')

/** Suma «retraso + duración» de cada animación con ms explícitos. */
function lastFrame(block: string, offset = 0): number {
  let end = 0
  for (const m of block.matchAll(
    /animation: [\w-]+ (\d+)ms (?:calc\(var\(--ticket-ceremony-delay\) \+ )?(\d+)?/g,
  )) {
    end = Math.max(end, Number(m[1]) + Number(m[2] ?? 0) + offset)
  }
  return end
}

describe('finalizar la cita (#747)', () => {
  it('estampa el sello de la tarjeta confirmada en latón (texto AA)', () => {
    expect(ticket).toMatch(/\.appointment-ticket \{[^}]*--ticket-seal: var\(--color-brass-text\);/)
    // Los estados cerrados conservan su color.
    expect(ticket).toMatch(/--cancelled \{\s*--ticket-seal: var\(--color-inactive-text\);/)
  })

  it('orquesta «Todo listo» en ≤ 1,5 s y solo con movimiento permitido', () => {
    const page = details.slice(details.indexOf('La llegada de «Todo listo»'))
    const pageBlock = page.slice(0, page.indexOf('@keyframes bk-done-rise'))
    expect(pageBlock).toMatch(/@media \(prefers-reduced-motion: no-preference\)/)
    expect(pageBlock).toMatch(/--ticket-ceremony-delay: 380ms;/)
    expect(lastFrame(pageBlock)).toBeLessThanOrEqual(1500)

    const own = ticket.slice(
      ticket.indexOf('── Ceremonia'),
      ticket.indexOf('@keyframes ticket-draw'),
    )
    expect(own).toMatch(/@media \(prefers-reduced-motion: no-preference\)/)
    for (const rule of own.match(/^\s+:root[^{]*\{/gm) ?? []) {
      expect(rule).toContain(":root:not([data-motion='reduced'])")
    }
    // Con el retraso de la página, la tarjeta termina antes de 1,5 s.
    expect(lastFrame(own, 380)).toBeLessThanOrEqual(1500)
    // Emblema → titular → tarjeta → sello → regla.
    const at = (name: string) =>
      Number(
        own.match(
          new RegExp(`${name} \\d+ms calc\\(var\\(--ticket-ceremony-delay\\) \\+ (\\d+)ms`),
        )?.[1],
      )
    expect(at('ticket-stamp')).toBeLessThan(at('ticket-draw'))
    // La regla se descubre solo con transform.
    expect(ticket).toMatch(
      /@keyframes ticket-draw \{\s*from \{\s*transform: translateX\(0\);\s*\}\s*\}/,
    )
  })

  it('une etiqueta y valor con puntos guía de latón', () => {
    expect(css).toMatch(/\.bk-leaders__row::after \{[^}]*radial-gradient/)
    expect(css).toMatch(/\.bk-leaders__row dd \{[^}]*order: 2;/)
  })

  it('fija «Tu cita» a la derecha en escritorio sin abrir hueco bajo el título', () => {
    expect(css).toMatch(/grid-template-rows: auto auto 1fr;/)
    expect(css).toMatch(/\.bk-details__pase \{\s*position: sticky;/)
    expect(css).toMatch(/\.bk-details__pase-card \{\s*display: none;/)
  })

  it('deja la acción secundaria del mismo alto, sin relleno', () => {
    expect(css).toMatch(/\.bk-cta--secondary \{[^}]*background-color: transparent;/)
  })

  it('cierra la revisión de E1: sin barra nativa en los días, pase y pasos al cargar', () => {
    expect(css).toMatch(/\.bk-days \{[^}]*scrollbar-width: none;/)
    expect(css).toMatch(/\.bk-days::-webkit-scrollbar \{\s*display: none;/)
    expect(daytime).toMatch(/bk-pase--skeleton[^]*?bk-cta bk-cta--idle">Elige una hora/)
    expect(layout).toMatch(/\(businessName \|\| !vocabularySettled\)/)
  })
})
