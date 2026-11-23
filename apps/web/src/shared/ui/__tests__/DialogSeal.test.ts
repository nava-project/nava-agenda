import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DialogSeal from '../DialogSeal.vue'

describe('DialogSeal (#791)', () => {
  it('sin glifo dibuja «agregar» con trazos, sin un «+» de texto que lea el lector', () => {
    const wrapper = mount(DialogSeal)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('svg path').exists()).toBe(true)
    expect(wrapper.text()).toBe('')
  })

  it('con glifo muestra la inicial y el tono de peligro', () => {
    const wrapper = mount(DialogSeal, { props: { glyph: 'C', tone: 'danger' } })
    expect(wrapper.text()).toBe('C')
    expect(wrapper.classes()).toContain('dialog-seal--danger')
  })

  it('es el retrato de latón compartido con su rombo colgante (#799)', () => {
    const wrapper = mount(DialogSeal, { props: { glyph: 'C' } })
    expect(wrapper.classes()).toContain('brass-monogram')
    expect(wrapper.classes()).toContain('brass-monogram--pendant')
    const source = readFileSync(join(__dirname, '../DialogSeal.vue'), 'utf8')
    expect(source).toContain("import BrassMonogram from './BrassMonogram.vue'")
  })
})
