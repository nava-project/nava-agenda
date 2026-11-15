/**
 * Pruebas de BarberWindowPanel (DEC-169): elegir un barbero, ver si hereda o
 * tiene ventana propia, guardarla, volver a heredar, validación local, Enter
 * sin enviar el formulario de la página y errores conservando lo escrito.
 * El cliente HTTP se sustituye por un doble.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { resetToasts, toastState } from '@/shared/model/toastStore'

const fetchMock = vi.hoisted(() => vi.fn())
const saveMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/barberBookingPolicyApi', () => ({
  fetchBarberWindows: fetchMock,
  saveBarberWindow: saveMock,
  removeBarberWindow: removeMock,
}))

const { default: BarberWindowPanel } = await import('../BarberWindowPanel.vue')

const ANA = 'a0000000-0000-4000-8000-000000000001'
const LEO = 'a0000000-0000-4000-8000-000000000002'
const shopWindow = { minAdvanceMinutes: 60, maxAdvanceDays: 3, slotGridMinutes: 15 }

function loaded(windows: unknown[] = []) {
  return {
    kind: 'success',
    barbers: [
      { id: ANA, fullName: 'Ana Ruiz', photoUrl: null },
      { id: LEO, fullName: 'Leo Mora', photoUrl: null },
    ],
    windows,
  }
}

async function mountPanel(windows: unknown[] = []) {
  fetchMock.mockResolvedValueOnce(loaded(windows))
  const wrapper = mount(BarberWindowPanel, { props: { shopWindow }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const ownSwitch = (w: VueWrapper) => w.get('button[role="switch"]')
const input = (w: VueWrapper, name: string) =>
  w.get(`input[name="${name}"]`).element as HTMLInputElement

async function chooseBarber(w: VueWrapper, fullName: string) {
  await w.get('#barber-window-select').trigger('click')
  const option = w
    .findAll('[role="option"]')
    .find((c) => c.get('.barber-select__option-name').text() === fullName)
  await option!.trigger('click')
}

const axeOptions = { rules: { 'color-contrast': { enabled: false } } }

describe('BarberWindowPanel', () => {
  beforeEach(() => {
    resetToasts()
    fetchMock.mockReset()
    saveMock.mockReset()
    removeMock.mockReset()
    document.body.innerHTML = ''
  })

  it('shows the first barber inheriting the shop window, with its sample slots', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Usa la ventana de')
    expect(ownSwitch(wrapper).attributes('aria-checked')).toBe('false')
    expect(wrapper.find('input[name="barberSlotGridMinutes"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Cada 15 min')
    expect(wrapper.findAll('.barber-window__slot').map((s) => s.text())).toEqual([
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ])
    expect(wrapper.text()).toMatch(/0\s*de 2 con ventana propia/)
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })

  it('saves an own window for the chosen barber and lists it as customised', async () => {
    const wrapper = await mountPanel()
    await chooseBarber(wrapper, 'Leo Mora')
    await ownSwitch(wrapper).trigger('click')

    // Parte de los valores de la barbería.
    expect(input(wrapper, 'barberSlotGridMinutes').value).toBe('15')
    await wrapper.get('input[name="barberSlotGridMinutes"]').setValue('40')
    await wrapper.get('input[name="barberMinAdvanceMinutes"]').setValue('30')
    expect(wrapper.findAll('.barber-window__slot')[1]!.text()).toBe('10:40')

    saveMock.mockResolvedValueOnce({
      kind: 'success',
      window: { barberId: LEO, minAdvanceMinutes: 30, maxAdvanceDays: 3, slotGridMinutes: 40 },
    })
    await wrapper.get('button.base-button--primary').trigger('click')
    await flushPromises()

    expect(saveMock).toHaveBeenCalledWith(LEO, {
      minAdvanceMinutes: 30,
      maxAdvanceDays: 3,
      slotGridMinutes: 40,
    })
    expect(wrapper.text()).toContain('Tiene ventana propia')
    expect(wrapper.text()).toMatch(/1\s*de 2 con ventana propia/)
    expect(wrapper.get('.barber-window__roster').text()).toContain('Leo Mora')
    expect(wrapper.get('.barber-window__roster').text()).toContain('cada 40 min')
    // Guardado: ya no hay nada pendiente.
    expect(wrapper.find('.barber-window__actions').exists()).toBe(false)
    expect(toastState.items.at(-1)?.title).toBe('Ventana de Leo Mora guardada')
  })

  it('returns a barber with an own window to the shop window', async () => {
    const wrapper = await mountPanel([
      { barberId: ANA, minAdvanceMinutes: 30, maxAdvanceDays: 7, slotGridMinutes: 40 },
    ])
    expect(ownSwitch(wrapper).attributes('aria-checked')).toBe('true')
    expect(input(wrapper, 'barberSlotGridMinutes').value).toBe('40')

    await ownSwitch(wrapper).trigger('click')
    const confirm = wrapper.get('button.base-button--primary')
    expect(confirm.text()).toContain('Usar la de')

    removeMock.mockResolvedValueOnce({ kind: 'success' })
    await confirm.trigger('click')
    await flushPromises()

    expect(removeMock).toHaveBeenCalledWith(ANA)
    expect(wrapper.text()).toContain('Usa la ventana de')
    expect(wrapper.find('.barber-window__roster').exists()).toBe(false)
  })

  it('validates locally and never calls the API with an out-of-range grid', async () => {
    const wrapper = await mountPanel()
    await ownSwitch(wrapper).trigger('click')
    await wrapper.get('input[name="barberSlotGridMinutes"]').setValue('0')
    await wrapper.get('button.base-button--primary').trigger('click')
    await flushPromises()

    expect(saveMock).not.toHaveBeenCalled()
    expect(wrapper.find('.base-input__error').exists()).toBe(true)
  })

  it('Enter inside a field saves only the barber window, not the surrounding form', async () => {
    const submit = vi.fn((e: Event) => e.preventDefault())
    const host = document.createElement('form')
    host.addEventListener('submit', submit)
    document.body.appendChild(host)
    fetchMock.mockResolvedValueOnce(loaded())
    const wrapper = mount(BarberWindowPanel, { props: { shopWindow }, attachTo: host })
    await flushPromises()

    await ownSwitch(wrapper).trigger('click')
    await wrapper.get('input[name="barberSlotGridMinutes"]').setValue('20')
    saveMock.mockResolvedValueOnce({
      kind: 'success',
      window: { barberId: ANA, minAdvanceMinutes: 60, maxAdvanceDays: 3, slotGridMinutes: 20 },
    })
    await wrapper.get('input[name="barberSlotGridMinutes"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(saveMock).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps what was typed when saving fails', async () => {
    const wrapper = await mountPanel()
    await ownSwitch(wrapper).trigger('click')
    await wrapper.get('input[name="barberSlotGridMinutes"]').setValue('25')
    saveMock.mockResolvedValueOnce({ kind: 'network-error' })
    await wrapper.get('button.base-button--primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(input(wrapper, 'barberSlotGridMinutes').value).toBe('25')
  })

  it('shows a retryable error when the barbers cannot be loaded', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mount(BarberWindowPanel, { props: { shopWindow } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar')

    fetchMock.mockResolvedValueOnce(loaded())
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('#barber-window-select').exists()).toBe(true)
  })

  it('explains there is nothing to configure without barbers', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'success', barbers: [], windows: [] })
    const wrapper = mount(BarberWindowPanel, { props: { shopWindow } })
    await flushPromises()
    expect(wrapper.text()).toContain('Aún no tienes')
    expect(wrapper.find('button[role="switch"]').exists()).toBe(false)
  })
})
