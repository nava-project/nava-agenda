/**
 * Paleta v2 «La luz del día» (DEC-188), con la familia NAVA de vuelta (#726): cada par de TOKEN_PAIRS se mide en los
 * modos Día y Noche leyendo tokens.css tal como lo sirve la app. Si alguien
 * cambia un color sin contraste suficiente, falla aquí.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/shared/model/brandPalette'
import { TOKEN_PAIRS } from '../tokenPairs'

const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf-8')

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim())
  return map
}

const dayBlock = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
const inkBlock = /:root\[data-app-theme='ink'\] \{([^}]*)\}/.exec(css)?.[1] ?? ''
const systemDarkBlock =
  /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-app-theme\]\) \{([^}]*)\}/.exec(
    css,
  )?.[1] ?? ''

const day = declarations(dayBlock)
const night = new Map([...day, ...declarations(inkBlock)])

/** Resuelve `var(--x)` y `var(--x, #fallback)` hasta un hexadecimal. */
function resolveColor(mode: Map<string, string>, name: string, depth = 0): string {
  const raw = mode.get(name)
  if (raw === undefined || depth > 8) throw new Error(`${name} sin valor`)
  const ref = /^var\((--[a-z0-9-]+)(?:,\s*(#[0-9a-f]{6}))?\)$/.exec(raw)
  if (!ref) return raw
  if (mode.has(ref[1]!)) return resolveColor(mode, ref[1]!, depth + 1)
  if (ref[2]) return ref[2]
  throw new Error(`${name} apunta a ${ref[1]} sin valor`)
}

describe('tokens v2 (DEC-188)', () => {
  it('define los modos Día y Noche, y las dos copias de Noche son idénticas', () => {
    expect(dayBlock).not.toBe('')
    expect(inkBlock).not.toBe('')
    expect([...declarations(systemDarkBlock)]).toEqual([...declarations(inkBlock)])
  })

  // La familia NAVA vuelve (#726): Día es el marfil de Pedidos y la landing, los
  // titulares van en Instrument Serif y el latón tiene su par de texto.
  it('Día es el marfil de la familia y los titulares van en Instrument Serif', () => {
    expect(resolveColor(day, '--color-canvas')).toBe('#f4f0e7')
    expect(day.get('--font-serif')).toMatch(/^'Instrument Serif'/)
    expect(day.get('--font-display')).toBe('var(--font-serif)')
    expect(resolveColor(day, '--color-brass-line')).toBe('#b8955a')
    expect(resolveColor(night, '--color-brass-text')).toBe('#c9a86f')
  })

  for (const [label, mode] of [
    ['Día', day],
    ['Noche', night],
  ] as const) {
    it.each(TOKEN_PAIRS.map((p) => [p.fg, p.bg, p.min] as const))(
      `${label}: %s sobre %s (≥ %s)`,
      (fg, bg, min) => {
        const ratio = contrastRatio(resolveColor(mode, fg), resolveColor(mode, bg))
        expect(ratio).toBeGreaterThanOrEqual(min)
      },
    )
  }
})
