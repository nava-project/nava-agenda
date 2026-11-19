/**
 * Pruebas de ProfessionalWindowPanel (DEC-169): elegir un profesional, ver si hereda o
 * tiene ventana propia, guardarla, volver a heredar, validación local, Enter
 * sin enviar el formulario de la página y errores conservando lo escrito.
 * El cliente HTTP se sustituye por un doble.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { resetToasts, toastState } from '@/shared/model/toastStore'

const fetchMock = vi.hoisted(() => vi.fn())
const saveMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/professionalBookingPolicyApi', () => ({
  fetchProfessionalWindows: fetchMock,
  saveProfessionalWindow: saveMock,
  removeProfessionalWindow: removeMock,
}))

const { default: ProfessionalWindowPanel } = await import('../ProfessionalWindowPanel.vue')

const ANA = 'a0000000-0000-4000-8000-000000000001'
const LEO = 'a0000000-0000-4000-8000-000000000002'
const shopWindow = { minAdvanceMinutes: 60, maxAdvanceDays: 3, slotGridMinutes: 15 }

// La muestra de «Día y hora» se pinta desde «ahora»: un reloj fijo a las 8:00
// (hora local) la vuelve determinista. Solo se finge `Date`; las promesas y los
// temporizadores siguen siendo reales.
function at8am() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 19, 8, 0))
}
afterEach(() => {
  vi.useRealTimers()
})

/** La primera fila del selector de muestra: la hora y sus minutos. */
function firstSampleRow(wrapper: VueWrapper) {
  const row = wrapper.get('.professional-window .bk-hrow')
  return {
    hour: `${row.get('.bk-hrow__number').text()} ${row.get('.bk-hrow__meridiem').text()}`.replace(
      /\s+/g,
      ' ',
    ),
    minutes: row.findAll('.bk-min').map((m) => m.text()),
  }
}

function loaded(windows: unknown[] = []) {
  return {
    kind: 'success',
    professionals: [
      { id: ANA, fullName: 'Ana Ruiz', photoUrl: null },
      { id: LEO, fullName: 'Leo Mora', photoUrl: null },
    ],
    windows,
  }
}

