import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ResendDusk from '../ResendDusk.vue'

describe('ResendDusk (#751)', () => {
  it('arranca el atardecer ya avanzado lo que pasó de la espera', () => {
    const w = mount(ResendDusk, { props: { total: 60, remaining: 45 } })
    const style = w.get('svg').attributes('style')
    expect(style).toContain('--dusk-total: 60s')
    expect(style).toContain('--dusk-elapsed: -15s')
  })

  it('se fija al montar: la cuenta que baja no mueve el retraso', async () => {
    const w = mount(ResendDusk, { props: { total: 60, remaining: 60 } })
    await w.setProps({ remaining: 30 })
    expect(w.get('svg').attributes('style')).toContain('--dusk-elapsed: 0s')
  })

  it('acota valores fuera de rango', () => {
    const w = mount(ResendDusk, { props: { total: 0, remaining: 99 } })
    const style = w.get('svg').attributes('style')
    expect(style).toContain('--dusk-total: 1s')
    expect(style).toContain('--dusk-elapsed: 0s')
  })

  it('es decorativo: la cuenta va en el texto de al lado', () => {
    const w = mount(ResendDusk, { props: { total: 60, remaining: 60 } })
    expect(w.get('svg').attributes('aria-hidden')).toBe('true')
    expect(w.get('svg').attributes('focusable')).toBe('false')
  })

  it('se mueve solo sin movimiento reducido, con transform', () => {
    const css = readFileSync(resolve(__dirname, '../ResendDusk.vue'), 'utf8')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*:root:not\(\[data-motion='reduced'\]\) \.dusk__sun \{\s*animation: dusk-set/,
    )
    const keyframes = css.slice(css.indexOf('@keyframes dusk-set'))
    expect(keyframes).not.toMatch(/(?:^|[\s{;])(?!transform)[a-z-]+:\s/m)
  })
})
