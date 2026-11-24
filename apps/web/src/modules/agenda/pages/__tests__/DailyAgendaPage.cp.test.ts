/**
 * CP-023 del Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III):
 * navegación entre días de la agenda. Fixture del plan: Barbería Alfa en
 * America/Bogota con citas ayer, hoy y mañana, y el reloj a las 23:30 de hoy en
 * la zona del negocio (ya es mañana en UTC). La etapa «Pruebas unitarias · Plan
 * de Pruebas (CP)» del Jenkinsfile corre todo lo que empieza por «CP-».
 * appointmentsApi se sustituye por un doble; el recorrido real contra el API
 * vive en los E2E de HU-063.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { resetBrand } from '@/shared/model'

const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchBusinessTimezoneMock = vi.hoisted(() => vi.fn())
const fetchDailyAgendaMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/appointmentsApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchBusinessTimezone: fetchBusinessTimezoneMock,
  fetchDailyAgenda: fetchDailyAgendaMock,
}))

const { default: DailyAgendaPage } = await import('../DailyAgendaPage.vue')

// 23:30 del lunes 14 de septiembre en Bogotá (UTC−5) = 04:30 del martes 15 en UTC.
const NEAR_MIDNIGHT = new Date('2026-09-15T04:30:00Z')
const AYER = '2026-09-13'
const HOY = '2026-09-14'
const MANANA = '2026-09-15'

function entry(id: string, attendeeName: string, startsAt: string, endsAt: string) {
  return {
    id,
    attendeeName,
    startsAt,
    endsAt,
    status: 'confirmed',
    origin: 'manual',
    serviceName: 'Corte clásico',
    durationMinutes: 30,
    priceAmount: '20000.00',
    currency: 'COP',
    homeService: null,
  }
}

// Las citas de cada día, en la hora local de Bogotá indicada en el nombre.
const AGENDA: Record<string, ReturnType<typeof entry>[]> = {
  [AYER]: [entry('c-ayer', 'Cliente Ayer 10:00', '2026-09-13T15:00:00Z', '2026-09-13T15:30:00Z')],
  [HOY]: [
    entry('c-hoy-1', 'Cliente Hoy 10:00', '2026-09-14T15:00:00Z', '2026-09-14T15:30:00Z'),
    entry('c-hoy-2', 'Cliente Hoy 16:00', '2026-09-14T21:00:00Z', '2026-09-14T21:30:00Z'),
  ],
  [MANANA]: [
    entry('c-manana', 'Cliente Mañana 10:00', '2026-09-15T15:00:00Z', '2026-09-15T15:30:00Z'),
  ],
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/panel', name: 'panel', component: { template: '<div>panel</div>' } },
      {
        path: '/panel/turnos/nuevo',
        name: 'agenda-nuevo-turno',
        component: { template: '<div/>' },
      },
      {
        path: '/panel/turnos/:appointmentId',
        name: 'agenda-detalle-turno',
        component: { template: '<div/>' },
      },
      { path: '/profesionales', name: 'staff-profesionales', component: { template: '<div/>' } },
    ],
  })
}

async function settle() {
  // La primera vista se destapa en cuanto hay algo entero que mostrar (#822):
  // con dobles inmediatos no hay retención que esperar.
  await flushPromises()
  await flushPromises()
}

async function mountAlfa(query: Record<string, string> = {}) {
  fetchProfessionalSummariesMock.mockResolvedValue({
    kind: 'success',
    items: [{ id: 'b-1', fullName: 'Barbero Uno' }],
  })
  fetchBusinessTimezoneMock.mockResolvedValue({ kind: 'success', timezone: 'America/Bogota' })
  const router = buildRouter()
  await router.push({ name: 'panel', query })
  await router.isReady()
  const wrapper = mount(DailyAgendaPage, {
    global: { plugins: [router], stubs: { teleport: true } },
  })
  await settle()
  return { wrapper, router }
}

type Wrapper = Awaited<ReturnType<typeof mountAlfa>>['wrapper']

function listText(wrapper: Wrapper) {
  return wrapper.get('.daily-agenda-page__list').text()
}

function expectOnly(wrapper: Wrapper, date: string) {
  const text = listText(wrapper)
  for (const [day, items] of Object.entries(AGENDA)) {
    for (const item of items) {
      if (day === date) expect(text).toContain(item.attendeeName)
      else expect(text).not.toContain(item.attendeeName)
    }
  }
}

async function click(wrapper: Wrapper, label: 'Día anterior' | 'Día siguiente') {
  await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
  await flushPromises()
}

describe('CP-023 navegación entre días', () => {
  beforeEach(() => {
    fetchProfessionalSummariesMock.mockReset()
    fetchBusinessTimezoneMock.mockReset()
    fetchDailyAgendaMock.mockReset()
    fetchDailyAgendaMock.mockImplementation((_professionalId: string, date: string) =>
      Promise.resolve({ kind: 'success', items: AGENDA[date] ?? [] }),
    )
    resetBrand()
    // Solo se congela la fecha: los temporizadores siguen reales para la carga.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NEAR_MIDNIGHT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('CP-023 abre en el día de hoy según la zona de la barbería, no la de UTC', async () => {
    const { wrapper, router } = await mountAlfa()
    expect(router.currentRoute.value.query.date).toBe(HOY)
    expect(fetchDailyAgendaMock).toHaveBeenLastCalledWith('b-1', HOY)
    expectOnly(wrapper, HOY)
  })

  it('CP-023 siguiente, anterior y volver a hoy muestran solo las citas de cada fecha', async () => {
    const { wrapper, router } = await mountAlfa()
    const dateTrigger = () => wrapper.get('#daily-agenda-date-picker').text()
    const todayLabel = dateTrigger()

    await click(wrapper, 'Día siguiente')
    expect(router.currentRoute.value.query.date).toBe(MANANA)
    expectOnly(wrapper, MANANA)
    expect(dateTrigger()).not.toBe(todayLabel)

    await click(wrapper, 'Día anterior')
    await click(wrapper, 'Día anterior')
    expect(router.currentRoute.value.query.date).toBe(AYER)
    expectOnly(wrapper, AYER)

    await wrapper.get('#daily-agenda-date-picker').trigger('click')
    await wrapper.get('.agenda-date-picker__today').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.date).toBe(HOY)
    expectOnly(wrapper, HOY)
    expect(dateTrigger()).toBe(todayLabel)
  })

  it('CP-023 conserva el orden de las citas del día', async () => {
    const { wrapper } = await mountAlfa()
    const text = listText(wrapper)
    expect(text.indexOf('Cliente Hoy 10:00')).toBeLessThan(text.indexOf('Cliente Hoy 16:00'))
  })

  it('CP-023 recargar con una fecha en la URL vuelve a esa misma fecha', async () => {
    const { wrapper, router } = await mountAlfa({ date: MANANA, professionalId: 'b-1' })
    expect(fetchDailyAgendaMock).toHaveBeenCalledTimes(1)
    expect(fetchDailyAgendaMock).toHaveBeenCalledWith('b-1', MANANA)
    expect(router.currentRoute.value.query.date).toBe(MANANA)
    expectOnly(wrapper, MANANA)
  })

  it('CP-023 pasada la medianoche en la barbería, hoy ya es el día siguiente', async () => {
    vi.setSystemTime(new Date('2026-09-15T05:00:30Z')) // 00:00:30 del martes en Bogotá
    const { wrapper, router } = await mountAlfa()
    expect(router.currentRoute.value.query.date).toBe(MANANA)
    expectOnly(wrapper, MANANA)
  })
})
