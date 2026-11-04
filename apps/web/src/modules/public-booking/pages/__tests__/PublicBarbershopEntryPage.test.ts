/**
 * Pruebas de PublicBarbershopEntryPage (HU-090): carga, éxito (nombre, hora
 * local en la zona de la barbería, contacto opcional), enlace no
 * disponible/desconocido/no publicable (CA-090-02, todos indistinguibles),
 * error de red con reintento, error inesperado con requestId, y ausencia
 * de violaciones de accesibilidad (axe-core) en cada estado observable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'vitest-axe'

const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({
  httpClient: { GET: getMock, POST: vi.fn() },
}))

// Las reseñas de Google (HU-101) tienen su propia suite: aquí se aíslan para que esta
// siga contando solo las peticiones de la entrada.
const getGoogleReviewsMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/getPublicGoogleReviewsApi', () => ({
  getPublicGoogleReviews: getGoogleReviewsMock,
}))

const { default: PublicBarbershopEntryPage } = await import('../PublicBarbershopEntryPage.vue')

// Una barbería que nunca configuró su vocabulario recibe los valores iniciales (DEC-119).
const initialVocabulary = {
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
  vocabulary: initialVocabulary,
  location: null,
  offersHomeService: false,
}

function okResponse(): Response {
  return { ok: true, status: 200, headers: new Headers() } as Response
}

function errorResponse(status: number): Response {
  return { ok: false, status, headers: new Headers() } as Response
}

// RouterLink stubbed en vez de un router real (mismo patrón que
// LoginPage.test.ts): esta suite verifica el componente en aislamiento, no
// el enrutamiento, y el CTA de la pantalla de éxito ("Reservar un turno")
// navega a la ruta del catálogo público (HU-091).
function mountEntryPage(props: { slug: string }) {
  return mount(PublicBarbershopEntryPage, {
    props,
    global: { stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } },
  })
}

beforeEach(() => {
  getMock.mockReset()
  getGoogleReviewsMock.mockReset()
  getGoogleReviewsMock.mockResolvedValue({ kind: 'empty' })
})

describe('PublicBarbershopEntryPage', () => {
  it('shows the loading state while the request is in flight', async () => {
    let resolveRequest!: (value: unknown) => void
    getMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })

    expect(wrapper.text()).toContain('Abriendo tu reserva')

    resolveRequest({ data: undefined, error: undefined, response: errorResponse(500) })
    await flushPromises()
  })

  it('resolves the slug from props, without reading useRoute (CA-090-03)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()

    expect(getMock).toHaveBeenCalledWith(
      '/public/barbershops/{slug}',
      expect.objectContaining({ params: { path: { slug: 'barberia-ejemplo' } } }),
    )
  })

  it('renders the barbershop name and its local time on success (CA-090-01)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()

    expect(wrapper.text()).toContain('Barbería Ejemplo')
    expect(wrapper.text()).toContain('Hora local de la barbería')
  })

  it('keeps the barbershop clock moving instead of freezing the time of the first paint (DEC-111)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-15T19:00:00Z'))
      getMock.mockResolvedValueOnce({
        data: {
          name: 'Barbería Ejemplo',
          timezone: 'America/Bogota',
          contactEmail: null,
          contactPhone: null,
          vocabulary: initialVocabulary,
        },
        error: undefined,
        response: okResponse(),
      })
      const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
      await flushPromises()
      expect(wrapper.text()).toMatch(/2:00\s*p\.\s*m\./)

      vi.setSystemTime(new Date('2026-09-15T19:05:00Z'))
      await vi.advanceTimersByTimeAsync(15_000)
      expect(wrapper.text()).toMatch(/2:05\s*p\.\s*m\./)

      // Al salir de la pantalla el reloj deja de correr.
      wrapper.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows contact when configured and omits the block when both are absent (CA-090-04)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: 'contacto@ejemplo.test',
        contactPhone: '+573001234567',
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    const withContact = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()
    expect(withContact.text()).toContain('contacto@ejemplo.test')
    // Bandera, prefijo y número separados, no el E.164 pegado.
    const phoneRow = withContact.get('.pb-contact__row .phone-display')
    expect(phoneRow.get('.phone-display__dial').text()).toBe('+57')
    expect(phoneRow.get('.phone-display__number').text()).toBe('300 123 4567')
    expect(withContact.text()).not.toContain('+573001234567')

    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    const withoutContact = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()
    expect(withoutContact.text()).not.toContain('Teléfono:')
    expect(withoutContact.text()).not.toContain('Correo:')
  })

  it('never renders an internal id, barbershopId or the slug itself in the DOM (CA-090-04)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-secreta-interna' })
    await flushPromises()

    expect(wrapper.html()).not.toContain('barberia-secreta-interna')
    expect(wrapper.html().toLowerCase()).not.toContain('barbershopid')
  })

  it('shows the same uniform message for a 404 (malformed, unknown or non-publishable, CA-090-02)', async () => {
    getMock.mockResolvedValueOnce({
      data: undefined,
      error: { status: 404 },
      response: errorResponse(404),
    })
    const wrapper = mountEntryPage({ slug: 'no-existe' })
    await flushPromises()

    expect(wrapper.text()).toContain('No encontramos ese enlace')
  })

  it('offers a retry action on a network error, re-fetching the same slug (CA-090-05)', async () => {
    getMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()
    expect(wrapper.text()).toContain('No pudimos conectar')

    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Barbería Ejemplo')
    expect(getMock).toHaveBeenCalledTimes(2)
    expect(getMock).toHaveBeenLastCalledWith(
      '/public/barbershops/{slug}',
      expect.objectContaining({ params: { path: { slug: 'barberia-ejemplo' } } }),
    )
  })

  it('shows the requestId on an unexpected error, without leaking the raw problem body', async () => {
    getMock.mockResolvedValueOnce({
      data: undefined,
      error: { status: 500, code: 'internal', title: 'Error interno', requestId: 'req-abc-123' },
      response: errorResponse(500),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()

    expect(wrapper.text()).toContain('req-abc-123')
    expect(wrapper.text()).toContain('Ocurrió un error inesperado')
  })

  it('shows the Google reviews section only when the listing has data (HU-101, CA-101-01)', async () => {
    getMock.mockResolvedValueOnce({
      data: profile,
      error: undefined,
      response: okResponse(),
    })
    getGoogleReviewsMock.mockResolvedValueOnce({
      kind: 'success',
      reviews: { rating: 4.7, ratingCount: 128, mapsUrl: null, reviews: [] },
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()

    expect(getGoogleReviewsMock).toHaveBeenCalledWith('barberia-ejemplo')
    expect(wrapper.text()).toContain('Opiniones en Google')
  })

  it('shows no Google section and no error when there is nothing to show (CA-101-01, CA-101-03)', async () => {
    getMock.mockResolvedValueOnce({
      data: profile,
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Google')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('has no accessibility violations in the loading state', async () => {
    getMock.mockReturnValueOnce(new Promise(() => {}))
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })

  it('has no accessibility violations on success', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: 'contacto@ejemplo.test',
        contactPhone: '+573001234567',
        vocabulary: initialVocabulary,
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ejemplo' })
    await flushPromises()
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })

  it('shows where the barbershop is, with the map and the address, when it has a location (CA-102-04)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
        location: { address: 'Calle 10 # 5-20, Bogotá', latitude: 4.598056, longitude: -74.076111 },
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ubicacion-1' })
    await flushPromises()

    const section = wrapper.get('.pb-location')
    expect(section.get('h2').text()).toBe('Dónde estamos')
    expect(section.get('iframe').attributes('src')).toContain('4.598056')
    expect(section.text()).toContain('Calle 10 # 5-20, Bogotá')
  })

  it.each([
    ['location is null (switch off or not geocoded: CA-102-02, CA-102-03)', { location: null }],
    ['the server omits location', {}],
  ])('renders no location section, and no error, when %s', async (_name, extra) => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: null,
        contactPhone: null,
        vocabulary: initialVocabulary,
        ...extra,
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ubicacion-2' })
    await flushPromises()

    expect(wrapper.find('.pb-location').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Dónde estamos')
    expect(wrapper.text()).toContain('Reservar un turno')
  })

  it('draws the clock dial with the barbershop hour, and keeps it out of the accessibility tree', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-15T19:30:00Z'))
      getMock.mockResolvedValueOnce({
        data: { ...profile, name: 'Barbería Ejemplo' },
        error: undefined,
        response: okResponse(),
      })
      const wrapper = mountEntryPage({ slug: 'barberia-reloj' })
      await flushPromises()

      const dial = wrapper.get('svg.pb-dial')
      expect(dial.attributes('aria-hidden')).toBe('true')
      // 14:30 en Bogotá: el texto de la hora sigue siendo la señal para quien no ve el reloj.
      expect(wrapper.get('.pb-clock__time').text()).toMatch(/2:30\s*p\.\s*m\./)
      expect(wrapper.get('.pb-clock__label').text()).toBe('Hora local de la barbería')
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the primary action before the data sheet, so it never waits behind the map', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ...profile,
        location: { address: 'Calle 10 # 5-20, Bogotá', latitude: 4.598056, longitude: -74.076111 },
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-orden' })
    await flushPromises()

    const cta = wrapper.get('.pb-cta')
    const plate = wrapper.get('.pb-plate')
    expect(cta.element.compareDocumentPosition(plate.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(wrapper.get('.pb-steps').text()).toContain('Barbero')
  })

  it('frames the map as a plan with its coordinates, and the modes of attention only from the profile', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ...profile,
        offersHomeService: true,
        location: { address: 'Calle 10 # 5-20, Bogotá', latitude: 4.598056, longitude: -74.076111 },
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-plano' })
    await flushPromises()

    expect(wrapper.get('.pb-plano__coords').text()).toBe('4.5981° N · 74.0761° O')
    expect(wrapper.get('.pb-contact').text()).toContain('En el local · A domicilio')
  })

  it('omits the attention row when the profile declares neither a place nor home service', async () => {
    getMock.mockResolvedValueOnce({ data: profile, error: undefined, response: okResponse() })
    const wrapper = mountEntryPage({ slug: 'barberia-sin-modalidad' })
    await flushPromises()

    expect(wrapper.find('.pb-contact').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Atención')
  })

  it('has no accessibility violations on success with a location', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        name: 'Barbería Ejemplo',
        timezone: 'America/Bogota',
        contactEmail: 'contacto@ejemplo.test',
        contactPhone: '+573001234567',
        vocabulary: initialVocabulary,
        location: { address: 'Calle 10 # 5-20, Bogotá', latitude: 4.598056, longitude: -74.076111 },
      },
      error: undefined,
      response: okResponse(),
    })
    const wrapper = mountEntryPage({ slug: 'barberia-ubicacion-3' })
    await flushPromises()
    // jsdom no resuelve el contenido del iframe: axe revisa el resto de la página.
    const results = await axe(wrapper.element, { iframes: false })
    expect(results).toHaveNoViolations()
  })

  it('has no accessibility violations on the not-found error state', async () => {
    getMock.mockResolvedValueOnce({
      data: undefined,
      error: { status: 404 },
      response: errorResponse(404),
    })
    const wrapper = mountEntryPage({ slug: 'no-existe' })
    await flushPromises()
    const results = await axe(wrapper.element)
    expect(results).toHaveNoViolations()
  })
})
