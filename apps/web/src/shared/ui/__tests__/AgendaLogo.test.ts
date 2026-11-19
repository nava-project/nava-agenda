import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import AgendaLogo from '../AgendaLogo.vue'
import NavaWordmark from '../NavaWordmark.vue'

describe('AgendaLogo (DEC-188)', () => {
  it('es decorativo por omisión: el nombre lo da el texto vecino', () => {
    const svg = mount(AgendaLogo).find('svg')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
  })

  it('con label se anuncia como imagen', () => {
    const svg = mount(AgendaLogo, { props: { label: 'Nava Agenda' } }).find('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('Nava Agenda')
    expect(svg.attributes('aria-hidden')).toBeUndefined()
  })

  it('dibuja la baldosa solo cuando se pide', () => {
    expect(mount(AgendaLogo).find('rect').exists()).toBe(false)
    expect(
      mount(AgendaLogo, { props: { tile: true } })
        .find('rect')
        .exists(),
    ).toBe(true)
  })

  it('usa la misma geometría que el favicon', () => {
    const favicon = readFileSync(resolve(__dirname, '../../../../public/favicon.svg'), 'utf-8')
    for (const path of mount(AgendaLogo).findAll('path')) {
      for (const piece of (path.attributes('d') ?? '').split(' M')) {
        expect(favicon).toContain(piece.replace(/^M?/, ''))
      }
    }
  })
})

describe('NavaWordmark', () => {
  it('firma con el logo, NAVA y el producto', () => {
    const wrapper = mount(NavaWordmark)
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.text()).toBe('NAVA Agenda')
  })

  it('puede omitir el producto', () => {
    expect(mount(NavaWordmark, { props: { product: false } }).text()).toBe('NAVA')
  })
})
