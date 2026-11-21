/**
 * Pruebas de NewAppointmentPage (HU-061): carga (vacío, error), selección
 * de profesional → carga de servicios asignados (DEC-072), validación de
 * forma, éxito con resumen honesto, conflicto (agenda/bloqueo, DEC-073),
 * conflicto de idempotencia, error de red, doble envío bloqueado y
 * accesibilidad. appointmentsApi se sustituye por un doble de prueba; el
 * recorrido real contra el API vive en el E2E de HU-061.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetToasts, toastState } from '@/shared/model/toastStore'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { axe } from 'vitest-axe'

const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchAssignedServicesMock = vi.hoisted(() => vi.fn())
const fetchBusinessTimezoneMock = vi.hoisted(() => vi.fn())
const createManualAppointmentMock = vi.hoisted(() => vi.fn())
const fetchManualAvailabilityMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/appointmentsApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchAssignedServices: fetchAssignedServicesMock,
  fetchBusinessTimezone: fetchBusinessTimezoneMock,
  createManualAppointment: createManualAppointmentMock,
  fetchManualAvailability: fetchManualAvailabilityMock,
}))

const { default: NewAppointmentPage } = await import('../NewAppointmentPage.vue')
const { formatCivilDateFull, getCivilDateInTimezone } = await import('@/shared/time/civilDate')

// Hoy en la zona del negocio: la hora se elige en la rejilla de inicios libres
// (#717). 19:30 UTC son las 2:30 p. m. en Bogotá.
const today = getCivilDateInTimezone('America/Bogota')
const freeStarts = {
  kind: 'success',
  availability: {
    starts: [`${today}T19:30:00Z`],
    timezone: 'America/Bogota',
    durationMinutes: 30,
    slotGridMinutes: 30,
  },
}

async function chooseFreeStart(wrapper: {
  findAll: (s: string) => { text: () => string; trigger: (e: string) => Promise<void> }[]
}) {
  await wrapper
    .findAll('.bk-min')
    .find((b) => b.text() === ':30')!
    .trigger('click')
  await flushPromises()
}

const oneProfessional = [{ id: 'b-1', fullName: 'Carlos Ramírez' }]
const twoServices = [
  { id: 's-1', name: 'Corte clásico' },
  { id: 's-2', name: 'Barba' },
]

function mountPage() {
  return mount(NewAppointmentPage)
}

async function mountReady(professionals = oneProfessional) {
  fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: professionals })
  fetchBusinessTimezoneMock.mockResolvedValueOnce({
    kind: 'success',
    timezone: 'America/Bogota',
  })
  const wrapper = mountPage()
  await flushPromises()
  return wrapper
}

/**
 * El campo "Profesional" es el listbox con monograma (ProfessionalSelect), no un
 * `<select>` nativo: el atlas nuevo-turno-eventos (issue #190) muestra el
 * retrato del profesional dentro del control cerrado, y una `<option>` nativa no
 * puede llevarlo. Elegir = abrir el disparador y activar su opción.
 */
async function chooseProfessional(
  wrapper: Awaited<ReturnType<typeof mountReady>>,
  index = 0,
): Promise<void> {
  await wrapper.get('#new-appointment-professional').trigger('click')
  await flushPromises()
  await wrapper.findAll('[role="option"]')[index]!.trigger('click')
  await flushPromises()
}

async function fillValidForm(wrapper: Awaited<ReturnType<typeof mountReady>>) {
  fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
  await chooseProfessional(wrapper)

  const serviceSelect = wrapper.get<HTMLSelectElement>('#new-appointment-service')
  await serviceSelect.setValue('s-1')

  const inputs = wrapper.findAll('input')
  const byLabel = (text: string) =>
    inputs.find((i) => i.element.labels?.[0]?.textContent?.includes(text))!
  await byLabel('Persona atendida').setValue('Juan Pérez')
  await byLabel('Nombre del cliente').setValue('Juan Pérez')
  await flushPromises()
  await chooseFreeStart(wrapper)
}

const axeOptions = { rules: { 'color-contrast': { enabled: false } } }

