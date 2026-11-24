/**
 * Pruebas de ManualStartPicker (#717, DEC-190): lectura de los 14 días, elección
 * sobre la rejilla, día sin hueco, «Otra hora», error, relectura tras un 409,
 * teclado y accesibilidad. appointmentsApi se sustituye por un doble.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { ref } from 'vue'

const fetchManualAvailabilityMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/composables/useLoaderGrace', async (original) =>
  (await import('@/shared/composables/__tests__/instantLoaderGrace')).instantLoaderGrace(
    await original(),
  ),
)
vi.mock('../../api/appointmentsApi', () => ({
  fetchManualAvailability: fetchManualAvailabilityMock,
}))

const { default: ManualStartPicker } = await import('../ManualStartPicker.vue')
const { getCivilDateInTimezone, shiftCivilDate, formatCivilDateFull } =
  await import('@/shared/time/civilDate')

const ZONE = 'America/Bogota'
const today = getCivilDateInTimezone(ZONE)
const tomorrow = shiftCivilDate(today, 1)
const dayAfter = shiftCivilDate(today, 2)
// Bogotá es UTC−5 todo el año: las 9:00 son las 14:00 UTC.
const at = (civilDate: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${civilDate}T${String(h! + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
}

function availability(starts: string[], slotGridMinutes = 30) {
  return {
    kind: 'success',
    availability: { starts, timezone: ZONE, durationMinutes: 30, slotGridMinutes },
  }
}

function mountPicker(props: Record<string, unknown> = {}) {
  const date = ref('')
  const time = ref('')
  const wrapper = mount(ManualStartPicker, {
    attachTo: document.body,
    props: {
      professionalId: 'p-1',
      serviceId: 's-1',
      timezone: ZONE,
      date: date.value,
      time: time.value,
      'onUpdate:date': (v: string) => {
        date.value = v
        void wrapper.setProps({ date: v })
      },
      'onUpdate:time': (v: string) => {
        time.value = v
        void wrapper.setProps({ time: v })
      },
      ...props,
    },
  })
  return { wrapper, date, time }
}

const minute = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('.bk-min').find((b) => b.text() === label)!

describe('ManualStartPicker', () => {
  beforeEach(() => {
    fetchManualAvailabilityMock.mockReset()
  })

  it('reads 14 days from today and shows every day, with or without gaps', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(
      availability([at(tomorrow, '09:00'), at(tomorrow, '09:30')]),
    )
    const { wrapper } = mountPicker()
    await flushPromises()

    expect(fetchManualAvailabilityMock).toHaveBeenCalledWith(
      'p-1',
      's-1',
      today,
      shiftCivilDate(today, 13),
      undefined,
    )
    expect(wrapper.findAll('.bk-day')).toHaveLength(14)
    // Abre en el primer día con hueco.
    expect(wrapper.get('.bk-day[aria-checked="true"]').attributes('aria-label')).toContain(
      '2 horarios libres',
    )
  })

  it('choosing a free start sets the civil date and the 24 h time', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(
      availability([at(today, '14:00'), at(today, '14:30')]),
    )
    const { wrapper, date, time } = mountPicker()
    await flushPromises()

    await minute(wrapper, ':30').trigger('click')
    await flushPromises()
    expect(date.value).toBe(today)
    expect(time.value).toBe('14:30')
    expect(minute(wrapper, ':30').attributes('aria-checked')).toBe('true')
  })

  it('uses the grid of the response for the minute columns (no fixed 15)', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(
      availability([at(today, '10:00'), at(today, '10:20'), at(today, '10:40')], 20),
    )
    const { wrapper } = mountPicker()
    await flushPromises()
    expect(wrapper.get('.bk-hrow__mins').attributes('style')).toContain('--bk-cols: 3')
  })

  it('a day without gaps says so and offers the next day with gaps and «Otra hora»', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(availability([at(dayAfter, '11:00')]))
    const { wrapper } = mountPicker()
    await flushPromises()

    // Hoy no tiene hueco: se pasa a él para ver su estado vacío.
    await wrapper.findAll('.bk-day')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(`Sin horas libres el ${formatCivilDateFull(today)}.`)
    const next = wrapper.findAll('button').find((b) => b.text().startsWith('Ver el'))!
    expect(next.text()).toBe(`Ver el ${formatCivilDateFull(dayAfter)}`)

    await next.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.bk-day')[2]!.attributes('aria-checked')).toBe('true')
    expect(wrapper.find('.bk-min').exists()).toBe(true)
  })

  it('«Otra hora» writes date and time by hand (12 h picker) and keeps the day', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(availability([at(tomorrow, '09:00')]))
    const { wrapper, date } = mountPicker()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Otra hora'))!
      .trigger('click')
    await flushPromises()
    expect(date.value).toBe(tomorrow)
    expect(wrapper.get('#new-appointment-date').text()).toContain(String(Number(tomorrow.slice(8))))
    expect(wrapper.text()).toContain('Hora del turno')
    expect(wrapper.find('.bk-days').exists()).toBe(false)

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Ver las horas libres')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('.bk-days').exists()).toBe(true)
  })

  it('waits with a skeleton of the real shape, then shows the picker', async () => {
    let resolve: (v: unknown) => void = () => {}
    fetchManualAvailabilityMock.mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = mountPicker()
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('Cargando las horas libres')
    expect(wrapper.findAll('.manual-start__skeleton-day')).toHaveLength(14)

    resolve(availability([at(today, '15:00')]))
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('.bk-min').exists()).toBe(true)
  })

  it('on a load error offers retry and «Otra hora»', async () => {
    fetchManualAvailabilityMock.mockResolvedValueOnce({ kind: 'network-error' })
    const { wrapper } = mountPicker()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('No pudimos cargar las horas libres')

    fetchManualAvailabilityMock.mockResolvedValueOnce(availability([at(today, '15:00')]))
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Reintentar')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('.bk-min').exists()).toBe(true)
  })

  describe('la espera sin destellos (#843)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps a skeleton that could be seen long enough to read, and skips it on a quick answer', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      let resolve: (v: unknown) => void = () => {}
      fetchManualAvailabilityMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
      const { wrapper } = mountPicker()
      await vi.advanceTimersByTimeAsync(350)
      resolve(availability([at(today, '15:00')]))
      await flushPromises()
      expect(wrapper.find('.manual-start__skeleton').exists()).toBe(true)
      await vi.advanceTimersByTimeAsync(440)
      expect(wrapper.find('.manual-start__skeleton').exists()).toBe(true)
      await vi.advanceTimersByTimeAsync(20)
      expect(wrapper.find('.manual-start__skeleton').exists()).toBe(false)
      expect(wrapper.find('.bk-min').exists()).toBe(true)
      wrapper.unmount()

      fetchManualAvailabilityMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
      const quick = mountPicker().wrapper
      await vi.advanceTimersByTimeAsync(120)
      resolve(availability([at(today, '15:00')]))
      await flushPromises()
      expect(quick.find('.manual-start__skeleton').exists()).toBe(false)
      expect(quick.find('.bk-min').exists()).toBe(true)
      quick.unmount()
    })

    it('counts the wait from when the skeleton appears, not from a mount inside a closed dialog', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      let resolve: (v: unknown) => void = () => {}
      fetchManualAvailabilityMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
      const { wrapper } = mountPicker()
      // Reprogramar lo monta con la página; el diálogo se abre mucho después.
      await vi.advanceTimersByTimeAsync(5000)
      const appear = new Event('animationstart')
      Object.defineProperty(appear, 'animationName', { value: 'manual-start-skeleton-in-1a2b' })
      wrapper.get('.manual-start__skeleton').element.dispatchEvent(appear)
      await vi.advanceTimersByTimeAsync(50)
      resolve(availability([at(today, '15:00')]))
      await flushPromises()
      expect(wrapper.find('.manual-start__skeleton').exists()).toBe(true)
      await vi.advanceTimersByTimeAsync(440)
      expect(wrapper.find('.manual-start__skeleton').exists()).toBe(true)
      await vi.advanceTimersByTimeAsync(20)
      expect(wrapper.find('.manual-start__skeleton').exists()).toBe(false)
      wrapper.unmount()
    })

    it('moves the focus to the picker before «Reintentar» disappears', async () => {
      fetchManualAvailabilityMock.mockResolvedValueOnce({ kind: 'network-error' })
      const { wrapper } = mountPicker()
      await flushPromises()
      fetchManualAvailabilityMock.mockReturnValueOnce(new Promise(() => {}))
      const retry = wrapper.findAll('button').find((b) => b.text() === 'Reintentar')!
      ;(retry.element as HTMLButtonElement).focus()
      await retry.trigger('click')
      expect(document.activeElement).toBe(wrapper.get('.manual-start').element)
      wrapper.unmount()
    })
  })

  it('without professional or service it only explains what to choose first', async () => {
    const { wrapper } = mountPicker({ serviceId: '' })
    await flushPromises()
    expect(fetchManualAvailabilityMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Elige el profesional y el servicio')
  })

  it('refreshDay after a 409 drops the taken start and keeps the rest', async () => {
    fetchManualAvailabilityMock.mockResolvedValueOnce(
      availability([at(today, '14:00'), at(today, '14:30')]),
    )
    const { wrapper, time } = mountPicker()
    await flushPromises()
    await minute(wrapper, ':30').trigger('click')
    await flushPromises()

    fetchManualAvailabilityMock.mockResolvedValueOnce(availability([at(today, '14:00')]))
    await (wrapper.vm as unknown as { refreshDay: (d: string) => Promise<void> }).refreshDay(today)
    await flushPromises()

    expect(fetchManualAvailabilityMock).toHaveBeenLastCalledWith(
      'p-1',
      's-1',
      today,
      today,
      undefined,
    )
    expect(time.value).toBe('')
    expect(wrapper.findAll('.bk-min').map((b) => b.text())).toEqual([':00'])
  })

  it('shows the field error under the day title, above the hours, describing them', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(availability([at(today, '14:00')]))
    const { wrapper } = mountPicker({ error: 'el profesional ya tiene una cita en ese intervalo' })
    await flushPromises()
    const error = wrapper.get('.manual-start__error')
    expect(error.text()).toBe('el profesional ya tiene una cita en ese intervalo')
    // Va entre el título del día y las horas, no al final de la rejilla.
    const order = [
      ...wrapper.element.querySelectorAll('.bk-day-title, .manual-start__error, .bk-hours'),
    ]
    expect(order.map((el) => el.className.split(' ')[0])).toEqual([
      'bk-day-title',
      'manual-start__error',
      'bk-hours',
    ])
    expect(
      wrapper.get('[role="radiogroup"][aria-label="Hora"]').attributes('aria-describedby'),
    ).toBe(error.attributes('id'))
  })

  it('keeps the focus when switching to «Otra hora» and back', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(
      availability([at(today, '14:00'), at(today, '14:30')]),
    )
    const { wrapper } = mountPicker()
    await flushPromises()

    const otherTime = () => wrapper.findAll('button').find((b) => b.text().startsWith('Otra hora'))!
    const backToGrid = () =>
      wrapper.findAll('button').find((b) => b.text() === 'Ver las horas libres')!

    // Sin hora elegida: entra al disparador de la fecha y vuelve al día activo.
    await otherTime().trigger('click')
    await flushPromises()
    expect(document.activeElement?.id).toBe('new-appointment-date')
    await backToGrid().trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('.bk-day[aria-checked="true"]').element)

    // Con hora elegida: vuelve a la hora.
    await minute(wrapper, ':30').trigger('click')
    await flushPromises()
    await otherTime().trigger('click')
    await flushPromises()
    await backToGrid().trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(minute(wrapper, ':30').element)
    wrapper.unmount()
  })

  it('moves between days with the arrow keys (roving tabindex)', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(availability([at(today, '14:00')]))
    const { wrapper } = mountPicker()
    await flushPromises()

    const days = () => wrapper.findAll('.bk-day')
    expect(days()[0]!.attributes('tabindex')).toBe('0')
    expect(days()[1]!.attributes('tabindex')).toBe('-1')
    await wrapper.get('.bk-days').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(days()[1]!.attributes('aria-checked')).toBe('true')
    await wrapper.get('.bk-days').trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(days()[13]!.attributes('aria-checked')).toBe('true')
    await wrapper.get('.bk-days').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(days()[0]!.attributes('aria-checked')).toBe('true')
  })

  it('has no axe violations', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(
      availability([at(today, '09:00'), at(today, '14:30'), at(today, '19:00')]),
    )
    const { wrapper } = mountPicker()
    await flushPromises()
    expect(
      await axe(wrapper.element.outerHTML, {
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })

  // --- Reprogramar (#776) ---------------------------------------------------

  it('when rescheduling, reads without the own appointment, also after a 409', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(availability([at(tomorrow, '09:00')]))
    const { wrapper } = mountPicker({ excludeAppointmentId: 'a-1' })
    await flushPromises()
    expect(fetchManualAvailabilityMock).toHaveBeenCalledWith(
      'p-1',
      's-1',
      today,
      shiftCivilDate(today, 13),
      'a-1',
    )
    await (wrapper.vm as unknown as { refreshDay: (d: string) => Promise<void> }).refreshDay(
      tomorrow,
    )
    expect(fetchManualAvailabilityMock).toHaveBeenLastCalledWith(
      'p-1',
      's-1',
      tomorrow,
      tomorrow,
      'a-1',
    )
  })

  it('shows the current start of the appointment marked, and it cannot be chosen', async () => {
    fetchManualAvailabilityMock.mockResolvedValue(
      availability([at(tomorrow, '09:00'), at(tomorrow, '09:30'), at(tomorrow, '10:00')]),
    )
    const { wrapper, time } = mountPicker({
      excludeAppointmentId: 'a-1',
      current: at(tomorrow, '09:30'),
      date: tomorrow,
    })
    await flushPromises()

    const current = minute(wrapper, ':30')
    expect(current.classes()).toContain('bk-min--current')
    await current.trigger('click')
    await flushPromises()
    expect(time.value).toBe('')
    expect(wrapper.find('.bk-min[aria-checked="true"]').exists()).toBe(false)

    await minute(wrapper, ':00').trigger('click')
    await flushPromises()
    expect(time.value).toBe('09:00')
  })

  it('on a 404 of the reading says what happened and offers «Otra hora», without switching silently', async () => {
    fetchManualAvailabilityMock.mockResolvedValue({ kind: 'not-found' })
    const { wrapper } = mountPicker({
      excludeAppointmentId: 'a-1',
      idPrefix: 'reschedule',
      dateLabel: 'Nueva fecha',
      timeLabel: 'Nueva hora',
    })
    await flushPromises()

    const notice = wrapper.get('.manual-start__empty[role="alert"]')
    expect(notice.text()).toContain('Este servicio ya no tiene horas libres aquí.')
    expect(notice.text()).toContain('dejó de estar asignado a este profesional')
    expect(wrapper.find('.bk-days').exists()).toBe(false)
    expect(wrapper.find('#reschedule-date').exists()).toBe(false)

    await notice
      .findAll('button')
      .find((b) => b.text() === 'Otra hora')!
      .trigger('click')
    await flushPromises()
    expect(document.activeElement?.id).toBe('reschedule-date')
    expect(wrapper.get('#reschedule-date-label').text()).toContain('Nueva fecha')
    expect(wrapper.text()).toContain('Nueva hora')
    wrapper.unmount()
  })
})
