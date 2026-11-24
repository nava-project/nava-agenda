/**
 * SunDiamond (#735): la marca de la espera, el diamante dentro del sol.
 * Decorativa, con máscara propia por instancia, sin rayos dentro de un botón y
 * quieta con movimiento reducido (del sistema o del panel).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import SunDiamond from '../SunDiamond.vue'

describe('SunDiamond', () => {
  it('is decorative', () => {
    const wrapper = mount(SunDiamond)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('focusable')).toBe('false')
  })

  it('cuts the diamond out of the sun with a mask of its own per instance', () => {
    // Dos en la misma app (useId es único por app): un botón que espera dentro
    // de una pantalla que carga.
    const Pair = defineComponent({
      components: { SunDiamond },
      template: '<div><SunDiamond /><SunDiamond size="sm" /></div>',
    })
    const wrapper = mount(Pair)
    const masks = wrapper.findAll('mask').map((m) => m.attributes('id'))
    expect(new Set(masks).size).toBe(2)
    expect(wrapper.findAll('.sun-diamond__disc')[0]!.attributes('mask')).toBe(`url(#${masks[0]})`)
  })

  it('draws the eight rays except inside a button', () => {
    expect(mount(SunDiamond, { props: { size: 'lg' } }).findAll('.sun-diamond__ray')).toHaveLength(
      8,
    )
    expect(mount(SunDiamond, { props: { size: 'sm' } }).findAll('.sun-diamond__ray')).toHaveLength(
      0,
    )
  })

  it('stands still with reduced motion, from the system or from the panel', () => {
    const css = readFileSync(resolve(__dirname, '../SunDiamond.vue'), 'utf-8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;/)
    expect(css).toMatch(/:root\[data-motion='reduced'\] \.sun-diamond__rays/)
    // `:global(X) .y` compila a solo `X` en scoped (#731): no se usa.
    expect(css).not.toMatch(/^:global\(/m)
  })

  it('moves only with transform and opacity', () => {
    const css = readFileSync(resolve(__dirname, '../SunDiamond.vue'), 'utf-8')
    const frames = css.match(/@keyframes[^{]+\{([\s\S]*?)\n\}/g) ?? []
    expect(frames.length).toBeGreaterThan(0)
    for (const block of frames) {
      const props = [...block.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1])
      for (const prop of props) expect(['transform', 'opacity']).toContain(prop)
    }
  })

  it('stands still as a state mark, not a wait (#809)', () => {
    const wrapper = mount(SunDiamond, { props: { still: true } })
    expect(wrapper.classes()).toContain('sun-diamond--still')
    expect(mount(SunDiamond).classes()).not.toContain('sun-diamond--still')
    const css = readFileSync(resolve(__dirname, '../SunDiamond.vue'), 'utf-8')
    const block = /\.sun-diamond--still,[\s\S]*?\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toContain('animation: none')
    for (const part of ['__rays', '__sun', '__gem', '__gleam'])
      expect(css).toContain(`.sun-diamond--still .sun-diamond${part}`)
  })
})