describe('NewAppointmentPage', () => {
  beforeEach(() => {
    resetToasts()
    resetBrand()
    fetchProfessionalSummariesMock.mockReset()
    fetchAssignedServicesMock.mockReset()
    fetchBusinessTimezoneMock.mockReset()
    createManualAppointmentMock.mockReset()
    fetchManualAvailabilityMock.mockReset()
    fetchManualAvailabilityMock.mockResolvedValue(freeStarts)
  })

  it('shows a non-blank loading state, then the professional picker', async () => {
    let resolveProfessionals: (value: unknown) => void = () => {}
    fetchProfessionalSummariesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProfessionals = resolve
      }),
    )
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Cargando profesionales')

    resolveProfessionals({ kind: 'success', items: oneProfessional })
    await flushPromises()
    expect(wrapper.find('#new-appointment-professional').exists()).toBe(true)
  })

  it('shows an explicit empty state when there are no professionals', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('Aún no tienes profesionales registrados')
  })

  it('shows a recoverable error when professionals fail to load', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('No pudimos cargar esta sección')
  })

  it('loads only the services assigned to the selected professional (DEC-072)', async () => {
    const wrapper = await mountReady()
    fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    await chooseProfessional(wrapper)
    expect(fetchAssignedServicesMock).toHaveBeenCalledWith('b-1')
    const options = wrapper.findAll('#new-appointment-service option')
    expect(options.map((o) => o.text())).toContain('Corte clásico')
  })

  it('blocks submit and shows field errors on an empty form', async () => {
    const wrapper = await mountReady()
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(createManualAppointmentMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Elige un profesional')
  })

  // Rediseño del issue #576: el boleto del resumen está desde el inicio y
  // nombra lo pendiente en vez de ocultarlo, para que su forma no salte.
  it('copies the attended person into the client name until it is edited (#716)', async () => {
    const wrapper = await mountReady()
    const byLabel = (text: string) =>
      wrapper.findAll('input').find((i) => i.element.labels?.[0]?.textContent?.includes(text))!
    await byLabel('Persona atendida').setValue('Ana Pérez')
    expect((byLabel('Nombre del cliente').element as HTMLInputElement).value).toBe('Ana Pérez')
    expect(wrapper.text()).toContain('Es la misma persona; cámbialo si reservó otra.')

    await byLabel('Nombre del cliente').setValue('Luis Pérez')
    await byLabel('Persona atendida').setValue('Ana María Pérez')
    expect((byLabel('Nombre del cliente').element as HTMLInputElement).value).toBe('Luis Pérez')
    expect(wrapper.text()).not.toContain('Es la misma persona')
    // Sin placeholders que repitan el rótulo.
    expect(byLabel('Persona atendida').attributes('placeholder')).toBeUndefined()
  })

  it('shows the summary ticket with every pending item named on an untouched form', async () => {
    const wrapper = await mountReady()
    const resumen = wrapper.get('.new-appointment-page__resumen')
    expect(resumen.text()).toContain('0/3 pasos')
    expect(resumen.text()).toContain('Fecha por definir')
    expect(resumen.text()).toContain('Por elegir')
    expect(resumen.text()).toContain('Por escribir')
  })

  it('fills the summary ticket live, keeping what is still pending as such', async () => {
    const wrapper = await mountReady()
    fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    await chooseProfessional(wrapper)

    const resumen = wrapper.get('.new-appointment-page__resumen')
    expect(resumen.text()).toContain('Carlos Ramírez')
    expect(resumen.text()).toContain('Por elegir')
    expect(resumen.text()).toContain('0/3 pasos')
  })

  it('marks each step as done once its required fields are filled', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)

    const sections = wrapper.findAll('.new-appointment-page__section')
    expect(sections.map((s) => s.classes('new-appointment-page__section--done'))).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(sections[0]!.get('h2').text()).toContain('(listo)')
    expect(wrapper.get('.new-appointment-page__resumen').text()).toContain('3/3 pasos')
  })

  it('reflects every filled field in "Resumen", including the readable date', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)

    const resumen = wrapper.get('.new-appointment-page__resumen')
    expect(resumen.text()).toContain('Carlos Ramírez')
    expect(resumen.text()).toContain('Corte clásico')
    expect(resumen.text()).toContain('Juan Pérez')
    expect(resumen.text()).toContain('14:30')
    expect(resumen.text()).toContain(formatCivilDateFull(today))
  })

  it('submits successfully and shows an honest summary, no link to a non-existent agenda screen', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)
    createManualAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: {
        id: 'appt-1',
        professionalId: 'b-1',
        serviceId: 's-1',
        attendeeName: 'Juan Pérez',
        startsAt: '2026-09-03T14:30:00-05:00',
        endsAt: '2026-09-03T15:00:00-05:00',
        serviceName: 'Corte clásico',
        durationMinutes: 30,
        priceAmount: '20000.00',
        currency: 'COP',
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('Turno registrado')
    expect(wrapper.text()).toContain('Corte clásico')
    expect(wrapper.find('a').exists()).toBe(false)
    expect(toastState.items.map((item) => item.title)).toEqual(['Turno registrado'])
  })

  it('shows the server conflict detail on a schedule/block conflict (DEC-073)', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)
    createManualAppointmentMock.mockResolvedValueOnce({
      kind: 'conflict',
      detail: 'el profesional tiene un bloqueo vigente en ese intervalo',
    })
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('el profesional tiene un bloqueo vigente en ese intervalo')
  })

  it('shows a recoverable message on a network error and keeps the form data', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)
    createManualAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('No pudimos registrar el turno')
    const attendeeInput = wrapper
      .findAll('input')
      .find((i) => i.element.labels?.[0]?.textContent?.includes('Persona atendida'))!
    expect(attendeeInput.element.value).toBe('Juan Pérez')
  })

  it('blocks a second submit while the first one is still in flight', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)
    let resolveCreate: (value: unknown) => void = () => {}
    createManualAppointmentMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )

    const form = wrapper.get('form')
    await form.trigger('submit.prevent')
    await form.trigger('submit.prevent')
    expect(createManualAppointmentMock).toHaveBeenCalledTimes(1)

    resolveCreate({
      kind: 'success',
      appointment: {
        id: 'appt-1',
        professionalId: 'b-1',
        serviceId: 's-1',
        attendeeName: 'Juan Pérez',
        startsAt: '2026-09-03T14:30:00-05:00',
        endsAt: '2026-09-03T15:00:00-05:00',
        serviceName: 'Corte clásico',
        durationMinutes: 30,
        priceAmount: '20000.00',
        currency: 'COP',
      },
    })
    await flushPromises()
  })

  // Fidelidad con el atlas nuevo-turno-eventos (issue #190). Estas pruebas
  // describen la NUEVA geometría/estado visual, nunca ocultan una diferencia.

  it('keeps every field and marks the time field on a 409 (atlas evento 11)', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)
    createManualAppointmentMock.mockResolvedValueOnce({
      kind: 'conflict',
      detail: 'el profesional ya tiene una cita en ese intervalo',
    })
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    // Dos niveles a la vez: alerta global + mismo detalle junto al campo.
    const occurrences = wrapper
      .text()
      .split('el profesional ya tiene una cita en ese intervalo').length
    expect(occurrences).toBe(3)

    const inputs = wrapper.findAll('input')
    const byLabel = (text: string) =>
      inputs.find((i) => i.element.labels?.[0]?.textContent?.includes(text))!
    expect(byLabel('Nombre del cliente').element.value).toBe('Juan Pérez')
    // La rejilla vuelve a leer ese día para no ofrecer la hora tomada (#717).
    expect(fetchManualAvailabilityMock).toHaveBeenLastCalledWith('b-1', 's-1', today, today)
    expect(wrapper.find('.bk-min[aria-checked="true"]').exists()).toBe(true)
  })

  it('counts the note against the real validateCustomerNote limit (500)', async () => {
    const wrapper = await mountReady()
    expect(wrapper.get('.new-appointment-page__counter').text()).toBe('0/500')

    await wrapper.get('#new-appointment-note').setValue('Cliente frecuente.')
    expect(wrapper.get('.new-appointment-page__counter').text()).toBe('18/500')
  })

  it('waits with the skeleton of the form, not with an empty screen', async () => {
    fetchProfessionalSummariesMock.mockReturnValueOnce(new Promise(() => {}))
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    const wrapper = mountPage()
    await flushPromises()

    const skeleton = wrapper.get('.nt-skeleton')
    expect(skeleton.attributes('role')).toBe('status')
    expect(skeleton.text()).toContain('Cargando profesionales')
    expect(wrapper.findAll('.nt-skeleton__band')).toHaveLength(4)
  })

  it('keeps Registrar and Cancelar together in the summary rail from the start', async () => {
    const wrapper = await mountReady()
    const rail = wrapper.get('.new-appointment-page__rail')
    const labels = rail.findAll('button').map((b) => b.text())
    expect(labels).toEqual(['Registrar turno', 'Cancelar'])
  })

  it('Cancelar returns to the agenda day it came from without creating the appointment', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/panel', name: 'panel', component: { template: '<div />' } },
        { path: '/panel/turnos/nuevo', name: 'agenda-nuevo-turno', component: NewAppointmentPage },
      ],
    })
    await router.push({
      name: 'agenda-nuevo-turno',
      query: { professionalId: 'b-1', date: '2026-09-03', extra: 'x' },
    })
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({
      kind: 'success',
      timezone: 'America/Bogota',
    })
    const wrapper = mount(NewAppointmentPage, { global: { plugins: [router] } })
    await flushPromises()

    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Cancelar')!
    await cancel.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('panel')
    expect(router.currentRoute.value.query).toEqual({ professionalId: 'b-1', date: '2026-09-03' })
    expect(createManualAppointmentMock).not.toHaveBeenCalled()
  })

  it('Cancelar opened without an agenda origin returns to the agenda default', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/panel', name: 'panel', component: { template: '<div />' } },
        { path: '/panel/turnos/nuevo', name: 'agenda-nuevo-turno', component: NewAppointmentPage },
      ],
    })
    await router.push({ name: 'agenda-nuevo-turno', query: { date: 'no-es-fecha' } })
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({
      kind: 'success',
      timezone: 'America/Bogota',
    })
    const wrapper = mount(NewAppointmentPage, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancelar')!
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('panel')
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('has no detectable axe violations in the ready state', async () => {
    const wrapper = await mountReady()
    const results = await axe(wrapper.element, axeOptions)
    expect(results.violations).toEqual([])
  })

  it('has no detectable axe violations with the global alert visible', async () => {
    const wrapper = await mountReady()
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.find('.new-appointment-page__rail').exists()).toBe(true)

    const results = await axe(wrapper.element, axeOptions)
    expect(results.violations).toEqual([])
  })

  it('has no detectable axe violations on the success screen', async () => {
    const wrapper = await mountReady()
    await fillValidForm(wrapper)
    createManualAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: {
        id: 'appt-1',
        professionalId: 'b-1',
        serviceId: 's-1',
        attendeeName: 'Juan Pérez',
        startsAt: '2026-09-03T14:30:00-05:00',
        endsAt: '2026-09-03T15:00:00-05:00',
        serviceName: 'Corte clásico',
        durationMinutes: 30,
        priceAmount: '20000.00',
        currency: 'COP',
      },
    })
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    const results = await axe(wrapper.element, axeOptions)
    expect(results.violations).toEqual([])
  })
  describe('perfil de profesional individual (DEC-115)', () => {
    it('preselects the only professional, hides the field and loads that professional services', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
      const wrapper = await mountReady()
      await flushPromises()

      expect(wrapper.find('#new-appointment-professional').exists()).toBe(false)
      expect(fetchAssignedServicesMock).toHaveBeenCalledWith('b-1')
      expect(wrapper.text()).toContain('Elige el servicio.')
      expect(wrapper.text()).not.toContain('Elige al profesional')
      expect(wrapper.get('#new-appointment-service').findAll('option').length).toBeGreaterThan(2)
    })

    it('books for the only professional without asking who it is', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
      const wrapper = await mountReady()
      await flushPromises()

      await wrapper.get<HTMLSelectElement>('#new-appointment-service').setValue('s-1')
      const inputs = wrapper.findAll('input')
      const byLabel = (text: string) =>
        inputs.find((i) => i.element.labels?.[0]?.textContent?.includes(text))!
      await byLabel('Persona atendida').setValue('Juan Pérez')
      await byLabel('Nombre del cliente').setValue('Juan Pérez')
      await flushPromises()
      await chooseFreeStart(wrapper)
      createManualAppointmentMock.mockResolvedValueOnce({ kind: 'conflict', detail: 'ocupado' })

      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()

      expect(createManualAppointmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ professionalId: 'b-1', serviceId: 's-1' }),
        expect.anything(),
      )
    })

    it('keeps the field in the solo profile when there are several professionals, and in the full panel', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      const several = await mountReady([
        { id: 'b-1', fullName: 'Carlos Ramírez' },
        { id: 'b-2', fullName: 'Ana Gómez' },
      ])
      expect(several.find('#new-appointment-professional').exists()).toBe(true)

      resetBrand()
      const full = await mountReady()
      expect(full.find('#new-appointment-professional').exists()).toBe(true)
    })

    it('has no axe violations without the professional field', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
      const wrapper = await mountReady()
      await flushPromises()

      expect(await axe(wrapper.element.outerHTML, axeOptions)).toHaveNoViolations()
    })
  })
})
