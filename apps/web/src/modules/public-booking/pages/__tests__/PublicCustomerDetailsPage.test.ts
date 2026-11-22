/**
 * Pruebas de PublicCustomerDetailsPage (HU-096/HU-097): formulario
 * condicional para sí mismo/otra persona (CA-096-01), campos obligatorios
 * y opcionales (CA-096-02), validación con conservación de datos ante
 * error (CA-096-03), resumen local antes de confirmar, confirmación
 * pública real (éxito, conflicto con alternativas, red, doble toque
 * bloqueado, CA-097-01 a CA-097-07) y ausencia de violaciones de
 * accesibilidad (CA-096-06). confirmPublicAppointmentApi se sustituye por
 * un doble de prueba; la persistencia real vive en las pruebas de backend
 * (publicbooking/confirm_test.go, booking/postgres/public_repository_test.go).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { bookingChromeKey } from '../../model/bookingChrome'

const confirmPublicAppointmentMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/confirmPublicAppointmentApi', () => ({
  confirmPublicAppointment: confirmPublicAppointmentMock,
}))

const routerPushMock = vi.hoisted(() => vi.fn())
const routerReplaceMock = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
}))

const listPublicProfessionalsMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/listPublicProfessionalsApi', () => ({
  listPublicProfessionals: listPublicProfessionalsMock,
}))

const loadPublicProfileMock = vi.hoisted(() => vi.fn())
vi.mock('../../model/publicProfile', () => ({
  loadPublicProfile: loadPublicProfileMock,
  publicTermsFor: () => null,
}))

const loadPublicServicesMock = vi.hoisted(() => vi.fn())
vi.mock('../../model/publicServices', () => ({ loadPublicServices: loadPublicServicesMock }))

const { default: PublicCustomerDetailsPage } = await import('../PublicCustomerDetailsPage.vue')

const BASE_PROPS = {
  slug: 'barberia-ejemplo',
  serviceId: '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4',
  professionalId: 'a1111111-1111-1111-1111-111111111111',
  startsAt: '2026-09-20T14:30:00Z',
}

const CONFIRMED_APPOINTMENT = {
  attendeeName: 'Ana Ríos',
  businessName: 'Barbería Ejemplo',
  serviceName: 'Corte clásico',
  durationMinutes: 30,
  priceAmount: '20000.00',
  currency: 'COP',
  startsAt: '2026-09-20T14:30:00Z',
  endsAt: '2026-09-20T15:00:00Z',
  timezone: 'America/Bogota',
  accessToken: 'abc123',
  customerNote: null,
}

function profileOutcome(
  offersHomeService: boolean,
  location: { address: string; latitude: number; longitude: number } | null = null,
) {
  return {
    kind: 'success',
    profile: {
      name: 'Barbería Ejemplo',
      timezone: 'America/Bogota',
      contactEmail: null,
      contactPhone: null,
      vocabulary: { professional: 'Barbero', service: 'Servicio', appointment: 'Turno' },
      location,
      offersHomeService,
    },
  }
}

function mountPage(options: { attachTo?: HTMLElement } = {}) {
  return mount(PublicCustomerDetailsPage, { props: BASE_PROPS, ...options })
}

beforeEach(() => {
  // jsdom no implementa scrollTo; al confirmar, la página sube al momento.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  // El diálogo de conflicto se teletransporta al <body>: sin limpiarlo, los de
  // pruebas anteriores se acumulan.
  document.body.innerHTML = ''
  confirmPublicAppointmentMock.mockReset()
  routerPushMock.mockReset()
  routerReplaceMock.mockReset()
  sessionStorage.clear()
  listPublicProfessionalsMock.mockReset()
  loadPublicProfileMock.mockReset()
  loadPublicProfileMock.mockResolvedValue(profileOutcome(false))
  loadPublicServicesMock.mockReset()
  loadPublicServicesMock.mockResolvedValue({
    kind: 'success',
    services: [
      {
        id: BASE_PROPS.serviceId,
        name: 'Corte clásico',
        description: null,
        durationMinutes: 30,
        price: '20000.00',
        currency: 'COP',
      },
    ],
  })
  listPublicProfessionalsMock.mockResolvedValue({
    kind: 'success',
    professionals: [
      {
        id: BASE_PROPS.professionalId,
        fullName: 'Mateo Cruz',
        description: null,
        photoUpdatedAt: '2026-10-01T10:00:00Z',
      },
    ],
  })
})

async function fillValidForm(wrapper: ReturnType<typeof mountPage>) {
  // Por autocomplete y no por tipo: con el paso a domicilio abierto, el combobox de la
  // dirección también es type="text".
  await wrapper.find('input[autocomplete="name"]').setValue('Ana Ríos')
  await wrapper.find('input[type="tel"]').setValue('+573001234567')
  await wrapper.find('input[type="email"]').setValue('ana@example.com')
}

describe('PublicCustomerDetailsPage', () => {
  it('shows required-field errors and preserves entered data on an invalid attempt (CA-096-02, CA-096-03)', async () => {
    const wrapper = mountPage()
    await wrapper.find('input[type="text"]').setValue('Ana Ríos')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('El teléfono es obligatorio.')
    expect(wrapper.text()).toContain('El correo es obligatorio.')
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('Ana Ríos')
  })

  it('derives the attendee name from the customer without asking twice when booking for self (CA-096-01)', async () => {
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    // "Para mí" nunca pide un segundo nombre: un solo campo de texto en el
    // formulario (el nombre del cliente).
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1)

    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('Ana Ríos')
    // Para uno mismo el resumen no repite el nombre como «Turno para».
    const labels = wrapper.findAll('.customer-details__summary-row dt').map((dt) => dt.text())
    expect(labels).toEqual(['Cliente', 'Teléfono', 'Correo'])
    expect(wrapper.text()).not.toContain('Atiende a')
  })

  it('heads the summary with the appointment card, still to be confirmed (DEC-189)', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    // Sin caja alrededor: la tarjeta sola y el título es la revisión.
    expect(wrapper.get('h1').text()).toBe('Revisa tus datos')
    expect(wrapper.classes()).toContain('bk-details--review')
    expect(wrapper.find('h2').exists()).toBe(false)
    const ticket = wrapper.get('.customer-details__ticket')
    expect(ticket.classes()).toContain('appointment-ticket--draft')
    expect(ticket.attributes('aria-label')).toBe('Tu turno, por confirmar')
    expect(ticket.text()).toContain('Corte clásico')
    expect(ticket.text()).toMatch(/30 min · \$\s?20\.000/)
    // 14:30 UTC son las 9:30 a. m. en Bogotá; el 20 de septiembre de 2026 es domingo.
    expect(ticket.get('.appointment-ticket__time').text()).toMatch(/^9:30\s?a\.\s?m\.$/)
    expect(ticket.get('.appointment-ticket__weekday').text()).toBe('Domingo')
    expect(ticket.get('.appointment-ticket__pending').text()).toBe('Por confirmar')
    expect(ticket.find('.appointment-ticket__seal').exists()).toBe(false)
  })

  it('shows the chosen professional with their photo in the summary', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    const who = wrapper.get('.customer-details__ticket .appointment-ticket__foot')
    expect(who.text()).toContain('Mateo Cruz')
    expect(who.get('img').attributes('src')).toContain(
      `/public/businesses/barberia-ejemplo/professionals/${BASE_PROPS.professionalId}/photo`,
    )
  })

  it('still shows a complete summary when the professional cannot be loaded', async () => {
    listPublicProfessionalsMock.mockResolvedValue({ kind: 'network-error' })
    const wrapper = mountPage()
    await flushPromises()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    expect(wrapper.find('.appointment-ticket__foot').exists()).toBe(false)
    expect(wrapper.text()).toContain('Ana Ríos')
  })

  it('tells the customer, before confirming, that Google may invite them at their email (DEC-122)', async () => {
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    expect(wrapper.find('.customer-details__invite-note').exists()).toBe(false)

    await wrapper.find('form').trigger('submit')

    const note = wrapper.get('.customer-details__invite-note')
    expect(note.text()).toContain('Si el negocio usa Google Calendar')
    expect(note.text()).toContain('recibirás una invitación')
    // Condicional: nunca promete una invitación que el negocio quizá no envíe.
    expect(note.text()).not.toMatch(/^Recibirás/)
    expect(note.get('strong').text()).not.toBe('')
  })

  it('requires a non-empty attendee name when booking for someone else (CA-096-01)', async () => {
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.findAll('input[type="radio"]')[1]!.setValue()

    expect(wrapper.findAll('input[type="text"]')).toHaveLength(2)

    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('El nombre de la persona atendida es obligatorio.')

    const attendeeInput = wrapper.findAll('input[type="text"]')[1]!
    await attendeeInput.setValue('Mateo Ruiz')
    await wrapper.find('form').trigger('submit')

    const rows = wrapper.findAll('.customer-details__summary-row')
    const attendedRow = rows.find((row) => row.text().includes('Turno para'))!
    expect(attendedRow.text()).toContain('Mateo Ruiz')
    const clientRow = rows.find((row) => row.text().includes('Cliente'))!
    expect(clientRow.text()).toContain('Ana Ríos')
  })

  it('sends the E.164 number built from the prefix box and the national number', async () => {
    confirmPublicAppointmentMock.mockResolvedValue({
      kind: 'success',
      appointment: CONFIRMED_APPOINTMENT,
    })
    const wrapper = mountPage()
    await wrapper.find('input[type="text"]').setValue('Ana Ríos')
    await wrapper.find('select').setValue('MX')
    await wrapper.find('input[type="tel"]').setValue('55 1234 5678')
    await wrapper.find('input[type="email"]').setValue('ana@example.com')
    await wrapper.find('form').trigger('submit')

    // Lo escrito se respeta (con espacios); al API viaja solo el E.164.
    expect(wrapper.text()).toContain('+52 55 1234 5678')

    await wrapper.findAll('button[type="button"]')[1]!.trigger('click')
    await flushPromises()

    expect(confirmPublicAppointmentMock.mock.calls[0]![3].phone).toBe('+525512345678')
  })

  it('keeps the note box at a fixed size', () => {
    const wrapper = mountPage()
    const note = wrapper.get('textarea')

    expect(note.attributes('rows')).toBe('3')
  })

  it('keeps «Tu cita» in view while filling the form, with dot leaders (#747)', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const pase = wrapper.get('aside.bk-details__pase')
    expect(pase.attributes('aria-label')).toBe('Tu cita')
    // La línea compacta del teléfono y el riel de escritorio dicen lo mismo.
    expect(pase.get('.bk-details__pase-line').text()).toMatch(/Corte clásico.*9:30\sa\.\sm\./)
    const rows = pase.findAll('.bk-leaders__row')
    expect(rows.map((r) => r.get('dt').text())).toEqual([
      'Corte clásico',
      'Profesional',
      'Día',
      'Hora',
    ])
    expect(rows[0]!.get('dd').text()).toMatch(/20\.000/)
    expect(rows[1]!.get('dd').text()).toBe('Mateo Cruz')
    // Sin el año: cabe en el riel.
    expect(rows[2]!.get('dd').text()).toBe('domingo, 20 de septiembre')
    expect(rows[3]!.get('dd').text()).toMatch(/^9:30\sa\.\sm\. – 10:00\sa\.\sm\.$/)
  })

  it('drops the rail on the summary, where the card already says it, and uses leaders (#747)', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.bk-details__pase').exists()).toBe(false)
    const rows = wrapper.findAll('.customer-details__summary-row')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.classes()).toContain('bk-leaders__row')
  })

  it('lets the customer go back to editing without losing the data already entered', async () => {
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('form').exists()).toBe(false)

    await wrapper.find('button[type="button"]').trigger('click')
    expect(wrapper.find('form').exists()).toBe(true)
    // El prefijo vive en su casilla: al volver a editar, el teléfono sigue
    // partido en país y número nacional.
    expect((wrapper.find('input[type="tel"]').element as HTMLInputElement).value).toBe('3001234567')
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('CO')
  })

  it('rejects an invalid phone/email format', async () => {
    const wrapper = mountPage()
    await wrapper.find('input[type="text"]').setValue('Ana Ríos')
    await wrapper.find('input[type="tel"]').setValue('123')
    await wrapper.find('input[type="email"]').setValue('no-arroba')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.text()).toContain('no parece completo')
    expect(wrapper.text()).toContain('formato inválido')
  })

  it('has no accessibility violations on the form', async () => {
    const wrapper = mountPage()
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })

  it('has no accessibility violations on the form with attempted errors', async () => {
    const wrapper = mountPage()
    await wrapper.find('form').trigger('submit')
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })

  it('tells the shell the booking is complete only once the server confirms it (DEC-111)', async () => {
    const completed = ref(false)
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: CONFIRMED_APPOINTMENT,
    })
    const wrapper = mount(PublicCustomerDetailsPage, {
      props: BASE_PROPS,
      global: { provide: { [bookingChromeKey as symbol]: { completed } } },
    })
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    // Revisar el resumen todavía no es una reserva: el progreso sigue en el paso.
    expect(completed.value).toBe(false)

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
      .trigger('click')
    await flushPromises()

    expect(completed.value).toBe(true)
    // El momento sobre la tarjeta: el rombo emblema y «Todo listo» (DEC-189).
    expect(wrapper.find('.bk-done__emblem').exists()).toBe(true)
    expect(wrapper.get('h1 .bk-done__moment').text()).toBe('Todo listo')
    expect(wrapper.get('h1 .bk-done__headline').text()).toBe('Tu turno quedó agendado')
  })

  it('does not complete the shell on a schedule conflict (DEC-111)', async () => {
    const completed = ref(false)
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'schedule-conflict',
      alternatives: [{ startsAt: '2026-09-20T15:00:00Z' }],
    })
    const wrapper = mount(PublicCustomerDetailsPage, {
      props: BASE_PROPS,
      global: { provide: { [bookingChromeKey as symbol]: { completed } } },
    })
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
      .trigger('click')
    await flushPromises()

    expect(completed.value).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Revisa tus datos')
  })

  it('has no accessibility violations on the summary', async () => {
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })

  it('announces the summary briefly instead of reading the whole card (#739)', async () => {
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    const summary = wrapper.get('.customer-details__summary')
    // La tarjeta es una región con nombre, no una región viva.
    expect(summary.attributes('role')).toBe('region')
    expect(summary.attributes('aria-label')).toBe('Resumen de tu turno')
    expect(summary.element.closest('[role="status"]')).toBeNull()
    // El anuncio es una frase corta y no contiene la tarjeta.
    const status = summary.get('[role="status"]')
    expect(status.text()).toBe('Revisa tus datos antes de confirmar.')
    expect(status.find('.customer-details__ticket').exists()).toBe(false)
  })

  it('confirms the appointment and shows the server confirmation (CA-097-01, CA-097-07)', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: CONFIRMED_APPOINTMENT,
    })
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    const confirmButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
    await confirmButton.trigger('click')
    await flushPromises()

    expect(confirmPublicAppointmentMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Tu turno quedó agendado')
    expect(wrapper.text()).toContain('Barbería Ejemplo')
    expect(wrapper.find('form').exists()).toBe(false)
    // El token en claro nunca se muestra en pantalla (DEC-089): solo viaja
    // por el correo de confirmación.
    expect(wrapper.text()).not.toContain('abc123')
  })

  it('blocks a second tap while the first confirmation is in flight (CA-097-07)', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    confirmPublicAppointmentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    const confirmButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
    await confirmButton.trigger('click')
    await confirmButton.trigger('click')
    await confirmButton.trigger('click')

    expect(confirmPublicAppointmentMock).toHaveBeenCalledTimes(1)
    resolveFirst({ kind: 'success', appointment: CONFIRMED_APPOINTMENT })
    await flushPromises()
  })

  // El diálogo de conflicto se teletransporta al <body>: se consulta ahí.
  const conflictDialog = () => document.body.querySelector<HTMLElement>('.pb-conflict-dialog')
  const isConflictOpen = () => !!conflictDialog()?.closest('.base-dialog__overlay--open')

  async function reachConflict(wrapper: ReturnType<typeof mountPage>) {
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
      .trigger('click')
    await flushPromises()
  }

  it('opens a blocking dialog on a schedule conflict and lets the customer retry with an alternative (RN-CON-05, DEC-090)', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'schedule-conflict',
      alternatives: [{ startsAt: '2026-09-20T15:00:00Z' }, { startsAt: '2026-09-20T15:30:00Z' }],
    })
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: CONFIRMED_APPOINTMENT,
    })
    const wrapper = mountPage()
    await reachConflict(wrapper)

    expect(isConflictOpen()).toBe(true)
    expect(conflictDialog()!.getAttribute('role')).toBe('dialog')
    expect(conflictDialog()!.textContent).toContain('Ese horario se acaba de ocupar')
    // F-RQ-03 (#444): la franja pudo quedar bloqueada y no reservada; no se atribuye a nadie.
    expect(conflictDialog()!.textContent).toContain('ya no están disponibles')
    expect(conflictDialog()!.textContent).not.toContain('Alguien reservó')
    // Sin salida lateral: ni botón de cerrar, y el aviso ya no vive en la hoja.
    expect(conflictDialog()!.querySelector('.base-dialog__close')).toBeNull()
    expect(wrapper.find('.base-alert').exists()).toBe(false)
    // Los datos del formulario nunca se pierden ante el conflicto (RN-CON-05).
    expect(wrapper.text()).toContain('+57 3001234567')

    const alternativeButtons =
      conflictDialog()!.querySelectorAll<HTMLButtonElement>('.pb-conflict__alt')
    expect(alternativeButtons.length).toBe(2)
    alternativeButtons[0]!.click()
    await flushPromises()

    // Elegir una alternativa cierra el diálogo y exige confirmar de nuevo.
    expect(isConflictOpen()).toBe(false)
    expect(confirmPublicAppointmentMock).toHaveBeenCalledTimes(1)

    const retryButton = wrapper.findAll('button').find((b) => b.text().includes('Confirmar turno'))!
    await retryButton.trigger('click')
    await flushPromises()

    expect(confirmPublicAppointmentMock).toHaveBeenCalledTimes(2)
    // El reintento con una alternativa distinta usa una clave de
    // idempotencia nueva (RN-IDE-01): el contenido cambió (otro startsAt).
    const firstKey = confirmPublicAppointmentMock.mock.calls[0]![4]
    const secondKey = confirmPublicAppointmentMock.mock.calls[1]![4]
    expect(secondKey).not.toBe(firstKey)
    expect(wrapper.text()).toContain('Tu turno quedó agendado')
    wrapper.unmount()
  })

  it('groups the free times by day as time pills named with their day (#794)', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'schedule-conflict',
      // Desordenadas y en dos días: se ordenan y el día va una vez por grupo.
      alternatives: [
        { startsAt: '2026-09-21T14:00:00Z' },
        { startsAt: '2026-09-20T15:30:00Z' },
        { startsAt: '2026-09-20T15:00:00Z' },
      ],
    })
    const wrapper = mountPage()
    await reachConflict(wrapper)

    const days = [...conflictDialog()!.querySelectorAll('.pb-conflict__day')]
    expect(days).toHaveLength(2)
    expect(days.map((d) => d.querySelectorAll('.pb-conflict__alt').length)).toEqual([2, 1])
    const firstDay = days[0]!.querySelector('.pb-conflict__day-label')!
    // El rótulo es visual: el día ya va en el nombre de cada píldora.
    expect(firstDay.getAttribute('aria-hidden')).toBe('true')
    const pills = [...conflictDialog()!.querySelectorAll<HTMLButtonElement>('.pb-conflict__alt')]
    // La píldora muestra solo la hora; su nombre empieza por ese mismo texto (2.5.3).
    for (const pill of pills) {
      const time = pill.textContent!.trim()
      expect(time).not.toContain(firstDay.textContent!.trim())
      expect(pill.getAttribute('aria-label')!.startsWith(`${time}, `)).toBe(true)
    }
    expect(pills[0]!.getAttribute('aria-label')).toContain(firstDay.textContent!.trim())
    // El rótulo de la lista ya no usa el tono de error.
    expect(conflictDialog()!.querySelector('.pb-conflict__label')!.textContent).toBe(
      'Estas horas siguen libres',
    )
    wrapper.unmount()
  })

  it('sends the customer back to the calendar from the conflict dialog', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'schedule-conflict',
      alternatives: [],
    })
    const wrapper = mountPage()
    await reachConflict(wrapper)

    expect(conflictDialog()!.textContent).toContain('No quedan horarios libres')
    expect(conflictDialog()!.querySelector('.pb-conflict__alt')).toBeNull()
    conflictDialog()!.querySelector<HTMLButtonElement>('.base-dialog__footer button')!.click()

    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'reserva-publica-horario',
      params: { slug: BASE_PROPS.slug, serviceId: BASE_PROPS.serviceId },
      query: { profesional: BASE_PROPS.professionalId },
    })
    wrapper.unmount()
  })

  it('shows a network error and lets the customer retry with the same idempotency key', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: CONFIRMED_APPOINTMENT,
    })
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    const confirmButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
    await confirmButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar con el servidor')
    expect(wrapper.find('form').exists()).toBe(false)
    // F-RQ-01 (#429): el aviso va fuera de la región desplazable del resumen, junto a los
    // botones; dentro quedaba bajo su borde visible y no se veía.
    const alert = wrapper.get('.customer-details__summary [role="alert"]')
    expect(alert.element.closest('.customer-details__summary-body')).toBeNull()
    // #794: aviso de la familia (rombo y titular serif), no la caja genérica «Error».
    expect(alert.classes()).toContain('customer-details__notice')
    expect(alert.get('.customer-details__notice-title').text()).toBe(
      'No pudimos confirmar tu turno',
    )
    expect(alert.get('.customer-details__notice-mark').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.base-alert').exists()).toBe(false)

    await confirmButton.trigger('click')
    await flushPromises()

    expect(confirmPublicAppointmentMock).toHaveBeenCalledTimes(2)
    const firstKey = confirmPublicAppointmentMock.mock.calls[0]![4]
    const secondKey = confirmPublicAppointmentMock.mock.calls[1]![4]
    expect(secondKey).toBe(firstKey)
    expect(wrapper.text()).toContain('Tu turno quedó agendado')
  })

  it('gives the focus back to «Confirmar turno» after a failure so the retry works by keyboard (F-RQ-01)', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPage({ attachTo: document.body })
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
      .trigger('click')
    await flushPromises()

    expect(document.activeElement?.textContent).toContain('Confirmar turno')
    wrapper.unmount()
  })

  it('has no accessibility violations on the schedule-conflict dialog', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'schedule-conflict',
      alternatives: [{ startsAt: '2026-09-20T15:00:00Z' }],
    })
    const wrapper = mountPage()
    await reachConflict(wrapper)

    const results = await axe(conflictDialog()!)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  async function confirmWith(
    appointment = CONFIRMED_APPOINTMENT,
    prepare?: (w: ReturnType<typeof mountPage>) => Promise<void>,
    attach = false,
  ) {
    confirmPublicAppointmentMock.mockResolvedValueOnce({ kind: 'success', appointment })
    const wrapper = mountPage(attach ? { attachTo: document.body } : {})
    await flushPromises()
    await fillValidForm(wrapper)
    if (prepare) await prepare(wrapper)
    await wrapper.find('form').trigger('submit')
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
      .trigger('click')
    await flushPromises()
    return wrapper
  }

  it('on confirm, goes to the top and focuses the title so the moment is seen (DEC-189)', async () => {
    const scrollTo = vi.mocked(window.scrollTo)
    const wrapper = await confirmWith(CONFIRMED_APPOINTMENT, async () => undefined, true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    expect(document.activeElement).toBe(wrapper.get('h1').element)
    // Un anuncio corto: no un role="status" que envuelva toda la tarjeta.
    expect(wrapper.get('.bk-done [role="status"]').text()).toBe('Turno confirmado')
    expect(wrapper.find('.bk-done__ticket').element.closest('[role="status"]')).toBeNull()
    wrapper.unmount()
  })

  it('shows the card, now confirmed, in the business time zone and without the access token', async () => {
    const wrapper = await confirmWith()
    const ticket = wrapper.get('.bk-done__ticket')
    expect(ticket.classes()).toContain('appointment-ticket--confirmed')
    expect(ticket.get('.appointment-ticket__seal').text()).toBe('Confirmado')
    expect(ticket.text()).toContain('Barbería Ejemplo')
    expect(ticket.text()).toContain('Corte clásico')
    expect(ticket.text()).toMatch(/20\.000/)
    expect(ticket.get('.appointment-ticket__foot').text()).toContain('Mateo Cruz')
    // 14:30 UTC son las 9:30 a. m. en Bogotá, sea cual sea la zona del navegador.
    expect(ticket.get('.appointment-ticket__time').text()).toMatch(/^9:30\s?a\.\s?m\.$/)
    expect(ticket.get('.appointment-ticket__note').text()).toMatch(/^hasta 10:00\s?a\.\s?m\./)
    expect(ticket.get('.appointment-ticket__leaf').text()).toContain('20')
    expect(ticket.text()).not.toContain('Turno para')
    // La ceremonia, una sola vez: al confirmar en esta visita.
    expect(ticket.classes()).toContain('appointment-ticket--ceremony')
    // La credencial nunca se dibuja (DEC-089).
    expect(wrapper.html()).not.toContain(CONFIRMED_APPOINTMENT.accessToken)
    expect(wrapper.text()).toContain('ana@example.com')
  })

  it('lays the card on the day ruler: the published hours, or a plain 7 a. m. to 7 p. m. day', async () => {
    const plain = (await confirmWith()).get('.bk-done__ticket .day-ruler')
    expect(plain.findAll('.day-ruler__numeral')[0]!.text()).toBe('7a. m.')
    expect(plain.find('.day-ruler__mark--mine').exists()).toBe(true)

    loadPublicProfileMock.mockResolvedValue({
      ...profileOutcome(false),
      profile: {
        ...profileOutcome(false).profile,
        openingHours: [{ dayOfWeek: 'SUNDAY', opens: '08:00', closes: '14:00' }],
      },
    })
    const withHours = (await confirmWith()).get('.bk-done__ticket .day-ruler')
    expect(withHours.findAll('.day-ruler__numeral')[0]!.text()).toBe('8a. m.')
    expect(withHours.findAll('.day-ruler__numeral').at(-1)!.text()).toBe('2p. m.')
  })

  it('downloads an .ics built in the browser, without the access token', async () => {
    const created: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return 'blob:turno'
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const wrapper = await confirmWith()
    await wrapper.get('.bk-done__calendar').trigger('click')

    expect(click).toHaveBeenCalled()
    // jsdom no implementa Blob.text(): se lee con FileReader.
    const ics = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(created[0]!)
    })
    expect(ics).toContain('DTSTART:20260920T143000Z')
    expect(ics).toContain('SUMMARY:Corte clásico\\, Barbería Ejemplo')
    expect(ics).not.toContain(CONFIRMED_APPOINTMENT.accessToken)
    expect(wrapper.get('.bk-done__calendar').text()).toContain('Descargado')
    click.mockRestore()
  })

  it('offers WhatsApp only when the business has a number', async () => {
    expect((await confirmWith()).find('.bk-done__whatsapp').exists()).toBe(false)

    loadPublicProfileMock.mockResolvedValue({
      ...profileOutcome(false),
      profile: { ...profileOutcome(false).profile, contactPhone: '+573001234567' },
    })
    const link = (await confirmWith()).get('.bk-done__whatsapp')
    expect(link.attributes('href')).toMatch(/^https:\/\/wa\.me\/573001234567\?text=Hola/)
    expect(link.attributes('rel')).toContain('noopener')
    // La frase no acaba en la hora: nunca «a. m..».
    const text = new URL(link.attributes('href')!).searchParams.get('text')!
    expect(text).toMatch(/^Hola, reservé Corte clásico a las 9:30\sa\.\sm\. del .+2026\.$/)
    expect(text).not.toContain('..')
  })

  it('offers WhatsApp as a secondary button next to the calendar (#747)', async () => {
    loadPublicProfileMock.mockResolvedValue({
      ...profileOutcome(false),
      profile: { ...profileOutcome(false).profile, contactPhone: '+573001234567' },
    })
    const wrapper = await confirmWith()
    const link = wrapper.get('.bk-done__actions .bk-done__whatsapp')
    expect(link.classes()).toEqual(expect.arrayContaining(['bk-cta', 'bk-cta--secondary']))
    expect(wrapper.get('.bk-done__actions .bk-done__calendar').classes()).not.toContain(
      'bk-cta--secondary',
    )
  })

  it('says on the confirmed card how far away the turn is (#747)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Una semana antes del turno del 20 de septiembre, en Bogotá.
    vi.setSystemTime(new Date('2026-09-13T15:00:00Z'))
    try {
      const wrapper = await confirmWith()
      expect(wrapper.get('.bk-done__ticket .appointment-ticket__relative').text()).toBe('en 7 días')
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits the relative chip once the turn is in the past (#747)', async () => {
    // El turno del fixture (septiembre de 2026) ya pasó frente al reloj real.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-21T15:00:00Z'))
    try {
      const wrapper = await confirmWith()
      expect(wrapper.find('.bk-done__ticket .appointment-ticket__relative').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says where: the business address with directions, or the home address', async () => {
    loadPublicProfileMock.mockResolvedValue(
      profileOutcome(false, {
        address: 'Calle 10 # 40-20, Medellín',
        latitude: 6.2,
        longitude: -75.5,
      }),
    )
    const place = (await confirmWith()).get('.bk-done__place')
    expect(place.text()).toContain('Calle 10 # 40-20, Medellín')
    expect(place.get('a').attributes('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=6.2,-75.5',
    )
  })

  describe('recargar la confirmación (revisión de #707)', () => {
    it('moves the URL to the confirmation and keeps the visit in this tab, without the token', async () => {
      await confirmWith()
      expect(routerReplaceMock).toHaveBeenCalledWith({
        name: 'reserva-publica-cliente',
        params: { ...BASE_PROPS },
        query: { confirmado: '1' },
      })
      const stored = Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)!)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toContain('Corte clásico')
      expect(stored[0]).not.toContain(CONFIRMED_APPOINTMENT.accessToken)
      expect(stored[0]).not.toContain('ana@example.com')
    })

    it('keeps «Cualquiera» in the confirmation URL', async () => {
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const wrapper = mount(PublicCustomerDetailsPage, {
        props: { ...BASE_PROPS, anyProfessional: true },
      })
      await flushPromises()
      await fillValidForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Confirmar turno'))!
        .trigger('click')
      await flushPromises()
      expect(routerReplaceMock.mock.calls[0]![0].query).toEqual({
        cualquiera: '1',
        confirmado: '1',
      })
    })

    it('after a reload, redraws the confirmation and never offers the form again', async () => {
      await confirmWith()
      const reloaded = mount(PublicCustomerDetailsPage, {
        props: { ...BASE_PROPS, confirmed: true },
      })
      await flushPromises()
      expect(reloaded.find('form').exists()).toBe(false)
      expect(reloaded.get('h1 .bk-done__headline').text()).toBe('Tu turno quedó agendado')
      expect(reloaded.classes()).not.toContain('bk-details--ceremony')
      expect(reloaded.get('.bk-done__ticket').text()).toContain('Corte clásico')
      expect(reloaded.get('.appointment-ticket__time').text()).toMatch(/^9:30/)
      // Al recargar, la tarjeta ya está quieta: sin ceremonia.
      expect(reloaded.get('.bk-done__ticket').classes()).not.toContain(
        'appointment-ticket--ceremony',
      )
      expect(reloaded.text()).toContain('En tu correo está el enlace')
      expect(confirmPublicAppointmentMock).toHaveBeenCalledTimes(1)
    })

    it('without anything stored, still says the turn is booked and hides the form', async () => {
      const reloaded = mount(PublicCustomerDetailsPage, {
        props: { ...BASE_PROPS, confirmed: true },
      })
      await flushPromises()
      expect(reloaded.find('form').exists()).toBe(false)
      expect(reloaded.find('.bk-done__ticket').exists()).toBe(false)
      expect(reloaded.text()).toContain('Este turno ya quedó reservado')
      const results = await axe(reloaded.element)
      expect(results).toHaveNoViolations()
    })
  })

  it('names the attendee on the card only when the turn is for someone else', async () => {
    const wrapper = await confirmWith(
      { ...CONFIRMED_APPOINTMENT, attendeeName: 'Mateo Ruiz' },
      async (w) => {
        await w.findAll('input[type="radio"]')[1]!.setValue()
        await w.findAll('input[type="text"]')[1]!.setValue('Mateo Ruiz')
      },
    )
    expect(wrapper.get('.bk-done__ticket').text()).toContain('Turno para Mateo Ruiz')
  })

  it('checks a field when the customer leaves it, keeps what was typed, and never scolds an untouched one', async () => {
    const wrapper = mountPage()
    const email = wrapper.get('input[type="email"]')
    // Pasar por un campo vacío no muestra nada.
    await email.trigger('blur')
    expect(wrapper.text()).not.toContain('El correo es obligatorio.')

    await email.setValue('ana@')
    await email.trigger('blur')
    expect(wrapper.text()).toContain('El correo tiene un formato inválido.')
    expect((email.element as HTMLInputElement).value).toBe('ana@')
    // El mensaje sigue la escritura y se va al corregir.
    await email.setValue('ana@example.com')
    expect(wrapper.text()).not.toContain('El correo tiene un formato inválido.')

    const tel = wrapper.get('input[type="tel"]')
    await tel.setValue('300 12')
    await tel.trigger('blur')
    expect(wrapper.text()).toContain('El número no parece completo')
    expect((tel.element as HTMLInputElement).value).toBe('300 12')
  })

  it('has no accessibility violations on the confirmed state', async () => {
    confirmPublicAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      appointment: CONFIRMED_APPOINTMENT,
    })
    const wrapper = mountPage()
    await fillValidForm(wrapper)
    await wrapper.find('form').trigger('submit')
    const confirmButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Confirmar turno'))!
    await confirmButton.trigger('click')
    await flushPromises()

    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })
  describe('servicio a domicilio (DEC-131, HU-103)', () => {
    async function mountOffering() {
      loadPublicProfileMock.mockResolvedValue(profileOutcome(true))
      const wrapper = mountPage()
      await flushPromises()
      return wrapper
    }

    // Marca el punto moviendo el mapa simulado (el pin va al centro, DEC-138).
    async function markOnMap(wrapper: Awaited<ReturnType<typeof mountOffering>>) {
      await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
      await flushPromises()
      await wrapper.get('button[aria-label="Mover el mapa al norte"]').trigger('click')
      await flushPromises()
    }

    it('does not offer the modality when the business does not serve at home (CA-103-01)', async () => {
      const wrapper = mountPage()
      await flushPromises()
      expect(wrapper.find('input[name="service-mode"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('A domicilio')
    })

    it('offers local/home when enabled and defaults to the shop (CA-103-01)', async () => {
      const wrapper = await mountOffering()
      const local = wrapper.get('input[name="service-mode"][value="local"]')
      expect((local.element as HTMLInputElement).checked).toBe(true)
      expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
    })

    it('requires a marked location before reviewing: the details alone are not one (CA-103-02, DEC-155)', async () => {
      const wrapper = await mountOffering()
      await fillValidForm(wrapper)
      await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
      await flushPromises()
      await wrapper.get('input[type="text"][maxlength="80"]').setValue('Torre 2, apto 304')
      await wrapper.find('form').trigger('submit')

      expect(wrapper.text()).toContain('Marca tu ubicación en el mapa')
      expect(wrapper.text()).not.toContain('Confirmar turno')
    })

    it('no longer offers to search an address (DEC-155)', async () => {
      const wrapper = await mountOffering()
      await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
      await flushPromises()
      expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Busca tu dirección')
      expect(wrapper.text()).toContain('Detalles de la dirección')
    })

    it('lets the customer mark the location by moving the map, with no address typed (CA-138-01)', async () => {
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const wrapper = await mountOffering()
      await fillValidForm(wrapper)
      await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
      await flushPromises()
      await wrapper.get('button[aria-label="Mover el mapa al norte"]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Ubicación marcada:')

      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Te atendemos en')
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Confirmar turno'))!
        .trigger('click')
      await flushPromises()

      const input = confirmPublicAppointmentMock.mock.calls[0]![3]
      expect(input.homeService).toMatchObject({ latitude: 4.712, longitude: -74.0721 })
      expect(input.homeService.address).toContain('Punto marcado cerca de')
    })

    it('opens the map on the business when it published a location', async () => {
      loadPublicProfileMock.mockResolvedValue(
        profileOutcome(true, { address: 'Calle 1', latitude: 6.2442, longitude: -75.5812 }),
      )
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const wrapper = mountPage()
      await flushPromises()
      await fillValidForm(wrapper)
      await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
      await flushPromises()
      await wrapper.get('button[aria-label="Mover el mapa al este"]').trigger('click')
      await flushPromises()
      await wrapper.find('form').trigger('submit')
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Confirmar turno'))!
        .trigger('click')
      await flushPromises()

      expect(confirmPublicAppointmentMock.mock.calls[0]![3].homeService).toMatchObject({
        latitude: 6.2442,
        longitude: -75.5802,
      })
    })

    it('detects the device location on choosing home and sends it without touching the map (DEC-155)', async () => {
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const getCurrentPosition = vi.fn((ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 4.65, longitude: -74.06, accuracy: 20 } }),
      )
      Object.defineProperty(navigator, 'geolocation', {
        value: { getCurrentPosition },
        configurable: true,
      })
      try {
        const wrapper = await mountOffering()
        await fillValidForm(wrapper)
        // Aún en el local: el navegador no recibe ninguna petición de ubicación.
        expect(getCurrentPosition).not.toHaveBeenCalled()
        await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
        await flushPromises()
        expect(getCurrentPosition).toHaveBeenCalledTimes(1)
        expect(wrapper.text()).toContain('Ubicación marcada:')

        await wrapper.find('form').trigger('submit')
        await wrapper
          .findAll('button')
          .find((b) => b.text().includes('Confirmar turno'))!
          .trigger('click')
        await flushPromises()

        expect(confirmPublicAppointmentMock.mock.calls[0]![3].homeService).toMatchObject({
          latitude: 4.65,
          longitude: -74.06,
        })
      } finally {
        Reflect.deleteProperty(navigator, 'geolocation')
      }
    })

    it('keeps the button to detect again and marks nothing when the permission is denied (CA-138-04)', async () => {
      const getCurrentPosition = vi.fn((_ok: unknown, fail: (e: { code: number }) => void) =>
        fail({ code: 1 }),
      )
      Object.defineProperty(navigator, 'geolocation', {
        value: { getCurrentPosition },
        configurable: true,
      })
      try {
        const wrapper = await mountOffering()
        await fillValidForm(wrapper)
        await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
        await flushPromises()
        expect(wrapper.text()).toContain('No tenemos permiso para ver tu ubicación')
        expect(wrapper.text()).not.toContain('Ubicación marcada:')

        await wrapper.find('form').trigger('submit')
        expect(wrapper.text()).toContain('Marca tu ubicación en el mapa')
        expect(wrapper.text()).not.toContain('Confirmar turno')
        expect(wrapper.findAll('button').some((b) => b.text().includes('Usar mi ubicación'))).toBe(
          true,
        )
      } finally {
        Reflect.deleteProperty(navigator, 'geolocation')
      }
    })

    it('sends the details before the address, with the coordinates, and shows them in the summary (CA-103-03, DEC-155)', async () => {
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const wrapper = await mountOffering()
      await markOnMap(wrapper)
      await wrapper.get('input[type="text"][maxlength="80"]').setValue('  Torre 2,  apto 304 ')
      await fillValidForm(wrapper)
      await wrapper.find('form').trigger('submit')

      expect(wrapper.text()).toContain('Te atendemos en')
      expect(wrapper.text()).toContain('Torre 2, apto 304 · Punto marcado cerca de')

      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Confirmar turno'))!
        .trigger('click')
      await flushPromises()

      const input = confirmPublicAppointmentMock.mock.calls[0]![3]
      expect(input.homeService).toMatchObject({ latitude: 4.712, longitude: -74.0721 })
      expect(input.homeService.address.startsWith('Torre 2, apto 304 · Punto marcado')).toBe(true)
      expect([...input.homeService.address].length).toBeLessThanOrEqual(200)
    })

    it('sends the plain address when no details were written', async () => {
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const wrapper = await mountOffering()
      await markOnMap(wrapper)
      await fillValidForm(wrapper)
      await wrapper.find('form').trigger('submit')
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Confirmar turno'))!
        .trigger('click')
      await flushPromises()

      expect(confirmPublicAppointmentMock.mock.calls[0]![3].homeService.address).toMatch(
        /^Punto marcado cerca de/,
      )
    })

    it('sends no address when the customer stays with the shop modality', async () => {
      confirmPublicAppointmentMock.mockResolvedValueOnce({
        kind: 'success',
        appointment: CONFIRMED_APPOINTMENT,
      })
      const wrapper = await mountOffering()
      await markOnMap(wrapper)
      await wrapper.find('input[name="service-mode"][value="local"]').setValue(true)
      await fillValidForm(wrapper)
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).not.toContain('Te atendemos en')

      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Confirmar turno'))!
        .trigger('click')
      await flushPromises()

      expect(confirmPublicAppointmentMock.mock.calls[0]![3].homeService).toBeNull()
    })

    it('has no accessibility violations with the address step open', async () => {
      const wrapper = await mountOffering()
      await wrapper.find('input[name="service-mode"][value="home"]').setValue(true)
      const results = await axe(wrapper.element)
      expect(results).toHaveNoViolations()
    })
  })
})
