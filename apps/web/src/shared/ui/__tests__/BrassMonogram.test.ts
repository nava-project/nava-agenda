import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrassMonogram from '../BrassMonogram.vue'

const source = readFileSync(join(__dirname, '../BrassMonogram.vue'), 'utf8')

describe('BrassMonogram (#799)', () => {
  it('es decorativo y muestra el glifo en sans por omisión, sin rombo', () => {
    const wrapper = mount(BrassMonogram, { props: { glyph: 'AP' } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.brass-monogram__glyph').text()).toBe('AP')
    expect(wrapper.classes()).toContain('brass-monogram--sans')
    expect(wrapper.classes()).not.toContain('brass-monogram--pendant')
  })

  it('con serif, rombo y tono de peligro lo refleja en sus clases', () => {
    const wrapper = mount(BrassMonogram, {
      props: { glyph: 'C', face: 'serif', pendant: true, tone: 'danger' },
    })
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining([
        'brass-monogram--serif',
        'brass-monogram--pendant',
        'brass-monogram--danger',
      ]),
    )
  })

  it('el contenido del slot sustituye al glifo (una foto, un trazo)', () => {
    const wrapper = mount(BrassMonogram, {
      props: { glyph: 'X' },
      slots: { default: '<img class="foto" alt="" src="/f.jpg" />' },
    })
    expect(wrapper.find('.foto').exists()).toBe(true)
    expect(wrapper.find('.brass-monogram__glyph').exists()).toBe(false)
  })

  it('dibuja filete, base y glifo de latón con los tokens de la familia', () => {
    expect(source).toMatch(/--monogram-line: var\(--color-brass-line\)/)
    expect(source).toMatch(/--monogram-body: var\(--color-brass-body\)/)
    expect(source).toMatch(/--monogram-ink: var\(--color-brass-text\)/)
    expect(source).toMatch(/box-shadow: inset 0 -2px 0 var\(--monogram-body\)/)
  })

  it('el rombo es un cuadrado girado 45°, recortado contra el fondo, nunca un círculo', () => {
    expect(source).toMatch(/\.brass-monogram::after \{[^}]*rotate\(45deg\)/)
    expect(source).toMatch(/border: 2px solid var\(--monogram-cutout, var\(--color-surface\)\)/)
    expect(source).not.toMatch(/border-radius:\s*50%/)
  })
})
