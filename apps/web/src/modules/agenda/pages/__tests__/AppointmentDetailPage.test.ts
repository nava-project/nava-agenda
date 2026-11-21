/**
 * Pruebas de AppointmentDetailPage (HU-064, más reprogramación T2 de
 * HU-065): carga del detalle (listo, no encontrado, error/reintento),
 * historial paginado (listo, error/reintento, "Cargar más"), regreso a la
 * agenda conservando fecha/profesional, reprogramación (visibilidad por
 * estado, resumen/confirmación, doble toque bloqueado, conflictos de
 * agenda/versión/estado con conservación de datos, éxito que refresca
 * detalle+historial y el destino de "Volver"), y accesibilidad.
 * appointmentsApi se sustituye por un doble de prueba; el recorrido real
 * contra el API vive en el E2E de HU-064/HU-065.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetToasts, toastState } from '@/shared/model/toastStore'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { axe } from 'vitest-axe'

const fetchAppointmentDetailMock = vi.hoisted(() => vi.fn())
const fetchAppointmentHistoryMock = vi.hoisted(() => vi.fn())
const fetchBusinessTimezoneMock = vi.hoisted(() => vi.fn())
const rescheduleAppointmentMock = vi.hoisted(() => vi.fn())
const cancelAppointmentByProfessionalMock = vi.hoisted(() => vi.fn())
const completeAppointmentMock = vi.hoisted(() => vi.fn())
const markAppointmentNoShowMock = vi.hoisted(() => vi.fn())
const correctAppointmentStatusMock = vi.hoisted(() => vi.fn())
const fetchManualAvailabilityMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/appointmentsApi', () => ({
  fetchAppointmentDetail: fetchAppointmentDetailMock,
  fetchAppointmentHistory: fetchAppointmentHistoryMock,
  fetchBusinessTimezone: fetchBusinessTimezoneMock,
  rescheduleAppointment: rescheduleAppointmentMock,
  cancelAppointmentByProfessional: cancelAppointmentByProfessionalMock,
  completeAppointment: completeAppointmentMock,
  markAppointmentNoShow: markAppointmentNoShowMock,
  correctAppointmentStatus: correctAppointmentStatusMock,
  fetchManualAvailability: fetchManualAvailabilityMock,
}))

const { default: AppointmentDetailPage } = await import('../AppointmentDetailPage.vue')
const { getCivilDateInTimezone, shiftCivilDate } = await import('@/shared/time/civilDate')

const readyDetail = {
  id: 'a-1',
  professionalId: 'b-1',
  professionalFullName: 'Ana Gómez',
  serviceId: 's-1',
  attendeeName: 'Juan Pérez',
  customerFullName: 'Juan Pérez',
  customerPhone: '+573001234567',
  customerEmail: null,
  customerNote: 'Prefiere silla junto a la ventana',
  startsAt: '2026-08-28T19:30:00Z',
  endsAt: '2026-08-28T20:00:00Z',
  status: 'confirmed',
  origin: 'manual',
  serviceName: 'Corte clásico',
  durationMinutes: 30,
  priceAmount: '20000.00',
  currency: 'COP',
  versionToken: 'opaque-token',
  createdAt: '2026-08-20T10:00:00Z',
  homeService: null,
}

const createdEvent = {
  id: 'h-1',
  eventType: 'appointment_created',
  actorType: 'staff',
  actorLabel: 'Ana Gómez',
  reason: null,
  occurredAt: '2026-08-20T10:00:00Z',
  changes: [],
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/panel', name: 'panel', component: { template: '<div>panel</div>' } },
      {
        path: '/panel/turnos/:appointmentId',
        name: 'agenda-detalle-turno',
        component: AppointmentDetailPage,
      },
    ],
  })
}

async function mountPage(
  query: Record<string, string> = { date: '2026-08-28', professionalId: 'b-1' },
) {
  const router = buildRouter()
  await router.push({ name: 'agenda-detalle-turno', params: { appointmentId: 'a-1' }, query })
  await router.isReady()
  // stubs.teleport hace que Vue Test Utils renderice el contenido de
  // <Teleport to="body"> (el diálogo de reprogramación, HU-065) EN EL
  // LUGAR, dentro del árbol del wrapper: mismo criterio que
  // StaffPage.test.ts.
  const wrapper = mount(AppointmentDetailPage, {
    global: { plugins: [router], stubs: { teleport: true } },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  resetToasts()
  fetchAppointmentDetailMock.mockReset()
  fetchAppointmentHistoryMock.mockReset()
  fetchBusinessTimezoneMock.mockReset()
  rescheduleAppointmentMock.mockReset()
  cancelAppointmentByProfessionalMock.mockReset()
  completeAppointmentMock.mockReset()
  markAppointmentNoShowMock.mockReset()
  correctAppointmentStatusMock.mockReset()
  fetchManualAvailabilityMock.mockReset()
  fetchManualAvailabilityMock.mockResolvedValue(rescheduleAvailability())
  fetchBusinessTimezoneMock.mockResolvedValue({ kind: 'success', timezone: 'America/Bogota' })
  fetchAppointmentHistoryMock.mockResolvedValue({
    kind: 'success',
    items: [createdEvent],
    nextCursor: null,
  })
})

// --- Ayudantes para el diálogo de reprogramación (HU-065) ----------------
// Mismo criterio que StaffPage.test.ts: BaseDialog usa Teleport EN EL
// LUGAR dentro del wrapper (no al document.body real), así que basta con
// buscar dentro de wrapper.element.
function openDialogElement(wrapper: VueWrapper): HTMLElement {
  const el = wrapper.element.querySelector('.base-dialog--open')
  if (!el) throw new Error('no open dialog found')
  return el as HTMLElement
}

function openDialogForm(wrapper: VueWrapper): HTMLFormElement {
  return openDialogElement(wrapper).querySelector('form') as HTMLFormElement
}

// Reprogramar (#776) elige sobre los inicios libres de mañana en Bogotá (UTC−5
// todo el año): el turno está a las 9:30 y la lectura, sin él, ofrece 9:00, 9:30
// (la suya, marcada «actual») y 10:00.
const ZONE = 'America/Bogota'
const today = getCivilDateInTimezone(ZONE)
const tomorrow = shiftCivilDate(today, 1)
const at = (civilDate: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${civilDate}T${String(h! + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
}
const rescheduleDetail = {
  ...readyDetail,
  startsAt: at(tomorrow, '09:30'),
  endsAt: at(tomorrow, '10:00'),
}

function rescheduleAvailability(clocks = ['09:00', '09:30', '10:00']) {
  return {
    kind: 'success',
    availability: {
      starts: clocks.map((c) => at(tomorrow, c)),
      timezone: ZONE,
      durationMinutes: 30,
      slotGridMinutes: 30,
    },
  }
}

function rescheduleMinute(wrapper: VueWrapper, hour: string, label: string) {
  const row = [...openDialogElement(wrapper).querySelectorAll('.bk-hrow')].find(
    (r) => r.querySelector('.bk-hrow__number')?.textContent?.trim() === hour,
  )
  const button = [...(row?.querySelectorAll<HTMLButtonElement>('.bk-min') ?? [])].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!button) throw new Error(`minute ${hour}${label} not found`)
  return button
}

async function chooseRescheduleStart(wrapper: VueWrapper, hour: string, label: string) {
  rescheduleMinute(wrapper, hour, label).click()
  await flushPromises()
}

function confirmButton(wrapper: VueWrapper): HTMLButtonElement {
  const button = [...openDialogElement(wrapper).querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Confirmar',
  )
  if (!button) throw new Error('Confirmar not found')
  return button
}

function submitRescheduleDialog(wrapper: VueWrapper) {
  openDialogForm(wrapper).dispatchEvent(new Event('submit', { cancelable: true }))
}

function findButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === text)
  if (!button) throw new Error(`button ${JSON.stringify(text)} not found`)
  return button
}

async function openRescheduleDialog(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Reprogramar turno').trigger('click')
  await flushPromises()
}

// --- Ayudantes para el diálogo de cancelación (HU-066) -------------------

async function openCancelDialog(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Cancelar turno').trigger('click')
  await flushPromises()
}

async function confirmCancel(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Sí, cancelar turno').trigger('click')
  await flushPromises()
}

// --- Ayudantes para el diálogo de cierre manual (HU-067, T4 manual/T7) ---

async function openCompleteDialog(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Marcar como atendido').trigger('click')
  await flushPromises()
}

async function openNoShowDialog(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Marcar que no asistió').trigger('click')
  await flushPromises()
}

async function confirmComplete(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Sí, marcar como atendido').trigger('click')
  await flushPromises()
}

async function confirmNoShow(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Sí, marcar que no asistió').trigger('click')
  await flushPromises()
}

// --- Ayudantes para el diálogo de corrección (HU-068, T8) -----------------

async function openCorrectDialog(wrapper: VueWrapper) {
  await findButtonByText(wrapper, 'Corregir resultado').trigger('click')
  await flushPromises()
}

function correctDestinationSelect(wrapper: VueWrapper): HTMLSelectElement {
  return openDialogElement(wrapper).querySelector('#correct-destination') as HTMLSelectElement
}

function correctReasonTextarea(wrapper: VueWrapper): HTMLTextAreaElement {
  return openDialogElement(wrapper).querySelector('#correct-reason') as HTMLTextAreaElement
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value
  select.dispatchEvent(new Event('change'))
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value
  textarea.dispatchEvent(new Event('input'))
}

async function fillCorrectForm(wrapper: VueWrapper, destination: string, reason: string) {
  setSelectValue(correctDestinationSelect(wrapper), destination)
  setTextareaValue(correctReasonTextarea(wrapper), reason)
  await flushPromises()
}

function submitCorrectDialog(wrapper: VueWrapper) {
  openDialogForm(wrapper).dispatchEvent(new Event('submit', { cancelable: true }))
}

describe('AppointmentDetailPage', () => {
  it('shows the appointment detail once loaded', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('Juan Pérez')
    expect(wrapper.text()).toContain('Ana Gómez')
    expect(wrapper.text()).toContain('Corte clásico')
    // El precio como en la reserva (es-CO, sin decimales para COP).
    expect(wrapper.text()).toMatch(/30 min · \$\s20\.000/)
    expect(wrapper.text()).not.toContain('20000.00')
    expect(wrapper.get('a[href="tel:+573001234567"]').text()).toMatch(/\+57\s*300/)
    expect(wrapper.text()).toContain('Prefiere silla junto a la ventana')
    expect(fetchAppointmentDetailMock).toHaveBeenCalledWith('a-1')
  })

  // #757: el turno en la tarjeta de la familia, con sello, origen y puntos guía.
  it('shows the turn as the family ticket with seal, origin and leader rows', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, customerEmail: 'juan.perez@example.test' },
    })
    const { wrapper } = await mountPage()

    const ticket = wrapper.get('article.appointment-ticket')
    expect(ticket.text()).toContain('Agendado en el panel')
    expect(ticket.text()).toContain('Corte clásico')
    expect(ticket.find('.appointment-ticket__seal').exists()).toBe(true)
    expect(ticket.text()).toContain('Hora de Colombia')
    expect(ticket.find('.appointment-ticket__ruler-wrap').exists()).toBe(true)
    // Ya no hay ficha genérica con barra lateral ni grilla de etiqueta y valor.
    expect(wrapper.find('.appointment-detail-page__sheet').exists()).toBe(false)
    expect(wrapper.find('.appointment-detail-page__facts').exists()).toBe(false)
    const labels = wrapper.findAll('.appointment-detail-page__leader dt').map((n) => n.text())
    expect(labels).toEqual(['Persona atendida', 'Cliente que reservó', 'Teléfono', 'Correo'])
    // Teléfono y correo en filas propias, cada uno con su acción.
    expect(wrapper.get('a[href="mailto:juan.perez@example.test"]').attributes('aria-label')).toBe(
      'Escribir a juan.perez@example.test',
    )
    expect(wrapper.get('a[href="tel:+573001234567"]').attributes('aria-label')).toBe(
      'Llamar al +573001234567',
    )
  })

  it('stamps the ticket with the terminal state and keeps it for screen readers', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional', origin: 'public' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.get('article.appointment-ticket').classes()).toContain(
      'appointment-ticket--cancelled',
    )
    expect(wrapper.text()).toContain('Reserva en línea')
    expect(wrapper.get('.appointment-detail-page__status').attributes('role')).toBe('status')
  })

  // #758: la línea de tiempo llega hasta el turno si aún no ocurre; si ya pasó, cierra.
  it('ends the history at the upcoming turn while it has not happened yet', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, startsAt: '2099-01-15T14:00:00Z', endsAt: '2099-01-15T14:30:00Z' },
    })
    const { wrapper } = await mountPage()

    const list = wrapper.get('.appointment-detail-page__history-list')
    expect(list.classes()).toContain('appointment-detail-page__history-list--upcoming')
    const end = wrapper.get('.appointment-detail-page__history-end--upcoming')
    expect(end.text()).toContain('El turno')
    expect(end.text()).toMatch(/Próximo · .*15.*9:00/)
  })

  it('closes the history with a hidden diamond once the turn is past', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    const end = wrapper.get('.appointment-detail-page__history-end--close')
    expect(end.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.appointment-detail-page__history-end--upcoming').exists()).toBe(false)
  })

  it('keeps the history open when more pages remain', async () => {
    fetchAppointmentHistoryMock.mockResolvedValue({
      kind: 'success',
      items: [createdEvent],
      nextCursor: 'cursor-1',
    })
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.find('.appointment-detail-page__history-end').exists()).toBe(false)
  })

  it('runs the arrival once, when the ticket first gets its data', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.get('.appointment-detail-page').classes()).toContain(
      'appointment-detail-page--arrive',
    )
  })

  it('shows a loading skeleton shaped like the header, ticket and history', async () => {
    fetchAppointmentDetailMock.mockReturnValue(new Promise(() => {}))
    const { wrapper } = await mountPage()

    const skeleton = wrapper.get('.appointment-detail-page__skeleton')
    expect(skeleton.find('.appointment-detail-page__hero').exists()).toBe(true)
    expect(skeleton.findAll('.appointment-detail-page__skeleton-bar--button')).toHaveLength(2)
    expect(
      skeleton
        .find('.appointment-detail-page__body .appointment-detail-page__skeleton-card')
        .exists(),
    ).toBe(true)
    expect(
      skeleton.find('.appointment-detail-page__body .appointment-detail-page__history').exists(),
    ).toBe(true)
  })

  it('shows the customer address with a map link for a home-service turn (DEC-131, HU-103)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: {
        ...readyDetail,
        homeService: {
          address: 'Carrera 7 # 71-21, Bogotá',
          latitude: 4.6486,
          longitude: -74.0628,
        },
      },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('A domicilio')
    expect(wrapper.text()).toContain('Carrera 7 # 71-21, Bogotá')
    const link = wrapper.get('a[href^="https://www.google.com/maps/search/"]')
    expect(link.attributes('href')).toContain('4.6486%2C-74.0628')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('shows no address section for a turn at the shop', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).not.toContain('A domicilio')
    expect(wrapper.find('a[href*="google.com/maps"]').exists()).toBe(false)
  })

  it('does not render a contact section when phone and email are both absent', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, customerPhone: null, customerEmail: null },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).not.toContain('Contacto')
  })

  it('shows a not-found alert when the appointment does not exist or belongs to another shop', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'not-found' })
    const { wrapper } = await mountPage()

    expect(wrapper.find('[role="alert"]').text()).toContain('ya no está disponible')
  })

  it('shows a load error with retry, and retrying recovers the detail', async () => {
    fetchAppointmentDetailMock
      .mockResolvedValueOnce({ kind: 'network-error' })
      .mockResolvedValueOnce({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    const retry = wrapper.findAll('button').find((b) => b.text().includes('Reintentar'))
    expect(retry).toBeTruthy()
    await retry!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Juan Pérez')
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
  })

  it('loads and shows the history once the detail is ready', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(fetchAppointmentHistoryMock).toHaveBeenCalledWith('a-1', undefined)
    expect(wrapper.text()).toContain('Turno creado')
    expect(wrapper.text()).toContain('Ana Gómez')
  })

  it('shows the reason and field changes of a history entry when present', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    fetchAppointmentHistoryMock.mockResolvedValue({
      kind: 'success',
      items: [
        {
          id: 'h-2',
          eventType: 'appointment_status_corrected',
          actorType: 'system',
          actorLabel: 'Sistema',
          reason: 'corrección administrativa de estado',
          occurredAt: '2026-08-21T09:15:00Z',
          changes: [
            {
              fieldName: 'status',
              previousValue: 'confirmed',
              newValue: 'cancelled_by_professional',
            },
          ],
        },
      ],
      nextCursor: null,
    })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('Estado corregido')
    expect(wrapper.text()).toContain('corrección administrativa de estado')
    // Los valores en español, nunca el estado técnico de la API (#757).
    expect(wrapper.text()).toMatch(/Estado:\s*Confirmado\s*→\s*Cancelado por el /)
    expect(wrapper.text()).not.toContain('cancelled_by_professional')
  })

  it('shows a "Cargar más" button when the history has a next page, and loads it', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    fetchAppointmentHistoryMock
      .mockResolvedValueOnce({ kind: 'success', items: [createdEvent], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({
        kind: 'success',
        items: [{ ...createdEvent, id: 'h-2', eventType: 'appointment_completed' }],
        nextCursor: null,
      })
    const { wrapper } = await mountPage()

    const loadMore = wrapper.findAll('button').find((b) => b.text().includes('Cargar más'))
    expect(loadMore).toBeTruthy()
    await loadMore!.trigger('click')
    await flushPromises()

    expect(fetchAppointmentHistoryMock).toHaveBeenNthCalledWith(2, 'a-1', 'cursor-1')
    expect(wrapper.text()).toContain('Turno completado')
    // Ambas páginas conviven: la primera no se reemplaza.
    expect(wrapper.text()).toContain('Turno creado')
  })

  it('shows a history load error with retry', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    fetchAppointmentHistoryMock
      .mockResolvedValueOnce({ kind: 'unexpected-error' })
      .mockResolvedValueOnce({ kind: 'success', items: [createdEvent], nextCursor: null })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('No pudimos cargar el historial')
    const retry = wrapper.findAll('button').find((b) => b.text().includes('Reintentar'))
    await retry!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Turno creado')
  })

  it('the back link preserves the originating date and professionalId (HU-063)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage({ date: '2026-08-30', professionalId: 'b-2' })

    const back = wrapper.findAll('a').find((a) => a.text().includes('Volver'))
    expect(back).toBeTruthy()
    expect(back!.attributes('href')).toBe('/panel?date=2026-08-30&professionalId=b-2')
  })

  it('has no obvious accessibility violations once ready', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    const results = await axe(wrapper.element)
    expect(results.violations).toEqual([])
  })

  // --- Reprogramación (HU-065, T2) ---------------------------------------

  it('shows the "Reprogramar turno" action only for a confirmed appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Reprogramar turno')).toBe(true)
  })

  it('does not show "Reprogramar turno" for a non-confirmed appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Reprogramar turno')).toBe(false)
  })

  it('opens the reschedule dialog on the day of the appointment, reading without it, with no native inputs', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)

    expect(fetchManualAvailabilityMock).toHaveBeenCalledWith(
      'b-1',
      's-1',
      today,
      shiftCivilDate(today, 13),
      'a-1',
    )
    const dialog = openDialogElement(wrapper)
    expect(dialog.querySelectorAll('input[type="date"], input[type="time"]')).toHaveLength(0)
    // El día abre en el del turno; su hora actual no cuenta como elegible.
    expect(
      dialog.querySelector('.bk-day[aria-checked="true"]')?.getAttribute('aria-label'),
    ).toContain('2 horarios libres')
    // Su hora vuelve libre, marcada como la actual y sin poder elegirse.
    expect(rescheduleMinute(wrapper, '9', ':30').classList).toContain('bk-min--current')
    // Ahora, en 12 h; la nueva hora queda por elegir y Confirmar espera.
    const ticket = dialog.querySelector('.appointment-detail-page__reschedule-ticket')!
    expect(ticket.textContent).toContain('9:30\u00a0a. m.')
    expect(ticket.textContent).toContain('hasta 10:00 a. m.')
    expect(ticket.textContent).toContain('--:--')
    expect(confirmButton(wrapper).disabled).toBe(true)
  })

  it('choosing a free start fills the ticket in 12 h and enables Confirmar', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)

    await chooseRescheduleStart(wrapper, '10', ':00')
    const ticket = openDialogElement(wrapper).querySelector(
      '.appointment-detail-page__reschedule-side--new',
    )!
    expect(ticket.textContent).toContain('10:00\u00a0a. m.')
    expect(ticket.textContent).toContain('hasta 10:30 a. m.')
    expect(ticket.textContent).not.toContain('10:00 – 10:30')
    // El pie fijo repite la elección junto a Confirmar.
    const foot = openDialogElement(wrapper).querySelector('[data-testid="reschedule-foot-value"]')!
    expect(foot.textContent).toContain('10:00')
    expect(foot.textContent).toContain('Mañana')
    expect(confirmButton(wrapper).disabled).toBe(false)
  })

  it('on success, refetches the detail and history, closes the dialog, and updates the back link to the new date', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage({ date: today, professionalId: 'b-1' })
    await openRescheduleDialog(wrapper)
    await chooseRescheduleStart(wrapper, '10', ':00')

    rescheduleAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      startsAt: at(tomorrow, '10:00'),
    })
    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: {
        ...rescheduleDetail,
        startsAt: at(tomorrow, '10:00'),
        endsAt: at(tomorrow, '10:30'),
      },
    })
    submitRescheduleDialog(wrapper)
    await flushPromises()

    expect(rescheduleAppointmentMock).toHaveBeenCalledWith(
      'a-1',
      { startsAt: `${tomorrow}T10:00:00` },
      'opaque-token',
      expect.any(String),
    )
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
    const back = wrapper.findAll('a').find((a) => a.text().includes('Volver'))
    expect(back!.attributes('href')).toBe(`/panel?date=${tomorrow}&professionalId=b-1`)
    expect(toastState.items.map((item) => item.title)).toEqual(['Turno reprogramado'])
  })

  it('blocks a second submit while the first is still in flight (no double POST)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)
    await chooseRescheduleStart(wrapper, '9', ':00')

    let resolveReschedule: (value: unknown) => void = () => {}
    rescheduleAppointmentMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveReschedule = resolve)),
    )
    submitRescheduleDialog(wrapper)
    submitRescheduleDialog(wrapper)
    await flushPromises()

    expect(rescheduleAppointmentMock).toHaveBeenCalledTimes(1)
    resolveReschedule({ kind: 'success', startsAt: rescheduleDetail.startsAt })
    await flushPromises()
  })

  it('sends the same idempotency key across a submit and a network-error retry of the same logical attempt', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)
    await chooseRescheduleStart(wrapper, '9', ':00')

    rescheduleAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
    submitRescheduleDialog(wrapper)
    await flushPromises()

    rescheduleAppointmentMock.mockResolvedValueOnce({
      kind: 'success',
      startsAt: rescheduleDetail.startsAt,
    })
    submitRescheduleDialog(wrapper)
    await flushPromises()

    const firstKey = rescheduleAppointmentMock.mock.calls[0]![3]
    const secondKey = rescheduleAppointmentMock.mock.calls[1]![3]
    expect(secondKey).toBe(firstKey)
  })

  it('on an agenda conflict, shows the message next to the hours and rereads that day', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)
    await chooseRescheduleStart(wrapper, '10', ':00')

    rescheduleAppointmentMock.mockResolvedValueOnce({
      kind: 'conflict',
      detail: 'El barbero ya tiene un turno en ese horario.',
    })
    // Al releer el día, las 10:00 ya no están.
    fetchManualAvailabilityMock.mockResolvedValueOnce(rescheduleAvailability(['09:00', '09:30']))
    submitRescheduleDialog(wrapper)
    await flushPromises()

    const error = openDialogElement(wrapper).querySelector('.manual-start__error')
    expect(error?.textContent).toContain('El barbero ya tiene un turno en ese horario.')
    expect(fetchManualAvailabilityMock).toHaveBeenLastCalledWith(
      'b-1',
      's-1',
      tomorrow,
      tomorrow,
      'a-1',
    )
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
    // La hora tomada se suelta; el día sigue elegido y Confirmar espera otra.
    expect(openDialogElement(wrapper).querySelector('.bk-min[aria-checked="true"]')).toBeNull()
    expect(confirmButton(wrapper).disabled).toBe(true)
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(1)
  })

  it('on a version conflict, offers a reload that refetches the real detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)
    await chooseRescheduleStart(wrapper, '9', ':00')

    rescheduleAppointmentMock.mockResolvedValueOnce({ kind: 'version-conflict' })
    submitRescheduleDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('cambió mientras lo editabas')
    const reload = wrapper.findAll('button').find((b) => b.text() === 'Recargar')
    expect(reload).toBeTruthy()

    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...rescheduleDetail, versionToken: 'fresh-token' },
    })
    await reload!.trigger('click')
    await flushPromises()

    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
  })

  it('on an invalid-state conflict, offers a reload with the same recoverable message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: rescheduleDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)
    await chooseRescheduleStart(wrapper, '9', ':00')

    rescheduleAppointmentMock.mockResolvedValueOnce({ kind: 'invalid-state' })
    submitRescheduleDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('ya no se puede reprogramar')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Recargar')).toBe(true)
  })

  // El atrapado/restauración de foco es responsabilidad genérica de
  // BaseDialog (shared/ui/__tests__/BaseDialog.test.ts): esta página solo
  // usa su API estándar (v-model, @close) sin lógica de foco propia. No se
  // duplica aquí una prueba de `document.activeElement` porque jsdom no
  // calcula layout (offsetParent es siempre null), la misma razón por la
  // que BaseDialog.test.ts y StaffPage.test.ts tampoco lo verifican a este
  // nivel; el foco real se confirma en el navegador vía el E2E de HU-065.

  it('has no obvious accessibility violations with the reschedule dialog open', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)

    const results = await axe(wrapper.element)
    expect(results.violations).toEqual([])
  })

  // heading-order: BaseAlert.vue (HU-009) fija el título de una alerta como
  // `<h4>` porque es la etiqueta de un widget transitorio (`role="alert"`),
  // no un encabezado del esquema del documento; junto al `<h1>`/`<h2>` reales
  // de esta página, axe interpreta ese salto como un esquema de encabezados
  // roto. Mismo criterio documentado en LoginPage.test.ts/SettingsPage.test.ts:
  // no es un defecto de esta pantalla ni de BaseAlert.
  it('has no obvious accessibility violations with the reschedule conflict alert visible', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openRescheduleDialog(wrapper)

    rescheduleAppointmentMock.mockResolvedValueOnce({
      kind: 'conflict',
      detail: 'El barbero ya tiene un turno en ese horario.',
    })
    submitRescheduleDialog(wrapper)
    await flushPromises()

    const results = await axe(wrapper.element, { rules: { 'heading-order': { enabled: false } } })
    expect(results.violations).toEqual([])
  })

  // --- Cancelación (HU-066, T6) -------------------------------------------

  it('shows the "Cancelar turno" action only for a confirmed appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Cancelar turno')).toBe(true)
  })

  it('does not show "Cancelar turno" for a non-confirmed appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Cancelar turno')).toBe(false)
  })

  it('opens the cancel dialog with the consequence explained before confirming', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    expect(openDialogElement(wrapper).textContent).toContain('Juan Pérez')
    expect(openDialogElement(wrapper).textContent).toContain('no se puede deshacer')
  })

  it('on success, calls the API with a fresh idempotency key, closes the dialog, and refetches the detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional' },
    })
    await confirmCancel(wrapper)

    expect(cancelAppointmentByProfessionalMock).toHaveBeenCalledWith(
      'a-1',
      'opaque-token',
      expect.any(String),
    )
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
    expect(toastState.items.map((item) => item.title)).toEqual(['Turno cancelado'])
  })

  it('blocks a second confirm while the first is still in flight (no double POST)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    let resolveCancel: (value: unknown) => void = () => {}
    cancelAppointmentByProfessionalMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveCancel = resolve)),
    )
    await confirmCancel(wrapper)
    await confirmCancel(wrapper)

    expect(cancelAppointmentByProfessionalMock).toHaveBeenCalledTimes(1)
    resolveCancel({ kind: 'success' })
    await flushPromises()
  })

  it('renews the idempotency key each time the dialog is reopened', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    await openCancelDialog(wrapper)
    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'network-error' })
    await confirmCancel(wrapper)

    await findButtonByText(wrapper, 'Volver').trigger('click')
    await flushPromises()

    await openCancelDialog(wrapper)
    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({ kind: 'success', detail: readyDetail })
    await confirmCancel(wrapper)

    const firstKey = cancelAppointmentByProfessionalMock.mock.calls[0]![2]
    const secondKey = cancelAppointmentByProfessionalMock.mock.calls[1]![2]
    expect(secondKey).not.toBe(firstKey)
  })

  it('on a version conflict, offers a reload that refetches the real detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'version-conflict' })
    await confirmCancel(wrapper)

    expect(wrapper.text()).toContain('cambió mientras lo revisabas')
    const reload = wrapper.findAll('button').find((b) => b.text() === 'Recargar')
    expect(reload).toBeTruthy()

    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...rescheduleDetail, versionToken: 'fresh-token' },
    })
    await reload!.trigger('click')
    await flushPromises()

    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
  })

  it('on an invalid-state conflict, offers a reload with the same recoverable message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'invalid-state' })
    await confirmCancel(wrapper)

    expect(wrapper.text()).toContain('ya no se puede cancelar')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Recargar')).toBe(true)
  })

  it('on an idempotency conflict, keeps the dialog open with a recoverable message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'idempotency-conflict' })
    await confirmCancel(wrapper)

    expect(wrapper.text()).toContain('No pudimos completar el intento anterior')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('on a network error, keeps the dialog open without losing the intent', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    cancelAppointmentByProfessionalMock.mockResolvedValueOnce({ kind: 'network-error' })
    await confirmCancel(wrapper)

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('renders a status badge reflecting the terminal cancelled_by_professional state', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('Cancelado por el profesional')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Cancelar turno')).toBe(false)
  })

  it('has no obvious accessibility violations with the cancel dialog open', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCancelDialog(wrapper)

    const results = await axe(wrapper.element)
    expect(results.violations).toEqual([])
  })

  // --- Cierre manual (HU-067, T4 manual y T7) -----------------------------
  // readyDetail.startsAt (2026-08-28) ya pasó respecto al reloj real: sirve
  // tal cual como el caso "ya se puede cerrar" (CA-067-08), sin fixture
  // aparte. rescheduleDetail cubre el caso "confirmed pero aún no empieza".

  const futureDetail = {
    ...readyDetail,
    startsAt: '2999-01-01T10:00:00Z',
    endsAt: '2999-01-01T10:30:00Z',
  }

  it('reads a confirmed appointment by the hour, like the daily agenda (DEC-188)', async () => {
    const status = async (detail: typeof readyDetail) => {
      fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail })
      const { wrapper } = await mountPage()
      const root = wrapper.get('.appointment-detail-page')
      return {
        text: wrapper.get('.appointment-detail-page__status').text(),
        classes: root.classes(),
      }
    }
    const past = await status(readyDetail)
    expect(past.text).toBe('Por registrar')
    expect(past.classes).toContain('appointment-detail-page--to-record')

    const now = Date.now()
    const ongoing = await status({
      ...readyDetail,
      startsAt: new Date(now - 10 * 60_000).toISOString(),
      endsAt: new Date(now + 20 * 60_000).toISOString(),
    })
    expect(ongoing.text).toBe('En curso')
    expect(ongoing.classes).toContain('appointment-detail-page--current')

    const upcoming = await status(futureDetail)
    expect(upcoming.text).toBe('Confirmado')
  })

  it('shows "Marcar como atendido" and "Marcar que no asistió" only once startsAt has passed', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar como atendido')).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar que no asistió')).toBe(true)
  })

  it('does not show the close actions for a confirmed appointment that has not started yet', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: futureDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar como atendido')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar que no asistió')).toBe(false)
  })

  it('does not show the close actions for a non-confirmed appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar como atendido')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar que no asistió')).toBe(false)
  })

  it('opens the complete dialog with the consequence explained before confirming', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    expect(openDialogElement(wrapper).textContent).toContain('Juan Pérez')
    expect(openDialogElement(wrapper).textContent).toContain('atendido')
    expect(openDialogElement(wrapper).textContent).toContain('no se puede deshacer')
  })

  it('opens the no-show dialog with the consequence explained before confirming', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openNoShowDialog(wrapper)

    expect(openDialogElement(wrapper).textContent).toContain('Juan Pérez')
    expect(openDialogElement(wrapper).textContent).toContain('no asistió')
  })

  it('closes the turn from the same ink card as cancel/reschedule, with a status-colored summary (#509)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openNoShowDialog(wrapper)

    const dialog = openDialogElement(wrapper)
    expect(dialog.className).toContain('appointment-detail-page__ink-dialog')
    const ticket = dialog.querySelector('.appointment-detail-page__close-ticket--no-show')
    expect(ticket?.textContent).toContain('Turno que se marcará como no asistido')
    expect(ticket?.textContent).toContain('Juan Pérez')
    expect(dialog.querySelector('.appointment-detail-page__close-ticket--complete')).toBeNull()
  })

  it('the complete dialog uses the same card with the completed color (#509)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    const ticket = openDialogElement(wrapper).querySelector(
      '.appointment-detail-page__close-ticket--complete',
    )
    expect(ticket?.textContent).toContain('Turno que se marcará como atendido')
  })

  it('on complete success, calls the API with a fresh idempotency key, closes the dialog, and refetches the detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    completeAppointmentMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    await confirmComplete(wrapper)

    expect(completeAppointmentMock).toHaveBeenCalledWith('a-1', 'opaque-token', expect.any(String))
    expect(markAppointmentNoShowMock).not.toHaveBeenCalled()
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
    expect(toastState.items.map((item) => item.title)).toEqual(['Turno marcado como atendido'])
  })

  it('on no-show success, calls the API with a fresh idempotency key, closes the dialog, and refetches the detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openNoShowDialog(wrapper)

    markAppointmentNoShowMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...readyDetail, status: 'no_show' },
    })
    await confirmNoShow(wrapper)

    expect(markAppointmentNoShowMock).toHaveBeenCalledWith(
      'a-1',
      'opaque-token',
      expect.any(String),
    )
    expect(completeAppointmentMock).not.toHaveBeenCalled()
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
    expect(toastState.items.map((item) => item.title)).toEqual(['Turno marcado como no asistido'])
  })

  it('blocks a second confirm while the first close attempt is still in flight (no double POST)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    let resolveComplete: (value: unknown) => void = () => {}
    completeAppointmentMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveComplete = resolve)),
    )
    await confirmComplete(wrapper)
    await confirmComplete(wrapper)

    expect(completeAppointmentMock).toHaveBeenCalledTimes(1)
    resolveComplete({ kind: 'success' })
    await flushPromises()
  })

  it('renews the idempotency key each time the close dialog is reopened', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    await openCompleteDialog(wrapper)
    completeAppointmentMock.mockResolvedValueOnce({ kind: 'network-error' })
    await confirmComplete(wrapper)

    await findButtonByText(wrapper, 'Volver').trigger('click')
    await flushPromises()

    await openCompleteDialog(wrapper)
    completeAppointmentMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({ kind: 'success', detail: readyDetail })
    await confirmComplete(wrapper)

    const firstKey = completeAppointmentMock.mock.calls[0]![2]
    const secondKey = completeAppointmentMock.mock.calls[1]![2]
    expect(secondKey).not.toBe(firstKey)
  })

  it('on a version conflict, offers a reload that refetches the real detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    completeAppointmentMock.mockResolvedValueOnce({ kind: 'version-conflict' })
    await confirmComplete(wrapper)

    expect(wrapper.text()).toContain('cambió mientras lo revisabas')
    const reload = wrapper.findAll('button').find((b) => b.text() === 'Recargar')
    expect(reload).toBeTruthy()

    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...futureDetail, versionToken: 'fresh-token' },
    })
    await reload!.trigger('click')
    await flushPromises()

    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
  })

  // CA-067-05: el resultado contrario (o cualquier otro terminal) responde
  // el mismo invalid-state que cualquier operación sobre un turno que ya
  // dejó de estar confirmed.
  it('on an invalid-state conflict (opposite result or other terminal), offers a reload', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    completeAppointmentMock.mockResolvedValueOnce({ kind: 'invalid-state' })
    await confirmComplete(wrapper)

    expect(wrapper.text()).toContain('ya tiene un resultado registrado')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Recargar')).toBe(true)
  })

  // CA-067-03: antes de startsAt, el servidor responde 422 (validation
  // error) en vez de un conflicto -- distinto de cancelar/reprogramar, que
  // no tienen esta frontera temporal.
  it('on a validation error (turn not started yet), offers a reload with an explanatory message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openNoShowDialog(wrapper)

    markAppointmentNoShowMock.mockResolvedValueOnce({
      kind: 'validation-error',
      detail: 'el turno todavía no comienza; espera hasta su hora de inicio',
    })
    await confirmNoShow(wrapper)

    expect(wrapper.text()).toContain('todavía no comienza')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Recargar')).toBe(true)
  })

  it('on an idempotency conflict, keeps the dialog open with a recoverable message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    completeAppointmentMock.mockResolvedValueOnce({ kind: 'idempotency-conflict' })
    await confirmComplete(wrapper)

    expect(wrapper.text()).toContain('No pudimos completar el intento anterior')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('on a network error, keeps the dialog open without losing the intent', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openNoShowDialog(wrapper)

    markAppointmentNoShowMock.mockResolvedValueOnce({ kind: 'network-error' })
    await confirmNoShow(wrapper)

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('renders a status badge distinguishable by text for completed and no_show', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('Completado')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar como atendido')).toBe(false)
  })

  it('renders a status badge distinguishable by text for no_show', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'no_show' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('No asistió')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Marcar que no asistió')).toBe(false)
  })

  it('has no obvious accessibility violations with the complete dialog open', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openCompleteDialog(wrapper)

    const results = await axe(wrapper.element)
    expect(results.violations).toEqual([])
  })

  it('has no obvious accessibility violations with the no-show dialog open', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()
    await openNoShowDialog(wrapper)

    const results = await axe(wrapper.element)
    expect(results.violations).toEqual([])
  })

  // --- Corregir resultado (HU-068, T8) ------------------------------------

  it('shows the "Corregir resultado" action only for a terminal appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Corregir resultado')).toBe(true)
  })

  it('does not show "Corregir resultado" for a confirmed appointment', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({ kind: 'success', detail: readyDetail })
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('button').some((b) => b.text() === 'Corregir resultado')).toBe(false)
  })

  // CA-068-01/CA-068-08: "confirmed" nunca aparece como opción, ni siquiera
  // como destino de una corrección -- demuestra que una cancelada no revive
  // a confirmed por esta vía.
  it('offers only the other three terminals as destination, never confirmed', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)

    const options = Array.from(correctDestinationSelect(wrapper).querySelectorAll('option'))
      .map((o) => o.getAttribute('value'))
      .filter((v): v is string => !!v)
    expect(options.sort()).toEqual(['cancelled_by_customer', 'completed', 'no_show'].sort())
    expect(options).not.toContain('confirmed')
    expect(options).not.toContain('cancelled_by_professional')
  })

  it('disables the confirm button until both a destination and a reason are filled', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)

    expect(findButtonByText(wrapper, 'Confirmar corrección').attributes('disabled')).toBeDefined()

    await fillCorrectForm(wrapper, 'no_show', 'El cliente nunca llegó.')
    expect(findButtonByText(wrapper, 'Confirmar corrección').attributes('disabled')).toBeUndefined()
  })

  // Pruebas obligatorias de HU-068: "corregir completed → no_show, ver
  // ambos eventos" -- tras el éxito, el historial recargado debe mostrar el
  // evento original (appointment_completed) y el nuevo
  // (appointment_status_corrected), nunca solo uno.
  it('on success (completed to no_show), calls the API, closes the dialog, and refetches detail+history showing both events', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'El barbero marcó completed por error.')

    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...readyDetail, status: 'no_show' },
    })
    fetchAppointmentHistoryMock.mockResolvedValueOnce({
      kind: 'success',
      items: [
        createdEvent,
        {
          id: 'h-2',
          eventType: 'appointment_completed',
          actorType: 'staff',
          actorLabel: 'Ana Gómez',
          reason: null,
          occurredAt: '2026-08-28T20:00:00Z',
          changes: [],
        },
        {
          id: 'h-3',
          eventType: 'appointment_status_corrected',
          actorType: 'staff',
          actorLabel: 'Ana Gómez',
          reason: 'El barbero marcó completed por error.',
          occurredAt: '2026-08-28T20:05:00Z',
          changes: [{ fieldName: 'status', previousValue: 'completed', newValue: 'no_show' }],
        },
      ],
      nextCursor: null,
    })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(correctAppointmentStatusMock).toHaveBeenCalledWith(
      'a-1',
      { status: 'no_show', reason: 'El barbero marcó completed por error.' },
      'opaque-token',
      expect.any(String),
    )
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('El barbero marcó completed por error.')
    expect(toastState.items.map((item) => item.title)).toEqual(['Resultado corregido'])
  })

  it('blocks a second confirm while the first correction attempt is still in flight (no double POST)', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')

    let resolveCorrect: (value: unknown) => void = () => {}
    correctAppointmentStatusMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveCorrect = resolve)),
    )
    submitCorrectDialog(wrapper)
    await flushPromises()
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(correctAppointmentStatusMock).toHaveBeenCalledTimes(1)
    resolveCorrect({ kind: 'success' })
    await flushPromises()
  })

  it('renews the idempotency key each time the correct dialog is reopened', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()

    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')
    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'network-error' })
    submitCorrectDialog(wrapper)
    await flushPromises()

    await findButtonByText(wrapper, 'Volver').trigger('click')
    await flushPromises()

    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')
    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'success' })
    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    submitCorrectDialog(wrapper)
    await flushPromises()

    const firstKey = correctAppointmentStatusMock.mock.calls[0]![3]
    const secondKey = correctAppointmentStatusMock.mock.calls[1]![3]
    expect(secondKey).not.toBe(firstKey)
  })

  // Pruebas obligatorias de HU-068: "probar conflicto de versión".
  it('on a version conflict, offers a reload that refetches the real detail', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')

    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'version-conflict' })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('cambió mientras lo revisabas')
    const reload = wrapper.findAll('button').find((b) => b.text() === 'Recargar')
    expect(reload).toBeTruthy()

    fetchAppointmentDetailMock.mockResolvedValueOnce({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed', versionToken: 'fresh-token' },
    })
    await reload!.trigger('click')
    await flushPromises()

    expect(wrapper.element.querySelector('.base-dialog--open')).toBeNull()
    expect(fetchAppointmentDetailMock).toHaveBeenCalledTimes(2)
  })

  it('on an invalid-state conflict (still confirmed), offers a reload', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')

    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'invalid-state' })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('todavía no tiene un resultado terminal')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Recargar')).toBe(true)
  })

  // CA-068-04: cruce de agenda al corregir desde un cancelado hacia un
  // terminal que ya ocupa la franja.
  it('on a schedule conflict, shows the server message without offering a reload', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'completed', 'motivo de prueba')

    correctAppointmentStatusMock.mockResolvedValueOnce({
      kind: 'conflict',
      detail: 'el barbero ya tiene una cita en ese intervalo',
    })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('el barbero ya tiene una cita en ese intervalo')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('on a validation error, shows the server message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'cancelled_by_professional' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'completed', 'motivo de prueba')

    correctAppointmentStatusMock.mockResolvedValueOnce({
      kind: 'validation-error',
      detail: 'el turno todavía no comienza; espera hasta su hora de inicio',
    })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('todavía no comienza')
  })

  it('on an idempotency conflict, keeps the dialog open with a recoverable message', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')

    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'idempotency-conflict' })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos completar el intento anterior')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('on a network error, keeps the dialog open without losing the intent', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)
    await fillCorrectForm(wrapper, 'no_show', 'motivo de prueba')

    correctAppointmentStatusMock.mockResolvedValueOnce({ kind: 'network-error' })
    submitCorrectDialog(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(wrapper.element.querySelector('.base-dialog--open')).toBeTruthy()
  })

  it('has no obvious accessibility violations with the correct dialog open', async () => {
    fetchAppointmentDetailMock.mockResolvedValue({
      kind: 'success',
      detail: { ...readyDetail, status: 'completed' },
    })
    const { wrapper } = await mountPage()
    await openCorrectDialog(wrapper)

    const results = await axe(wrapper.element)
    expect(results.violations).toEqual([])
  })
})
