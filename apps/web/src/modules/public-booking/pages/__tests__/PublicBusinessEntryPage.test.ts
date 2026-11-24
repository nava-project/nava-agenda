/**
 * Pruebas de PublicBusinessEntryPage (HU-090, HU-091; v2 DEC-188): la entrada
 * es el catálogo. Carga con siluetas, éxito (nombre, hora local en la zona del
 * negocio, servicios con duración y precio, contacto opcional), un solo
 * servicio pasa directo a «Día y hora», enlace inexistente con orientación y
 * sin reintento (CA-090-02), error de red con reintento (CA-090-05), error
 * inesperado con requestId, franja de hoy solo con horario real y ausencia de
 * violaciones de accesibilidad (axe-core) en cada estado observable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { resetPublicProfileCache } from '../../model/publicProfile'
import { resetPublicServicesCache } from '../../model/publicServices'

const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({
  httpClient: { GET: getMock, POST: vi.fn() },
}))

const replaceMock = vi.hoisted(() => vi.fn())
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRouter: () => ({ replace: replaceMock }),
}))

// Las reseñas de Google (HU-101) tienen su propia suite.
const getGoogleReviewsMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/getPublicGoogleReviewsApi', () => ({
  getPublicGoogleReviews: getGoogleReviewsMock,
}))

const { default: PublicBusinessEntryPage } = await import('../PublicBusinessEntryPage.vue')

const vocabulary = {
  businessTerm: 'barbería',
  businessTermGender: 'feminine',
  professionalTerm: 'barbero',
  professionalTermPlural: 'barberos',
  professionalTermGender: 'masculine',
}

const profile = {
  name: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  contactEmail: null,
  contactPhone: null,
  vocabulary,
  location: null,
  offersHomeService: false,
  brandAccent: 'brass',
  openingHours: [],
  closedOnHolidays: false,
  today: null,
}

const services = [
  {
    id: 's-1',
    name: 'Corte clásico',
    description: 'Tijera y máquina.',
    durationMinutes: 45,
    price: '35000.00',
    currency: 'COP',
  },
  {
    id: 's-2',
    name: 'Color',
    description: null,
    durationMinutes: 90,
    price: '90000.00',
    currency: 'COP',
  },
]

const ok = { ok: true, status: 200, headers: new Headers() } as Response
const failure = (status: number) => ({ ok: false, status, headers: new Headers() }) as Response

/** Responde por ruta: el perfil y el catálogo se piden a la vez. */
function respond(
  profileData: Record<string, unknown> | null,
  items: typeof services = services,
  profileStatus = 200,
) {
  getMock.mockImplementation(async (path: string) => {
    if (path === '/public/businesses/{slug}')
      return profileData && profileStatus === 200
        ? { data: profileData, error: undefined, response: ok }
        : {
            data: undefined,
            error: { status: profileStatus, code: 'x', title: 'x', requestId: 'req-42' },
            response: failure(profileStatus),
          }
    if (path === '/public/businesses/{slug}/services')
      return { data: { items }, error: undefined, response: ok }
    throw new Error(`unexpected ${path}`)
  })
}

function mountEntryPage(slug = 'barberia-ejemplo') {
  return mount(PublicBusinessEntryPage, {
    props: { slug },
    attachTo: document.body,
    global: { stubs: { RouterLink: { props: ['to'], template: '<a href="#"><slot /></a>' } } },
  })
}

beforeEach(() => {
  getMock.mockReset()
  replaceMock.mockReset()
  getGoogleReviewsMock.mockReset()
  getGoogleReviewsMock.mockResolvedValue({ kind: 'empty' })
  resetPublicProfileCache()
  resetPublicServicesCache()
  document.body.innerHTML = ''
})

