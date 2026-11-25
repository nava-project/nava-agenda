/**
 * El velo de BaseDialog se desenfoca también en Firefox (#791). El fallo solo
 * existía en el CSS construido: con `-webkit-backdrop-filter` escrito a mano,
 * Lightning CSS dejaba solo el prefijado. `pnpm run build` corre
 * scripts/check-built-css.mjs sobre dist; aquí se fija su criterio y que el
 * fuente no vuelva a escribir el prefijo a mano.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prefixedOnlyRules, rootOnlyRules } from '../../../../scripts/check-built-css.mjs'

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

describe('ninguna regla cae sobre toda la raíz (#846)', () => {
  it('señala lo que el build de main dejaba de `:global(:root[data-motion]) .clase`', () => {
    const mainBuild =
      '.staff-page__skeleton-bar[data-v-1]{opacity:.6}:root[data-motion=reduced],:root[data-motion=reduced]{opacity:.8;animation:none}'
    expect(rootOnlyRules(mainBuild)).toEqual([
      ':root[data-motion=reduced],:root[data-motion=reduced] { opacity; animation }',
    ])
  })

  it('acepta los tokens de la apariencia y las reglas que bajan a un elemento', () => {
    const css =
      ':root[data-app-theme=ink]{--color-canvas:#0b1022;color-scheme:dark}' +
      ':root[data-motion=reduced] .staff-page__skeleton-bar[data-v-1]{animation:none;opacity:.8}' +
      ':root[data-motion=reduced] *,:root[data-motion=reduced] :after{animation-duration:.01ms!important}'
    expect(rootOnlyRules(css)).toEqual([])
  })

  it('el fuente no escribe `:global(X) .y` en estilos scoped: compila a solo X (#731)', () => {
    const src = join(__dirname, '../../..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.vue')) {
          const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
          for (const match of source.matchAll(/:global\([^)]*\)\s*[^\s{,]/g))
            offenders.push(`${path.slice(src.length + 1)}: ${match[0]}`)
        }
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })
})
