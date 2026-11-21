/**
 * OpeningHoursPanel (HU-107, DEC-182): el horario de atención del local.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'

const fetchMock = vi.hoisted(() => vi.fn())
const saveMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/openingHoursApi', () => ({
  fetchOpeningHours: fetchMock,
  saveOpeningHours: saveMock,
}))

const { default: OpeningHoursPanel } = await import('../OpeningHoursPanel.vue')

const WEEK = {
  openingHours: [
    { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:00' },
    { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
    { dayOfWeek: 'FRIDAY', opens: '20:00', closes: '24:00' },
  ],
  closedOnHolidays: false,
}

function mountPanel() {
  return mount(OpeningHoursPanel, { attachTo: document.body })
}

const day = (w: ReturnType<typeof mountPanel>, index: number) => w.findAll('.opening__day')[index]
const saveButton = (w: ReturnType<typeof mountPanel>) =>
  w.findAll('button').find((b) => b.text().includes('Guardar horario'))!

describe('OpeningHoursPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    saveMock.mockReset()
    fetchMock.mockResolvedValue({ kind: 'success', settings: WEEK })
    document.body.innerHTML = ''
  })

  it('pinta los siete días: el lunes con dos horarios, el viernes hasta medianoche y el resto cerrado', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    const names = wrapper.findAll('.opening__day-name').map((n) => n.text())
    expect(names).toEqual([
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ])
    expect(day(wrapper, 0).findAll('.opening__interval')).toHaveLength(2)
    expect(day(wrapper, 1).classes()).toContain('opening__day--closed')
    expect(day(wrapper, 1).text()).toContain('Cerrado')
    // 24:00 se edita como 00:00 y se lee «12:00 a. m.» (el selector llega hasta 11:59 p. m.).
    expect(day(wrapper, 4).findAll('.base-time-picker')[1].text()).toContain('12:00 a. m.')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  it('los días cerrados llevan puntos guía decorativos y los abiertos no (#759)', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    const leaders = wrapper.findAll('.opening__day').map((d) => d.find('.opening__closed-leader'))
    expect(leaders.map((l) => l.exists())).toEqual([false, true, true, true, false, true, true])
    expect(leaders[1]!.attributes('aria-hidden')).toBe('true')
  })

  it('abrir un día le pone un horario y guarda la semana completa, con 00:00 como 24:00', async () => {
    saveMock.mockImplementation(async (settings) => ({ kind: 'success', settings }))
    const wrapper = mountPanel()
    await flushPromises()

    await day(wrapper, 5).get('input[type="checkbox"]').setValue(true)
    expect(day(wrapper, 5).findAll('.opening__interval')).toHaveLength(1)
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(saveMock).toHaveBeenCalledWith({
      openingHours: [
        { dayOfWeek: 'MONDAY', opens: '09:00', closes: '12:00' },
        { dayOfWeek: 'MONDAY', opens: '14:00', closes: '19:00' },
        { dayOfWeek: 'FRIDAY', opens: '20:00', closes: '24:00' },
        { dayOfWeek: 'SATURDAY', opens: '09:00', closes: '19:00' },
      ],
      closedOnHolidays: false,
    })
    expect(wrapper.get('.opening__feedback').text()).toContain('Tus clientes ya ven este horario')
    // El aviso de guardado lleva el rombo que se posa (#759); vuelve a reposo al editar.
    expect(wrapper.get('.opening__feedback').classes()).toContain('opening__feedback--saved')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await day(wrapper, 6).get('input[type="checkbox"]').setValue(true)
    expect(wrapper.get('.opening__feedback').classes()).not.toContain('opening__feedback--saved')
  })

  it('mientras guarda, «Guardando…» se ve solo en el botón y el lector lo oye en el estado (#759)', async () => {
    let finish: (value: unknown) => void = () => {}
    saveMock.mockImplementation(
      (settings) =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'success', settings })
        }),
    )
    const wrapper = mountPanel()
    await flushPromises()

    await day(wrapper, 5).get('input[type="checkbox"]').setValue(true)
    await saveButton(wrapper).trigger('click')

    const status = wrapper.get('.opening__feedback')
    expect(status.attributes('role')).toBe('status')
    expect(status.get('.visually-hidden').text()).toBe('Guardando…')
    expect(saveButton(wrapper).text()).toContain('Guardando…')
    finish(undefined)
    await flushPromises()
    expect(status.find('.visually-hidden').exists()).toBe(false)
    expect(status.text()).toContain('Tus clientes ya ven este horario')
  })

  it('no envía un día con horarios que se cruzan y lo señala junto al día', async () => {
    fetchMock.mockResolvedValue({
      kind: 'success',
      settings: {
        openingHours: [
          { dayOfWeek: 'TUESDAY', opens: '09:00', closes: '13:00' },
          { dayOfWeek: 'TUESDAY', opens: '12:00', closes: '18:00' },
        ],
        closedOnHolidays: false,
      },
    })
    const wrapper = mountPanel()
    await flushPromises()
    // Cualquier cambio habilita el botón; el cruce ya venía de antes.
    await wrapper.get('[role="switch"]').trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(saveMock).not.toHaveBeenCalled()
    expect(day(wrapper, 1).get('[role="alert"]').text()).toBe(
      'Dos horarios del mismo día se cruzan.',
    )
    expect(wrapper.get('.opening__feedback').text()).toContain('Revisa los días marcados')
  })

  it('quitar el único horario de un día lo deja cerrado; copiar el lunes llena de martes a viernes', async () => {
    saveMock.mockImplementation(async (settings) => ({ kind: 'success', settings }))
    const wrapper = mountPanel()
    await flushPromises()

    await day(wrapper, 4).get('.opening__remove').trigger('click')
    expect(day(wrapper, 4).classes()).toContain('opening__day--closed')

    const copy = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Copiar el horario del lunes'))!
    await copy.trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    const sent = saveMock.mock.calls[0][0].openingHours as { dayOfWeek: string }[]
    for (const d of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']) {
      expect(sent.filter((s) => s.dayOfWeek === d)).toHaveLength(2)
    }
    expect(sent.some((s) => s.dayOfWeek === 'SATURDAY')).toBe(false)
  })

  it('el interruptor de festivos viaja en el guardado', async () => {
    saveMock.mockImplementation(async (settings) => ({ kind: 'success', settings }))
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('[role="switch"]').trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(saveMock.mock.calls[0][0].closedOnHolidays).toBe(true)
  })

  it('si el guardado falla, conserva lo escrito y lo dice', async () => {
    saveMock.mockResolvedValue({ kind: 'network-error' })
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('[role="switch"]').trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.get('.opening__feedback').text()).toContain('tu horario no se guardó')
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('si no carga, ofrece reintentar', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos conectar')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.opening__day')).toHaveLength(7)
  })
})
