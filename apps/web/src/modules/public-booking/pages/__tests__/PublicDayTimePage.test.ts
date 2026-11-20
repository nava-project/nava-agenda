/**
 * PublicDayTimePage («Día y hora», DEC-188): una sola lectura de disponibilidad
 * para todos los profesionales (DEC-162); el profesional es un filtro con
 * «Cualquiera» por defecto y oculto si solo hay uno; días con su luz libre
 * real; horas por Mañana/Tarde/Noche con nombre completo para el lector; el
 * pase dice quién atiende y lleva a «Tus datos» con ese profesional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'

const replaceMock = vi.hoisted(() => vi.fn())
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: replaceMock }),
}))

const listProfessionalsMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/listPublicProfessionalsApi', () => ({
  listPublicProfessionals: listProfessionalsMock,
}))
const availabilityMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/listPublicServiceAvailabilityApi', () => ({
  listPublicServiceAvailability: availabilityMock,
}))
const servicesMock = vi.hoisted(() => vi.fn())
vi.mock('../../model/publicServices', () => ({ loadPublicServices: servicesMock }))
vi.mock('../../model/publicProfile', () => ({
  loadPublicProfile: vi.fn().mockResolvedValue({ kind: 'not-found' }),
  publicProfileFor: () => null,
}))
// Las reseñas tienen su propia suite.
vi.mock('../../components/ProfessionalReviews.vue', () => ({
  default: { template: '<div class="reviews-stub" />' },
}))

const { default: PublicDayTimePage } = await import('../PublicDayTimePage.vue')

const ANA = {
  id: 'pro-ana',
  fullName: 'Ana Ruiz',
  description: 'Cortes clásicos.',
  photoUpdatedAt: null,
  rating: null,
  ratingCount: 0,
}
const BETO = {
  id: 'pro-beto',
  fullName: 'Beto Gil',
  description: null,
  photoUpdatedAt: null,
  rating: null,
  ratingCount: 0,
}
const SERVICE = {
  id: 'svc',
  name: 'Corte clásico',
  description: null,
  durationMinutes: 45,
  price: '35000.00',
  currency: 'COP',
}

// Lunes 14 y martes 15 de enero de 2030 en Bogotá.
const slots = [
  { professionalId: ANA.id, startsAt: '2030-01-14T09:00:00-05:00' },
  { professionalId: BETO.id, startsAt: '2030-01-14T09:00:00-05:00' },
  { professionalId: BETO.id, startsAt: '2030-01-14T14:00:00-05:00' },
  { professionalId: ANA.id, startsAt: '2030-01-15T18:30:00-05:00' },
]

function respond(professionals = [ANA, BETO], available = slots) {
  servicesMock.mockResolvedValue({ kind: 'success', services: [SERVICE] })
  listProfessionalsMock.mockResolvedValue({ kind: 'success', professionals })
  availabilityMock.mockResolvedValue({
    kind: 'success',
    availability: {
      slots: available,
      durationMinutes: 45,
      timezone: 'America/Bogota',
      slotGridMinutes: 15,
    },
  })
}

function mountPage(professionalId: string | null = null) {
  return mount(PublicDayTimePage, {
    props: { slug: 'barberia', serviceId: 'svc', professionalId },
    attachTo: document.body,
    global: {
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a href="#" :data-to="JSON.stringify(to)"><slot /></a>',
        },
      },
    },
  })
}

const hours = (w: VueWrapper) => w.findAll('[role="radiogroup"][aria-label="Hora"] [role="radio"]')
const days = (w: VueWrapper) => w.findAll('[role="radiogroup"][aria-label="Día"] [role="radio"]')
const chip = (w: VueWrapper, name: string) =>
  w.findAll('.bk-chip').find((c) => c.text().includes(name))!

beforeEach(() => {
  replaceMock.mockReset()
  listProfessionalsMock.mockReset()
  availabilityMock.mockReset()
  servicesMock.mockReset()
  document.body.innerHTML = ''
})

describe('PublicDayTimePage', () => {
  it('shows silhouettes while loading', () => {
    servicesMock.mockReturnValue(new Promise(() => {}))
    listProfessionalsMock.mockReturnValue(new Promise(() => {}))
    availabilityMock.mockReturnValue(new Promise(() => {}))
    const wrapper = mountPage()
    expect(wrapper.get('main').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('h1').text()).toBe('Cargando las horas libres…')
  })

  it('reads availability once for every professional and offers «Cualquiera» by default', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()

    expect(availabilityMock).toHaveBeenCalledTimes(1)
    expect(availabilityMock).toHaveBeenCalledWith('barberia', 'svc')
    expect(chip(wrapper, 'Cualquiera').attributes('aria-checked')).toBe('true')
    // 9:00 la ofrecen los dos y aparece una sola vez.
    expect(hours(wrapper).map((h) => h.attributes('aria-label'))).toEqual([
      expect.stringMatching(/^9:00\s?a\.\s?m\., mañana$/),
      expect.stringMatching(/^2:00\s?p\.\s?m\., tarde$/),
    ])
    expect(wrapper.findAll('.bk-hours__label').map((l) => l.text())).toEqual(['Mañana', 'Tarde'])
  })

  it('tells each day its real count of free hours and draws its light from it', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    const [monday, tuesday] = days(wrapper)
    expect(monday!.attributes('aria-label')).toMatch(/14 de enero de 2030, 2 horarios libres$/)
    expect(tuesday!.attributes('aria-label')).toMatch(/15 de enero de 2030, 1 horario libre$/)
    expect(monday!.attributes('aria-checked')).toBe('true')
  })

  it('filters by a professional without asking the server again, and keeps it in the URL', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()

    await chip(wrapper, 'Ana Ruiz').trigger('click')
    expect(availabilityMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith({
      name: 'reserva-publica-horario',
      params: { slug: 'barberia', serviceId: 'svc' },
      query: { profesional: ANA.id },
    })
    expect(hours(wrapper)).toHaveLength(1)
    expect(wrapper.text()).toContain('Cortes clásicos.')
  })

  it('builds the pass as you choose and assigns «Cualquiera» to the first free professional', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('a.bk-cta').exists()).toBe(false)

    await hours(wrapper)[0]!.trigger('click')
    const chosen = hours(wrapper)[0]!
    expect(chosen.attributes('aria-checked')).toBe('true')
    // La elegida es el chip de su minuto en la fila de su hora, que dice a. m./p. m.
    expect(chosen.text()).toBe(':00')
    expect(chosen.attributes('aria-label')).toMatch(/^9:00\s?a\.\s?m\., mañana$/)
    const row = wrapper.get('.bk-hrow--chosen')
    expect(row.get('.bk-hrow__hour').text()).toMatch(/^9\s?a\.\s?m\.$/)

    const pase = wrapper.get('.bk-pase')
    expect(pase.text()).toContain('Corte clásico')
    expect(pase.text()).toContain('35.000')
    expect(pase.text()).toContain('Con Ana Ruiz')
    expect(pase.text()).toMatch(/9:00\s?a\.\s?m\. – 9:45\s?a\.\s?m\./)

    const next = JSON.parse(wrapper.get('a.bk-cta').attributes('data-to')!)
    expect(next).toEqual({
      name: 'reserva-publica-cliente',
      params: {
        slug: 'barberia',
        serviceId: 'svc',
        professionalId: ANA.id,
        startsAt: '2030-01-14T09:00:00-05:00',
      },
      query: { cualquiera: '1' },
    })
  })

  it('says «Seguir con tus datos» without a text arrow (#745)', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    await hours(wrapper)[0]!.trigger('click')
    const cta = wrapper.get('a.bk-cta')
    expect(cta.text()).toContain('Seguir con tus datos')
    expect(cta.text()).not.toContain('→')
  })

  it('keeps the day arrows in their own column, after the days, never over them (#745)', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    const wrap = wrapper.get('.bk-days-wrap')
    const children = wrap.element.children
    expect(children[0]!.classList.contains('bk-days')).toBe(true)
    expect(children[1]!.classList.contains('bk-days__navs')).toBe(true)
    // Al empezar no hay días hacia atrás: la flecha se apaga en su sitio.
    const before = wrapper.get('.bk-days__nav--before')
    expect(before.attributes('disabled')).toBeDefined()
    expect(before.attributes('aria-hidden')).toBe('true')
  })

  it('keeps a professional chosen in the URL and sends it on without «cualquiera»', async () => {
    respond()
    const wrapper = mountPage(BETO.id)
    await flushPromises()
    expect(chip(wrapper, 'Beto Gil').attributes('aria-checked')).toBe('true')
    await hours(wrapper)[1]!.trigger('click')
    const next = JSON.parse(wrapper.get('a.bk-cta').attributes('data-to')!)
    expect(next.params.professionalId).toBe(BETO.id)
    expect(next.query).toEqual({})
  })

  it('makes the professional chips a single Tab stop that arrows move through', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    const chips = wrapper.findAll('.bk-chip')
    expect(chips.map((c) => c.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
    await wrapper.get('.bk-chips').trigger('keydown', { key: 'ArrowRight' })
    expect(replaceMock).toHaveBeenLastCalledWith({
      name: 'reserva-publica-horario',
      params: { slug: 'barberia', serviceId: 'svc' },
      query: { profesional: ANA.id },
    })
  })

  it('says the month once and again only when it changes', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    const months = days(wrapper).map((d) => d.get('.bk-day__month').text())
    expect(months[0]).not.toBe('')
    expect(months.slice(1).every((m) => m === '')).toBe(true)
  })

  it('hides the chips when a single professional attends, and says who', async () => {
    respond(
      [ANA],
      slots.filter((s) => s.professionalId === ANA.id),
    )
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.bk-chips').exists()).toBe(false)
    expect(wrapper.get('.bk-attends').text()).toContain('Te atiende Ana Ruiz')
  })

  it('offers to look with anyone when the chosen professional has no free hours', async () => {
    respond(
      [ANA, BETO],
      slots.filter((s) => s.professionalId === ANA.id),
    )
    const wrapper = mountPage(BETO.id)
    await flushPromises()
    expect(wrapper.text()).toContain('Beto Gil no tiene horas libres en los próximos días.')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Ver con cualquiera')!
      .trigger('click')
    expect(hours(wrapper).length).toBeGreaterThan(0)
  })

  it('says so when the service has no professionals', async () => {
    respond([], [])
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('no tiene profesionales disponibles en este momento')
  })

  it('moves between days and hours with the arrow keys, selecting as it goes', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('[aria-label="Día"]').trigger('keydown', { key: 'ArrowRight' })
    expect(days(wrapper)[1]!.attributes('aria-checked')).toBe('true')
    expect(hours(wrapper)).toHaveLength(1)
    expect(wrapper.findAll('.bk-hours__label').map((l) => l.text())).toEqual(['Noche'])

    await wrapper.get('[aria-label="Día"]').trigger('keydown', { key: 'Home' })
    await wrapper.get('[aria-label="Hora"]').trigger('keydown', { key: 'ArrowRight' })
    expect(hours(wrapper)[1]!.attributes('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(hours(wrapper)[1]!.element)
  })

  it('shows the uniform not-found guidance for an unknown link', async () => {
    respond()
    availabilityMock.mockResolvedValue({ kind: 'not-found' })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Este enlace no lleva a ninguna agenda')
  })

  it('has no accessibility violations with an hour chosen', async () => {
    respond()
    const wrapper = mountPage()
    await flushPromises()
    await hours(wrapper)[0]!.trigger('click')
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })
})
