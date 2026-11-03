import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import WeekdayMultiPicker from '../WeekdayMultiPicker.vue'

function mountPicker(
  props: Partial<{ modelValue: number[]; disabled: boolean; error: string }> = {},
) {
  return mount(WeekdayMultiPicker, {
    attachTo: document.body,
    props: { modelValue: [], label: 'Días de la semana', ...props },
  })
}

function chips(wrapper: ReturnType<typeof mountPicker>) {
  return wrapper.findAll('.weekday-picker__chip')
}

function quick(wrapper: ReturnType<typeof mountPicker>, name: string) {
  return wrapper.findAll('.weekday-picker__quick-button').find((b) => b.text() === name)!
}

describe('WeekdayMultiPicker', () => {
  it('exposes seven toggle buttons named by the full weekday and reflects the selection', () => {
    const wrapper = mountPicker({ modelValue: [1, 3] })

    expect(chips(wrapper).map((c) => c.attributes('aria-label'))).toEqual([
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ])
    expect(chips(wrapper).map((c) => c.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ])
    wrapper.unmount()
  })

  it('adds and removes days keeping the list sorted', async () => {
    const wrapper = mountPicker({ modelValue: [2, 5] })

    await chips(wrapper)[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([[1, 2, 5]])

    await chips(wrapper)[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')![1]).toEqual([[5]])
    wrapper.unmount()
  })

  it('offers shortcuts for weekdays, every day and clearing', async () => {
    const wrapper = mountPicker({ modelValue: [6] })

    await quick(wrapper, 'Entre semana').trigger('click')
    await quick(wrapper, 'Todos').trigger('click')
    await quick(wrapper, 'Limpiar').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([
      [[1, 2, 3, 4, 5]],
      [[1, 2, 3, 4, 5, 6, 7]],
      [[]],
    ])
    wrapper.unmount()
  })

  it('disables the shortcuts that would change nothing', () => {
    const wrapper = mountPicker({ modelValue: [1, 2, 3, 4, 5] })

    expect(quick(wrapper, 'Entre semana').attributes('disabled')).toBeDefined()
    expect(quick(wrapper, 'Limpiar').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('does nothing while disabled', async () => {
    const wrapper = mountPicker({ disabled: true })
    await chips(wrapper)[0]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('announces the error and has no axe violations', async () => {
    const wrapper = mountPicker({ modelValue: [1], error: 'Elige al menos un día.' })

    expect(wrapper.get('[role="alert"]').text()).toBe('Elige al menos un día.')
    expect(await axe(wrapper.element as HTMLElement)).toHaveNoViolations()
    wrapper.unmount()
  })
})
