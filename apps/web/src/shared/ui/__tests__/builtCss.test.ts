/**
 * El velo de BaseDialog se desenfoca también en Firefox (#791). El fallo solo
 * existía en el CSS construido: con `-webkit-backdrop-filter` escrito a mano,
 * Lightning CSS dejaba solo el prefijado. `pnpm run build` corre
 * scripts/check-built-css.mjs sobre dist; aquí se fija su criterio y que el
 * fuente no vuelva a escribir el prefijo a mano.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prefixedOnlyRules } from '../../../../scripts/check-built-css.mjs'

describe('CSS construido sin propiedades solo prefijadas (#791)', () => {
  it('señala la regla que el build de main dejaba solo con -webkit-backdrop-filter', () => {
    const mainBuild =
      '.base-dialog__overlay[data-v-1991b1a1]{background-color:var(--color-overlay-scrim);-webkit-backdrop-filter:blur(6px);z-index:var(--layer-dialog)}'
    expect(prefixedOnlyRules(mainBuild)).toHaveLength(1)
  })

  it('acepta la regla con las dos declaraciones y la que solo trae la estándar', () => {
    const fixed =
      '.a{-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}.b{backdrop-filter:blur(2px)}'
    expect(prefixedOnlyRules(fixed)).toEqual([])
  })

  it('lee cada regla por separado, también dentro de @media', () => {
    const css =
      '@media (min-width:640px){.a{-webkit-backdrop-filter:blur(2px)}}.b{backdrop-filter:blur(2px)}'
    expect(prefixedOnlyRules(css)).toEqual(['.a { -webkit-backdrop-filter … }'])
  })

  it('BaseDialog no escribe el prefijo a mano: lo pone el minificador', () => {
    const source = readFileSync(join(__dirname, '../BaseDialog.vue'), 'utf8')
    expect(source).toMatch(/^\s*backdrop-filter: blur\(6px\);/m)
    expect(source).not.toMatch(/^\s*-webkit-backdrop-filter:/m)
  })
})
