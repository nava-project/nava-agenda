/**
 * Pruebas de DailyAgendaPage (HU-062): carga (vacío, error), selector
 * obligatorio de un profesional (DEC-074, sin vista consolidada), estados de la
 * agenda (carga, vacío, error, listo), aislamiento entre selecciones
 * rápidas de profesional, navegación a "Nuevo turno" y accesibilidad.
 * appointmentsApi se sustituye por un doble de prueba; el recorrido real
 * contra el API vive en el E2E de HU-062.
 */
import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { axe } from 'vitest-axe'
import { shiftCivilDate } from '@/shared/time/civilDate'
import { DEFAULT_MIN_HOLD_MS } from '@/shared/composables'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'

// useMinHoldLoading (issue 2026-09-28, "se ve como se genera el objeto")
// mantiene pageStatus/agendaStatus en su primera carga con un setTimeout
// REAL de al menos DEFAULT_MIN_HOLD_MS antes de pasar a listo/error;
// flushPromises() (solo microtareas) no alcanza a esperarlo. Con margen
// sobre el valor exacto para no quedar al borde por jitter del entorno de
// pruebas. No aplica a la actualización por cambio de fecha/profesional (usa
// 'updating', sin retraso propio, sin tocar).
function waitOutInitialLoadHold() {
  return new Promise((resolve) => setTimeout(resolve, DEFAULT_MIN_HOLD_MS + 50))
}

const fetchProfessionalSummariesMock = vi.hoisted(() => vi.fn())
const fetchBusinessTimezoneMock = vi.hoisted(() => vi.fn())
const fetchDailyAgendaMock = vi.hoisted(() => vi.fn())

vi.mock('../../api/appointmentsApi', () => ({
  fetchProfessionalSummaries: fetchProfessionalSummariesMock,
  fetchBusinessTimezone: fetchBusinessTimezoneMock,
  fetchDailyAgenda: fetchDailyAgendaMock,
}))

const { default: DailyAgendaPage } = await import('../DailyAgendaPage.vue')

const twoProfessionals = [
  { id: 'b-1', fullName: 'Carlos Ramírez' },
  { id: 'b-2', fullName: 'Ana Gómez' },
]

const oneEntry = [
  {
    id: 'a-1',
    attendeeName: 'Juan Pérez',
    startsAt: '2026-08-28T19:30:00Z',
    endsAt: '2026-08-28T20:00:00Z',
    status: 'confirmed',
    origin: 'manual',
    serviceName: 'Corte clásico',
    durationMinutes: 30,
    priceAmount: '20000.00',
    currency: 'COP',
    homeService: null,
  },
]

// 23:30 (2026-08-28, America/Bogota) → 00:30 del día siguiente: cruza
// medianoche, para probar la marca "Cambio de día" (issue #189, evento 11).
const nightEntry = [
  {
    id: 'a-2',
    attendeeName: 'Laura Méndez',
    startsAt: '2026-08-29T04:30:00Z',
    endsAt: '2026-08-29T05:30:00Z',
    status: 'confirmed',
    origin: 'manual',
    serviceName: 'Corte clásico',
    durationMinutes: 60,
    priceAmount: '25000.00',
    currency: 'COP',
    homeService: null,
  },
]

const terminalEntry = [
  {
    id: 'a-3',
    attendeeName: 'Carlos Ruiz',
    startsAt: '2026-08-28T18:00:00Z',
    endsAt: '2026-08-28T18:30:00Z',
    status: 'completed',
    origin: 'manual',
    serviceName: 'Barba',
    durationMinutes: 30,
    priceAmount: '15000.00',
    currency: 'COP',
    homeService: null,
  },
]

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/panel', name: 'panel', component: { template: '<div>panel</div>' } },
      {
        path: '/panel/turnos/nuevo',
        name: 'agenda-nuevo-turno',
        component: { template: '<div>nuevo turno</div>' },
      },
      {
        path: '/panel/turnos/:appointmentId',
        name: 'agenda-detalle-turno',
        component: { template: '<div>detalle</div>' },
      },
      {
        path: '/profesionales',
        name: 'staff-profesionales',
        component: { template: '<div>profesionales</div>' },
      },
    ],
  })
}

// El listbox propio de ProfessionalSelect no tiene un <select> nativo que
// setValue() pueda usar (issue #189): abre el disparador y hace click en la
// opción con el nombre buscado, mismo resultado observable que antes.
async function selectProfessional(
  wrapper: Awaited<ReturnType<typeof mountPage>>['wrapper'],
  fullName: string,
) {
  await wrapper.get('#daily-agenda-professional-select').trigger('click')
  const option = wrapper.findAll('[role="option"]').find((o) => o.text().includes(fullName))
  if (!option) throw new Error(`No option found for professional "${fullName}"`)
  await option.trigger('click')
}

async function mountPage() {
  const router = buildRouter()
  await router.push({ name: 'panel' })
  await router.isReady()
  const wrapper = mount(DailyAgendaPage, {
    global: { plugins: [router], stubs: { teleport: true } },
  })
  return { wrapper, router }
}

async function mountReady(professionals = twoProfessionals) {
  fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: professionals })
  fetchBusinessTimezoneMock.mockResolvedValueOnce({
    kind: 'success',
    timezone: 'America/Bogota',
  })
  const { wrapper, router } = await mountPage()
  await flushPromises()
  await waitOutInitialLoadHold()
  await flushPromises()
  return { wrapper, router }
}

