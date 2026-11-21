/**
 * Rombos, no círculos (#737, punto 1 del pulido): ningún marcador de estado,
 * paso, viñeta, «ahora» ni espera se dibuja redondo. Es una red estática: lee
 * el CSS de cada componente y hoja, y busca las reglas redondas. Cada selector
 * que queda redondo tiene que estar en la lista de abajo, con su motivo; un
 * marcador nuevo y redondo hace fallar la prueba.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/* Se lee del disco: con `?raw`, Vitest entrega vacías las hojas .css. */
const SRC = join(__dirname, '../../..')
const sources: Record<string, string> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(vue|css)$/.test(file))
    .map((file) => [
      `/src/${relative(SRC, join(SRC, file))}`,
      readFileSync(join(SRC, file), 'utf8'),
    ]),
)

/* Lo que puede seguir redondo, porque no es un marcador. */
const ROUND_ALLOWED: Record<string, string> = {
  '.appointment-ticket__perforation::before': 'perforación del boleto (objeto físico)',
  '.appointment-ticket__perforation::after': 'perforación del boleto (objeto físico)',
  '.new-appointment-page__resumen-perforation::before': 'perforación del boleto (objeto físico)',
  '.new-appointment-page__resumen-perforation::after': 'perforación del boleto (objeto físico)',
  '.location-picker__activate-hint': 'píldora de texto',
  '.schedules-switch__thumb': 'perilla de interruptor (control)',
  '.offer-switch__thumb': 'perilla de interruptor (control)',
  '.catalog-page__lifecycle-thumb': 'perilla de interruptor (control)',
  '.schedules-page__segment-add': 'botón de añadir (control, no marcador)',
  '.bk-days__nav': 'flechas del carrusel de días (control)',
  '.bk-chip__any': 'hueco de avatar de «Cualquiera», junto a las fotos redondas',
  '.bk-chip .professional-avatar': 'foto del profesional',
  '.daily-agenda-page__timeline-slip-initial': 'avatar de inicial',
  '.shell-ambient__glow': 'luz ambiental del fondo',
  '.professional-reviews__badge': 'píldora de texto',
  '.actions__stamp': 'píldora de texto',
  '.catalog-page__detail-status': 'píldora de texto',
}

function roundSelectors(source: string): string[] {
  const css = source.includes('<style') ? source.split('<style').slice(1).join('\n') : source
  const found: string[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (const match of css.matchAll(rule)) {
    const [, selector = '', body = ''] = match
    if (/border-radius:\s*(50%|999px)\s*;/.test(body)) {
      const clean = selector.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const one of clean.split(',')) found.push(one.replace(/\s+/g, ' ').trim())
    }
  }
  return found
}

describe('marcadores en rombo (#737)', () => {
  it('ningún selector nuevo dibuja un círculo', () => {
    const offenders: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      if (path.includes('/__tests__/')) continue
      for (const selector of roundSelectors(source)) {
        if (!(selector in ROUND_ALLOWED)) offenders.push(`${path} → ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('las excepciones siguen existiendo (la lista no acumula restos)', () => {
    const all = Object.entries(sources)
      .filter(([path]) => !path.includes('/__tests__/'))
      .flatMap(([, source]) => roundSelectors(source))
    for (const selector of Object.keys(ROUND_ALLOWED)) {
      expect(all, selector).toContain(selector)
    }
  })

  it('el punto de BaseBadge es un rombo', () => {
    const badge = sources['/src/shared/ui/BaseBadge.vue'] ?? ''
    const dot = badge.match(/\n\.base-badge__dot \{([^}]*)\}/)?.[1] ?? ''
    expect(dot).toMatch(/rotate: 45deg;/)
    expect(dot).not.toMatch(/border-radius: 50%/)
  })
})
