/**
 * Pruebas de SchedulesPage (HU-040): carga (un profesional, cuatro profesionales),
 * vacío (sin profesionales), error recuperable, cambio de profesional, alta (éxito,
 * solape -CA-040-04-, validación, no encontrado, error de red), edición
 * (éxito, solape), retiro (éxito, no encontrado, error de red, sin doble
 * envío), agrupación por los siete días y accesibilidad. schedulesApi se
 * sustituye por un doble de prueba; el recorrido real contra el API vive en
 * el E2E de HU-040.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetToasts, toastState } from '@/shared/model/toastStore'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import BaseDatePicker from '@/shared/ui/BaseDatePicker.vue'
import BaseTimePicker from '@/shared/ui/BaseTimePicker.vue'

const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchBusinessTimezoneMock = vi.hoisted(() => vi.fn())
const fetchWorkingHoursMock = vi.hoisted(() => vi.fn())
const createWorkingHourMock = vi.hoisted(() => vi.fn())
const updateWorkingHourMock = vi.hoisted(() => vi.fn())
const deleteWorkingHourMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/schedulesApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchBusinessTimezone: fetchBusinessTimezoneMock,
  fetchWorkingHours: fetchWorkingHoursMock,
  createWorkingHour: createWorkingHourMock,
  updateWorkingHour: updateWorkingHourMock,
  deleteWorkingHour: deleteWorkingHourMock,
}))

// HU-041: mismo doble de prueba que schedulesApi, para que el calendario de
// festivos y las excepciones de jornada (siempre cargados junto al horario
// semanal del profesional elegido) no dependan de una llamada de red real
// durante estas pruebas de HU-040.
const fetchHolidayCalendarMock = vi.hoisted(() => vi.fn())
const updateHolidayCalendarMock = vi.hoisted(() => vi.fn())
const fetchScheduleExceptionsMock = vi.hoisted(() => vi.fn())
const createScheduleExceptionMock = vi.hoisted(() => vi.fn())
const updateScheduleExceptionMock = vi.hoisted(() => vi.fn())
const deleteScheduleExceptionMock = vi.hoisted(() => vi.fn())
const fetchColombianHolidaysMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/scheduleExceptionsApi', () => ({
  fetchHolidayCalendar: fetchHolidayCalendarMock,
  updateHolidayCalendar: updateHolidayCalendarMock,
  fetchScheduleExceptions: fetchScheduleExceptionsMock,
  createScheduleException: createScheduleExceptionMock,
  updateScheduleException: updateScheduleExceptionMock,
  deleteScheduleException: deleteScheduleExceptionMock,
  fetchColombianHolidays: fetchColombianHolidaysMock,
}))

const { default: SchedulesPage } = await import('../SchedulesPage.vue')

const oneProfessional = [{ id: 'b-1', fullName: 'Carlos Ramírez' }]
const fourProfessionals = [
  { id: 'b-1', fullName: 'Carlos Ramírez' },
  { id: 'b-2', fullName: 'Ana Torres' },
  { id: 'b-3', fullName: 'Luis Gómez' },
  { id: 'b-4', fullName: 'María Pérez' },
]

const mondayMorning = {
  id: 'wh-1',
  isoWeekday: 1,
  startsTime: '08:00',
  durationMinutes: 240,
  createdAt: '2026-08-25T15:04:05Z',
  updatedAt: '2026-08-25T15:04:05Z',
}

function mountPage() {
  return mount(SchedulesPage, { global: { stubs: { teleport: true } } })
}

async function mountReady(professionals = oneProfessional, items: (typeof mondayMorning)[] = []) {
  fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: professionals })
  fetchWorkingHoursMock.mockResolvedValueOnce({
    kind: 'success',
    page: { items, nextCursor: null },
  })
  const wrapper = mountPage()
  await flushPromises()
  return wrapper
}

// El selector de profesional es un listbox propio (BaseSelect): se abre con su
// disparador y las opciones solo existen mientras está abierto.
async function openProfessionalList(wrapper: VueWrapper) {
  await wrapper.get('#schedules-professional-select').trigger('click')
  await flushPromises()
  return wrapper.findAll('[role="option"]')
}

async function openCreateDialog(wrapper: VueWrapper) {
  await wrapper.get('button[aria-label="Agregar un tramo el Lunes"]').trigger('click')
  await flushPromises()
}

function createForm(wrapper: VueWrapper) {
  return wrapper.get('form[name="createWorkingHour"]')
}

function editForm(wrapper: VueWrapper) {
  return wrapper.get('form[name="updateWorkingHour"]')
}

// La hora y la fecha ya no son inputs nativos sino selectores propios: se les
// entrega el valor por su evento, igual que lo haría su panel al aplicar.
async function setTime(form: ReturnType<typeof createForm>, time: string, index = 0) {
  form.findAllComponents(BaseTimePicker)[index]!.vm.$emit('update:modelValue', time)
  await flushPromises()
}

async function setDate(form: ReturnType<typeof createForm>, date: string) {
  form.findComponent(BaseDatePicker).vm.$emit('update:modelValue', date)
  await flushPromises()
}

async function fillCreateForm(
  wrapper: VueWrapper,
  { startsTime = '08:00', endsTime = '09:00' } = {},
) {
  await createForm(wrapper).get('button[role="radio"][aria-label="Lunes"]').trigger('click')
  await setTime(createForm(wrapper), startsTime, 0)
  // El formulario se vuelve a leer: tras el primer cambio se re-renderiza.
  await setTime(createForm(wrapper), endsTime, 1)
}

const axeOptions = { rules: { 'color-contrast': { enabled: false } } }

describe('SchedulesPage', () => {
  beforeEach(() => {
    resetToasts()
    resetBrand()
    fetchProfessionalSummariesMock.mockReset()
    fetchWorkingHoursMock.mockReset()
    createWorkingHourMock.mockReset()
    updateWorkingHourMock.mockReset()
    deleteWorkingHourMock.mockReset()
    fetchBusinessTimezoneMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
    fetchHolidayCalendarMock.mockReset().mockResolvedValue({ kind: 'success', enabled: false })
    updateHolidayCalendarMock.mockReset()
    fetchScheduleExceptionsMock
      .mockReset()
      .mockResolvedValue({ kind: 'success', page: { items: [], nextCursor: null } })
    createScheduleExceptionMock.mockReset()
    updateScheduleExceptionMock.mockReset()
    deleteScheduleExceptionMock.mockReset()
    fetchColombianHolidaysMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
  })

  it('shows a non-blank loading state, then the loaded picker', async () => {
    let resolveProfessionals: (value: unknown) => void = () => {}
    fetchProfessionalSummariesMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveProfessionals = resolve)),
    )
    const wrapper = mountPage()

    expect(wrapper.text()).toContain('Cargando')

    fetchWorkingHoursMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: [], nextCursor: null },
    })
    resolveProfessionals({ kind: 'success', items: oneProfessional })
    await flushPromises()

    expect(wrapper.text()).toContain('Carlos Ramírez')
  })

  it('keeps the page skeleton over the first week until it arrives, then uncovers it (#817)', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    let resolveWeek: (value: unknown) => void = () => {}
    fetchWorkingHoursMock.mockReturnValueOnce(new Promise((resolve) => (resolveWeek = resolve)))
    const wrapper = mountPage()
    await flushPromises()

    // Profesionales ya cargados, semana en vuelo: el esqueleto sigue encima.
    expect(wrapper.find('.content-reveal__cover').exists()).toBe(true)

    resolveWeek({ kind: 'success', page: { items: [mondayMorning], nextCursor: null } })
    await flushPromises()

    expect(wrapper.find('.content-reveal__cover').exists()).toBe(false)
    expect(wrapper.text()).toContain('8:00 a. m.')
  })

  it('asks for the week and the side panel at once and uncovers only when all of it arrived (#817)', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    let resolveWeek: (value: unknown) => void = () => {}
    fetchWorkingHoursMock.mockReturnValueOnce(new Promise((resolve) => (resolveWeek = resolve)))
    let resolveExceptions: (value: unknown) => void = () => {}
    fetchScheduleExceptionsMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveExceptions = resolve)),
    )
    const wrapper = mountPage()
    await flushPromises()

    // Sin esperar a la semana: el lateral ya salió.
    expect(fetchScheduleExceptionsMock).toHaveBeenCalledWith('b-1')
    expect(fetchHolidayCalendarMock).toHaveBeenCalledWith('b-1')

    resolveWeek({ kind: 'success', page: { items: [mondayMorning], nextCursor: null } })
    await flushPromises()
    // La semana llegó, las excepciones no: el lateral aún crecería.
    expect(wrapper.find('.content-reveal__cover').exists()).toBe(true)

    resolveExceptions({ kind: 'success', page: { items: [], nextCursor: null } })
    await flushPromises()
    expect(wrapper.find('.content-reveal__cover').exists()).toBe(false)
  })

  it('uncovers the week error instead of hiding it under the skeleton (#817)', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchWorkingHoursMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.content-reveal__cover').exists()).toBe(false)
  })

  it('a professional with one tramo and one with a full team select use the same component', async () => {
    const oneWrapper = await mountReady(oneProfessional, [mondayMorning])
    expect((await openProfessionalList(oneWrapper)).length).toBe(1)
    expect(oneWrapper.text()).toContain('8:00 a. m.')

    const fourWrapper = await mountReady(fourProfessionals, [])
    expect((await openProfessionalList(fourWrapper)).length).toBe(4)
  })

  it('always shows all seven weekdays, with or without tramos (CA-040-01)', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
      expect(wrapper.text()).toContain(day)
    }
  })

  it('names the business timezone, never the device one (CA-040-06)', async () => {
    fetchBusinessTimezoneMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      timezone: 'America/Bogota',
    })
    const wrapper = await mountReady(oneProfessional, [])
    expect(wrapper.text()).toContain('Horas en hora de Colombia')
    expect(wrapper.text()).not.toContain('America/Bogota')
  })

  it('shows an empty state when there are no professionals, without an interactive picker', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Aún no tienes profesionales registrados')
    expect(wrapper.find('#schedules-professional-select').exists()).toBe(false)
  })

  it('shows a recoverable error with Reintentar when the initial load fails', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos cargar esta sección')

    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchWorkingHoursMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: [], nextCursor: null },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Carlos Ramírez')
  })

  it('switching professionals loads that professional schedule independently (cross-professional isolation)', async () => {
    const wrapper = await mountReady(fourProfessionals, [mondayMorning])
    expect(wrapper.text()).toContain('8:00 a. m.')

    fetchWorkingHoursMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: [{ ...mondayMorning, id: 'wh-2', startsTime: '10:00' }], nextCursor: null },
    })
    const options = await openProfessionalList(wrapper)
    await options[1]!.trigger('click')
    await flushPromises()

    expect(fetchWorkingHoursMock).toHaveBeenLastCalledWith('b-2')
    expect(wrapper.text()).toContain('10:00 a. m.')
    expect(wrapper.text()).not.toContain('8:00 a. m.')
  })

  describe('el velo al cambiar de profesional (#843, CA-22)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    // Cambia a Bruno con su horario pendiente; cada prueba decide cuándo llega.
    async function switchPending() {
      const wrapper = await mountReady(fourProfessionals, [mondayMorning])
      let resolve: (value: unknown) => void = () => {}
      fetchWorkingHoursMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
      const options = await openProfessionalList(wrapper)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      await options[1]!.trigger('click')
      await flushPromises()
      const arrive = () =>
        resolve({
          kind: 'success',
          page: {
            items: [{ ...mondayMorning, id: 'wh-2', startsTime: '10:00' }],
            nextCursor: null,
          },
        })
      return { wrapper, arrive }
    }
    const veil = (wrapper: VueWrapper) => wrapper.find('.schedules-page__veil').exists()
    const dimmed = (wrapper: VueWrapper) =>
      wrapper.find('.schedules-page__board-wrap--busy').exists()

    it('keeps the board inert at once but shows the veil and the dimming only after 300 ms', async () => {
      const { wrapper, arrive } = await switchPending()
      expect(wrapper.get('.schedules-page__board').attributes('inert')).toBeDefined()
      expect(veil(wrapper)).toBe(false)
      expect(dimmed(wrapper)).toBe(false)
      await vi.advanceTimersByTimeAsync(300)
      expect(veil(wrapper)).toBe(true)
      expect(dimmed(wrapper)).toBe(true)
      arrive()
      await flushPromises()
      wrapper.unmount()
    })

    it('a quick answer never shows the veil nor dims the board', async () => {
      const { wrapper, arrive } = await switchPending()
      await vi.advanceTimersByTimeAsync(150)
      arrive()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(500)
      expect(veil(wrapper)).toBe(false)
      expect(dimmed(wrapper)).toBe(false)
      expect(wrapper.text()).toContain('10:00 a. m.')
      wrapper.unmount()
    })

    it('holds a veil that appeared for its entrance plus the minimum visible time', async () => {
      const { wrapper, arrive } = await switchPending()
      await vi.advanceTimersByTimeAsync(350)
      arrive()
      await flushPromises()
      // Asomó a los 300 ms: se queda 180 + 300 ms, hasta los 780.
      await vi.advanceTimersByTimeAsync(420)
      expect(veil(wrapper)).toBe(true)
      expect(wrapper.get('.schedules-page__board').attributes('inert')).toBeDefined()
      await vi.advanceTimersByTimeAsync(20)
      expect(veil(wrapper)).toBe(false)
      expect(dimmed(wrapper)).toBe(false)
      expect(wrapper.get('.schedules-page__board').attributes('inert')).toBeUndefined()
      wrapper.unmount()
    })
  })

  it('creating a tramo succeeds and appends it to its day', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openCreateDialog(wrapper)
    await fillCreateForm(wrapper)

    createWorkingHourMock.mockResolvedValueOnce({ kind: 'success', workingHour: mondayMorning })
    await createForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createWorkingHourMock).toHaveBeenCalledWith('b-1', 1, '08:00', 60, expect.any(String))
    expect(wrapper.text()).toContain('8:00 a. m.')
    expect(toastState.items.map((item) => item.title)).toEqual(['Tramo agregado'])
  })

  it('an overlapping tramo (CA-040-04) shows a recoverable message without closing the dialog', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openCreateDialog(wrapper)
    await fillCreateForm(wrapper)

    createWorkingHourMock.mockResolvedValueOnce({ kind: 'overlap-conflict' })
    await createForm(wrapper).trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('se solapa con otro existente')
  })

  it('rejects an empty starts time on the client without calling the API', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openCreateDialog(wrapper)
    await createForm(wrapper).get('button[role="radio"][aria-label="Lunes"]').trigger('click')
    await setTime(createForm(wrapper), '09:00', 1)

    await createForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createWorkingHourMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Elige una hora válida.')
    expect(wrapper.text()).not.toContain('24 horas')
  })

  it('editing a tramo succeeds and updates its row in place', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    const editButtons = wrapper.findAll('button').filter((b) => b.text() === 'Editar')
    await editButtons[0]!.trigger('click')
    await flushPromises()

    // Mueve el tramo de 08:00–12:00 a 09:00–13:00: la duración (240) se deriva.
    await setTime(editForm(wrapper), '09:00', 0)
    await setTime(editForm(wrapper), '13:00', 1)

    updateWorkingHourMock.mockResolvedValueOnce({
      kind: 'success',
      workingHour: { ...mondayMorning, startsTime: '09:00' },
    })
    await editForm(wrapper).trigger('submit')
    await flushPromises()

    expect(updateWorkingHourMock).toHaveBeenCalledWith('b-1', 'wh-1', 1, '09:00', 240)
    expect(wrapper.text()).toContain('9:00 a. m.')
    expect(wrapper.text()).not.toContain('8:00 a. m.')
    expect(toastState.items.map((item) => item.title)).toEqual(['Tramo actualizado'])
  })

  // #782: sin cambios, «Guardar» espera en reposo (punteado de latón) y sigue
  // activo; al cambiar algo vuelve a ser la acción principal.
  it('rests the edit dialog save button until the tramo changes', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    const editButtons = wrapper.findAll('button').filter((b) => b.text() === 'Editar')
    await editButtons[0]!.trigger('click')
    await flushPromises()

    const save = () => editForm(wrapper).get('button[type="submit"]')
    expect(save().classes()).toContain('schedules-page__save--rest')
    expect(save().attributes('disabled')).toBeUndefined()

    await setTime(editForm(wrapper), '09:00', 0)
    expect(save().classes()).not.toContain('schedules-page__save--rest')

    await setTime(editForm(wrapper), '08:00', 0)
    expect(save().classes()).toContain('schedules-page__save--rest')
  })

  // Revisión de #783 (WCAG 2.4.7): el reposo quita la sombra del botón, y la sombra
  // es también el anillo de foco de BaseButton. jsdom no aplica :focus-visible,
  // así que se vigila la hoja: el reposo devuelve el anillo con el teclado.
  it('keeps the keyboard focus ring on «Guardar» while it rests', () => {
    const source = readFileSync(join(__dirname, '../SchedulesPage.vue'), 'utf8')
    const css = source.slice(source.indexOf('<style'))
    const focusRule =
      /\.schedules-page__save--rest[^{}]*:focus-visible[^{}]*\)?\s*\{([^{}]*)\}/.exec(css)
    expect(focusRule?.[1]).toMatch(/box-shadow:\s*var\(--btn-focus-ring\)/)
  })

  it('deleting a tramo removes it from the list on success', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    deleteWorkingHourMock.mockResolvedValueOnce({ kind: 'success' })

    const retireButton = wrapper.findAll('button').find((b) => b.text() === 'Retirar')!
    await retireButton.trigger('click')
    await flushPromises()

    expect(deleteWorkingHourMock).toHaveBeenCalledWith('b-1', 'wh-1')
    expect(wrapper.text()).not.toContain('8:00 a. m.')
    expect(toastState.items.map((item) => item.title)).toEqual(['Tramo retirado'])
  })

  it('a 404 while deleting treats the tramo as already gone, without an error message', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    deleteWorkingHourMock.mockResolvedValueOnce({ kind: 'not-found' })

    const retireButton = wrapper.findAll('button').find((b) => b.text() === 'Retirar')!
    await retireButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('8:00 a. m.')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('a network error while deleting keeps the row and shows a recoverable message', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    deleteWorkingHourMock.mockResolvedValueOnce({ kind: 'network-error' })

    const retireButton = wrapper.findAll('button').find((b) => b.text() === 'Retirar')!
    await retireButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(wrapper.text()).toContain('8:00 a. m.')
    // Con la fila visible el error sigue en línea (DEC-095).
    expect(toastState.items).toHaveLength(0)
  })

  it('disables the retire button while its own request is in flight (no double submit)', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    let resolveDelete: (value: unknown) => void = () => {}
    deleteWorkingHourMock.mockReturnValueOnce(new Promise((resolve) => (resolveDelete = resolve)))

    const retireButton = wrapper.findAll('button').find((b) => b.text() === 'Retirar')!
    await retireButton.trigger('click')
    await flushPromises()

    expect(
      wrapper
        .findAll('button')
        .find((b) => b.text() === 'Retirar')!
        .attributes('disabled'),
    ).toBeDefined()
    expect(deleteWorkingHourMock).toHaveBeenCalledTimes(1)

    resolveDelete({ kind: 'success' })
    await flushPromises()
  })

  it('has no axe violations in the ready view', async () => {
    const wrapper = await mountReady(fourProfessionals, [mondayMorning])
    const results = await axe(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })
})

// --- HU-041: calendario de festivos, excepciones de jornada ---------------

function holidayCalendarCheckbox(wrapper: VueWrapper): HTMLInputElement {
  return wrapper.get('input[type="checkbox"]').element as HTMLInputElement
}

async function openExceptionCreateDialog(wrapper: VueWrapper) {
  const button = wrapper.findAll('button').find((b) => b.text() === 'Agregar excepción')!
  await button.trigger('click')
  await flushPromises()
}

function exceptionCreateForm(wrapper: VueWrapper) {
  return wrapper.get('form[name="createScheduleException"]')
}

// «Abierto con tramos especiales»: muestra el primer tramo en blanco.
async function openOpenShape(wrapper: VueWrapper) {
  const radio = exceptionCreateForm(wrapper).findAll('input[name="createExceptionShape"]')[1]!
  ;(radio.element as HTMLInputElement).checked = true
  await radio.trigger('change')
  await flushPromises()
}

const closedException = {
  id: 'exc-1',
  effectiveDate: '2026-12-08',
  isClosed: true,
  reason: null,
  segments: [],
  createdAt: '2026-08-25T15:04:05Z',
  updatedAt: '2026-08-25T15:04:05Z',
}

describe('SchedulesPage · HU-041', () => {
  beforeEach(() => {
    fetchProfessionalSummariesMock.mockReset()
    fetchWorkingHoursMock.mockReset()
    fetchBusinessTimezoneMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
    fetchHolidayCalendarMock.mockReset().mockResolvedValue({ kind: 'success', enabled: false })
    updateHolidayCalendarMock.mockReset()
    fetchScheduleExceptionsMock
      .mockReset()
      .mockResolvedValue({ kind: 'success', page: { items: [], nextCursor: null } })
    createScheduleExceptionMock.mockReset()
    deleteScheduleExceptionMock.mockReset()
    fetchColombianHolidaysMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
  })

  it('reflects the current holiday calendar state (CA-041-01)', async () => {
    fetchHolidayCalendarMock.mockReset().mockResolvedValueOnce({ kind: 'success', enabled: true })
    const wrapper = await mountReady(oneProfessional, [])

    expect(holidayCalendarCheckbox(wrapper).checked).toBe(true)
  })

  it('toggling the holiday calendar persists the new value (CA-041-02)', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    updateHolidayCalendarMock.mockResolvedValueOnce({ kind: 'success', enabled: true })

    const checkbox = holidayCalendarCheckbox(wrapper)
    checkbox.checked = true
    await checkbox.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(updateHolidayCalendarMock).toHaveBeenCalledWith('b-1', true)
    expect(checkbox.checked).toBe(true)
    expect(toastState.items.map((item) => item.title)).toEqual(['Festivos activados'])
  })

  it('a failed toggle shows a recoverable message', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    updateHolidayCalendarMock.mockResolvedValueOnce({ kind: 'network-error' })

    const checkbox = holidayCalendarCheckbox(wrapper)
    checkbox.checked = true
    await checkbox.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(toastState.items).toHaveLength(0)
  })

  it('lists the exceptions of the selected professional (CA-041-04)', async () => {
    fetchScheduleExceptionsMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      page: { items: [closedException], nextCursor: null },
    })
    const wrapper = await mountReady(oneProfessional, [])

    // Revisión de #783: la fecha en palabras, nunca ISO, en el texto y en la acción.
    expect(wrapper.text()).toMatch(/martes 8 de diciembre/)
    expect(wrapper.text()).not.toContain('2026-12-08')
    const edit = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Editar' && /excepción/.test(b.attributes('aria-label') ?? ''))
    expect(edit?.attributes('aria-label')).toMatch(/^Editar excepción del martes 8 de diciembre/)
    expect(wrapper.text()).toContain('Cerrado')
  })

  it('creating a closed exception succeeds and appends it to the list', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openExceptionCreateDialog(wrapper)
    await setDate(exceptionCreateForm(wrapper), '2026-12-08')

    createScheduleExceptionMock.mockResolvedValueOnce({
      kind: 'success',
      exception: closedException,
    })
    await exceptionCreateForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createScheduleExceptionMock).toHaveBeenCalledWith(
      'b-1',
      '2026-12-08',
      true,
      null,
      [],
      expect.any(String),
    )
    expect(wrapper.text()).toContain('8 de diciembre')
    expect(toastState.items.map((item) => item.title)).toEqual(['Excepción agregada'])
  })

  it('captures an open exception segment as start and end time and sends the derived duration', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openExceptionCreateDialog(wrapper)
    let form = exceptionCreateForm(wrapper)
    await setDate(form, '2026-12-24')
    await openOpenShape(wrapper)
    form = exceptionCreateForm(wrapper)

    // No hay campo de minutos: solo «Hora de inicio» y «Hora de fin».
    expect(form.text()).not.toContain('Duración (minutos)')
    expect(form.text()).toContain('Hora de fin')

    // Los dos BaseTimePicker del formulario son el inicio y el fin del tramo.
    await setTime(form, '08:00', 0)
    // El formulario se vuelve a leer: tras el primer cambio se re-renderiza.
    await setTime(exceptionCreateForm(wrapper), '13:30', 1)
    createScheduleExceptionMock.mockResolvedValueOnce({
      kind: 'success',
      exception: { ...closedException, isClosed: false },
    })
    await exceptionCreateForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createScheduleExceptionMock).toHaveBeenCalledWith(
      'b-1',
      '2026-12-24',
      false,
      null,
      [{ startsTime: '08:00', durationMinutes: 330 }],
      expect.any(String),
    )
  })

  it('does not submit an open exception segment that has no end time', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openExceptionCreateDialog(wrapper)
    let form = exceptionCreateForm(wrapper)
    await setDate(form, '2026-12-24')
    await openOpenShape(wrapper)
    form = exceptionCreateForm(wrapper)
    await setTime(form, '08:00', 0)

    await exceptionCreateForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createScheduleExceptionMock).not.toHaveBeenCalled()
    expect(exceptionCreateForm(wrapper).text()).toContain(
      'Revisa la hora de inicio y de fin de cada tramo.',
    )
  })

  it('a duplicate date (CA-041-05) shows a recoverable message without closing the dialog', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openExceptionCreateDialog(wrapper)
    await setDate(exceptionCreateForm(wrapper), '2026-12-08')

    createScheduleExceptionMock.mockResolvedValueOnce({ kind: 'date-conflict' })
    await exceptionCreateForm(wrapper).trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Ya existe una excepción para esa fecha')
  })

  it('rejects an empty effective date on the client without calling the API', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await openExceptionCreateDialog(wrapper)

    await exceptionCreateForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createScheduleExceptionMock).not.toHaveBeenCalled()
  })

  it('deleting an exception removes it from the list on success', async () => {
    fetchScheduleExceptionsMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      page: { items: [closedException], nextCursor: null },
    })
    const wrapper = await mountReady(oneProfessional, [])
    deleteScheduleExceptionMock.mockResolvedValueOnce({ kind: 'success' })

    const retireButton = wrapper.findAll('button').find((b) => b.text() === 'Retirar')!
    await retireButton.trigger('click')
    await flushPromises()

    expect(deleteScheduleExceptionMock).toHaveBeenCalledWith('b-1', 'exc-1')
    expect(wrapper.text()).not.toContain('8 de diciembre')
    expect(toastState.items.map((item) => item.title)).toEqual(['Excepción retirada'])
  })

  it('shows upcoming Colombian holidays and prefills the create dialog from one (RN-BLQ-02)', async () => {
    fetchColombianHolidaysMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      items: [{ date: '2026-12-25', name: 'Navidad' }],
    })
    const wrapper = await mountReady(oneProfessional, [])

    expect(wrapper.text()).toContain('Navidad')

    const useButton = wrapper.findAll('button').find((b) => b.text() === 'Registrar excepción')!
    await useButton.trigger('click')
    await flushPromises()

    expect(exceptionCreateForm(wrapper).findComponent(BaseDatePicker).props('modelValue')).toBe(
      '2026-12-25',
    )
  })

  it('marks a holiday that already has an exception instead of offering to register another', async () => {
    fetchScheduleExceptionsMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      page: { items: [{ ...closedException, effectiveDate: '2026-12-25' }], nextCursor: null },
    })
    fetchColombianHolidaysMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      items: [{ date: '2026-12-25', name: 'Navidad' }],
    })
    const wrapper = await mountReady(oneProfessional, [])

    expect(wrapper.text()).toContain('Con excepción')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Registrar excepción')).toBe(false)
  })
})

// --- Tablero semanal --------------------------------------------------------

describe('SchedulesPage · tablero semanal', () => {
  beforeEach(() => {
    fetchProfessionalSummariesMock.mockReset()
    fetchWorkingHoursMock.mockReset()
    createWorkingHourMock.mockReset()
    fetchBusinessTimezoneMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
    fetchHolidayCalendarMock.mockReset().mockResolvedValue({ kind: 'success', enabled: false })
    fetchScheduleExceptionsMock
      .mockReset()
      .mockResolvedValue({ kind: 'success', page: { items: [], nextCursor: null } })
    fetchColombianHolidaysMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
  })

  it('totals the week and counts the days with a working schedule', async () => {
    const wrapper = await mountReady(oneProfessional, [
      mondayMorning,
      { ...mondayMorning, id: 'wh-2', startsTime: '14:00', durationMinutes: 210 },
      { ...mondayMorning, id: 'wh-3', isoWeekday: 3 },
    ])

    const stats = wrapper.get('dl').text()
    expect(stats).toContain('11 h 30 min')
    expect(stats).toContain('2/7')
  })

  it('labels a day without tramos as free, and still lists it (CA-040-01)', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])

    expect(wrapper.findAll('section.week-board__day')).toHaveLength(7)
    expect(wrapper.findAll('.week-board__day--free')).toHaveLength(6)
    expect(wrapper.text()).toContain('Día libre')
  })

  it('shows each tramo as a 12-hour range, without its minutes', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])

    expect(wrapper.text()).toContain('8:00 a. m. – 12:00 p. m.')
    expect(wrapper.text()).not.toContain('240 min')
  })

  it('opens the create dialog on the day whose + was pressed', async () => {
    const wrapper = await mountReady(oneProfessional, [])
    await wrapper.get('button[aria-label="Agregar un tramo el Martes"]').trigger('click')
    await flushPromises()

    expect(
      createForm(wrapper)
        .get('button[role="radio"][aria-label="Martes"]')
        .attributes('aria-checked'),
    ).toBe('true')

    await setTime(createForm(wrapper), '09:00', 0)
    await setTime(createForm(wrapper), '10:00', 1)
    createWorkingHourMock.mockResolvedValueOnce({
      kind: 'success',
      workingHour: { ...mondayMorning, isoWeekday: 2, startsTime: '09:00' },
    })
    await createForm(wrapper).trigger('submit')
    await flushPromises()

    expect(createWorkingHourMock).toHaveBeenCalledWith('b-1', 2, '09:00', 60, expect.any(String))
  })

  it('previews the tramo being written together with the ones the day already has', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])
    await wrapper.get('button[aria-label="Agregar un tramo el Lunes"]').trigger('click')
    await flushPromises()

    expect(createForm(wrapper).text()).toContain('Elige la hora de inicio y de fin')

    await setTime(createForm(wrapper), '13:00', 0)
    await setTime(createForm(wrapper), '14:00', 1)

    expect(createForm(wrapper).text()).toContain('Lunes · 1:00 p. m. – 2:00 p. m. · 1 h')
    // El de la mañana sigue en la pista como contexto, atenuado.
    expect(createForm(wrapper).findAll('.day-track__bar--muted')).toHaveLength(1)
  })

  it('marks today in the business timezone, not the device one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // Domingo 4 de octubre, 22:30 en Bogotá (lunes 5 UTC).
      vi.setSystemTime(new Date('2026-10-05T03:30:00Z'))
      fetchBusinessTimezoneMock.mockReset().mockResolvedValueOnce({
        kind: 'success',
        timezone: 'America/Bogota',
      })
      const wrapper = await mountReady(oneProfessional, [mondayMorning])

      const today = wrapper.findAll('.week-board__day--today')
      expect(today).toHaveLength(1)
      expect(today[0]!.text()).toContain('Domingo')
      expect(today[0]!.text()).toContain('Hoy')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks no day as today when the timezone is unknown', async () => {
    const wrapper = await mountReady(oneProfessional, [mondayMorning])

    expect(wrapper.find('.week-board__day--today').exists()).toBe(false)
  })

  it('opens the exceptions section first and keeps one section open at a time', async () => {
    fetchColombianHolidaysMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      items: [{ date: '2026-12-25', name: 'Navidad' }],
    })
    const wrapper = await mountReady(oneProfessional, [])
    const trigger = (title: string) =>
      wrapper.findAll('.accordion-item__trigger').find((t) => t.text().startsWith(title))!

    expect(trigger('Excepciones de jornada').attributes('aria-expanded')).toBe('true')
    expect(trigger('Calendario de festivos').attributes('aria-expanded')).toBe('false')
    expect(trigger('Próximos festivos').attributes('aria-expanded')).toBe('false')

    await trigger('Calendario de festivos').trigger('click')
    expect(trigger('Calendario de festivos').attributes('aria-expanded')).toBe('true')
    expect(trigger('Excepciones de jornada').attributes('aria-expanded')).toBe('false')

    await trigger('Calendario de festivos').trigger('click')
    expect(trigger('Calendario de festivos').attributes('aria-expanded')).toBe('false')
  })

  it('summarizes each section in its header badge', async () => {
    fetchHolidayCalendarMock.mockReset().mockResolvedValueOnce({ kind: 'success', enabled: true })
    fetchScheduleExceptionsMock.mockReset().mockResolvedValueOnce({
      kind: 'success',
      page: { items: [closedException], nextCursor: null },
    })
    const wrapper = await mountReady(oneProfessional, [])
    const badge = (title: string) =>
      wrapper
        .findAll('.accordion-item__trigger')
        .find((t) => t.text().startsWith(title))!
        .get('.accordion-item__badge')
        .text()

    expect(badge('Calendario de festivos')).toBe('Activo')
    expect(badge('Excepciones de jornada')).toBe('1')
  })
  describe('perfil de profesional individual (DEC-115)', () => {
    it('hides the professional picker with one professional and still loads that schedule', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      const wrapper = await mountReady(oneProfessional, [mondayMorning])

      expect(wrapper.find('#schedules-professional-select').exists()).toBe(false)
      expect(fetchWorkingHoursMock).toHaveBeenCalledWith('b-1')
      expect(wrapper.text()).toContain('8:00 a. m.')
    })

    it('sizes the loading header for the name, not the picker, from the first frame (CLS)', async () => {
      // La carga queda pendiente a propósito: el test mira el primer cuadro y
      // así no hay una respuesta vacía que llegue después del desmontaje.
      fetchProfessionalSummariesMock.mockReturnValue(new Promise(() => {}))
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      const solo = mountPage()
      // Sin esperar a la API: el perfil se lee de forma síncrona del brand.
      expect(solo.find('.schedules-page__who--skeleton').exists()).toBe(true)
      expect(solo.find('.schedules-page__skeleton-bar--name').exists()).toBe(true)
      expect(solo.find('.schedules-page__skeleton-select').exists()).toBe(false)
      solo.unmount()

      resetBrand()
      const team = mountPage()
      expect(team.find('.schedules-page__skeleton-select').exists()).toBe(true)
      expect(team.find('.schedules-page__skeleton-bar--name').exists()).toBe(false)
      team.unmount()
    })

    it('keeps the picker in the solo profile with several professionals, and in the full panel', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      expect(
        (await mountReady(fourProfessionals)).find('#schedules-professional-select').exists(),
      ).toBe(true)

      resetBrand()
      expect(
        (await mountReady(oneProfessional)).find('#schedules-professional-select').exists(),
      ).toBe(true)
    })

    it('points the empty state at "Mi perfil" instead of "Profesionales"', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('Mi perfil')
      expect(wrapper.text()).not.toContain('Barberos')
    })

    it('has no axe violations without the picker', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      const wrapper = await mountReady(oneProfessional, [mondayMorning])

      expect(await axe(wrapper.element.outerHTML, axeOptions)).toHaveNoViolations()
    })
  })
})

describe('SchedulesPage · vocabulario del negocio (DEC-119)', () => {
  const nails = {
    ...DEFAULT_BRAND,
    businessTerm: 'estudio',
    businessTermGender: 'masculine' as const,
    professionalTerm: 'manicurista',
    professionalTermPlural: 'manicuristas',
    professionalTermGender: 'feminine' as const,
  }

  beforeEach(() => {
    resetToasts()
    resetBrand()
    fetchProfessionalSummariesMock.mockReset()
    fetchWorkingHoursMock.mockReset()
    fetchBusinessTimezoneMock.mockReset().mockResolvedValue({
      kind: 'success',
      timezone: 'America/Bogota',
    })
    fetchHolidayCalendarMock.mockReset().mockResolvedValue({ kind: 'success', enabled: false })
    fetchScheduleExceptionsMock
      .mockReset()
      .mockResolvedValue({ kind: 'success', page: { items: [], nextCursor: null } })
    fetchColombianHolidaysMock.mockReset().mockResolvedValue({ kind: 'unavailable' })
  })

  function expectNoFixedWords(wrapper: VueWrapper) {
    expect(wrapper.text()).not.toMatch(/professional(o|a|os|as|ía|ías)\b/i)
    // Ni las palabras del vocabulario inicial (DEC-183).
    expect(wrapper.text()).not.toMatch(/profesional(es)?\b|negocio/i)
  }

  it('names the picker and the holiday switch with the configured words', async () => {
    setBrand(nails)
    const wrapper = await mountReady(fourProfessionals)

    expect(wrapper.get('#schedules-professional-select').text()).not.toBe('')
    expect(wrapper.text()).toContain('Manicurista')
    expect(wrapper.text()).toContain('Horas en hora de Colombia')
    expect(wrapper.text()).toContain('festivos colombianos de esta manicurista')
    expectNoFixedWords(wrapper)
  })

  it('writes the empty state and its link with the configured plural', async () => {
    setBrand(nails)
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Aún no tienes manicuristas registradas.')
    expect(wrapper.text()).toContain('“Manicuristas”')
    expectNoFixedWords(wrapper)
  })

  it('writes the recoverable errors with the configured word', async () => {
    setBrand(nails)
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchWorkingHoursMock.mockResolvedValueOnce({ kind: 'network-error' })
    fetchScheduleExceptionsMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos cargar el horario de esta manicurista')
    expectNoFixedWords(wrapper)
  })

  it('uses the generic words when the business never configured its own (DEC-183)', async () => {
    const wrapper = await mountReady(fourProfessionals)

    expect(wrapper.text()).toContain('Horas en hora de Colombia')
    expect(wrapper.text()).toContain('festivos colombianos de este profesional')
  })
})