describe('PublicBusinessEntryPage', () => {
  it('shows silhouettes with an accessible heading while loading, without a retry', async () => {
    getMock.mockReturnValue(new Promise(() => {}))
    const wrapper = mountEntryPage()
    expect(wrapper.get('main').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('h1').text()).toBe('Abriendo la reserva…')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  it('coming back, draws what it already read at once and re-reads the profile behind it (#820)', async () => {
    respond(profile)
    mountEntryPage().unmount()
    await flushPromises()
    getMock.mockClear()

    // La relectura no llega todavía: no vuelve el esqueleto.
    let release!: () => void
    getMock.mockImplementation(
      (path: string) =>
        new Promise((ok_) => {
          release = () =>
            ok_(
              path === '/public/businesses/{slug}'
                ? {
                    data: { ...profile, name: 'Barbería Ejemplo Centro' },
                    error: undefined,
                    response: ok,
                  }
                : { data: { items: services }, error: undefined, response: ok },
            )
        }),
    )
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(wrapper.get('main').attributes('aria-busy')).toBeUndefined()
    expect(wrapper.get('h1').text()).toBe('Barbería Ejemplo')
    expect(getMock).toHaveBeenCalledWith('/public/businesses/{slug}', expect.anything())

    release()
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Barbería Ejemplo Centro')
  })

  it('keeps what it shows when the re-read behind it has no network (#820)', async () => {
    respond(profile)
    mountEntryPage().unmount()
    await flushPromises()
    getMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Barbería Ejemplo')
    expect(wrapper.text()).toContain('Corte clásico')
  })

  it('asks for the profile and the catalog of the slug from props (CA-090-03)', async () => {
    respond(profile)
    mountEntryPage('barberia-ejemplo')
    await flushPromises()
    const calls = getMock.mock.calls.map(([path, init]) => [path, init.params.path.slug])
    expect(calls).toEqual(
      expect.arrayContaining([
        ['/public/businesses/{slug}', 'barberia-ejemplo'],
        ['/public/businesses/{slug}/services', 'barberia-ejemplo'],
      ]),
    )
  })

  it('renders the business as protagonist and its services with duration and price', async () => {
    respond(profile)
    const wrapper = mountEntryPage()
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Barbería Ejemplo')
    expect(wrapper.get('.bk-hero__time').text()).toMatch(/^\d{1,2}:\d{2}/)
    expect(wrapper.text()).toContain('Hora del negocio')
    const rows = wrapper.findAll('.bk-service')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Corte clásico')
    expect(rows[0]!.text()).toContain('45 min')
    expect(rows[0]!.text()).toContain('35.000')
    expect(rows[1]!.text()).toContain('1 h 30 min')
    expect(rows[1]!.find('.bk-service__desc').exists()).toBe(false)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('goes straight to «Día y hora» when there is a single service, replacing the entry', async () => {
    respond(profile, [services[0]!])
    mountEntryPage('una-sola')
    await flushPromises()
    expect(replaceMock).toHaveBeenCalledWith({
      name: 'reserva-publica-horario',
      params: { slug: 'una-sola', serviceId: 's-1' },
    })
  })

  it('says so, without an error, when the business has no services yet', async () => {
    respond(profile, [])
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(wrapper.text()).toContain('aún no tiene servicios para reservar en línea')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('shows contact when configured and omits the block when both are absent (CA-090-04)', async () => {
    respond({ ...profile, contactEmail: 'hola@example.test', contactPhone: '+573001234567' })
    const withContact = mountEntryPage('con-contacto')
    await flushPromises()
    expect(withContact.get('.pb-contact').text()).toContain('hola@example.test')

    resetPublicProfileCache()
    respond(profile)
    const without = mountEntryPage('sin-contacto')
    await flushPromises()
    expect(without.find('.pb-contact').exists()).toBe(false)
  })

  it('never renders an internal id or the slug itself in the DOM (CA-090-04)', async () => {
    respond(profile)
    const wrapper = mountEntryPage('slug-secreto')
    await flushPromises()
    expect(wrapper.html()).not.toContain('slug-secreto')
    expect(wrapper.html()).not.toContain('s-1')
  })

  it('guides on an unknown link, with no retry that would change nothing (CA-090-02)', async () => {
    respond(null, services, 404)
    const wrapper = mountEntryPage('no-existe')
    await flushPromises()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Este enlace no lleva a ninguna agenda')
    expect(alert.text()).toContain('Pide al negocio el enlace de nuevo')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  it('offers a retry on a network error, asking again for the same slug (CA-090-05)', async () => {
    getMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = mountEntryPage('barberia-red')
    await flushPromises()
    expect(wrapper.text()).toContain('No pudimos conectar')

    respond(profile)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Barbería Ejemplo')
  })

  it('shows the requestId on an unexpected error, without leaking the raw problem', async () => {
    respond(null, services, 500)
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(wrapper.text()).toContain('req-42')
    expect(wrapper.text()).not.toContain('status')
  })

  it('draws today’s daylight strip only from real opening hours, with a summary', async () => {
    respond(profile)
    const without = mountEntryPage('sin-horario')
    await flushPromises()
    expect(without.find('.daylight').exists()).toBe(false)
    expect(without.find('.pb-hours').exists()).toBe(false)

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(
      new Date(),
    )
    resetPublicProfileCache()
    respond({
      ...profile,
      openingHours: [{ dayOfWeek: 'MONDAY', opens: '08:00', closes: '18:00' }],
      today: {
        date: today,
        dayOfWeek: 'MONDAY',
        holiday: null,
        hours: [{ opens: '08:00', closes: '18:00' }],
      },
    })
    const withHours = mountEntryPage('con-horario')
    await flushPromises()
    const strip = withHours.get('.daylight[role="img"]')
    expect(strip.attributes('aria-label')).toContain('Hoy atiende de 8:00 a. m. a 6:00 p. m.')
    expect(withHours.find('.pb-hours').exists()).toBe(true)
  })

  it('does not invent today when the profile day is not today in the business zone', async () => {
    respond({
      ...profile,
      openingHours: [{ dayOfWeek: 'SATURDAY', opens: '08:00', closes: '16:00' }],
      closedOnHolidays: true,
      today: { date: '2000-01-01', dayOfWeek: 'SATURDAY', holiday: null, hours: [] },
    })
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(wrapper.find('.daylight').exists()).toBe(false)
    expect(wrapper.get('.pb-hours').text()).toContain('8:00 a. m. – 4:00 p. m.')
  })

  it('shows where the business is when it has a location, and nothing when not (CA-102-02/04)', async () => {
    respond({
      ...profile,
      location: { address: 'Calle 10 # 5-20, Bogotá', latitude: 4.598056, longitude: -74.076111 },
    })
    const withMap = mountEntryPage('con-mapa')
    await flushPromises()
    const section = withMap.get('.pb-location')
    expect(section.get('h2').text()).toBe('Dónde estamos')
    expect(section.text()).toContain('Calle 10 # 5-20, Bogotá')
    expect(withMap.text()).toContain('En el local')

    resetPublicProfileCache()
    respond(profile)
    const without = mountEntryPage('sin-mapa')
    await flushPromises()
    expect(without.find('.pb-location').exists()).toBe(false)
    expect(without.text()).not.toContain('En el local')
  })

  it('asks for the Google reviews of the link and shows nothing when there are none (HU-101)', async () => {
    respond(profile)
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(getGoogleReviewsMock).toHaveBeenCalledWith('barberia-ejemplo')
    expect(wrapper.find('.pb-google').exists()).toBe(false)
  })

  it('has no accessibility violations on success', async () => {
    respond({ ...profile, contactEmail: 'hola@example.test' })
    const wrapper = mountEntryPage()
    await flushPromises()
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })
})
