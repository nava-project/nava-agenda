/**
 * La entrada a la Agenda (#822, F2/F6): una sola espera con la forma de la
 * pantalla desde el primer cuadro, sin cargador que destelle, y lo ya leído en
 * la sesión (profesionales y zona) dibuja la pantalla al volver mientras se
 * relee por detrás.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const businessId = vi.hoisted(() => ({ current: null as unknown as { value: string | null } }))
vi.mock('@/modules/auth', async () => {
  const { ref: vueRef } = await import('vue')
  businessId.current = vueRef<string | null>('negocio-a')
  return { sessionBusinessId: businessId.current }
})

const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchBusinessTimezoneMock = vi.hoisted(() => vi.fn())
const fetchDailyAgendaMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/appointmentsApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchBusinessTimezone: fetchBusinessTimezoneMock,
  fetchDailyAgenda: fetchDailyAgendaMock,
}))

const { default: DailyAgendaPage } = await import('../DailyAgendaPage.vue')
const { forgetAgendaContext } = await import('../../model/agendaContext')

const TWO = [
  { id: 'b-1', fullName: 'Carlos Ramírez' },
  { id: 'b-2', fullName: 'Ana Gómez' },
]
const THREE = [...TWO, { id: 'b-3', fullName: 'Luisa Pardo' }]
const TIMEZONE = { kind: 'success', timezone: 'America/Bogota' }
const never = () => new Promise(() => {})

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/panel', name: 'panel', component: { template: '<div/>' } },
      {
        path: '/panel/turnos/nuevo',
        name: 'agenda-nuevo-turno',
        component: { template: '<div/>' },
      },
      { path: '/profesionales', name: 'staff-profesionales', component: { template: '<div/>' } },
    ],
  })
}

async function mountPage() {
  const router = buildRouter()
  await router.push({ name: 'panel' })
  await router.isReady()
  return mount(DailyAgendaPage, { global: { plugins: [router], stubs: { teleport: true } } })
}

const cover = (w: Awaited<ReturnType<typeof mountPage>>) => w.find('.content-reveal__cover')

async function optionNames(w: Awaited<ReturnType<typeof mountPage>>) {
  await w.get('#daily-agenda-professional-select').trigger('click')
  // El texto de cada opción lleva delante las iniciales del avatar.
  const names = w.findAll('[role="option"]').map((o) => o.text())
  await w.get('#daily-agenda-professional-select').trigger('click')
  return names
}

function expectNames(options: string[], names: string[]) {
  expect(options).toHaveLength(names.length)
  names.forEach((name, i) => expect(options[i]).toContain(name))
}

describe('DailyAgendaPage: la entrada (#822)', () => {
  beforeEach(() => {
    forgetAgendaContext()
    businessId.current.value = 'negocio-a'
    fetchProfessionalSummariesMock.mockReset()
    fetchBusinessTimezoneMock.mockReset()
    fetchDailyAgendaMock.mockReset()
    fetchDailyAgendaMock.mockResolvedValue({ kind: 'success', items: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('shows the shape of the screen from the first render, never a page with only its title', async () => {
    fetchProfessionalSummariesMock.mockReturnValue(never())
    fetchBusinessTimezoneMock.mockReturnValue(never())
    const wrapper = await mountPage()
    const shape = cover(wrapper)
    expect(shape.exists()).toBe(true)
    expect(shape.find('.daily-agenda-page__controls').exists()).toBe(true)
    expect(shape.find('.agenda-skeleton').exists()).toBe(true)
    expect(shape.text()).toContain('Cargando profesionales…')
    // «Nuevo turno» guarda su sitio mientras tanto: aparecer no empuja la agenda.
    expect(wrapper.find('.daily-agenda-page__header .daily-agenda-page__skel--cta').exists()).toBe(
      true,
    )
  })

  it('uncovers once the day is in, without a second, different wait', async () => {
    fetchProfessionalSummariesMock.mockResolvedValue({ kind: 'success', items: TWO })
    fetchBusinessTimezoneMock.mockResolvedValue(TIMEZONE)
    let resolveDay: (v: unknown) => void = () => {}
    fetchDailyAgendaMock.mockReturnValueOnce(new Promise((ok) => (resolveDay = ok)))
    const wrapper = await mountPage()
    await flushPromises()
    // Ya hay profesionales, falta el día: la misma tapa sigue, ya sin hablar de profesionales.
    expect(cover(wrapper).exists()).toBe(true)
    expect(cover(wrapper).text()).toContain('Cargando la agenda…')
    resolveDay({ kind: 'success', items: [] })
    await flushPromises()
    expect(cover(wrapper).exists()).toBe(false)
    expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(true)
  })

  it('keeps the wait in view once it could be seen, instead of flashing it', async () => {
    vi.useFakeTimers()
    fetchProfessionalSummariesMock.mockImplementation(
      () => new Promise((ok) => setTimeout(() => ok({ kind: 'success', items: TWO }), 350)),
    )
    fetchBusinessTimezoneMock.mockResolvedValue(TIMEZONE)
    const wrapper = await mountPage()
    await vi.advanceTimersByTimeAsync(360)
    expect(cover(wrapper).exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(220)
    expect(cover(wrapper).exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(40)
    expect(cover(wrapper).exists()).toBe(false)
  })

  it('comes back drawing what was already read and rereads it behind', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: TWO })
    fetchBusinessTimezoneMock.mockResolvedValueOnce(TIMEZONE)
    ;(await mountPage()).unmount()
    await flushPromises()

    fetchProfessionalSummariesMock.mockReturnValueOnce(never())
    fetchBusinessTimezoneMock.mockReturnValueOnce(never())
    const back = await mountPage()
    await flushPromises()
    expect(cover(back).exists()).toBe(false)
    expectNames(await optionNames(back), ['Carlos Ramírez', 'Ana Gómez'])
    expect(fetchProfessionalSummariesMock).toHaveBeenCalledTimes(2)
  })

  it('brings the screen up to date when the reread brings someone new', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: TWO })
    fetchBusinessTimezoneMock.mockResolvedValue(TIMEZONE)
    ;(await mountPage()).unmount()
    await flushPromises()

    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: THREE })
    const back = await mountPage()
    await flushPromises()
    expectNames(await optionNames(back), ['Carlos Ramírez', 'Ana Gómez', 'Luisa Pardo'])
  })

  it('keeps what is shown when the reread fails', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: TWO })
    fetchBusinessTimezoneMock.mockResolvedValueOnce(TIMEZONE)
    ;(await mountPage()).unmount()
    await flushPromises()

    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    fetchBusinessTimezoneMock.mockResolvedValueOnce(TIMEZONE)
    const back = await mountPage()
    await flushPromises()
    expect(back.find('[role="alert"]').exists()).toBe(false)
    expectNames(await optionNames(back), ['Carlos Ramírez', 'Ana Gómez'])
  })

  it('never shows what was read for another business', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: TWO })
    fetchBusinessTimezoneMock.mockResolvedValueOnce(TIMEZONE)
    ;(await mountPage()).unmount()
    await flushPromises()

    businessId.current.value = 'negocio-b'
    fetchProfessionalSummariesMock.mockReturnValueOnce(never())
    fetchBusinessTimezoneMock.mockReturnValueOnce(never())
    const other = await mountPage()
    await flushPromises()
    expect(cover(other).exists()).toBe(true)
    expect(other.text()).not.toContain('Carlos Ramírez')
  })
})