const axeOptions = { rules: { 'color-contrast': { enabled: false } } }
const civilDateMatcher = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)

describe('DailyAgendaPage', () => {
  beforeEach(() => {
    fetchProfessionalSummariesMock.mockReset()
    fetchBusinessTimezoneMock.mockReset()
    fetchDailyAgendaMock.mockReset()
    resetBrand()
  })

  it('shows a non-blank loading state, then the professional picker (DEC-074: selector obligatorio)', async () => {
    let resolveProfessionals: (value: unknown) => void = () => {}
    fetchProfessionalSummariesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProfessionals = resolve
      }),
    )
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const { wrapper } = await mountPage()
    expect(wrapper.text()).toContain('Cargando profesionales')

    resolveProfessionals({ kind: 'success', items: twoProfessionals })
    await flushPromises()
    await waitOutInitialLoadHold()
    await flushPromises()
    expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(true)
  })

  it('shows an empty state with no professional picker when there are no professionals', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    const { wrapper } = await mountPage()
    await flushPromises()
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.text()).toContain('Aún no tienes profesionales registrados')
    expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(false)
    expect(fetchDailyAgendaMock).not.toHaveBeenCalled()
  })

  it('shows a recoverable error with Reintentar when the initial load fails', async () => {
    fetchProfessionalSummariesMock.mockResolvedValueOnce({ kind: 'network-error' })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
    const { wrapper } = await mountPage()
    await flushPromises()
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos cargar esta sección')

    fetchProfessionalSummariesMock.mockResolvedValueOnce({
      kind: 'success',
      items: twoProfessionals,
    })
    fetchBusinessTimezoneMock.mockResolvedValueOnce({
      kind: 'success',
      timezone: 'America/Bogota',
    })
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    await wrapper.get('button[type="button"]').trigger('click')
    await flushPromises()
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(true)
  })

  it('auto-selects the first professional and loads its agenda on open, with an explicit civil date (CA-062-01, CA-063)', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
    const { wrapper, router } = await mountReady()

    expect(fetchDailyAgendaMock).toHaveBeenCalledWith('b-1', civilDateMatcher)
    expect(wrapper.text()).toContain('Juan Pérez')
    expect(wrapper.text()).toContain('Corte clásico')
    // El turno de la ficha ya pasó sin resultado: v2 lo muestra «Por registrar».
    expect(wrapper.text()).toContain('Por registrar')
    // La URL queda normalizada con profesional y fecha explícitos.
    expect(router.currentRoute.value.query.professionalId).toBe('b-1')
    expect(router.currentRoute.value.query.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('marks a home-service turn in the agenda without showing the address (DEC-131, HU-103)', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({
      kind: 'success',
      items: [
        {
          ...oneEntry[0]!,
          homeService: {
            address: 'Carrera 7 # 71-21, Bogotá',
            latitude: 4.6486,
            longitude: -74.0628,
          },
        },
      ],
    })
    const { wrapper } = await mountReady()

    expect(wrapper.text()).toContain('Corte clásico · A domicilio')
    // La dirección es dato personal: vive solo en el detalle del turno.
    expect(wrapper.text()).not.toContain('Carrera 7')
  })

  it('shows an explicit empty message when the selected professional has no turns today', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const { wrapper } = await mountReady()

    expect(wrapper.text()).toContain('No hay turnos para Carlos Ramírez hoy')
  })

  it('switching professionals loads that professional agenda independently (discards a stale in-flight response)', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    fetchDailyAgendaMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )
    const { wrapper } = await mountReady()

    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
    await selectProfessional(wrapper, 'Ana Gómez')
    await flushPromises()
    // La de b-1 nunca resolvió (sigue pendiente): hasLoadedEntriesOnce
    // sigue en false, así que esta también cuenta como "primera carga" y
    // vuelve a mantenerse el mínimo (correcto: sin agenda previa que
    // conservar, no hay nada que "actualizar").
    await waitOutInitialLoadHold()
    await flushPromises()

    // La respuesta lenta del primer profesional (b-1) llega tarde: no debe
    // pisar la agenda ya cargada de b-2.
    resolveFirst({ kind: 'success', items: [] })
    await flushPromises()

    expect(fetchDailyAgendaMock).toHaveBeenNthCalledWith(1, 'b-1', civilDateMatcher)
    expect(fetchDailyAgendaMock).toHaveBeenNthCalledWith(2, 'b-2', civilDateMatcher)
    expect(wrapper.text()).toContain('Juan Pérez')
  })

  it('shows a recoverable error with Reintentar when the agenda fails to load', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'network-error' })
    const { wrapper } = await mountReady()

    expect(wrapper.text()).toContain('No pudimos cargar la agenda de este profesional')

    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
    const retryButtons = wrapper.findAll('button').filter((b) => b.text() === 'Reintentar')
    await retryButtons[0]!.trigger('click')
    await flushPromises()
    // El intento anterior falló, no tuvo éxito: hasLoadedEntriesOnce sigue
    // en false, así que el reintento también es "primera carga".
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.text()).toContain('Juan Pérez')
  })

  it('shows a not-found message when the selected professional no longer exists', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'not-found' })
    const { wrapper } = await mountReady()

    expect(wrapper.text()).toContain('Este profesional ya no está disponible')
  })

  it('"Nuevo turno" navigates to the real HU-061 form', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const { wrapper, router } = await mountReady()

    const newButton = wrapper.findAll('button').find((b) => b.text() === 'Nuevo turno')!
    await newButton.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('agenda-nuevo-turno')
    // Lleva el profesional y la fecha que se miraban, para que Cancelar vuelva
    // a este mismo día (issue #576).
    expect(router.currentRoute.value.query.professionalId).toBeTruthy()
    expect(router.currentRoute.value.query.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('has no detectable axe violations in the ready state with entries', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
    const { wrapper } = await mountReady()

    const results = await axe(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })

  it('has no detectable axe violations in the initial loading state (PageState)', async () => {
    fetchProfessionalSummariesMock.mockReturnValueOnce(new Promise(() => {}))
    fetchBusinessTimezoneMock.mockReturnValueOnce(new Promise(() => {}))
    const { wrapper } = await mountPage()
    await flushPromises()

    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })

  it('has no detectable axe violations with a terminal entry present (outline badge on parchment)', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: terminalEntry })
    const { wrapper } = await mountReady()

    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })

  it('has no detectable axe violations in the empty-day-today composition', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
    const { wrapper } = await mountReady()

    expect(await axe(wrapper.element, axeOptions)).toHaveNoViolations()
  })

  // Cada badge lleva la variante de BaseBadge que corresponde a su estado
  // real (issue #189, bug preexistente corregido: antes pasaba una clase
  // CSS externa que BaseBadge siempre ignoraba —resuelve sus colores por
  // :style en línea según `variant`— así que todo badge salía con la
  // paleta neutra sin importar el estado). El estado terminal ya no se
  // marca en el propio badge (se retiró la caja con borde: "parecen
  // botones", rediseño local de esta pantalla) sino en la fila que lo
  // contiene, que es quien atenúa su color vía CSS.
  it('gives each status badge its matching BaseBadge variant (issue #189)', async () => {
    fetchDailyAgendaMock.mockResolvedValueOnce({
      kind: 'success',
      items: [...oneEntry, ...terminalEntry],
    })
    const { wrapper } = await mountReady()

    const badges = wrapper.findAll('.base-badge')
    expect(badges.length).toBe(2)
    // `confirmed` ya pasado sin resultado: «Por registrar», con la variante de confirmado.
    const confirmedBadge = badges.find((b) => b.text() === 'Por registrar')!
    const terminalBadge = badges.find((b) => b.text() === 'Completado')!
    expect(confirmedBadge.classes()).toContain('base-badge--info')
    expect(terminalBadge.classes()).toContain('base-badge--success')

    expect(confirmedBadge.element.closest('.daily-agenda-page__item')?.className).not.toContain(
      'daily-agenda-page__item--terminal',
    )
    expect(terminalBadge.element.closest('.daily-agenda-page__item')?.className).toContain(
      'daily-agenda-page__item--terminal',
    )
  })

  describe('navegación por fecha (HU-063)', () => {
    function anteriorButton(wrapper: Awaited<ReturnType<typeof mountReady>>['wrapper']) {
      return wrapper.findAll('button').find((b) => b.text() === 'Anterior')!
    }

    function siguienteButton(wrapper: Awaited<ReturnType<typeof mountReady>>['wrapper']) {
      return wrapper.findAll('button').find((b) => b.text() === 'Siguiente')!
    }

    it('"Anterior" navigates one civil day back, keeps the same professional and updates the URL (CA-063)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper, router } = await mountReady()
      const firstDate = router.currentRoute.value.query.date as string

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      await anteriorButton(wrapper).trigger('click')
      await flushPromises()

      const expectedPrevious = shiftCivilDate(firstDate, -1)

      expect(router.currentRoute.value.query.date).toBe(expectedPrevious)
      expect(router.currentRoute.value.query.professionalId).toBe('b-1')
      expect(fetchDailyAgendaMock).toHaveBeenNthCalledWith(2, 'b-1', expectedPrevious)
    })

    it('"Siguiente" navigates one civil day forward, keeps the same professional (CA-063)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper, router } = await mountReady()
      const firstDate = router.currentRoute.value.query.date as string

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      await siguienteButton(wrapper).trigger('click')
      await flushPromises()

      const expectedNext = shiftCivilDate(firstDate, 1)

      expect(router.currentRoute.value.query.date).toBe(expectedNext)
      expect(fetchDailyAgendaMock).toHaveBeenNthCalledWith(2, 'b-1', expectedNext)
    })

    it('picking a date in the date selector navigates directly to it (CA-063)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper, router } = await mountReady()

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      await wrapper.get('#daily-agenda-date-picker').trigger('click')
      // El calendario se abre en el mes de la fecha vigente: se navega hasta
      // enero de 2026 y se elige el 15 (mismo resultado que escribirla).
      const currentTitle = wrapper.get('.agenda-date-picker__title').text()
      expect(currentTitle).not.toContain('Enero de 2026')
      for (let i = 0; i < 40 && !wrapper.find('[data-date="2026-01-15"]').exists(); i++) {
        const backwards = router.currentRoute.value.query.date
          ? String(router.currentRoute.value.query.date) > '2026-01-15'
          : true
        await wrapper
          .get(`button[aria-label="${backwards ? 'Mes anterior' : 'Mes siguiente'}"]`)
          .trigger('click')
      }
      await wrapper.get('[data-date="2026-01-15"]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query.date).toBe('2026-01-15')
      expect(fetchDailyAgendaMock).toHaveBeenNthCalledWith(2, 'b-1', '2026-01-15')
    })

    it('opening the URL with an explicit date/professional (reload) loads exactly that selection, without an extra navigation', async () => {
      fetchProfessionalSummariesMock.mockResolvedValueOnce({
        kind: 'success',
        items: twoProfessionals,
      })
      fetchBusinessTimezoneMock.mockResolvedValueOnce({
        kind: 'success',
        timezone: 'America/Bogota',
      })
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })

      const router = buildRouter()
      await router.push({ name: 'panel', query: { date: '2026-01-15', professionalId: 'b-2' } })
      await router.isReady()
      const wrapper = mount(DailyAgendaPage, {
        global: { plugins: [router], stubs: { teleport: true } },
      })
      await flushPromises()
      await waitOutInitialLoadHold()
      await flushPromises()

      expect(fetchDailyAgendaMock).toHaveBeenCalledTimes(1)
      expect(fetchDailyAgendaMock).toHaveBeenCalledWith('b-2', '2026-01-15')
      expect(router.currentRoute.value.query.date).toBe('2026-01-15')
      expect(router.currentRoute.value.query.professionalId).toBe('b-2')
      expect(wrapper.text()).toContain('Ana Gómez')
    })

    it('the browser back button restores the previous date and its agenda (CA-063)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper, router } = await mountReady()
      const firstDate = router.currentRoute.value.query.date as string

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      await anteriorButton(wrapper).trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.query.date).not.toBe(firstDate)

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      router.back()
      await flushPromises()

      expect(router.currentRoute.value.query.date).toBe(firstDate)
      expect(wrapper.text()).toContain('Juan Pérez')
    })

    it('discards an out-of-order response from a previous date after navigating again (CA-063)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper, router } = await mountReady()
      const firstDate = router.currentRoute.value.query.date as string

      let resolveFirstNav: (value: unknown) => void = () => {}
      fetchDailyAgendaMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstNav = resolve
        }),
      )
      await anteriorButton(wrapper).trigger('click')
      await flushPromises()

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      await anteriorButton(wrapper).trigger('click')
      await flushPromises()

      // La primera navegación ("Anterior" una vez) llega tarde, después de
      // que el usuario ya pidió un segundo "Anterior": no debe pisar la
      // fecha vigente.
      resolveFirstNav({ kind: 'success', items: oneEntry })
      await flushPromises()

      const expectedDate = shiftCivilDate(firstDate, -2)
      expect(router.currentRoute.value.query.date).toBe(expectedDate)
      expect(wrapper.text()).toContain('No hay turnos para Carlos Ramírez el')
    })

    it('keeps the previous agenda visible with an "Actualizando…" indicator while navigating to a new date (CA-063)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper } = await mountReady()
      expect(wrapper.text()).toContain('Juan Pérez')

      let resolveNext: (value: unknown) => void = () => {}
      fetchDailyAgendaMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNext = resolve
        }),
      )
      await siguienteButton(wrapper).trigger('click')
      await flushPromises()

      // La agenda anterior sigue visible (no una pantalla en blanco) con un
      // indicador local de actualización, mientras la nueva sigue en vuelo.
      expect(wrapper.text()).toContain('Actualizando…')
      expect(wrapper.text()).toContain('Juan Pérez')

      resolveNext({ kind: 'success', items: [] })
      await flushPromises()
      expect(wrapper.text()).not.toContain('Actualizando…')
    })

    it('disables date navigation when the business timezone is unavailable (RN-DIS-07)', async () => {
      fetchProfessionalSummariesMock.mockResolvedValueOnce({
        kind: 'success',
        items: twoProfessionals,
      })
      fetchBusinessTimezoneMock.mockResolvedValueOnce({ kind: 'unavailable' })
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const { wrapper } = await mountPage()
      await flushPromises()
      await waitOutInitialLoadHold()
      await flushPromises()

      // Sin zona conocida, el modelo no puede calcular "hoy" en el
      // negocio (nunca la sustituye por la del dispositivo): la agenda
      // sigue siendo legible (comportamiento degradado de HU-062), pero la
      // navegación por fecha queda deshabilitada en vez de adivinar.
      expect(fetchDailyAgendaMock).toHaveBeenCalledWith('b-1', undefined)
      expect(anteriorButton(wrapper).attributes('disabled')).toBeDefined()
      expect(siguienteButton(wrapper).attributes('disabled')).toBeDefined()
      expect(wrapper.get<HTMLButtonElement>('#daily-agenda-date-picker').element.disabled).toBe(
        true,
      )
    })
  })

  describe('línea temporal de escritorio (Fase 4a, adopción NAVA)', () => {
    async function mountWithFixedDate(items = oneEntry) {
      fetchProfessionalSummariesMock.mockResolvedValueOnce({
        kind: 'success',
        items: twoProfessionals,
      })
      fetchBusinessTimezoneMock.mockResolvedValueOnce({
        kind: 'success',
        timezone: 'America/Bogota',
      })
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items })

      const router = buildRouter()
      // Fecha fija en el pasado: nunca coincide con "hoy" real al correr la
      // prueba, así que el marcador "Ahora" tiene un resultado determinista
      // (no debe aparecer).
      await router.push({ name: 'panel', query: { date: '2026-08-28', professionalId: 'b-1' } })
      await router.isReady()
      const wrapper = mount(DailyAgendaPage, {
        global: { plugins: [router], stubs: { teleport: true } },
      })
      await flushPromises()
      await waitOutInitialLoadHold()
      await flushPromises()
      return { wrapper, router }
    }

    it('renders one hidden, non-focusable timeline slip per entry, alongside the accessible list', async () => {
      const { wrapper } = await mountWithFixedDate()

      // El carril desplazable es una parada de Tab con nombre propio; su
      // contenido es decorativo (la lista dice lo mismo en texto).
      const timeline = wrapper.get('.daily-agenda-page__timeline')
      expect(timeline.attributes('role')).toBe('region')
      expect(timeline.attributes('tabindex')).toBe('0')
      expect(timeline.attributes('aria-label')).toMatch(/^Carril de Carlos Ramírez, /)
      expect(wrapper.get('.daily-agenda-page__timeline-scroll').attributes('aria-hidden')).toBe(
        'true',
      )

      const slips = wrapper.findAll('.daily-agenda-page__timeline-slip')
      expect(slips.length).toBe(1)
      expect(slips[0]!.attributes('tabindex')).toBe('-1')
      expect(slips[0]!.text()).toContain('Juan Pérez')

      // La lista accesible sigue existiendo con la misma información.
      expect(wrapper.get('.daily-agenda-page__list').text()).toContain('Juan Pérez')
    })

    it('does not render the timeline when there are no entries for the day', async () => {
      const { wrapper } = await mountWithFixedDate([])
      expect(wrapper.find('.daily-agenda-page__timeline').exists()).toBe(false)
    })

    it('does not show "Ahora" for a date other than today in the business timezone', async () => {
      const { wrapper } = await mountWithFixedDate()
      expect(wrapper.find('.daily-agenda-page__timeline-now').exists()).toBe(false)
    })

    it('positions and sizes a slip from its own startsAt/endsAt, never an arbitrary spread', async () => {
      const { wrapper } = await mountWithFixedDate()

      // 2026-08-28T19:30-20:00Z = 14:30-15:00 America/Bogota (UTC-05).
      // bounds: [00:00, 24:00) (pedido explícito del propietario, el carril
      // siempre cubre el día completo) → left=870/1440=60.4166...%,
      // width=(900-870)/1440=2.08...%: con el ancho mínimo por hora (issue
      // #587) 30 min son 90 px, por encima del mínimo visual de una ficha.
      const slip = wrapper.get('.daily-agenda-page__timeline-slip')
      const style = slip.attributes('style') ?? ''
      expect(style).toContain('left: 60.416666666666664%')
      expect(style).toContain('width: 2.083333333333333%')
    })

    // Issue #587: el día completo en el ancho de la pantalla dejaba ~76 px por
    // hora y las fichas en «Nic…». Cada hora mide al menos 180 px a zoom 1 y,
    // desde la v2 (DEC-188), lo que haga falta para que el turno más corto mida
    // 140 px: con uno de 30 min, 280 px por hora (24 h = 6720 px).
    it('gives every hour a legible minimum width, multiplied by the zoom', async () => {
      const { wrapper } = await mountWithFixedDate()
      const scroll = wrapper.get('.daily-agenda-page__timeline-scroll')
      expect(scroll.attributes('style')).toContain('min-width: 6720px')

      await wrapper.get('[aria-label="Acercar el calendario"]').trigger('click')
      expect(wrapper.get('.daily-agenda-page__timeline-scroll').attributes('style')).toContain(
        'min-width: 13440px',
      )
    })

    it('hides an axis label the viewport cuts at its edge, and shows it once it fits', async () => {
      const width = vi
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(function (this: HTMLElement) {
          return this.classList.contains('daily-agenda-page__timeline') ? 1000 : 0
        })
      try {
        const { wrapper } = await mountWithFixedDate()
        const viewport = wrapper.get('.daily-agenda-page__timeline')
        // Carril de 6720 px (280 px por hora): «4 a. m.» cae en x = 1120 px.
        const label = () =>
          wrapper
            .findAll('.daily-agenda-page__timeline-tick-label')
            .find((t) => t.text() === '4 a. m.')!
        ;(viewport.element as HTMLElement).scrollLeft = 0
        await viewport.trigger('scroll')
        expect(label().classes()).toContain('daily-agenda-page__timeline-tick-label--clipped')
        ;(viewport.element as HTMLElement).scrollLeft = 400
        await viewport.trigger('scroll')
        expect(label().classes()).not.toContain('daily-agenda-page__timeline-tick-label--clipped')
      } finally {
        width.mockRestore()
      }
    })

    it('keeps the hour at 180 px when every appointment is long enough', async () => {
      const entry = [{ ...oneEntry[0]!, endsAt: '2026-08-28T20:30:00Z' }]
      const { wrapper } = await mountWithFixedDate(entry)
      expect(wrapper.get('.daily-agenda-page__timeline-scroll').attributes('style')).toContain(
        'min-width: 4320px',
      )
    })

    it('says the list times in 12 h like the booking, with the period once when shared', async () => {
      const { wrapper } = await mountWithFixedDate()
      // 14:30–15:00 en Bogotá.
      expect(wrapper.get('.daily-agenda-page__item-time').text()).toBe('2:30 – 3:00 p. m.')
    })

    it('a 45-minute slip shows time range, person and service at the default zoom', async () => {
      const entry = [{ ...oneEntry[0]!, endsAt: '2026-08-28T20:15:00Z' }]
      const { wrapper } = await mountWithFixedDate(entry)
      expect(wrapper.get('.daily-agenda-page__timeline-slip').text()).toContain('Corte clásico')
    })

    it('a very short slip keeps a minimum visual width without inflating its duration', async () => {
      const entry = [{ ...oneEntry[0]!, endsAt: '2026-08-28T19:35:00Z' }]
      const { wrapper } = await mountWithFixedDate(entry)
      const slip = wrapper.get('.daily-agenda-page__timeline-slip')
      // Con 5 min la hora llega a su tope de 420 px (24 h = 10080 px): 5 min son
      // 35 px y el mínimo visual es 44 px de 10080 = 0.4365...%.
      expect(slip.attributes('style')).toMatch(/width: 0\.436/)
      expect(slip.text()).not.toContain('Corte clásico')
      // Estrecha: la hora y la inicial, nunca un nombre cortado a una sílaba.
      expect(slip.get('.daily-agenda-page__timeline-slip-initial').text()).toBe('J')
      expect(slip.text()).not.toContain('Juan')
    })

    it('con el dedo, el primer toque ensancha la ficha con horario y servicio y el segundo abre el detalle', async () => {
      const { wrapper, router } = await mountWithFixedDate()
      const slip = wrapper.get('.daily-agenda-page__timeline-slip')

      await slip.trigger('pointerdown', { pointerType: 'touch' })
      await slip.trigger('click')
      await flushPromises()
      expect(slip.classes()).toContain('daily-agenda-page__timeline-slip--expanded')
      expect(slip.text()).toContain('Corte clásico')
      expect(router.currentRoute.value.name).toBe('panel')

      await slip.trigger('pointerdown', { pointerType: 'touch' })
      await slip.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('agenda-detalle-turno')
    })

    it('un toque fuera de la ficha la contrae, y con ratón el clic abre el detalle directo', async () => {
      const { wrapper, router } = await mountWithFixedDate()
      const slip = wrapper.get('.daily-agenda-page__timeline-slip')

      await slip.trigger('pointerdown', { pointerType: 'touch' })
      await slip.trigger('click')
      expect(slip.classes()).toContain('daily-agenda-page__timeline-slip--expanded')
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await flushPromises()
      expect(slip.classes()).not.toContain('daily-agenda-page__timeline-slip--expanded')

      await slip.trigger('pointerdown', { pointerType: 'mouse' })
      await slip.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('agenda-detalle-turno')
    })

    it('shows "Cambio de día" exactly at midnight when a shift ends the next civil day (evento 11)', async () => {
      const { wrapper } = await mountWithFixedDate(nightEntry)

      // La marca (línea vertical del carril) y su etiqueta ("Cambio de
      // día") son elementos distintos desde issue #189: viven en filas
      // propias (eje/marcas/carril, calcadas del atlas) para que una marca
      // nunca pueda quedar encima de una hora en punto.
      const mark = wrapper.get('.daily-agenda-page__timeline-mark--day-change')
      // bounds: [00:00, 24:30) — el carril cubre el día completo y se
      // extiende solo lo necesario para el turno que cruza medianoche
      // (termina a las 00:30 del día siguiente, minuto 1470). left de
      // medianoche (1440): 1440/1470=97.95...%.
      expect(mark.attributes('style')).toContain('left: 97.95918367346938%')

      const label = wrapper.get('.daily-agenda-page__timeline-mark-label--day-change')
      expect(label.attributes('style')).toContain('left: 97.95918367346938%')
      expect(label.text()).toBe('Cambio de día')

      // La ficha ocupa su duración real (60min) más allá de medianoche, no
      // recortada a la medianoche del día que se está viendo.
      const slip = wrapper.get('.daily-agenda-page__timeline-slip')
      const style = slip.attributes('style') ?? ''
      expect(style).toContain('width: 4.081632653061225%') // (1470-1410)/1470
    })

    it('keeps the timeline (with "Ahora") visible for a valid empty day when viewing today (evento 09)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const { wrapper } = await mountReady()

      expect(wrapper.find('.daily-agenda-page__timeline').exists()).toBe(true)
      expect(wrapper.find('.daily-agenda-page__timeline-mark--now').exists()).toBe(true)
    })

    // Pedido del propietario (2026-11-15): sin turnos no hay fichas que leer y
    // el carril se acomoda al ancho, sin desplazamiento horizontal.
    it('an empty day fits the lane to the available width (no minimum width)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const { wrapper } = await mountReady()

      const style = wrapper.get('.daily-agenda-page__timeline-scroll').attributes('style') ?? ''
      expect(style).toContain('width: 100%')
      expect(style).not.toContain('min-width')
    })

    // Zoom del carril (pedido explícito del propietario, 2026-09-04): no
    // representado en el atlas, función nueva autorizada aparte del modo
    // de fidelidad visual del resto de esta pantalla.
    describe('zoom del carril', () => {
      function zoomButtons(wrapper: Awaited<ReturnType<typeof mountWithFixedDate>>['wrapper']) {
        const out = wrapper.get('[aria-label="Alejar el calendario"]')
        const zoomIn = wrapper.get('[aria-label="Acercar el calendario"]')
        return { out, zoomIn }
      }

      it('starts at 1h ticks, "Alejar" disabled, "Acercar" enabled', async () => {
        const { wrapper } = await mountWithFixedDate()

        expect(wrapper.get('.daily-agenda-page__timeline-zoom-label').text()).toBe('1 h')
        const { out, zoomIn } = zoomButtons(wrapper)
        expect(out.attributes('disabled')).toBeDefined()
        expect(zoomIn.attributes('disabled')).toBeUndefined()

        const ticks = wrapper.findAll('.daily-agenda-page__timeline-tick-label')
        // v2: el eje en 12 h, como la reserva («12 a. m.», «1 p. m.»).
        expect(ticks[0]!.text()).toBe('12 a. m.')

        const scroll = wrapper.get('.daily-agenda-page__timeline-scroll')
        expect(scroll.attributes('style')).toContain('width: 100%')
      })

      it('narrows the tick step and widens the track on each zoom-in, down to 15min', async () => {
        const { wrapper } = await mountWithFixedDate()
        const { zoomIn } = zoomButtons(wrapper)

        await zoomIn.trigger('click')
        expect(wrapper.get('.daily-agenda-page__timeline-zoom-label').text()).toBe('30 min')
        expect(wrapper.get('.daily-agenda-page__timeline-scroll').attributes('style')).toContain(
          'width: 200%',
        )

        await zoomIn.trigger('click')
        expect(wrapper.get('.daily-agenda-page__timeline-zoom-label').text()).toBe('15 min')
        expect(wrapper.get('.daily-agenda-page__timeline-scroll').attributes('style')).toContain(
          'width: 400%',
        )
        const ticks = wrapper.findAll('.daily-agenda-page__timeline-tick-label')
        expect(ticks.some((t) => /:15 [ap]\. m\.$/.test(t.text()))).toBe(true)

        // Al tope: "Acercar" se deshabilita, "Alejar" sigue disponible.
        const { out, zoomIn: zoomInAtMax } = zoomButtons(wrapper)
        expect(zoomInAtMax.attributes('disabled')).toBeDefined()
        expect(out.attributes('disabled')).toBeUndefined()
      })

      it('widening the track lets a short slip show its full detail (time+name+service)', async () => {
        // 10min: 30 px a zoom 1 (bajo el umbral de 120 px, modo compacto);
        // a zoom 4 (dos clics de "Acercar") 120 px (modo completo).
        const shortEntry = [{ ...oneEntry[0]!, endsAt: '2026-08-28T19:40:00Z' }]
        const { wrapper } = await mountWithFixedDate(shortEntry)
        const { zoomIn } = zoomButtons(wrapper)

        expect(wrapper.get('.daily-agenda-page__timeline-slip').text()).not.toContain(
          'Corte clásico',
        )

        await zoomIn.trigger('click')
        await zoomIn.trigger('click')

        expect(wrapper.get('.daily-agenda-page__timeline-slip').text()).toContain('Corte clásico')
      })
    })
  })
  describe('perfil de profesional individual (DEC-115)', () => {
    const oneProfessional = [{ id: 'b-1', fullName: 'Mateo Rojas' }]
    const hhmm = (instant: string) =>
      new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: 'h12',
      }).format(new Date(instant))

    // Turnos de hoy en la zona del negocio, relativos al reloj real: la página
    // evalúa «ahora» con Date.now(), igual que su marcador «Ahora».
    function todayEntry(id: string, fromNowMin: number, durationMin: number, serviceName: string) {
      const startsAt = new Date(Date.now() + fromNowMin * 60_000).toISOString()
      const endsAt = new Date(Date.now() + (fromNowMin + durationMin) * 60_000).toISOString()
      return {
        ...oneEntry[0]!,
        id,
        serviceName,
        startsAt,
        endsAt,
      }
    }

    it('hides the professional picker when there is one professional, and still loads that agenda', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: oneEntry })
      const { wrapper, router } = await mountReady(oneProfessional)

      expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(false)
      expect(fetchDailyAgendaMock).toHaveBeenCalledWith('b-1', civilDateMatcher)
      // La selección sigue en la URL (DEC-074): solo desaparece el control.
      expect(router.currentRoute.value.query.professionalId).toBe('b-1')
      expect(wrapper.text()).toContain('Juan Pérez')
    })

    it('keeps the picker in the solo profile if the business actually has several professionals', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const { wrapper } = await mountReady(twoProfessionals)

      expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(true)
    })

    it('keeps the picker in the full panel even with one professional', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const { wrapper } = await mountReady(oneProfessional)

      expect(wrapper.find('#daily-agenda-professional-select').exists()).toBe(true)
      expect(wrapper.find('.daily-agenda-page__summary').exists()).toBe(false)
    })

    it('says what is left today: the count and the next appointment', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      const next = todayEntry('a-next', 60, 30, 'Barba perfilada')
      fetchDailyAgendaMock.mockResolvedValueOnce({
        kind: 'success',
        items: [todayEntry('a-later', 180, 30, 'Corte clásico'), next],
      })
      const { wrapper } = await mountReady(oneProfessional)

      expect(wrapper.get('.daily-agenda-page__summary').text()).toBe(
        `2 turnos por atender · Siguiente a las ${hhmm(next.startsAt)} · Barba perfilada`,
      )
    })

    it('derives «Confirmado», «En curso» and «Por registrar» from `confirmed` by the hour (DEC-188)', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({
        kind: 'success',
        items: [
          todayEntry('a-past', -40, 30, 'Corte clásico'),
          todayEntry('a-now', -10, 40, 'Barba perfilada'),
          todayEntry('a-next', 60, 30, 'Corte clásico'),
        ],
      })
      const { wrapper } = await mountReady(oneProfessional)

      const items = wrapper.findAll('.daily-agenda-page__item')
      const byLabel = (label: string) =>
        items.find((item) => item.get('.base-badge').text() === label)!
      expect(byLabel('Por registrar').classes()).toContain('daily-agenda-page__item--pending')
      expect(byLabel('En curso').classes()).toContain('daily-agenda-page__item--current')
      const confirmed = byLabel('Confirmado')
      expect(confirmed.classes()).not.toContain('daily-agenda-page__item--pending')
      expect(confirmed.classes()).not.toContain('daily-agenda-page__item--current')
    })

    it('marks «Ahora» in the list between what happened and what comes, and draws the day strip (DEC-188)', async () => {
      // Media mañana en Bogotá: con el reloj real, de noche el sol queda fuera
      // de la franja del día y la prueba fallaba según la hora en que corría.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-19T15:00:00Z') })
      onTestFinished(() => {
        vi.useRealTimers()
      })
      fetchDailyAgendaMock.mockResolvedValueOnce({
        kind: 'success',
        items: [
          todayEntry('a-past', -90, 30, 'Corte clásico'),
          todayEntry('a-next', 60, 30, 'Barba perfilada'),
        ],
      })
      const { wrapper } = await mountReady(oneProfessional)

      const rows = wrapper.findAll('.daily-agenda-page__list > li')
      expect(rows.map((r) => r.classes()[0])).toEqual([
        'daily-agenda-page__item',
        'daily-agenda-page__now',
        'daily-agenda-page__item',
      ])
      expect(rows[1]!.text()).toBe(`Ahora · ${hhmm(new Date().toISOString())}`)

      const strip = wrapper.get('.daily-agenda-page__strip')
      expect(strip.findAll('.daylight__mark')).toHaveLength(2)
      expect(strip.find('.daylight__marker--sun').exists()).toBe(true)
    })

    it('a tap on a strip mark brings its card into view and focuses it', async () => {
      fetchDailyAgendaMock.mockResolvedValueOnce({
        kind: 'success',
        items: [todayEntry('a-next', 60, 30, 'Barba perfilada')],
      })
      const { wrapper } = await mountReady(oneProfessional)
      const link = wrapper.get('[data-entry-id="a-next"] .daily-agenda-page__item-main')
      const scrollIntoView = vi.fn()
      const focus = vi.spyOn(link.element as HTMLElement, 'focus')
      ;(link.element as HTMLElement).scrollIntoView = scrollIntoView
      await wrapper.get('.daily-agenda-page__strip .daylight__mark').trigger('click')
      expect(scrollIntoView).toHaveBeenCalled()
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    })

    it('says when the appointment in progress ends', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      const current = todayEntry('a-now', -10, 40, 'Corte clásico')
      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [current] })
      const { wrapper } = await mountReady(oneProfessional)

      expect(wrapper.get('.daily-agenda-page__summary').text()).toBe(
        `1 turno por atender · En curso hasta las ${hhmm(current.endsAt)}`,
      )
    })

    it('says so when nothing is left today, and stays silent on an empty day', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchDailyAgendaMock.mockResolvedValueOnce({
        kind: 'success',
        items: [{ ...todayEntry('a-done', -120, 30, 'Barba'), status: 'completed' }],
      })
      const done = await mountReady(oneProfessional)
      expect(done.wrapper.get('.daily-agenda-page__summary').text()).toBe(
        'No te quedan turnos por atender hoy.',
      )

      fetchDailyAgendaMock.mockResolvedValueOnce({ kind: 'success', items: [] })
      const empty = await mountReady(oneProfessional)
      expect(empty.wrapper.find('.daily-agenda-page__summary').exists()).toBe(false)
    })

    it('has no axe violations with the summary and no picker', async () => {
      setBrand({ ...DEFAULT_BRAND, panelProfile: 'solo' })
      fetchDailyAgendaMock.mockResolvedValueOnce({
        kind: 'success',
        items: [todayEntry('a-next', 60, 30, 'Barba perfilada')],
      })
      const { wrapper } = await mountReady(oneProfessional)

      expect(await axe(wrapper.element.outerHTML, axeOptions)).toHaveNoViolations()
    })
  })
})
