/**
 * ReminderPanel (DEC-174): con cuántos minutos de anticipación sale el recordatorio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'

const fetchMock = vi.hoisted(() => vi.fn())
const saveMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/reminderSettingsApi', () => ({
  fetchReminderSettings: fetchMock,
  saveReminderLead: saveMock,
}))

const { default: ReminderPanel } = await import('../ReminderPanel.vue')

function mountPanel() {
  return mount(ReminderPanel, { attachTo: document.body })
}

const radios = (w: ReturnType<typeof mountPanel>) =>
  w.findAll<HTMLInputElement>('input[type="radio"]')

describe('ReminderPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    saveMock.mockReset()
    fetchMock.mockResolvedValue({ kind: 'success', leadMinutes: 30 })
    document.body.innerHTML = ''
  })

  it('muestra las seis opciones fijas, de 10 a 60, con la vigente marcada', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
    await flushPromises()

    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe(
      'Anticipación del recordatorio',
    )
    expect(radios(wrapper).map((r) => r.element.value)).toEqual([
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
    ])
    expect(radios(wrapper).map((r) => r.element.checked)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ])
    expect(wrapper.text()).toContain('30 minutos antes')
  })

  it('guarda al elegir, como número, y lo anuncia', async () => {
    saveMock.mockResolvedValue({ kind: 'success', leadMinutes: 10 })
    const wrapper = mountPanel()
    await flushPromises()

    await radios(wrapper)[0]!.setValue(true)
    await flushPromises()

    expect(saveMock).toHaveBeenCalledWith(10)
    expect(radios(wrapper)[0]!.element.checked).toBe(true)
    expect(wrapper.text()).toContain('10 minutos antes')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Guardado.')
  })

  it('si el guardado falla vuelve a la opción anterior y lo dice', async () => {
    saveMock.mockResolvedValue({ kind: 'network-error' })
    const wrapper = mountPanel()
    await flushPromises()

    await radios(wrapper)[5]!.setValue(true)
    await flushPromises()

    expect(radios(wrapper)[2]!.element.checked).toBe(true)
    expect(radios(wrapper)[5]!.element.checked).toBe(false)
    expect(wrapper.text()).toContain('se mantiene la opción anterior')
  })

  it('ofrece reintentar si no pudo cargar', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.text()).toContain('No pudimos conectar')

    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true)
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })
})
