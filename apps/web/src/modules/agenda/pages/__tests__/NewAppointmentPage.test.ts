/**
 * Pruebas de NewAppointmentPage (HU-061): carga (vacío, error), selección
 * de profesional → carga de servicios asignados (DEC-072), validación de
 * forma, éxito con resumen honesto, conflicto (agenda/bloqueo, DEC-073),
 * conflicto de idempotencia, error de red, doble envío bloqueado y
 * accesibilidad. appointmentsApi se sustituye por un doble de prueba; el
 * recorrido real contra el API vive en el E2E de HU-061.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// El negocio de la sesión encabeza la tarjeta del borrador (#833).
vi.mock('@/modules/auth', async () => {
  const { computed } = await import('vue')
  return { sessionBusinessName: computed(() => 'Barbería Demo') }
})

const { default: NewAppointmentPage } = await import('../NewAppointmentPage.vue')
const { getCivilDateInTimezone } = await import('@/shared/time/civilDate')
const { civilTicketMoment } = await import('@/shared/time/ticketMoment')

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

// La rejilla se pinta tras varias promesas encadenadas (servicio, profesional,
// inicios libres); bajo carga del CI un solo flushPromises no siempre basta
// (#834, PR-860 #1). Se espera al chip en vez de consultarlo en el acto.
async function chooseFreeStart(wrapper: {
  findAll: (s: string) => { text: () => string; trigger: (e: string) => Promise<void> }[]
}) {
  const chip = await vi.waitFor(
    () => {
      const found = wrapper.findAll('.bk-min').find((b) => b.text() === ':30')
      if (!found) throw new Error('la rejilla aún no muestra el inicio :30')
      return found
    },
    { timeout: 2000, interval: 10 },
  )
  await chip.trigger('click')
  await flushPromises()
}

const oneProfessional = [{ id: 'b-1', fullName: 'Carlos Ramírez' }]
// Precio y duración del catálogo: los que el servidor aplica al registrar (#833).
const twoServices = [
  { id: 's-1', name: 'Corte clásico', durationMinutes: 45, price: '35000.00', currency: 'COP' },
  { id: 's-2', name: 'Barba', durationMinutes: 20, price: '15000.00', currency: 'COP' },
]

function mountPage(options: { attachTo?: HTMLElement } = {}) {
  return mount(NewAppointmentPage, options)
}

async function mountReady(
  professionals = oneProfessional,
  options: { attachTo?: HTMLElement } = {},
) {
  fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: professionals })
  fetchBusinessTimezoneMock.mockResolvedValueOnce({
    kind: 'success',
    timezone: 'America/Bogota',
  })
  const wrapper = mountPage(options)
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
    expect(wrapper.get('.new-appointment-page__progress').text()).toBe('3/3 pasos')
  })

  it('submits successfully and shows an honest summary, no link to a non-existent agenda screen', async () => {
    const wrapper = await mountReady(oneProfessional, { attachTo: document.body })
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
    // Sin aviso emergente (#839): la confirmación es la vista. El lector la anuncia
    // al recibir el foco el titular, que lleva su nota como descripción.
    expect(toastState.items).toEqual([])
    const heading = wrapper.get('h2.new-appointment-page__done-title')
    expect(document.activeElement).toBe(heading.element)
    const note = document.getElementById(heading.attributes('aria-describedby')!)
    expect(note?.textContent).toContain('El turno quedó confirmado en la agenda')
    wrapper.unmount()
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

  it.each([
    ['conflicto', { kind: 'conflict', detail: 'ocupado' }],
    ['red', { kind: 'network-error' }],
    ['validación', { kind: 'validation-error', detail: 'revisa' }],
  ])(
    'pone la alerta de «%s» justo encima de «Registrar turno», junto al botón (#837 r1)',
    async (_name, outcome) => {
      const wrapper = await mountReady()
      await fillValidForm(wrapper)
      createManualAppointmentMock.mockResolvedValueOnce(outcome)
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()
      const respond = wrapper.get('.new-appointment-page__respond')
      const children = Array.from(respond.element.children)
      expect(children[0]!.getAttribute('role')).toBe('alert')
      expect(children.at(-1)!.classList).toContain('new-appointment-page__actions')
      // Fuera del bloque, nada más del riel lleva una alerta.
      const rail = wrapper.get('.new-appointment-page__rail').element
      expect(
        Array.from(rail.querySelectorAll('[role="alert"]')).every((a) =>
          respond.element.contains(a),
        ),
      ).toBe(true)
    },
  )

  it('devuelve el foco a «Registrar turno» si se perdió mientras guardaba (#837 r1)', async () => {
    const wrapper = await mountReady(oneProfessional, { attachTo: document.body })
    await fillValidForm(wrapper)
    createManualAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
    ;(document.activeElement as HTMLElement | null)?.blur()
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('.new-appointment-page__submit').element)
    wrapper.unmount()
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
    expect(fetchManualAvailabilityMock).toHaveBeenLastCalledWith(
      'b-1',
      's-1',
      today,
      today,
      undefined,
    )
    expect(wrapper.find('.bk-min[aria-checked="true"]').exists()).toBe(true)
  })

  describe('«Empezó ahora» (#852)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('sends the existing POST with today and the current minute, and a 409 is shown as with a written time (CA-2, CA-4)', async () => {
      // Las 3:47 p. m. de hoy en Bogotá (UTC−5).
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(`${today}T20:47:35Z`))
      const wrapper = await mountReady()
      fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
      await chooseProfessional(wrapper)
      await wrapper.get<HTMLSelectElement>('#new-appointment-service').setValue('s-1')
      const inputs = wrapper.findAll('input')
      const byLabel = (text: string) =>
        inputs.find((i) => i.element.labels?.[0]?.textContent?.includes(text))!
      await byLabel('Persona atendida').setValue('Juan Pérez')
      await byLabel('Nombre del cliente').setValue('Juan Pérez')
      await flushPromises()

      const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
      await wrapper
        .findAll('button')
        .find((b) => b.text().startsWith('Otra hora'))!
        .trigger('click')
      await flushPromises()
      await button('Empezó ahora').trigger('click')
      await flushPromises()

      createManualAppointmentMock.mockResolvedValueOnce({
        kind: 'conflict',
        detail: 'el profesional ya tiene una cita en ese intervalo',
      })
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()

      expect(createManualAppointmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ professionalId: 'b-1', startsAt: `${today}T15:47:00` }),
        expect.any(String),
      )
      // Alerta global y el mismo detalle junto al campo, como con la hora escrita.
      expect(wrapper.text().split('el profesional ya tiene una cita en ese intervalo').length).toBe(
        3,
      )
      expect(byLabel('Nombre del cliente').element.value).toBe('Juan Pérez')
      expect(button('Empezó ahora')).toBeDefined()
    })
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

  it('marks the answer block as docked only while the rail foot is below the view (#839)', async () => {
    // jsdom no maqueta ni pega: se simula el IntersectionObserver del pie del riel.
    type Entry = Pick<
      IntersectionObserverEntry,
      'isIntersecting' | 'boundingClientRect' | 'rootBounds'
    >
    let notify: (entries: Entry[]) => void = () => {}
    let root: Element | Document | null | undefined
    class FakeObserver {
      constructor(cb: (entries: Entry[]) => void, options?: IntersectionObserverInit) {
        notify = cb
        root = options?.root
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.appendChild(scroller)
    const entry = (isIntersecting: boolean, top: number): Entry => ({
      isIntersecting,
      boundingClientRect: { top } as DOMRectReadOnly,
      rootBounds: { bottom: 700 } as DOMRectReadOnly,
    })
    try {
      const wrapper = await mountReady(oneProfessional, { attachTo: scroller })
      const respond = () => wrapper.get('.new-appointment-page__respond').attributes('data-docked')
      expect(root).toBe(scroller)
      expect(respond()).toBeUndefined()

      // Al cargar en una vista baja el pie del riel queda debajo: el bloque está pegado.
      notify([entry(false, 860)])
      await flushPromises()
      expect(respond()).toBe('true')

      // Al bajar hasta el final el bloque vuelve a su sitio y deja de leerse como dock.
      notify([entry(true, 690)])
      await flushPromises()
      expect(respond()).toBeUndefined()
      wrapper.unmount()
    } finally {
      scroller.remove()
      vi.unstubAllGlobals()
    }
  })

  it('never marks the block as docked below 1024 px, where it is static (O2 of #848)', async () => {
    type Entry = Pick<
      IntersectionObserverEntry,
      'isIntersecting' | 'boundingClientRect' | 'rootBounds'
    >
    let notify: (entries: Entry[]) => void = () => {}
    class FakeObserver {
      constructor(cb: (entries: Entry[]) => void) {
        notify = cb
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query !== '(min-width: 1024px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.appendChild(scroller)
    try {
      const wrapper = await mountReady(oneProfessional, { attachTo: scroller })
      // A 390 el pie del riel queda fuera de la vista, pero el bloque no está pegado.
      notify([
        {
          isIntersecting: false,
          boundingClientRect: { top: 1400 } as DOMRectReadOnly,
          rootBounds: { bottom: 844 } as DOMRectReadOnly,
        },
      ])
      await flushPromises()
      expect(
        wrapper.get('.new-appointment-page__respond').attributes('data-docked'),
      ).toBeUndefined()
      wrapper.unmount()
    } finally {
      scroller.remove()
      vi.unstubAllGlobals()
    }
  })

  it('paints the docked block with the panel canvas, never a plate of its own (#839)', () => {
    const page = readFileSync(join(__dirname, '../NewAppointmentPage.vue'), 'utf8')
    const shell = readFileSync(join(__dirname, '../../../auth/layouts/PrivateShell.vue'), 'utf8')
    // El relleno es el lienzo del escenario, con su luz fija a la ventana.
    expect(page).toMatch(/background: var\(--shell-canvas-fill, var\(--color-surface-strong\)\);/)
    expect(page).not.toMatch(
      /linear-gradient\(to bottom, transparent, var\(--color-surface-strong\) 14px\)/,
    )
    expect(shell).toMatch(
      /--shell-canvas-fill:[\s\S]*?no-repeat fixed,\s*var\(--color-surface-strong\);/,
    )
    // Filete de latón solo pegado, en el borde de arriba del bloque: 14 px sobre
    // «Registrar turno», que si no lo tapa (O1 de #848).
    expect(page).toMatch(
      /\.new-appointment-page__respond\[data-docked\]::before \{\s*inset: 0;\s*border-top: 1px solid color-mix\(in srgb, var\(--color-brass-line\)/,
    )
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

  // ── La tarjeta del borrador (#833) ───────────────────────────────────────
  describe('la tarjeta del borrador (#833)', () => {
    const created = {
      id: 'appt-1',
      professionalId: 'b-1',
      serviceId: 's-1',
      attendeeName: 'Juan Pérez',
      startsAt: '2026-09-03T14:30:00-05:00',
      endsAt: '2026-09-03T15:00:00-05:00',
      serviceName: 'Corte clásico',
      durationMinutes: 30,
      priceAmount: '35000.00',
      currency: 'COP',
    }
    const card = (w: Awaited<ReturnType<typeof mountReady>>) => w.get('.appointment-ticket')
    const announcer = (w: Awaited<ReturnType<typeof mountReady>>) =>
      w.get('[data-testid="draft-announcer"]')
    const byLabel = (w: Awaited<ReturnType<typeof mountReady>>, text: string) =>
      w.findAll('input').find((i) => i.element.labels?.[0]?.textContent?.includes(text))!

    it('starts empty: a draft «Por registrar» with a silhouette in every gap, no seal and nothing invented', async () => {
      const wrapper = await mountReady()
      const ticket = card(wrapper)
      expect(ticket.classes()).toContain('appointment-ticket--draft')
      expect(ticket.classes()).toContain('appointment-ticket--filling')
      expect(ticket.text()).toContain('Barbería Demo')
      expect(ticket.text()).toContain('Por registrar')
      expect(ticket.find('.appointment-ticket__seal').exists()).toBe(false)
      // Servicio, dato, día, día de la semana, hora, nota, retrato y nombre.
      expect(ticket.findAll('.appointment-ticket__blank')).toHaveLength(8)
      // La regla guarda su sitio, sin rombo.
      expect(ticket.find('.appointment-ticket__ruler-wrap--blank').exists()).toBe(true)
      expect(ticket.find('.day-ruler__mark').exists()).toBe(false)
      expect(ticket.text()).not.toMatch(/undefined|NaN|\$ 0|Invalid Date|--/)
      expect(wrapper.get('.new-appointment-page__progress').text()).toBe('0/3 pasos')
      // Sin caja «Resumen» alrededor ni región viva dentro.
      expect(wrapper.find('.new-appointment-page__resumen').exists()).toBe(false)
      expect(ticket.find('[role="status"], [aria-live]').exists()).toBe(false)
    })

    it('fills in place: the professional in the foot, the service with «duration · price» from the catalog', async () => {
      fetchManualAvailabilityMock.mockReset()
      fetchManualAvailabilityMock.mockReturnValue(new Promise(() => {}))
      const wrapper = await mountReady()
      fetchAssignedServicesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
      await chooseProfessional(wrapper)
      expect(card(wrapper).get('.appointment-ticket__foot').text()).toContain('Carlos Ramírez')
      await wrapper.get('#new-appointment-service').setValue('s-1')
      await flushPromises()
      // Sin la lectura de inicios libres todavía: la duración del catálogo.
      expect(card(wrapper).get('.appointment-ticket__service').text()).toBe('Corte clásico')
      expect(card(wrapper).get('.appointment-ticket__meta').text()).toBe('45 min · $\u00a035.000')
    })

    it('takes the duration of the free-starts reading once it arrives, as the server will', async () => {
      const wrapper = await mountReady()
      await fillValidForm(wrapper)
      const ticket = card(wrapper)
      expect(ticket.get('.appointment-ticket__meta').text()).toBe('30 min · $\u00a035.000')
      expect(ticket.get('.appointment-ticket__time').text()).toBe('2:30 p. m.')
      expect(ticket.get('.appointment-ticket__note').text()).toMatch(/^hasta 3:00 p\. m\. · /)
      const m = civilTicketMoment(today, '14:30', 30)!
      expect(ticket.get('.calendar-leaf__day').text()).toBe(m.day)
      expect(ticket.get('.calendar-leaf__month').text()).toBe(m.month)
      expect(ticket.get('.appointment-ticket__weekday').text()).toBe(m.weekday)
      // La regla con el rombo hueco del borrador, sin Sol.
      expect(ticket.find('.day-ruler__mark--draft').exists()).toBe(true)
      expect(ticket.find('.day-ruler__mark--mine').exists()).toBe(false)
      expect(ticket.findAll('.appointment-ticket__blank')).toHaveLength(0)
    })

    it('shows no price at all when the catalog price is unreadable', async () => {
      fetchManualAvailabilityMock.mockReset()
      fetchManualAvailabilityMock.mockReturnValue(new Promise(() => {}))
      const wrapper = await mountReady()
      fetchAssignedServicesMock.mockResolvedValueOnce({
        kind: 'success',
        items: [{ ...twoServices[0]!, price: 'gratis' }],
      })
      await chooseProfessional(wrapper)
      await wrapper.get('#new-appointment-service').setValue('s-1')
      await flushPromises()
      expect(card(wrapper).get('.appointment-ticket__meta').text()).toBe('45 min')
    })

    it('lists «Para» and «Cliente» under the card, and phone and email only when given', async () => {
      const wrapper = await mountReady()
      await fillValidForm(wrapper)
      const lines = () => wrapper.get('.new-appointment-page__lines')
      expect(
        lines()
          .findAll('dt')
          .map((d) => d.text()),
      ).toEqual(['Para', 'Cliente'])
      expect(lines().text()).toContain('Juan Pérez')
      expect(card(wrapper).text()).not.toContain('Juan Pérez')
      await byLabel(wrapper, 'Correo').setValue('cliente@ejemplo.test')
      expect(
        lines()
          .findAll('dt')
          .map((d) => d.text()),
      ).toEqual(['Para', 'Cliente', 'Correo'])
    })

    it('drops the time from the card when the form drops it, on a change of service', async () => {
      const wrapper = await mountReady()
      await fillValidForm(wrapper)
      expect(card(wrapper).get('.appointment-ticket__time').text()).toBe('2:30 p. m.')
      fetchManualAvailabilityMock.mockReturnValue(new Promise(() => {}))
      await wrapper.get('#new-appointment-service').setValue('s-2')
      await flushPromises()
      const formTime = wrapper.find('.bk-min[aria-checked="true"]').exists()
      expect(card(wrapper).find('.appointment-ticket__blank--time').exists()).toBe(!formTime)
      expect(card(wrapper).get('.appointment-ticket__service').text()).toBe('Barba')
    })

    it('stays a draft with everything chosen on a failed registration', async () => {
      const wrapper = await mountReady()
      await fillValidForm(wrapper)
      createManualAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()
      expect(card(wrapper).classes()).toContain('appointment-ticket--draft')
      expect(card(wrapper).get('.appointment-ticket__time').text()).toBe('2:30 p. m.')
      expect(wrapper.get('.new-appointment-page__rail').text()).toContain(
        'No pudimos registrar el turno',
      )
    })

    it('registers into the same card, confirmed with the short ceremony, focus on the headline', async () => {
      const wrapper = await mountReady()
      document.body.appendChild(wrapper.element)
      await fillValidForm(wrapper)
      createManualAppointmentMock.mockResolvedValueOnce({ kind: 'success', appointment: created })
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()
      const ticket = card(wrapper)
      expect(ticket.classes()).toContain('appointment-ticket--confirmed')
      expect(ticket.classes()).toContain('appointment-ticket--ceremony-short')
      expect(ticket.classes()).not.toContain('appointment-ticket--ceremony')
      expect(ticket.get('.appointment-ticket__seal').text()).toContain('Registrado')
      expect(ticket.find('.day-ruler__mark--mine').exists()).toBe(true)
      expect(document.activeElement?.textContent?.trim()).toBe('Turno registrado')
      // Ningún role="status" envuelve la tarjeta; el aviso emergente anuncia.
      expect(ticket.element.closest('[role="status"], [aria-live]')).toBeNull()
      // Sin aviso emergente (#839): la confirmación es la vista y el foco en su titular.
      expect(toastState.items).toEqual([])
      expect(announcer(wrapper).text()).toBe('')
      wrapper.unmount()
    })

    it('«Registrar otro turno» keeps the professional, clears the rest of the turn and focuses «Servicio»', async () => {
      const wrapper = await mountReady()
      document.body.appendChild(wrapper.element)
      await fillValidForm(wrapper)
      createManualAppointmentMock.mockResolvedValueOnce({ kind: 'success', appointment: created })
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()
      await wrapper.get('.new-appointment-page__again').trigger('click')
      await flushPromises()
      const ticket = card(wrapper)
      expect(ticket.classes()).toContain('appointment-ticket--draft')
      // El profesional se queda en el pie; servicio, día y hora vuelven a ser siluetas.
      expect(ticket.get('.appointment-ticket__foot').text()).toContain('Carlos Ramírez')
      expect(ticket.findAll('.appointment-ticket__blank')).toHaveLength(6)
      expect(ticket.text()).not.toMatch(/Corte clásico|2:30/)
      expect(wrapper.get('.new-appointment-page__lines').text()).not.toContain('Juan Pérez')
      expect(wrapper.get<HTMLSelectElement>('#new-appointment-service').element.value).toBe('')
      expect(announcer(wrapper).text()).toBe('')
      expect(document.activeElement?.id).toBe('new-appointment-service')
      wrapper.unmount()
    })

    it('registers one turn right after another, without waiting for the first ceremony', async () => {
      const wrapper = await mountReady()
      for (const id of ['appt-1', 'appt-2']) {
        await fillValidForm(wrapper)
        createManualAppointmentMock.mockResolvedValueOnce({
          kind: 'success',
          appointment: { ...created, id },
        })
        await wrapper.get('form').trigger('submit.prevent')
        await flushPromises()
        expect(card(wrapper).classes()).toContain('appointment-ticket--confirmed')
        await wrapper.get('.new-appointment-page__again').trigger('click')
        await flushPromises()
      }
      expect(createManualAppointmentMock).toHaveBeenCalledTimes(2)
    })

    it('announces once when the draft is complete, never while typing, and again after breaking and completing it', async () => {
      const wrapper = await mountReady()
      const texts: string[] = []
      const observer = new MutationObserver(() => {
        const text = announcer(wrapper).text()
        if (text) texts.push(text)
      })
      observer.observe(announcer(wrapper).element, {
        childList: true,
        characterData: true,
        subtree: true,
      })
      await fillValidForm(wrapper)
      await flushPromises()
      expect(texts).toEqual(['Turno listo para registrar.'])
      // Seguir escribiendo en un campo ya lleno no anuncia nada.
      await byLabel(wrapper, 'Persona atendida').setValue('Juan Pérez Gómez')
      await byLabel(wrapper, 'Nombre del cliente').setValue('Juan Pérez Gómez')
      await flushPromises()
      expect(texts).toHaveLength(1)
      // Se rompe (sin nombre) y se vuelve a completar: un segundo anuncio.
      await byLabel(wrapper, 'Persona atendida').setValue('')
      await byLabel(wrapper, 'Nombre del cliente').setValue('')
      await flushPromises()
      expect(announcer(wrapper).text()).toBe('')
      await byLabel(wrapper, 'Persona atendida').setValue('Ana')
      await flushPromises()
      observer.disconnect()
      expect(texts).toEqual(['Turno listo para registrar.', 'Turno listo para registrar.'])
    })
  })
})
