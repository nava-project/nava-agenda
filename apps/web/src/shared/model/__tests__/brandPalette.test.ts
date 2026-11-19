/**
 * Contraste de la paleta de acentos del negocio (DEC-110, WCAG 2.2 AA). Los
 * pares de los tokens v2 se miden en styles/__tests__/tokens.test.ts (DEC-188).
 * Esta prueba es la garantía de que ningún acento ni par de texto llegue a
 * pantalla sin haber sido medido: si alguien cambia un color o añade un
 * acento sin contraste suficiente, falla aquí.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BRAND_ACCENTS,
  contrastRatio,
  DEFAULT_BRAND_ACCENT,
  isBrandAccentKey,
  SURFACE_INK,
  SURFACE_IVORY,
} from '../brandPalette'

const AA_TEXT = 4.5

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // Simétrico: no importa cuál sea el color claro.
    expect(contrastRatio('#101b2b', '#f4f0e7')).toBeCloseTo(contrastRatio('#f4f0e7', '#101b2b'), 8)
  })
})

describe('BRAND_ACCENTS', () => {
  it('has the six closed keys the contract and the database allow', () => {
    expect(BRAND_ACCENTS.map((a) => a.key)).toEqual([
      'brass',
      'emerald',
      'sapphire',
      'ruby',
      'amethyst',
      'copper',
    ])
  })

  it('starts on brass, the NAVA brass, and recognizes only its own keys', () => {
    expect(DEFAULT_BRAND_ACCENT).toBe('brass')
    expect(isBrandAccentKey('emerald')).toBe(true)
    expect(isBrandAccentKey('#b8955a')).toBe(false)
    expect(isBrandAccentKey('Brass')).toBe(false)
    expect(isBrandAccentKey(null)).toBe(false)
  })

  it.each(BRAND_ACCENTS.map((a) => [a.key, a] as const))(
    '%s reads as text and as a button fill on the Noche canvas (AA)',
    (_key, accent) => {
      // Como texto o filete sobre tinta...
      expect(contrastRatio(accent.ink, SURFACE_INK)).toBeGreaterThanOrEqual(AA_TEXT)
      // ...y como relleno de un botón con texto del color de la superficie.
      expect(contrastRatio(SURFACE_INK, accent.ink)).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it.each(BRAND_ACCENTS.map((a) => [a.key, a] as const))(
    '%s reads as text and as a button fill on the Día canvas (AA)',
    (_key, accent) => {
      expect(contrastRatio(accent.ivory, SURFACE_IVORY)).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(SURFACE_IVORY, accent.ivory)).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it('keeps every accent readable over the surfaces and fields of both modes', () => {
    for (const accent of BRAND_ACCENTS) {
      // Superficie y campos de Noche, y la superficie blanca de Día.
      expect(contrastRatio(accent.ink, '#151b35')).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(accent.ink, '#1c2342')).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(accent.ink, '#080c1a')).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(accent.ivory, '#ffffff')).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  // DEC-188: el acento del negocio también va como texto o filete sobre los
  // cielos (los tintes de Mañana, Tarde y Noche) de cada modo.
  it('keeps every accent readable over the skies of its mode', () => {
    for (const accent of BRAND_ACCENTS) {
      for (const sky of ['#fff0d2', '#ffe0d6', '#e2e3fa']) {
        expect(contrastRatio(accent.ivory, sky)).toBeGreaterThanOrEqual(AA_TEXT)
      }
      for (const sky of ['#3a2d12', '#3c1f27', '#22264d']) {
        expect(contrastRatio(accent.ink, sky)).toBeGreaterThanOrEqual(AA_TEXT)
      }
    }
  })

  it('gives each accent distinct colors, so a choice is always visible', () => {
    expect(new Set(BRAND_ACCENTS.map((a) => a.ink)).size).toBe(BRAND_ACCENTS.length)
    expect(new Set(BRAND_ACCENTS.map((a) => a.ivory)).size).toBe(BRAND_ACCENTS.length)
  })
})

describe('alertas en línea de BaseAlert sobre tinta (DEC-149)', () => {
  const alert = readFileSync(resolve(__dirname, '../../ui/BaseAlert.vue'), 'utf-8')
  const css = alert.slice(alert.indexOf('<style'))

  // v2 (DEC-188, entrega 5): el acento es solo de la acción principal; la
  // palabra de estado va en texto secundario y el filete lleva el color.
  it('pinta la palabra de estado en texto secundario, sin el acento', () => {
    expect(/\.base-alert__status \{[^}]*var\(--color-text-secondary\)/.test(css)).toBe(true)
    expect(/\.base-alert__status \{[^}]*brand-accent/.test(css)).toBe(false)
  })

  it('usa el lienzo y el texto de tinta, no las superficies pastel de estado', () => {
    expect(css).toContain('--alert-surface: var(--color-surface);')
    expect(css).toContain('--alert-text: var(--color-on-strong);')
    expect(css).not.toMatch(/--color-(success|warning|danger|info)-(surface|text|border)/)
  })

  it.each(['success', 'warning', 'danger', 'info'])(
    'el filete de %s es el color de estado levantado a tinta',
    (variant) => {
      expect(alert).toContain(`${variant}: 'var(--color-${variant}-on-strong)'`)
    },
  )
})
