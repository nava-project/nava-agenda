/**
 * BaseTimePicker (#722): la hora en 12 h es-CO en el disparador y en el diálogo
 * (hora 1–12, minutos y «a. m. / p. m.»), con el `v-model` en `HH:MM` de 24 h.
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import BaseTimePicker from '../BaseTimePicker.vue'

function render(modelValue = '', disabled = false) {
  return mount(BaseTimePicker, {
    attachTo: document.body,
    props: { modelValue, label: 'Hora de inicio', disabled, required: true },
    global: { stubs: { teleport: true } },
  })
}
const HOUR = '[role="spinbutton"][aria-valuemax="12"]'
const MINUTE = '[role="spinbutton"][aria-valuemax="59"]'
const radio = (w: ReturnType<typeof render>, label: string) =>
  w.findAll('[role="radio"]').find((r) => r.text() === label)!

describe('BaseTimePicker', () => {
  it('shows the chosen time in 12 h on the trigger, midnight and noon included', async () => {
    const wrapper = render('14:05')
    expect(wrapper.get('.base-time-picker__trigger').text()).toContain('2:05 p. m.')
    await wrapper.setProps({ modelValue: '00:00' })
    expect(wrapper.get('.base-time-picker__trigger').text()).toContain('12:00 a. m.')
    await wrapper.setProps({ modelValue: '12:30' })
    expect(wrapper.get('.base-time-picker__trigger').text()).toContain('12:30 p. m.')
    await wrapper.setProps({ modelValue: '23:59' })
    expect(wrapper.get('.base-time-picker__trigger').text()).toContain('11:59 p. m.')
    await wrapper.setProps({ modelValue: '' })
    expect(wrapper.get('.base-time-picker__trigger').text()).toContain('Elegir hora')
    wrapper.unmount()
  })

  it('a closing field reads midnight as «12:00 a. m. (medianoche)» and keeps the value (#767)', async () => {
    const wrapper = mount(BaseTimePicker, {
      attachTo: document.body,
      props: { modelValue: '00:00', label: 'Cierra', closing: true },
      global: { stubs: { teleport: true } },
    })
    const trigger = wrapper.get('.base-time-picker__trigger')
    expect(trigger.get('.base-time-picker__midnight-long').text()).toBe('12:00 a. m. (medianoche)')
    expect(trigger.get('.base-time-picker__midnight-short').text()).toBe('Medianoche')
    await wrapper.setProps({ modelValue: '24:00' })
    expect(trigger.find('.base-time-picker__midnight-long').exists()).toBe(true)
    // Cualquier otra hora se lee igual que en un campo de apertura.
    await wrapper.setProps({ modelValue: '00:30' })
    expect(trigger.find('.base-time-picker__midnight-long').exists()).toBe(false)
    expect(trigger.text()).toContain('12:30 a. m.')
    // Sin `closing`, la medianoche es solo «12:00 a. m.».
    await wrapper.setProps({ modelValue: '00:00', closing: false })
    expect(trigger.text()).toContain('12:00 a. m.')
    expect(trigger.text()).not.toContain('medianoche')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('draws its clock as a diamond, never a circle (#767)', () => {
    const wrapper = render('09:00')
    expect(wrapper.find('.base-time-picker__trigger circle').exists()).toBe(false)
    expect(wrapper.find('.base-time-picker__icon').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens in 12 h with the half of the day marked, and says so', async () => {
    const wrapper = render('19:45')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.get<HTMLInputElement>(HOUR).element.value).toBe('7')
    expect(wrapper.get<HTMLInputElement>(MINUTE).element.value).toBe('45')
    expect(radio(wrapper, 'p. m.').attributes('aria-checked')).toBe('true')
    expect(radio(wrapper, 'a. m.').attributes('aria-checked')).toBe('false')
    expect(wrapper.get(HOUR).attributes('aria-valuetext')).toBe('7 p. m.')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Formato de 12 horas')
    expect(wrapper.text()).not.toContain('24 horas')
    wrapper.unmount()
  })

  it('does not change a blank time until applying, and emits HH:MM in 24 h', async () => {
    const wrapper = render()
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    await wrapper.get(HOUR).setValue('11')
    await wrapper.get(MINUTE).setValue('55')
    await radio(wrapper, 'p. m.').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('.base-time-picker__apply').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['23:55']])
    expect(document.activeElement).toBe(wrapper.get('.base-time-picker__trigger').element)
    wrapper.unmount()
  })

  it('12 a. m. is midnight and 12 p. m. is noon', async () => {
    const wrapper = render()
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    await wrapper.get(HOUR).setValue('12')
    await wrapper.get(MINUTE).setValue('07')
    await radio(wrapper, 'a. m.').trigger('click')
    await wrapper.get('.base-time-picker__apply').trigger('click')
    await wrapper.setProps({ modelValue: '00:07' })
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.get<HTMLInputElement>(HOUR).element.value).toBe('12')
    await radio(wrapper, 'p. m.').trigger('click')
    await wrapper.get(MINUTE).setValue('00')
    await wrapper.get('.base-time-picker__apply').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['00:07'], ['12:00']])
    wrapper.unmount()
  })

  it('translates an hour typed in 24 h and moves on to the minutes', async () => {
    const wrapper = render()
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    const hour = wrapper.get<HTMLInputElement>(HOUR)
    const minute = wrapper.get<HTMLInputElement>(MINUTE)
    await hour.setValue('1')
    expect(hour.element.value).toBe('1')
    expect(document.activeElement).toBe(hour.element)
    await hour.setValue('14')
    expect(hour.element.value).toBe('2')
    expect(radio(wrapper, 'p. m.').attributes('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(minute.element)
    await hour.setValue('00')
    expect(hour.element.value).toBe('12')
    expect(radio(wrapper, 'a. m.').attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('validates manual precision and keeps letters out', async () => {
    const wrapper = render('00:07')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.get<HTMLInputElement>(HOUR).element.value).toBe('12')
    await wrapper.get(MINUTE).setValue('60')
    expect(wrapper.get('.base-time-picker__apply').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('Hora de 1 a 12 y minutos de 00 a 59.')
    await wrapper.get(MINUTE).setValue('xy')
    expect(wrapper.get<HTMLInputElement>(MINUTE).element.value).toBe('')
    expect(wrapper.get(MINUTE).attributes('aria-invalid')).toBe('true')
    await wrapper.get(MINUTE).setValue('-3')
    expect(wrapper.get<HTMLInputElement>(MINUTE).element.value).toBe('3')
    await wrapper.get(MINUTE).setValue('7')
    await wrapper.get('.base-time-picker__apply').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['00:07']])
    wrapper.unmount()
  })

  it('cancels the draft, isolates Escape and restores the original value on reopening', async () => {
    const wrapper = render('12:37')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    await wrapper.get(HOUR).setValue('7')
    await radio(wrapper, 'a. m.').trigger('click')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    let propagated = false
    const listener = () => {
      propagated = true
    }
    document.addEventListener('keydown', listener)
    wrapper.get('[role="dialog"]').element.dispatchEvent(event)
    document.removeEventListener('keydown', listener)
    await wrapper.vm.$nextTick()
    expect(event.defaultPrevented).toBe(true)
    expect(propagated).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.get<HTMLInputElement>(HOUR).element.value).toBe('12')
    expect(wrapper.get<HTMLInputElement>(MINUTE).element.value).toBe('37')
    expect(radio(wrapper, 'p. m.').attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('Escape returns focus to the trigger with a visible ring; the mouse does not force it (#794)', async () => {
    const wrapper = render('09:00')
    const trigger = wrapper.get<HTMLButtonElement>('.base-time-picker__trigger')
    const focus = vi.spyOn(trigger.element, 'focus')
    await trigger.trigger('click')
    wrapper
      .get('[role="dialog"]')
      .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: true })

    await trigger.trigger('click')
    await wrapper.findAll('.base-time-picker__footer button')[0]!.trigger('click')
    expect(focus).toHaveBeenLastCalledWith(undefined)
    wrapper.unmount()
  })

  it('hour arrows walk the whole clock, across noon and midnight; Home and End stay in the half', async () => {
    const wrapper = render('11:00')
    await wrapper.get('.base-time-picker__trigger').trigger('keydown', { key: 'ArrowDown' })
    const input = wrapper.get<HTMLInputElement>(HOUR)
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.element.value).toBe('12')
    expect(radio(wrapper, 'p. m.').attributes('aria-checked')).toBe('true')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.element.value).toBe('10')
    expect(radio(wrapper, 'a. m.').attributes('aria-checked')).toBe('true')
    await input.trigger('keydown', { key: 'Home' })
    expect(input.element.value).toBe('1')
    await input.trigger('keydown', { key: 'End' })
    expect(input.element.value).toBe('12')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.element.value).toBe('11')
    expect(radio(wrapper, 'p. m.').attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('a. m. / p. m. is one tab stop that switches with the arrows', async () => {
    const wrapper = render('09:00')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(radio(wrapper, 'a. m.').attributes('tabindex')).toBe('0')
    expect(radio(wrapper, 'p. m.').attributes('tabindex')).toBe('-1')
    await radio(wrapper, 'a. m.').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.vm.$nextTick()
    expect(radio(wrapper, 'p. m.').attributes('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio(wrapper, 'p. m.').element)
    await radio(wrapper, 'p. m.').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['21:00']])
    wrapper.unmount()
  })

  it('traps Tab and closes on outside click', async () => {
    const wrapper = render()
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    const last = wrapper.get('.base-time-picker__apply')
    ;(last.element as HTMLElement).focus()
    await last.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(wrapper.get('.base-time-picker__close').element)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('adjusts exact minutes with the keyboard and applies with Enter', async () => {
    const wrapper = render('09:37')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    const minute = wrapper.get<HTMLInputElement>(MINUTE)
    await minute.trigger('keydown', { key: 'ArrowUp' })
    expect(minute.element.value).toBe('38')
    await minute.trigger('keydown', { key: 'ArrowDown' })
    expect(minute.element.value).toBe('37')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await minute.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['09:37']])
    wrapper.unmount()
  })

  it('cannot open while disabled and closes when saving disables the field', async () => {
    const wrapper = render('', true)
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.setProps({ disabled: false })
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    await wrapper.setProps({ disabled: true })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('has accessible names and no detectable axe violations', async () => {
    const wrapper = render('22:07')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    const options = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }
    expect(await axe(wrapper.element as HTMLElement, options)).toHaveNoViolations()
    expect(wrapper.get(MINUTE).attributes('aria-valuenow')).toBe('7')
    expect(wrapper.get(HOUR).attributes('aria-valuenow')).toBe('10')
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe(
      'Mañana o tarde de hora de inicio',
    )
    wrapper.unmount()
  })

  it('optional: labels it «(opcional)» and lets a chosen time be removed (#507)', async () => {
    const wrapper = mount(BaseTimePicker, {
      attachTo: document.body,
      props: { modelValue: '09:30', label: 'Hora de fin', optional: true },
      global: { stubs: { teleport: true } },
    })
    expect(wrapper.get('label').text()).toContain('(opcional)')
    expect(wrapper.get('label').text()).not.toContain('obligatoria')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    const remove = wrapper
      .findAll('.base-time-picker__footer button')
      .find((b) => b.text() === 'Quitar hora')
    expect(remove).toBeTruthy()
    await remove!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    wrapper.unmount()
  })

  it('without optional there is no way to remove the time', async () => {
    const wrapper = render('09:30')
    await wrapper.get('.base-time-picker__trigger').trigger('click')
    expect(wrapper.text()).not.toContain('Quitar hora')
    wrapper.unmount()
  })
})
