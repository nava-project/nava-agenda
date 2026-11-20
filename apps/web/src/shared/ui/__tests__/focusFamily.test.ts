/**
 * Un solo foco de la familia (#739, punto 4 del pulido). El anillo es del color
 * del texto (`--color-focus`), de 2 px y con su hueco, en público y en el panel.
 * Antes convivían tres: frambuesa con resplandor sobre gris en la reserva, un
 * doble anillo grueso en mi turno y otro en el panel. Esta red estática lee el
 * CSS y falla si un estado de foco vuelve a pintarse con el acento del negocio,
 * con resplandor o con otro grosor.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../..')
const sources: Record<string, string> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(vue|css)$/.test(file) && !file.includes('__tests__'))
    .map((file) => [
      `/src/${relative(SRC, join(SRC, file))}`,
      readFileSync(join(SRC, file), 'utf8'),
    ]),
)

/* Colores del acento: válidos para marcar lo elegido, nunca para el foco. */
const ACCENT =
  /var\(--(pb-brass|bk-accent|ax-brass|mt-brass|ac-brass|rs-brass|cd-brass|color-brand-accent-surface|color-brand-alba)\b/

function focusRules(source: string): { selector: string; body: string }[] {
  const css = source.includes('<style') ? source.split('<style').slice(1).join('\n') : source
  const rules: { selector: string; body: string }[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (/:focus(-visible|-within)?\b/.test(selector)) rules.push({ selector, body: match[2] ?? '' })
  }
  return rules
}

describe('foco de la familia (#739)', () => {
  const all = Object.entries(sources).flatMap(([path, source]) =>
    focusRules(source).map((rule) => ({ path, ...rule })),
  )

  it('ningún foco usa el acento del negocio', () => {
    const offenders = all
      .filter(({ body }) => /(outline|box-shadow)[^;]*/.test(body))
      .filter(({ body }) =>
        body
          .split(';')
          .filter((decl) => /^\s*(outline|box-shadow)/.test(decl))
          // Un filete interior (inset) marca lo elegido, no el foco.
          .some((decl) => ACCENT.test(decl) && !/inset/.test(decl)),
      )
      .map(({ path, selector }) => `${path} → ${selector}`)
    expect(offenders).toEqual([])
  })

  it('ningún foco lleva resplandor', () => {
    const offenders = all
      .filter(({ body }) => /box-shadow:[^;]*0 0 \d{2}px/.test(body))
      .map(({ path, selector }) => `${path} → ${selector}`)
    expect(offenders).toEqual([])
  })

  it('el contorno de foco mide 2 px', () => {
    const offenders = all
      .filter(({ body }) => /outline:\s*(3px|4px|var\(--border-width-emphasis)/.test(body))
      .map(({ path, selector }) => `${path} → ${selector}`)
    expect(offenders).toEqual([])
  })

  it('el paginador recupera el anillo que su `box-shadow: none` quitaba', () => {
    expect(sources['/src/shared/ui/BasePagination.vue']).toMatch(
      /\.base-pagination__nav :deep\(\.base-button:focus-visible\) \{\s*outline: 2px solid var\(--color-focus\);/,
    )
  })

  it.each([
    ['/src/shared/ui/BaseInput.vue', 'base-input__error'],
    ['/src/shared/ui/PhoneField.vue', 'phone-field__error'],
    ['/src/shared/ui/OtpInput.vue', 'otp-input__error'],
  ])('el error de %s lleva su rombo de aviso', (path, cls) => {
    const source = sources[path] ?? ''
    const mark = source.match(new RegExp(`\\.${cls}::before \\{([^}]*)\\}`))?.[1] ?? ''
    expect(mark).toMatch(/mask: url\("data:image\/svg\+xml/)
    expect(mark).toMatch(/background-color: currentColor;/)
  })

  it('el selector de prefijo no pinta un segundo anillo dentro de la fila', () => {
    expect(sources['/src/shared/ui/PhoneField.vue']).not.toMatch(
      /phone-field__select:focus-visible\) \.phone-field__face/,
    )
  })

  it('el iframe del mapa no es una parada de Tab invisible', () => {
    expect(sources['/src/shared/ui/LocationMap.vue']).toMatch(
      /class="location-map__frame"[^>]*tabindex="-1"/,
    )
  })
})
