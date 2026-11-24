/**
 * Pruebas de ProfessionalServicesPage (HU-023): carga (un profesional, cuatro
 * profesionales, servicio compartido), vacío (sin profesionales, sin servicios),
 * error recuperable, cambio de profesional, asignar/desasignar (éxito, último
 * activo rechazado -DEC-068-, no encontrado, error de red), doble envío
 * bloqueado, aislamiento entre profesionales y accesibilidad. professionalServicesApi
 * se sustituye por un doble de prueba; el recorrido real contra el API vive
 * en el E2E de HU-023.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetToasts, toastState } from '@/shared/model/toastStore'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'

const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchServiceSummariesMock = vi.hoisted(() => vi.fn())
const fetchAssignmentsMock = vi.hoisted(() => vi.fn())
const assignServiceMock = vi.hoisted(() => vi.fn())
const unassignServiceMock = vi.hoisted(() => vi.fn())

// La gracia del cargador (#820) es instantánea con el reloj real: la carga simulada
// es inmediata y una máquina cargada no debe convertirla en una espera (#834).
vi.mock('@/shared/composables/useLoaderGrace', async (original) =>
  (await import('@/shared/composables/__tests__/instantLoaderGrace')).instantLoaderGrace(
    await original(),
  ),
)

vi.mock('../../api/professionalServicesApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchServiceSummaries: fetchServiceSummariesMock,
  fetchAssignments: fetchAssignmentsMock,
  assignService: assignServiceMock,
  unassignService: unassignServiceMock,
}))

const { default: ProfessionalServicesPage } = await import('../ProfessionalServicesPage.vue')

const oneProfessional = [{ id: 'b-1', fullName: 'Carlos Ramírez' }]
const fourProfessionals = [
  { id: 'b-1', fullName: 'Carlos Ramírez' },
  { id: 'b-2', fullName: 'Ana Torres' },
  { id: 'b-3', fullName: 'Luis Gómez' },
  { id: 'b-4', fullName: 'María Pérez' },
]
const twoServices = [
  { id: 's-1', name: 'Corte clásico' },
  { id: 's-2', name: 'Barba' },
]

// Adjunto al documento: el foco solo existe en elementos conectados (ASSIGN-F-1).
const mounted: VueWrapper[] = []

function mountPage() {
  const wrapper = mount(ProfessionalServicesPage, {
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

async function mountReady(
  professionals = oneProfessional,
  services = twoServices,
  assignedServiceIds: string[] = [],
) {
  fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: professionals })
  fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: services })
  fetchAssignmentsMock.mockResolvedValueOnce({
    kind: 'success',
    page: {
      items: assignedServiceIds.map((serviceId) => ({
        professionalId: professionals[0]!.id,
        serviceId,
        createdAt: '2026-08-24T15:04:05Z',
      })),
      nextCursor: null,
    },
  })
  const wrapper = mountPage()
  await flushPromises()
  return wrapper
}

function checkbox(wrapper: VueWrapper, serviceId: string): HTMLInputElement {
  return wrapper.element.querySelector(
    `#professional-services-service-${serviceId}`,
  ) as HTMLInputElement
}

// El selector de profesional es el listbox propio (ProfessionalSelect): se abre con su
// disparador y se elige haciendo clic en la opción.
async function chooseProfessional(wrapper: VueWrapper, fullName: string) {
  await wrapper.get('#professional-services-professional-select').trigger('click')
  const option = wrapper
    .findAll('[role="option"]')
    .find((candidate) => candidate.get('.professional-select__option-name').text() === fullName)
  await option!.trigger('click')
}

const axeOptions = { rules: { 'color-contrast': { enabled: false } } }

describe('ProfessionalServicesPage', () => {
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount()
  })

  beforeEach(() => {
    resetToasts()
    fetchProfessionalSummariesMock.mockReset()
    fetchServiceSummariesMock.mockReset()
    fetchAssignmentsMock.mockReset()
    assignServiceMock.mockReset()
    unassignServiceMock.mockReset()
  })

  it('shows a non-blank loading state, then the loaded picker', async () => {
    let resolveProfessionals: (value: unknown) => void = () => {}
    fetchProfessionalSummariesMock.mockReturnValueOnce(
      new Promise((resolve) => (resolveProfessionals = resolve)),
    )
    fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    const wrapper = mountPage()

    expect(wrapper.text()).toContain('Cargando')

    fetchAssignmentsMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: [], nextCursor: null },
    })
    resolveProfessionals({ kind: 'success', items: oneProfessional })
    await flushPromises()

    expect(wrapper.text()).toContain('Carlos Ramírez')
    expect(wrapper.text()).toContain('Corte clásico')
  })

  it('a professional with one service and one with a full team select use the same component (CA-023-01)', async () => {
    const oneWrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
    expect(oneWrapper.findAll('[role="option"]').length).toBe(1)
    expect(checkbox(oneWrapper, 's-1').checked).toBe(true)
    expect(checkbox(oneWrapper, 's-2').checked).toBe(false)

    const fourWrapper = await mountReady(fourProfessionals, twoServices, [])
    expect(fourWrapper.findAll('[role="option"]').length).toBe(4)
  })

  it('wraps each checkbox and its name in one 44px label, the real tap target (Fase 5, issue #157)', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
    const input = checkbox(wrapper, 's-1')
    const label = input.closest('label')
    expect(label).toBeTruthy()
    expect(label!.textContent).toContain('Corte clásico')
  })

  it('lays the catalog out as a table with column headers and a count footer', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])

    expect(wrapper.find('.professional-services-page__columns').text()).toContain('Servicio')
    expect(wrapper.find('.professional-services-page__columns').text()).toContain('Asignación')
    expect(wrapper.find('.base-pagination__count').text()).toBe('2 servicios')
    expect(wrapper.findAll('.professional-services-page__row')).toHaveLength(2)
  })

  it('paginates a long catalog on the client and keeps toggles working on later pages', async () => {
    const manyServices = Array.from({ length: 25 }, (_, i) => ({
      id: `s-${i + 1}`,
      name: `Servicio ${i + 1}`,
    }))
    assignServiceMock.mockResolvedValueOnce({
      kind: 'success',
      assignment: { professionalId: 'b-1', serviceId: 's-25', createdAt: '2026-08-24T15:04:05Z' },
    })
    const wrapper = await mountReady(oneProfessional, manyServices, [])

    // jsdom no mide alturas: aplica el tamaño de página de reserva (20).
    expect(wrapper.findAll('.professional-services-page__row')).toHaveLength(20)
    expect(wrapper.find('.base-pagination__count').text()).toContain('Página 1 de 2')
    expect(checkbox(wrapper, 's-25')).toBeNull()

    await wrapper.find('button[aria-label="Página siguiente"]').trigger('click')

    expect(wrapper.findAll('.professional-services-page__row')).toHaveLength(5)
    expect(wrapper.find('[aria-current="page"]').text()).toBe('2')
    expect(
      wrapper.find('button[aria-label="Página siguiente"]').attributes('disabled'),
    ).toBeDefined()

    checkbox(wrapper, 's-25').checked = true
    await checkbox(wrapper, 's-25').dispatchEvent(new Event('change'))
    await flushPromises()

    expect(assignServiceMock).toHaveBeenCalledWith('b-1', 's-25')
    expect(checkbox(wrapper, 's-25').checked).toBe(true)
  })

  it('shows an empty state when there are no professionals, without an interactive picker', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Aún no tienes profesionales registrados')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('shows an empty state when there are no services, without an interactive picker', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Aún no tienes servicios en el catálogo')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('shows a recoverable error with Reintentar when the initial load fails', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos cargar esta sección')

    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: oneProfessional,
    })
    fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    fetchAssignmentsMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: [], nextCursor: null },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Carlos Ramírez')
  })

  it('switching professionals loads that professional assignments independently (cross-professional isolation)', async () => {
    const wrapper = await mountReady(fourProfessionals, twoServices, ['s-1'])
    expect(checkbox(wrapper, 's-1').checked).toBe(true)

    fetchAssignmentsMock.mockResolvedValueOnce({
      kind: 'success',
      page: {
        items: [{ professionalId: 'b-2', serviceId: 's-2', createdAt: '2026-08-24T15:04:05Z' }],
        nextCursor: null,
      },
    })
    await chooseProfessional(wrapper, fourProfessionals[1]!.fullName)
    await flushPromises()

    expect(fetchAssignmentsMock).toHaveBeenLastCalledWith('b-2')
    expect(checkbox(wrapper, 's-1').checked).toBe(false)
    expect(checkbox(wrapper, 's-2').checked).toBe(true)
  })

  // Issue #575: cambiar de persona vaciaba la ficha y la tabla y la pantalla
  // saltaba. Ahora la tabla anterior queda debajo de un velo de carga, inerte.
  describe('el velo al cambiar de profesional (#841: asoma a los LOADER_APPEAR_MS)', () => {
    // Montada con el reloj real (la gracia del doble es instantánea); después se
    // controla solo el temporizador del velo.
    afterEach(() => vi.useRealTimers())

    async function switchPending() {
      const wrapper = await mountReady(fourProfessionals, twoServices, ['s-1'])
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      let resolveAssignments: (value: unknown) => void = () => {}
      fetchAssignmentsMock.mockReturnValueOnce(
        new Promise((resolve) => (resolveAssignments = resolve)),
      )
      await chooseProfessional(wrapper, fourProfessionals[1]!.fullName)
      await flushPromises()
      return { wrapper, resolve: resolveAssignments }
    }

    it('keeps the previous catalog in place, inert, and covers it with the veil once the wait passes 300 ms', async () => {
      const { wrapper, resolve } = await switchPending()

      const fieldset = wrapper.find('fieldset')
      expect(fieldset.exists()).toBe(true)
      expect(fieldset.attributes('inert')).toBeDefined()
      expect(wrapper.find('.professional-services-page__panel').attributes('aria-busy')).toBe(
        'true',
      )
      // Todavía no asoma: una respuesta rápida no debe pintar nada.
      expect(wrapper.find('.professional-services-page__veil').exists()).toBe(false)

      await vi.advanceTimersByTimeAsync(300)
      expect(wrapper.find('[role="status"]').text()).toContain(
        `Cargando los servicios de ${fourProfessionals[1]!.fullName}`,
      )
      expect(wrapper.find('fieldset').classes()).toContain(
        'professional-services-page__fieldset--dimmed',
      )

      resolve({ kind: 'success', page: { items: [], nextCursor: null } })
      await flushPromises()
      // El velo que asomó se queda su mínimo (entrada + 300 ms) y después se va.
      await vi.advanceTimersByTimeAsync(500)

      expect(wrapper.find('fieldset').attributes('inert')).toBeUndefined()
      expect(
        wrapper.find('.professional-services-page__panel').attributes('aria-busy'),
      ).toBeUndefined()
      expect(checkbox(wrapper, 's-1').checked).toBe(false)
    })

    it('once shown, keeps the veil and its loader at least its entry plus 300 ms, even if the answer arrives first (#842 C1)', async () => {
      const { wrapper, resolve } = await switchPending()
      await vi.advanceTimersByTimeAsync(300)
      expect(wrapper.find('.professional-services-page__veil').exists()).toBe(true)
      // El cargador del velo no espera su propio retardo: es el mismo nodo, ya montado.
      expect(wrapper.find('.professional-services-page__veil .diamond-loader').exists()).toBe(true)

      await vi.advanceTimersByTimeAsync(50)
      resolve({ kind: 'success', page: { items: [], nextCursor: null } })
      await flushPromises()
      // 180 ms de entrada + 300 ms a la vista desde que se montó: a los 470 ms sigue.
      await vi.advanceTimersByTimeAsync(420)
      expect(wrapper.find('.professional-services-page__veil').exists()).toBe(true)
      expect(wrapper.find('fieldset').attributes('inert')).toBeDefined()

      await vi.advanceTimersByTimeAsync(20)
      expect(wrapper.find('.professional-services-page__veil').exists()).toBe(false)
      expect(wrapper.find('fieldset').attributes('inert')).toBeUndefined()
    })

    it('never mounts the veil nor dims the catalog when the answer arrives before 300 ms', async () => {
      const { wrapper, resolve } = await switchPending()
      await vi.advanceTimersByTimeAsync(200)
      resolve({ kind: 'success', page: { items: [], nextCursor: null } })
      await flushPromises()
      await vi.advanceTimersByTimeAsync(500)
      expect(wrapper.find('.professional-services-page__veil').exists()).toBe(false)
      expect(wrapper.find('fieldset').classes()).not.toContain(
        'professional-services-page__fieldset--dimmed',
      )
      expect(wrapper.get('.professional-services-page__meter').classes()).not.toContain(
        'professional-services-page__meter--busy',
      )
    })
  })

  it('checking a box assigns the service and reflects success only after the server responds', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, [])
    assignServiceMock.mockResolvedValueOnce({
      kind: 'success',
      assignment: { professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' },
    })

    const box = checkbox(wrapper, 's-1')
    box.checked = true
    await box.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(assignServiceMock).toHaveBeenCalledWith('b-1', 's-1')
    expect(checkbox(wrapper, 's-1').checked).toBe(true)
    expect(toastState.items.map((item) => item.title)).toEqual(['Servicio asignado'])
  })

  it('unchecking a box unassigns the service on success', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
    unassignServiceMock.mockResolvedValueOnce({ kind: 'success' })

    const box = checkbox(wrapper, 's-1')
    box.checked = false
    await box.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(unassignServiceMock).toHaveBeenCalledWith('b-1', 's-1')
    expect(checkbox(wrapper, 's-1').checked).toBe(false)
    expect(toastState.items.map((item) => item.title)).toEqual(['Servicio retirado'])
  })

  it('removing the only professional of a service is allowed and confirmed like any other removal (DEC-114)', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
    unassignServiceMock.mockResolvedValueOnce({ kind: 'success' })

    const box = checkbox(wrapper, 's-1')
    box.checked = false
    await box.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(unassignServiceMock).toHaveBeenCalledWith('b-1', 's-1')
    expect(checkbox(wrapper, 's-1').checked).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(toastState.items.map((item) => item.title)).toEqual(['Servicio retirado'])
  })

  it('a network error while toggling keeps the previous state and shows a recoverable message', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, [])
    assignServiceMock.mockResolvedValueOnce({ kind: 'network-error' })

    const box = checkbox(wrapper, 's-1')
    box.checked = true
    await box.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(checkbox(wrapper, 's-1').checked).toBe(false)
  })

  it('marks the checkbox busy, not disabled, while its own request is in flight (no double submit, keeps focus)', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, [])
    let resolveAssign: (value: unknown) => void = () => {}
    assignServiceMock.mockReturnValueOnce(new Promise((resolve) => (resolveAssign = resolve)))

    const box = checkbox(wrapper, 's-1')
    box.focus()
    box.checked = true
    await box.dispatchEvent(new Event('change'))
    await flushPromises()

    // AGENDA ASSIGN-F-1: `disabled` expulsa el foco a BODY (CA-023-08, WCAG 2.4.3).
    expect(checkbox(wrapper, 's-1').disabled).toBe(false)
    expect(checkbox(wrapper, 's-1').getAttribute('aria-disabled')).toBe('true')
    expect(checkbox(wrapper, 's-1').getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(checkbox(wrapper, 's-1'))
    expect(assignServiceMock).toHaveBeenCalledTimes(1)

    // Un segundo cambio mientras guarda se descarta y la casilla vuelve al estado real.
    checkbox(wrapper, 's-1').checked = false
    await checkbox(wrapper, 's-1').dispatchEvent(new Event('change'))
    await flushPromises()
    expect(assignServiceMock).toHaveBeenCalledTimes(1)
    expect(unassignServiceMock).not.toHaveBeenCalled()

    resolveAssign({
      kind: 'success',
      assignment: { professionalId: 'b-1', serviceId: 's-1', createdAt: '2026-08-24T15:04:05Z' },
    })
    await flushPromises()

    expect(checkbox(wrapper, 's-1').getAttribute('aria-disabled')).toBeNull()
    expect(document.activeElement).toBe(checkbox(wrapper, 's-1'))
  })

  it('never shows professional schedules, availability, appointments, or per-professional pricing', async () => {
    const wrapper = await mountReady(fourProfessionals, twoServices, ['s-1'])
    const text = wrapper.text().toLowerCase()
    for (const forbidden of [
      'horario',
      'disponib',
      'agenda',
      'cita',
      'precio',
      'duración',
      'comisión',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('has no axe violations in the ready view', async () => {
    const wrapper = await mountReady(fourProfessionals, twoServices, ['s-1'])
    const results = await axe(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })

  // heading-order: BaseAlert.vue (HU-009) fija el título de una alerta como
  // `<h4>` porque es la etiqueta de un widget transitorio (`role="alert"`),
  // no un encabezado del esquema del documento; junto al único `<h1>` real
  // de esta página, axe interpreta ese salto como un esquema de encabezados
  // roto. Mismo criterio documentado en LoginPage.test.ts/SettingsPage.test.ts:
  // no es un defecto de esta pantalla ni de BaseAlert.
  const axeOptionsWithAlert = {
    rules: { 'color-contrast': { enabled: false }, 'heading-order': { enabled: false } },
  }

  it('has no axe violations with the save-error alert visible', async () => {
    const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
    unassignServiceMock.mockResolvedValueOnce({ kind: 'network-error' })

    const box = checkbox(wrapper, 's-1')
    box.checked = false
    await box.dispatchEvent(new Event('change'))
    await flushPromises()

    const results = await axe(wrapper.element, axeOptionsWithAlert)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations in the load-error state', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
    const wrapper = mountPage()
    await flushPromises()

    const results = await axe(wrapper.element, axeOptionsWithAlert)
    expect(results).toHaveNoViolations()
  })

  describe('en renglones con el retrato de latón (#841)', () => {
    const row = (wrapper: VueWrapper, serviceId: string) =>
      checkbox(wrapper, serviceId).closest('li') as HTMLLIElement
    const state = (wrapper: VueWrapper, serviceId: string) =>
      Array.from(
        row(wrapper, serviceId).querySelector('.professional-services-page__assignment')!.classList,
      )
        .find((c) => c.startsWith('professional-services-page__assignment--'))
        ?.replace('professional-services-page__assignment--', '')

    it('pinta cada renglón sin el cuadrito de la inicial y con el rombo y la palabra (CA-1, CA-3)', async () => {
      const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
      expect(wrapper.find('.professional-services-page__service-icon').exists()).toBe(false)
      expect(state(wrapper, 's-1')).toBe('on')
      expect(state(wrapper, 's-2')).toBe('off')
      // Las tres palabras viven en la misma celda (ancho reservado, CA-16).
      const words = row(wrapper, 's-1').querySelectorAll(
        '.professional-services-page__assignment-words > span',
      )
      expect(Array.from(words).map((w) => w.textContent)).toEqual([
        'Asignado',
        'No asignado',
        'Guardando…',
      ])
    })

    it('anuncia una sola vez: la casilla se llama como el servicio y el estado visible va aria-hidden (CA-17)', async () => {
      const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
      const box = checkbox(wrapper, 's-1')
      expect(box.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Corte clásico')
      expect(
        row(wrapper, 's-1')
          .querySelector('.professional-services-page__assignment')!
          .getAttribute('aria-hidden'),
      ).toBe('true')
      // Ninguna región viva dentro de la lista: el aviso emergente es el único anuncio.
      expect(wrapper.find('.professional-services-page__list [aria-live]').exists()).toBe(false)
    })

    it('mientras guarda, el sol ocupa el sitio del rombo y la casilla sigue enfocada (CA-5, CA-24)', async () => {
      let finish: (value: unknown) => void = () => {}
      assignServiceMock.mockReturnValue(new Promise((r) => (finish = r)))
      const wrapper = await mountReady()
      const box = checkbox(wrapper, 's-1')
      box.focus()
      box.checked = true
      box.dispatchEvent(new Event('change'))
      await flushPromises()
      expect(state(wrapper, 's-1')).toBe('pending')
      expect(row(wrapper, 's-1').querySelector('.sun-diamond, svg')).not.toBeNull()
      expect(box.getAttribute('aria-disabled')).toBe('true')
      expect(box.disabled).toBe(false)
      expect(document.activeElement).toBe(box)
      finish({ kind: 'success' })
      await flushPromises()
      expect(state(wrapper, 's-1')).toBe('on')
      expect(document.activeElement).toBe(box)
    })

    it.each([
      ['red', { kind: 'network-error' }, 'No pudimos conectar'],
      ['inesperado', { kind: 'unexpected-error' }, 'Ocurrió un error inesperado'],
    ])(
      'si falla (%s), la casilla vuelve, el foco se queda y el aviso va bajo su renglón (CA-18)',
      async (_name, outcome, text) => {
        assignServiceMock.mockResolvedValue(outcome)
        const wrapper = await mountReady()
        const box = checkbox(wrapper, 's-2')
        box.focus()
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await flushPromises()
        expect(box.checked).toBe(false)
        expect(document.activeElement).toBe(box)
        const error = row(wrapper, 's-2').querySelector('[role="alert"]')!
        expect(error.textContent).toContain('No pudimos guardar el cambio.')
        expect(error.textContent).toContain(text)
        expect(box.getAttribute('aria-describedby')).toBe(error.id)
        // Nada arriba de la lista: el único aviso es el del renglón.
        expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
        expect(row(wrapper, 's-1').querySelector('[role="alert"]')).toBeNull()
      },
    )

    it('varios cambios seguidos no reordenan los renglones y cada casilla termina como dijo el servidor (CA-21)', async () => {
      const services = [
        { id: 's-1', name: 'Corte clásico' },
        { id: 's-2', name: 'Barba' },
        { id: 's-3', name: 'Color completo' },
      ]
      const finishers: Record<string, (value: unknown) => void> = {}
      assignServiceMock.mockImplementation(
        (_professionalId: string, serviceId: string) =>
          new Promise((r) => (finishers[serviceId] = r)),
      )
      const wrapper = await mountReady(oneProfessional, services)
      for (const id of ['s-1', 's-2', 's-3']) {
        const box = checkbox(wrapper, id)
        box.checked = true
        box.dispatchEvent(new Event('change'))
      }
      await flushPromises()
      finishers['s-3']!({ kind: 'success' })
      finishers['s-1']!({ kind: 'network-error' })
      finishers['s-2']!({ kind: 'success' })
      await flushPromises()
      const order = wrapper
        .findAll('.professional-services-page__service-name')
        .map((n) => n.text())
      expect(order).toEqual(['Corte clásico', 'Barba', 'Color completo'])
      expect(['s-1', 's-2', 's-3'].map((id) => checkbox(wrapper, id).checked)).toEqual([
        false,
        true,
        true,
      ])
      expect(['s-1', 's-2', 's-3'].map((id) => state(wrapper, id))).toEqual(['off', 'on', 'on'])
    })

    it('dice la cifra en texto, «n de m servicios», y la barra no se anuncia (CA-7)', async () => {
      const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])
      expect(
        wrapper.get('.professional-services-page__meter-figure').text().replace(/\s+/g, ' '),
      ).toBe('1 de 2 servicios')
      expect(
        wrapper.get('.professional-services-page__meter-track').attributes('aria-hidden'),
      ).toBe('true')
      expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
    })

    it('dice «servicio» en singular con un solo servicio en el catálogo', async () => {
      const wrapper = await mountReady(oneProfessional, [{ id: 's-1', name: 'Corte' }])
      expect(
        wrapper.get('.professional-services-page__meter-figure').text().replace(/\s+/g, ' '),
      ).toBe('0 de 1 servicio')
    })

    it('deja el foco en el selector al cambiar de profesional (CA-20)', async () => {
      const wrapper = await mountReady(fourProfessionals)
      fetchAssignmentsMock.mockResolvedValueOnce({
        kind: 'success',
        page: { items: [], nextCursor: null },
      })
      await chooseProfessional(wrapper, 'Ana Torres')
      await flushPromises()
      expect(document.activeElement?.id).toBe('professional-services-professional-select')
    })
  })

  describe('panel del empleado (DEC-173)', () => {
    afterEach(() => resetBrand())

    it('is «Mis servicios» for their own professional, without a professional picker', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'employee' })
      const wrapper = await mountReady(oneProfessional, twoServices, ['s-1'])

      expect(wrapper.get('h1').text()).toBe('Mis servicios')
      expect(wrapper.find('#professional-services-professional-select').exists()).toBe(false)
      expect(wrapper.text()).toContain('Carlos Ramírez')
      expect(wrapper.text()).toContain('Corte clásico')
    })

    it('asks the business to link the account when there is no professional', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'employee' })
      fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      fetchServiceSummariesMock.mockResolvedValueOnce({ kind: 'success', items: twoServices })
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('Tu cuenta aún no tiene un perfil.')
      expect(wrapper.find('a').exists()).toBe(false)
    })

    it('keeps the picker in the full panel with one professional', async () => {
      const wrapper = await mountReady()

      expect(wrapper.find('#professional-services-professional-select').exists()).toBe(true)
    })
  })
})
