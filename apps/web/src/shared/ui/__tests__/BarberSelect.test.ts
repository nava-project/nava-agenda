import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BarberSelect from '../BarberSelect.vue'

const barbers = [
  { id: 'b-1', fullName: 'Carlos Ramírez' },
  { id: 'b-2', fullName: 'Ana Torres' },
  { id: 'b-3', fullName: 'Luis Gómez' },
]

function mountSelect(modelValue: string | null = 'b-2') {
  return mount(BarberSelect, {
    props: { modelValue, barbers, triggerId: 'barber-test-select' },
    attachTo: document.body,
  })
}

describe('BarberSelect', () => {
  it('muestra al barbero elegido en el disparador y lo marca en la lista', () => {
    const wrapper = mountSelect('b-2')

    expect(wrapper.get('#barber-test-select').text()).toContain('Ana Torres')
    const options = wrapper.findAll('[role="option"]')
    expect(options.map((o) => o.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
    wrapper.unmount()
  })

  it('abre la lista con el disparador y emite el barbero al elegir una opción', async () => {
    const wrapper = mountSelect('b-2')
    const trigger = wrapper.get('#barber-test-select')
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    await wrapper.findAll('[role="option"]')[2]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['b-3']])
    expect(trigger.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('se maneja con teclado: flechas para moverse, Enter elige y Escape cierra', async () => {
    const wrapper = mountSelect('b-2')
    await wrapper.get('#barber-test-select').trigger('click')
    const list = wrapper.get('[role="listbox"]')

    await list.trigger('keydown', { key: 'ArrowDown' })
    await list.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['b-3']])

    await wrapper.get('#barber-test-select').trigger('click')
    await list.trigger('keydown', { key: 'Escape' })
    expect(wrapper.get('#barber-test-select').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('con el valor vacío muestra el texto de ayuda en lugar de un nombre', () => {
    const wrapper = mount(BarberSelect, {
      props: { modelValue: null, barbers, placeholder: 'Elige quién atiende' },
    })

    expect(wrapper.get('.barber-select__trigger-label').text()).toBe('Elige quién atiende')
    wrapper.unmount()
  })
})
