/**
 * DiamondRule (DEC-189, #728): la regla-rombo-regla. Sin rótulo es decoración
 * oculta a los lectores de pantalla; con rótulo, el corte se lee.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import DiamondRule from '../DiamondRule.vue'

const axeOptions = { rules: { region: { enabled: false } } }

describe('DiamondRule', () => {
  it('is hidden from assistive technology when it has no label', () => {
    const wrapper = mount(DiamondRule)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.diamond-rule__mark').exists()).toBe(true)
    expect(wrapper.find('.diamond-rule__label').exists()).toBe(false)
  })

  it('reads its label when it marks a meaningful cut', async () => {
    const wrapper = mount(DiamondRule, {
      props: { label: 'Para todo el negocio' },
      attachTo: document.body,
    })
    expect(wrapper.attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.get('.diamond-rule__label').text()).toBe('Para todo el negocio')
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })

  it('takes the tone of a state and the short size for page states', () => {
    const wrapper = mount(DiamondRule, {
      props: { tone: 'var(--color-warning-text)', size: 'short' },
    })
    expect(wrapper.classes()).toContain('diamond-rule--short')
    expect(wrapper.attributes('style')).toContain('--diamond-rule-tone: var(--color-warning-text)')
  })
})
