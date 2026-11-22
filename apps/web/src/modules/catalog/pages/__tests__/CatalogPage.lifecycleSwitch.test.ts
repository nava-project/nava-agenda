/**
 * «Estado del servicio» con el interruptor de la familia (#791): ranura recta y
 * rombo, como SwitchField de 8c, y un anillo de foco que ninguna regla en
 * reposo le gana (lo que pasó en #783 con «Guardar»).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../CatalogPage.vue'), 'utf8')
const css = source
  .split('<style')
  .slice(1)
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function rules(selectorPart: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector = '', body = '']) => ({ selector: selector.trim(), body }))
    .filter((rule) => rule.selector.includes(selectorPart))
}

describe('interruptor de «Estado del servicio» (#791)', () => {
  it('la perilla es un rombo que gira, no un círculo', () => {
    const thumb = rules('.catalog-page__lifecycle-thumb').find(
      (rule) => rule.selector === '.catalog-page__lifecycle-thumb',
    )
    expect(thumb?.body).toMatch(/rotate:\s*45deg/)
    expect(thumb?.body).not.toMatch(/border-radius/)
    const on = rules('.catalog-page__lifecycle-switch--on .catalog-page__lifecycle-thumb')[0]
    expect(on?.body).toMatch(/rotate:\s*135deg/)
  })

  it('la ranura es recta, no una píldora', () => {
    const track = rules('.catalog-page__lifecycle-track').find(
      (rule) => rule.selector === '.catalog-page__lifecycle-track',
    )
    expect(track?.body).toMatch(/border-radius:\s*3px/)
  })

  it('solo :focus-visible pinta sombra en el botón: ninguna regla en reposo pisa el anillo', () => {
    const shadowed = rules('.catalog-page__lifecycle-switch')
      .filter((rule) => !rule.selector.includes(' '))
      .filter((rule) => /box-shadow/.test(rule.body))
    expect(shadowed.map((rule) => rule.selector)).toEqual([
      '.catalog-page__lifecycle-switch:focus-visible',
    ])
  })

  it('la etiqueta apagada baja a texto secundario, no a opacidad (axe: 3,5:1 con 0,4)', () => {
    const labels = rules('.catalog-page__lifecycle-state')
    expect(labels.some((rule) => /opacity/.test(rule.body))).toBe(false)
    const dimmed = labels.find((rule) => rule.selector.includes(':not('))
    expect(dimmed?.body).toMatch(/color:\s*var\(--color-text-secondary\)/)
  })
})
