/**
 * #791: los atajos «Entre semana», «Todos» y «Limpiar» miden 32 px con puntero
 * fino, pero en táctil y en angosto suben al piso de 44 px (CA-009-03, #783).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '../weekday-picker.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

describe('atajos del selector de días en táctil (#791)', () => {
  it('suben a 44 px con (max-width: 767px), (pointer: coarse)', () => {
    const block = css.match(
      /@media \(max-width: 767px\), \(pointer: coarse\) \{\s*\.weekday-picker__quick-button \{([^}]*)\}/,
    )
    expect(block?.[1]).toMatch(/min-height:\s*44px/)
  })
})
