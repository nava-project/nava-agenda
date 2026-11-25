/**
 * Composición de «Servicios» en app (DEC-115): el catálogo no conoce las
 * asignaciones ni al revés. Las APIs de los dos módulos se sustituyen por dobles;
 * el recorrido real contra el servidor vive en el E2E del perfil de profesional
 * individual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { DEFAULT_MIN_HOLD_MS } from '@/shared/composables'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'
import { resetToasts, toastState } from '@/shared/model/toastStore'

const fetchServicesMock = vi.hoisted(() => vi.fn())
const createServiceMock = vi.hoisted(() => vi.fn())
const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchAssignmentsMock = vi.hoisted(() => vi.fn())
const assignServiceMock = vi.hoisted(() => vi.fn())
const unassignServiceMock = vi.hoisted(() => vi.fn())

vi.mock('@/modules/catalog/api/catalogApi', () => ({
  fetchServices: fetchServicesMock,
  createService: createServiceMock,
  updateService: vi.fn(),
  previewDeactivation: vi.fn(),
  deactivateService: vi.fn(),
  reactivateService: vi.fn(),
}))
vi.mock('@/modules/professionalServices/api/professionalServicesApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchAssignments: fetchAssignmentsMock,
  assignService: assignServiceMock,
  unassignService: unassignServiceMock,
}))

const { default: CatalogWorkspacePage } = await import('../CatalogWorkspacePage.vue')
// `CatalogPage` llega en diferido (defineAsyncComponent). Sin precargarlo, la primera
// prueba pagaba la transformación en frío del módulo (~740 ms con la máquina en reposo)
// dentro del `vi.waitFor` de `mountPage`, cuyo límite es 1 s: con carga se pasaba (#836).
// Precargado aquí, el cargador diferido resuelve desde la caché de módulos en milisegundos.
await import('@/modules/catalog/pages/CatalogPage.vue')

function service(id: string, name: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name,
    description: null,
    durationMinutes: 30,
    price: '45000.00',
    currency: 'COP',
    isActive: true,
    deactivatedAt: null,
    createdAt: '2026-08-24T15:04:05Z',
    updatedAt: '2026-08-24T15:04:05Z',
    ...overrides,
  }
}

const services = [service('s-1', 'Corte clásico'), service('s-2', 'Barba perfilada')]
const solo = { ...DEFAULT_BRAND, panelProfile: 'solo' as const }
const oneProfessional = { kind: 'success', items: [{ id: 'b-1', fullName: 'Mateo Rojas' }] }
const assignmentsOf = (...ids: string[]) => ({
  kind: 'success',
  page: {
    items: ids.map((serviceId) => ({ professionalId: 'b-1', serviceId, createdAt: '2026-10-04' })),
    nextCursor: null,
  },
})

// Reloj simulado (#867, como StaffPage en #834): el catálogo sostiene su rombo de
// carga DEFAULT_MIN_HOLD_MS con setTimeout y Date.now(). Con una espera real en la
// prueba, un CI cargado la reordenaba frente a la del componente. setImmediate sigue
// real porque lo usa flushPromises; vi.waitFor avanza el reloj simulado en cada intento.
// Ese vi.waitFor del montaje avanza hasta 1 s y absorbe una mínima más larga de lo
// previsto: el valor exacto de la mínima del catálogo lo vigila CatalogPage.test.ts,
// no este archivo (revisión de #870).
const COMPONENT_WAITS = {
  // useMinHoldLoading: el rombo de la carga, con margen.
  loadHold: DEFAULT_MIN_HOLD_MS + 50,
} as const

async function passComponentWait(wait: keyof typeof COMPONENT_WAITS) {
  await vi.advanceTimersByTimeAsync(COMPONENT_WAITS[wait])
}

function waitOutHold() {
  return passComponentWait('loadHold')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

// `CatalogPage` se carga de forma diferida (defineAsyncComponent): hay que esperar a que
// monte antes de contar el rombo de carga, y desmontar al terminar para que una página
// rezagada de una prueba no consuma los dobles de la siguiente.
const mounted: VueWrapper[] = []

async function mountPage() {
  fetchServicesMock.mockResolvedValueOnce({
    kind: 'success',
    page: { items: [...services], page: 1, pageSize: 20, total: 2, totalPages: 1 },
  })
  const wrapper = mount(CatalogWorkspacePage, {
    global: { stubs: { teleport: true, transition: true } },
  })
  mounted.push(wrapper)
  await vi.waitFor(() => expect(wrapper.find('.catalog-page').exists()).toBe(true))
  await flushPromises()
  await waitOutHold()
  await flushPromises()
  return wrapper
}

const switches = (wrapper: VueWrapper) => wrapper.findAll('[role="switch"]')

// Tras crear, el catálogo vuelve a pedir la página (HALL-CAT-03): el servidor devuelve la
// lista con el servicio nuevo al final, porque ordena por created_at.
function serverListsCreated(created: ReturnType<typeof service>) {
  fetchServicesMock.mockResolvedValueOnce({
    kind: 'success',
    page: { items: [...services, created], page: 1, pageSize: 20, total: 3, totalPages: 1 },
  })
}

describe('CatalogWorkspacePage', () => {
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount()
  })

  beforeEach(() => {
    resetToasts()
    resetBrand()
    for (const mock of [
      fetchServicesMock,
      createServiceMock,
      fetchProfessionalSummariesMock,
      fetchAssignmentsMock,
      assignServiceMock,
      unassignServiceMock,
    ]) {
      mock.mockReset()
    }
  })

  it('is the plain catalog in the full panel: no column, no assignment request', async () => {
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('Corte clásico')
    expect(switches(wrapper)).toHaveLength(0)
    expect(wrapper.find('.catalog-page__table--offer').exists()).toBe(false)
    expect(fetchProfessionalSummariesMock).not.toHaveBeenCalled()
  })

  it('adds «Lo ofrezco» to every service in the solo profile, reflecting what is assigned', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce(oneProfessional)
    fetchAssignmentsMock.mockResolvedValueOnce(assignmentsOf('s-1'))
    const wrapper = await mountPage()

    expect(wrapper.get('.catalog-page__columns').text()).toContain('Lo ofrezco')
    expect(switches(wrapper).map((s) => s.attributes('aria-checked'))).toEqual(['true', 'false'])
    expect(switches(wrapper).map((s) => s.attributes('aria-label'))).toEqual([
      'Lo ofrezco: Corte clásico',
      'Lo ofrezco: Barba perfilada',
    ])
  })

  it('offers and stops offering a service through the real assignment', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce(oneProfessional)
    fetchAssignmentsMock.mockResolvedValueOnce(assignmentsOf('s-1'))
    const wrapper = await mountPage()
    assignServiceMock.mockResolvedValueOnce({ kind: 'success', assignment: {} })
    unassignServiceMock.mockResolvedValueOnce({ kind: 'success' })

    await switches(wrapper)[1]!.trigger('click')
    await flushPromises()
    expect(assignServiceMock).toHaveBeenCalledWith('b-1', 's-2')
    expect(switches(wrapper)[1]!.attributes('aria-checked')).toBe('true')

    await switches(wrapper)[0]!.trigger('click')
    await flushPromises()
    expect(unassignServiceMock).toHaveBeenCalledWith('b-1', 's-1')
    expect(switches(wrapper)[0]!.attributes('aria-checked')).toBe('false')
  })

  it('keeps the switch where it was when the server refuses', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce(oneProfessional)
    fetchAssignmentsMock.mockResolvedValueOnce(assignmentsOf('s-1'))
    const wrapper = await mountPage()
    unassignServiceMock.mockResolvedValueOnce({ kind: 'last-active-conflict' })

    await switches(wrapper)[0]!.trigger('click')
    await flushPromises()

    expect(switches(wrapper)[0]!.attributes('aria-checked')).toBe('true')
    expect(toastState.items.map((t) => t.title)).toEqual(['No pudimos guardar el cambio'])
  })

  it('offers a newly created service to the only professional', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce(oneProfessional)
    fetchAssignmentsMock.mockResolvedValueOnce(assignmentsOf())
    const wrapper = await mountPage()
    createServiceMock.mockResolvedValueOnce({
      kind: 'success',
      service: service('s-new', 'Cejas'),
    })
    assignServiceMock.mockResolvedValueOnce({ kind: 'success', assignment: {} })
    serverListsCreated(service('s-new', 'Cejas'))

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Agregar servicio')!
      .trigger('click')
    await flushPromises()
    const form = wrapper.element.querySelector('.base-dialog--open form') as HTMLFormElement
    const set = (name: string, value: string) => {
      const input = form.querySelector(`input[name="${name}"]`) as HTMLInputElement
      input.value = value
      input.dispatchEvent(new Event('input'))
    }
    set('name', 'Cejas')
    set('durationMinutes', '15')
    set('price', '10000.00')
    await flushPromises()
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    await waitOutHold()
    await flushPromises()

    expect(assignServiceMock).toHaveBeenCalledWith('b-1', 's-new')
    expect(switches(wrapper).at(-1)!.attributes('aria-label')).toBe('Lo ofrezco: Cejas')
    expect(switches(wrapper).at(-1)!.attributes('aria-checked')).toBe('true')
  })

  it('says so when a created service could not be offered, and leaves it switchable', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce(oneProfessional)
    fetchAssignmentsMock.mockResolvedValueOnce(assignmentsOf())
    const wrapper = await mountPage()
    createServiceMock.mockResolvedValueOnce({
      kind: 'success',
      service: service('s-new', 'Cejas'),
    })
    assignServiceMock.mockResolvedValueOnce({ kind: 'network-error' })
    serverListsCreated(service('s-new', 'Cejas'))

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Agregar servicio')!
      .trigger('click')
    await flushPromises()
    const form = wrapper.element.querySelector('.base-dialog--open form') as HTMLFormElement
    for (const [name, value] of [
      ['name', 'Cejas'],
      ['durationMinutes', '15'],
      ['price', '10000.00'],
    ] as const) {
      const input = form.querySelector(`input[name="${name}"]`) as HTMLInputElement
      input.value = value
      input.dispatchEvent(new Event('input'))
    }
    await flushPromises()
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    expect(toastState.items.map((t) => [t.variant, t.title])).toContainEqual([
      'warning',
      'El servicio se creó, pero aún no lo ofreces',
    ])
    await waitOutHold()
    await flushPromises()
    expect(switches(wrapper).at(-1)!.attributes('aria-checked')).toBe('false')
  })

  it('shows no column when the solo profile has several professionals: there is nobody to pick', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: [
        { id: 'b-1', fullName: 'A' },
        { id: 'b-2', fullName: 'B' },
      ],
    })
    const wrapper = await mountPage()

    expect(switches(wrapper)).toHaveLength(0)
    expect(wrapper.find('.catalog-page__table--offer').exists()).toBe(false)
    expect(fetchAssignmentsMock).not.toHaveBeenCalled()
  })

  it('starts loading what the professional offers when the profile arrives after mounting', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce(oneProfessional)
    fetchAssignmentsMock.mockResolvedValueOnce(assignmentsOf('s-2'))
    const wrapper = await mountPage()
    expect(switches(wrapper)).toHaveLength(0)

    setBrand(solo)
    await flushPromises()

    expect(switches(wrapper).map((s) => s.attributes('aria-checked'))).toEqual(['false', 'true'])
  })

  it('warns once when what the professional offers cannot be loaded, without breaking the catalog', async () => {
    setBrand(solo)
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('Corte clásico')
    expect(switches(wrapper)).toHaveLength(0)
    expect(toastState.items.map((t) => t.title)).toEqual([
      'No pudimos cargar qué servicios ofreces',
    ])
  })
})
