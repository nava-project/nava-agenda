/**
 * #794: en angosto o táctil los botones de los emergentes miden 44 px de alto
 * (CA-009-03), no solo su zona activa: los del aviso, «Descartar todos», los
 * días y «Hoy» del calendario y la ranura «a. m. / p. m.». El rombo del sello
 * del aviso se queda quieto con movimiento reducido.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function style(file: string): string {
  const sfc = readFileSync(join(__dirname, '..', file), 'utf8')
  const css = sfc.slice(sfc.indexOf('<style'))
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function touchBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 767px), (pointer: coarse) {')
  expect(start).toBeGreaterThan(-1)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  return ''
}

describe('blancos táctiles de los emergentes (#794)', () => {
  it('BaseToast: «Reintentar» y «Descartar» de 44 px', () => {
    const block = touchBlock(style('BaseToast.vue'))
    expect(block).toMatch(/\.base-toast__action,\s*\.base-toast__dismiss \{\s*height: 44px;/)
  })

  it('ToastRegion: «Descartar todos» de 44 px', () => {
    expect(touchBlock(style('ToastRegion.vue'))).toMatch(/\.toast-region__clear \{\s*height: 44px;/)
  })

  it('BaseDatePicker: días y «Hoy» de 44 px, con el factor de ventanas bajas', () => {
    const block = touchBlock(style('BaseDatePicker.vue'))
    expect(block).toMatch(/\.agenda-date-picker__day,\s*\.agenda-date-picker__today \{/)
    expect(block).toMatch(/min-height: calc\(44px \* var\(--dp-zoom, 1\)\)/)
  })

  it('BaseTimePicker: «a. m.» y «p. m.» de 44 px cada uno', () => {
    expect(touchBlock(style('BaseTimePicker.vue'))).toMatch(
      /\.base-time-picker__meridiem \{\s*grid-template-rows: 44px 44px;/,
    )
  })

  it('el sello en rombo del aviso no se anima con movimiento reducido', () => {
    const css = style('BaseToast.vue')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.base-toast__mark::before \{\s*animation: none;/)
  })
})
