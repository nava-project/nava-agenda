/**
 * Comillas de los textos visibles (#815): las referencias a secciones y botones
 * van en comillas españolas «», como el resto de la app. Este barrido de los
 * `<template>` impide que vuelvan “”, ‘’ o "" rodeando un texto.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(__dirname, '..', '..', '..')

// El texto visible de un template: sin comentarios ni etiquetas (los atributos
// viven dentro de la etiqueta y usan comillas rectas a propósito).
function visibleText(source: string): string {
  const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? ''
  return template.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '\n')
}

describe('comillas de los textos visibles (#815)', () => {
  it('detecta las comillas que no son españolas y deja pasar «»', () => {
    const offending = (s: string) => /[“”‘’]|"[^"\n]*"/.test(visibleText(s))
    expect(offending('<template><a>“Servicios”</a></template>')).toBe(true)
    expect(offending('<template><span>"{{ v.Professionals }}"</span></template>')).toBe(true)
    expect(
      offending('<template><a class="x" :to="{ name: \'a\' }">«Servicios»</a></template>'),
    ).toBe(false)
  })

  it('ningún template usa “”, ‘’ ni "" alrededor de un texto', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path)
        } else if (entry.name.endsWith('.vue')) {
          for (const line of visibleText(readFileSync(path, 'utf8')).split('\n'))
            if (/[“”‘’]|"[^"\n]*"/.test(line))
              offenders.push(`${path.slice(src.length + 1)}: ${line.trim()}`)
        }
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })
})
