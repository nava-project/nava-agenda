/**
 * #791: «Elegir foto», «Deshacer» y «Quitar foto» son compactos (36 px) con
 * puntero fino, pero en táctil y en angosto suben al piso de 44 px
 * (CA-009-03, #783).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../ProfessionalPhotoField.vue'), 'utf8')
  .split('<style')
  .slice(1)
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('botones de la foto en táctil (#791)', () => {
  it('suben a 44 px con (max-width: 767px), (pointer: coarse)', () => {
    const block = css.match(
      /@media \(max-width: 767px\), \(pointer: coarse\) \{\s*\.professional-photo-field__actions :deep\(\.base-button\) \{([^}]*)\}/,
    )
    expect(block?.[1]).toMatch(/height:\s*44px/)
  })
})
