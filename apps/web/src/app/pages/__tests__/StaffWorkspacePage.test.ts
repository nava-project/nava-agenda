/**
 * «Bloquear» en Profesionales (decisión del lote del pulido, 2026-11-24): es una
 * acción normal, en tinta, no de peligro. El rojo queda para errores y acciones
 * destructivas (estandar-diseno-visual §5), y un bloqueo se puede quitar.
 * El botón conserva el candado y su nombre accesible «Bloquear a …».
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '..', 'StaffWorkspacePage.vue'), 'utf8')
const template = /<template>([\s\S]*)<\/template>/.exec(source)![1]!
const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')

describe('StaffWorkspacePage · «Bloquear»', () => {
  it('is the plain secondary button: no danger color anywhere in its styles', () => {
    const blockRules = [...styles.matchAll(/([^{}]*\.block-action[^{}]*)\{([^}]*)\}/g)]
    expect(blockRules.length).toBeGreaterThan(0)
    for (const [, selector, body] of blockRules) {
      expect(`${selector}{${body}}`).not.toMatch(/danger|color-error/)
      expect(selector).not.toMatch(/base-button--secondary/)
    }
  })

  it('keeps the lock and the accessible name «Bloquear a …»', () => {
    const button = /<BaseButton[\s\S]*?class="block-action"[\s\S]*?<\/BaseButton>/.exec(
      template,
    )![0]
    expect(button).toContain('variant="secondary"')
    expect(button).toContain(':aria-label="`Bloquear a ${professional.fullName}`"')
    expect(button).toContain('class="block-action-icon"')
    expect(button).toMatch(/>\s*Bloquear\s*</)
  })
})