async function mountPanel(windows: unknown[] = []) {
  fetchMock.mockResolvedValueOnce(loaded(windows))
  const wrapper = mount(ProfessionalWindowPanel, { props: { shopWindow }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const ownSwitch = (w: VueWrapper) => w.get('button[role="switch"]')
const input = (w: VueWrapper, name: string) =>
  w.get(`input[name="${name}"]`).element as HTMLInputElement

async function chooseProfessional(w: VueWrapper, fullName: string) {
  await w.get('#professional-window-select').trigger('click')
  const option = w
    .findAll('[role="option"]')
    .find((c) => c.get('.professional-select__option-name').text() === fullName)
  await option!.trigger('click')
}

const axeOptions = { rules: { 'color-contrast': { enabled: false } } }

describe('ProfessionalWindowPanel', () => {
  beforeEach(() => {
    resetToasts()
    fetchMock.mockReset()
    saveMock.mockReset()
    removeMock.mockReset()
    document.body.innerHTML = ''
  })

  it('shows only their own professional to an employee, without picker or team count (DEC-173)', async () => {
    fetchMock.mockResolvedValueOnce({
      kind: 'success',
      professionals: [{ id: ANA, fullName: 'Ana Ruiz', photoUrl: null }],
      windows: [],
    })
    const wrapper = mount(ProfessionalWindowPanel, {
      props: { shopWindow, ownOnly: true },
      attachTo: document.body,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Tu ventana de reserva')
    expect(wrapper.find('#professional-window-select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('con ventana propia')
    expect(wrapper.text()).toContain('Ventana propia para Ana Ruiz')
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })

  it('asks the business to link an employee with no professional', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'success', professionals: [], windows: [] })
    const wrapper = mount(ProfessionalWindowPanel, {
      props: { shopWindow, ownOnly: true },
      attachTo: document.body,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Pídele al negocio que vincule tu usuario')
  })

  it('shows the first professional inheriting the shop window, with its sample slots', async () => {
    at8am()
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Usa la ventana de')
    expect(ownSwitch(wrapper).attributes('aria-checked')).toBe('false')
    expect(wrapper.find('input[name="professionalSlotGridMinutes"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Cada 15 min')
    // El mismo «Día y hora» que ve el cliente, en 12 h y con la ventana heredada:
    // a las 8:00 con 1 h de anticipación, la primera hora libre es las 9:00 a. m.
    expect(firstSampleRow(wrapper)).toEqual({
      hour: '9 a. m.',
      minutes: [':00', ':15', ':30', ':45'],
    })
    expect(wrapper.get('.professional-window__sample-text').text()).toMatch(
      /^Primer horario libre: hoy, 9:00\sa\.\sm\./,
    )
    expect(wrapper.text()).toMatch(/0\s*de 2 con ventana propia/)
    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })

  it('saves an own window for the chosen professional and lists it as customised', async () => {
    at8am()
    const wrapper = await mountPanel()
    await chooseProfessional(wrapper, 'Leo Mora')
    await ownSwitch(wrapper).trigger('click')

    // Parte de los valores del negocio.
    expect(input(wrapper, 'professionalSlotGridMinutes').value).toBe('15')
    // Sin campo de días: la ventana propia dura hasta apagarla (DEC-172).
    expect(wrapper.find('input[name="professionalMaxAdvanceDays"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Sin límite de días')
    await wrapper.get('input[name="professionalSlotGridMinutes"]').setValue('40')
    await wrapper.get('input[name="professionalMinAdvanceMinutes"]').setValue('30')
    // Rejilla de 40 min desde las 9:00: 9:00 y 9:40 en la primera fila.
    expect(firstSampleRow(wrapper).minutes).toEqual([':00', ':40'])

    saveMock.mockResolvedValueOnce({
      kind: 'success',
      window: {
        professionalId: LEO,
        minAdvanceMinutes: 30,
        maxAdvanceDays: 90,
        slotGridMinutes: 40,
      },
    })
    await wrapper.get('button.base-button--primary').trigger('click')
    await flushPromises()

    // DEC-172: la ventana propia no pide días; viaja con el techo del sistema.
    expect(saveMock).toHaveBeenCalledWith(LEO, {
      minAdvanceMinutes: 30,
      maxAdvanceDays: 90,
      slotGridMinutes: 40,
    })
    expect(wrapper.text()).toContain('Tiene ventana propia')
    expect(wrapper.text()).toMatch(/1\s*de 2 con ventana propia/)
    expect(wrapper.get('.professional-window__roster').text()).toContain('Leo Mora')
    expect(wrapper.get('.professional-window__roster').text()).toContain('cada 40 min')
    // Guardado: ya no hay nada pendiente.
    expect(wrapper.find('.professional-window__actions').exists()).toBe(false)
    expect(toastState.items.at(-1)?.title).toBe('Ventana de Leo Mora guardada')
  })

  it('returns a professional with an own window to the shop window', async () => {
    const wrapper = await mountPanel([
      { professionalId: ANA, minAdvanceMinutes: 30, maxAdvanceDays: 7, slotGridMinutes: 40 },
    ])
    expect(ownSwitch(wrapper).attributes('aria-checked')).toBe('true')
    expect(input(wrapper, 'professionalSlotGridMinutes').value).toBe('40')

    await ownSwitch(wrapper).trigger('click')
    const confirm = wrapper.get('button.base-button--primary')
    expect(confirm.text()).toContain('Usar la de')

    removeMock.mockResolvedValueOnce({ kind: 'success' })
    await confirm.trigger('click')
    await flushPromises()

    expect(removeMock).toHaveBeenCalledWith(ANA)
    expect(wrapper.text()).toContain('Usa la ventana de')
    expect(wrapper.find('.professional-window__roster').exists()).toBe(false)
  })

  it('validates locally and never calls the API with an out-of-range grid', async () => {
    const wrapper = await mountPanel()
    await ownSwitch(wrapper).trigger('click')
    await wrapper.get('input[name="professionalSlotGridMinutes"]').setValue('0')
    await wrapper.get('button.base-button--primary').trigger('click')
    await flushPromises()

    expect(saveMock).not.toHaveBeenCalled()
    expect(wrapper.find('.base-input__error').exists()).toBe(true)
  })

  it('Enter inside a field saves only the professional window, not the surrounding form', async () => {
    const submit = vi.fn((e: Event) => e.preventDefault())
    const host = document.createElement('form')
    host.addEventListener('submit', submit)
    document.body.appendChild(host)
    fetchMock.mockResolvedValueOnce(loaded())
    const wrapper = mount(ProfessionalWindowPanel, { props: { shopWindow }, attachTo: host })
    await flushPromises()

    await ownSwitch(wrapper).trigger('click')
    await wrapper.get('input[name="professionalSlotGridMinutes"]').setValue('20')
    saveMock.mockResolvedValueOnce({
      kind: 'success',
      window: {
        professionalId: ANA,
        minAdvanceMinutes: 60,
        maxAdvanceDays: 3,
        slotGridMinutes: 20,
      },
    })
    await wrapper
      .get('input[name="professionalSlotGridMinutes"]')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(saveMock).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps what was typed when saving fails', async () => {
    const wrapper = await mountPanel()
    await ownSwitch(wrapper).trigger('click')
    await wrapper.get('input[name="professionalSlotGridMinutes"]').setValue('25')
    saveMock.mockResolvedValueOnce({ kind: 'network-error' })
    await wrapper.get('button.base-button--primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(input(wrapper, 'professionalSlotGridMinutes').value).toBe('25')
  })

  it('shows a retryable error when the professionals cannot be loaded', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mount(ProfessionalWindowPanel, { props: { shopWindow } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar')

    fetchMock.mockResolvedValueOnce(loaded())
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('#professional-window-select').exists()).toBe(true)
  })

  it('explains there is nothing to configure without professionals', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'success', professionals: [], windows: [] })
    const wrapper = mount(ProfessionalWindowPanel, { props: { shopWindow } })
    await flushPromises()
    expect(wrapper.text()).toContain('Aún no tienes')
    expect(wrapper.find('button[role="switch"]').exists()).toBe(false)
  })
})
