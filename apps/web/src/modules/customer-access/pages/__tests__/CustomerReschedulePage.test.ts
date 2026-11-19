/**
 * Pruebas de CustomerReschedulePage (HU-104, DEC-178):
 * - carga del turno y de las franjas, agrupadas por día del negocio;
 * - la hora actual se ve pero no se puede elegir;
 * - elegir con ratón y con teclado (roving tabindex), resumen «antes → ahora»;
 * - confirmar: cabeceras, éxito y foco en el título;
 * - rechazos del servidor: hora ocupada (recarga), plazo cerrado, límite;
 * - estados sin cambio posible: plazo vencido, sin cambios, no confirmado;
 * - la clave de idempotencia se reutiliza solo al reintentar la misma hora;
 * - enlace inválido, error de red con reintento y accesibilidad (axe-core).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { GET: getMock, POST: postMock } }))

const { default: CustomerReschedulePage } = await import('../CustomerReschedulePage.vue')

// «Ahora» fijo: lunes 15 de marzo de 2027, 08:00 en Bogotá. El turno es a las 10:00.
const NOW = new Date('2027-03-15T13:00:00Z')

const ok = () => ({ ok: true, status: 200, headers: new Headers() }) as Response
const fail = (status: number) => ({ ok: false, status, headers: new Headers() }) as Response
const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: 'req-9',
})

function appointmentData(over: Record<string, unknown> = {}) {
  return {
    businessName: 'Barbería Ejemplo',
    timezone: 'America/Bogota',
    attendeeName: 'Cliente Ejemplo',
    serviceName: 'Corte clásico',
    durationMinutes: 30,
    professionalName: 'Barbero Ejemplo',
    startsAt: '2027-03-15T15:00:00Z',
    endsAt: '2027-03-15T15:30:00Z',
    status: 'confirmed',
    cancellationDeadlineMinutes: 60,
    lateCancellationClientAllowed: false,
    lateCancellationReasonRequired: false,
    versionToken: 'v-1',
    businessContactEmail: 'contacto@barberia-ejemplo.test',
    businessContactPhone: '+573001234567',
    vocabulary: {
      businessTerm: 'barbería',
      businessTermGender: 'feminine',
      professionalTerm: 'barbero',
      professionalTermPlural: 'barberos',
      professionalTermGender: 'masculine',
    },
    canReview: false,
    review: null,
    rescheduleRemaining: 2,
    ...over,
  }
}

// Dos días: el lunes 15 incluye la hora actual (10:00); el martes 16, otras dos.
const STARTS = [
  '2027-03-15T15:00:00Z',
  '2027-03-15T16:00:00Z',
  '2027-03-16T14:00:00Z',
  '2027-03-16T14:30:00Z',
]

function mockLoad(options: { appointment?: Record<string, unknown>; starts?: string[] } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === '/customer/appointments/{token}') {
      return Promise.resolve({ data: appointmentData(options.appointment), response: ok() })
    }
    return Promise.resolve({
      data: { timezone: 'America/Bogota', starts: options.starts ?? STARTS },
      response: ok(),
    })
  })
}

function respondPost(status: number, error?: unknown) {
  postMock.mockResolvedValueOnce({
    data:
      status === 200
        ? { startsAt: '2027-03-16T14:00:00Z', endsAt: '2027-03-16T14:30:00Z' }
        : undefined,
    error,
    response: status === 200 ? ok() : fail(status),
  })
}

const wrappers: VueWrapper[] = []
async function mountPage() {
  const wrapper = mount(CustomerReschedulePage, {
    props: { token: 'tok-1' },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

// El selector es el de «Día y hora» (DayTimePicker): días y horas son grupos de radio.
const slots = (w: VueWrapper) => w.findAll('.bk-hours [role="radio"]')
const days = (w: VueWrapper) => w.findAll('.bk-days [role="radio"]')
const confirmButton = (w: VueWrapper) =>
  w
    .findAll('button')
    .find((b) => b.text().startsWith('Cambiar a') || b.text() === 'Elige una hora')!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  getMock.mockReset()
  postMock.mockReset()
})

afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})

describe('CustomerReschedulePage', () => {
  it('muestra el turno actual y los días con horas libres en la zona del negocio', async () => {
    mockLoad()
    const w = await mountPage()

    expect(w.find('h1').text()).toBe('Cambiar la hora')
    expect(w.text()).toContain('Barbería Ejemplo')
    expect(w.text()).toContain('Hora actual')
    expect(w.text()).toContain('Corte clásico')
    // La zona en palabras, nunca el identificador IANA («Bogota» sin tilde).
    expect(w.text()).toContain('Hora de Colombia')
    expect(w.text()).not.toContain('Bogota')
    // La franja del día marca la hora actual con el rombo hueco.
    expect(w.find('.daylight__marker--current').exists()).toBe(true)
    expect(days(w)).toHaveLength(2)
    expect(days(w)[0]!.attributes('aria-checked')).toBe('true')
    expect(w.text()).toContain('Te quedan 2 cambios')
    expect(w.text()).toContain('Puedes cambiarla hasta las')
    expect(confirmButton(w).attributes('disabled')).toBeDefined()
  })

  it('la hora actual se ve marcada pero no se puede elegir', async () => {
    mockLoad()
    const w = await mountPage()

    const current = slots(w)[0]!
    expect(current.attributes('aria-disabled')).toBe('true')
    expect(current.attributes('aria-label')).toContain('tu hora actual')
    await current.trigger('click')
    expect(current.attributes('aria-checked')).toBe('false')
    expect(confirmButton(w).attributes('disabled')).toBeDefined()
  })

  it('elegir otro día y otra hora arma el «antes → ahora» y habilita confirmar', async () => {
    mockLoad()
    const w = await mountPage()

    await days(w)[1]!.trigger('click')
    expect(days(w)[1]!.attributes('aria-checked')).toBe('true')
    await slots(w)[0]!.trigger('click')

    expect(slots(w)[0]!.attributes('aria-checked')).toBe('true')
    expect(w.find('.stamp__time--struck').exists()).toBe(true)
    expect(w.text()).toContain('9:00')
    expect(confirmButton(w).text()).toMatch(/^Cambiar a mar 16, 9:00/)
    expect(w.find('[role="status"].visually-hidden').text()).toContain('Nueva hora elegida')
  })

  it('con el teclado las flechas recorren y eligen, como en «Día y hora»', async () => {
    mockLoad()
    const w = await mountPage()
    await days(w)[1]!.trigger('click')
    await flushPromises()

    const group = w.find('.bk-hours[role="radiogroup"]')
    expect(slots(w)[0]!.attributes('tabindex')).toBe('0')
    await group.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(slots(w)[1]!.attributes('tabindex')).toBe('0')
    expect(document.activeElement).toBe(slots(w)[1]!.element)
    expect(slots(w)[1]!.attributes('aria-checked')).toBe('true')
    expect(confirmButton(w).attributes('disabled')).toBeUndefined()
  })

  it('confirma con If-Match y clave de idempotencia y muestra el boleto nuevo', async () => {
    mockLoad()
    respondPost(200)
    const w = await mountPage()
    await days(w)[1]!.trigger('click')
    await slots(w)[0]!.trigger('click')
    await confirmButton(w).trigger('click')
    await flushPromises()

    const [path, init] = postMock.mock.calls[0]!
    expect(path).toBe('/customer/appointments/{token}/reschedule')
    expect(init.params.path).toEqual({ token: 'tok-1' })
    expect(init.params.header['If-Match']).toBe('v-1')
    expect(init.params.header['Idempotency-Key']).toMatch(/.+/)
    expect(init.body).toEqual({ startsAt: '2027-03-16T14:00:00Z' })

    expect(w.text()).toContain('Listo. Tu turno quedó para el')
    expect(w.text()).toContain('puedes cambiarla una vez más')
    expect(document.activeElement).toBe(w.find('h1').element)
    expect(w.find('a.reschedule__cta').attributes('href')).toBe('/mi-turno/tok-1')
  })

  it('si la hora se ocupó, vuelve a pedir las franjas, conserva el día y avisa', async () => {
    mockLoad()
    respondPost(409, problem(409, 'slot-conflict'))
    const w = await mountPage()
    await days(w)[1]!.trigger('click')
    await slots(w)[0]!.trigger('click')
    mockLoad({ starts: STARTS.filter((s) => s !== '2027-03-16T14:00:00Z') })
    await confirmButton(w).trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Esa hora se acaba de ocupar')
    expect(days(w)[1]!.attributes('aria-checked')).toBe('true')
    expect(slots(w)).toHaveLength(1)
    expect(slots(w)[0]!.attributes('aria-checked')).toBe('false')
  })

  it.each([
    ['reschedule-window-closed', 'Ya no puedes cambiar la hora por tu cuenta'],
    ['reschedule-limit-reached', 'Ya usaste los cambios de este turno'],
  ])('el rechazo %s del servidor prevalece y ofrece el contacto', async (code, headline) => {
    mockLoad()
    respondPost(422, problem(422, code))
    const w = await mountPage()
    await slots(w)[1]!.trigger('click')
    await confirmButton(w).trigger('click')
    await flushPromises()

    expect(w.text()).toContain(headline)
    expect(w.find('[role="radiogroup"]').exists()).toBe(false)
    expect(w.find('a[href="tel:+573001234567"]').exists()).toBe(true)
  })

  it.each([
    [{ cancellationDeadlineMinutes: 180 }, 'Ya no puedes cambiar la hora por tu cuenta'],
    [{ cancellationDeadlineMinutes: 0 }, 'Ya no puedes cambiar la hora por tu cuenta'],
    [{ rescheduleRemaining: 0 }, 'Ya usaste los cambios de este turno'],
    [{ status: 'cancelled_by_customer' }, 'Este turno ya no se puede mover'],
  ])('sin cambio posible (%o) no muestra el selector', async (appointment, headline) => {
    mockLoad({ appointment })
    const w = await mountPage()

    expect(w.text()).toContain(headline)
    expect(w.find('[role="radiogroup"]').exists()).toBe(false)
    expect(w.find('a.reschedule__back').attributes('href')).toBe('/mi-turno/tok-1')
  })

  it('sin otras horas libres lo dice y ofrece volver', async () => {
    mockLoad({ starts: [] })
    const w = await mountPage()
    expect(w.text()).toContain('No hay otras horas libres con Barbero Ejemplo')
    expect(w.find('[role="radiogroup"]').exists()).toBe(false)
  })

  it('tras un fallo de red reintenta la misma hora con la misma clave', async () => {
    mockLoad()
    postMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    respondPost(200)
    const w = await mountPage()
    await slots(w)[1]!.trigger('click')
    await confirmButton(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('No pudimos conectar')

    await confirmButton(w).trigger('click')
    await flushPromises()
    const firstKey = postMock.mock.calls[0]![1].params.header['Idempotency-Key']
    const secondKey = postMock.mock.calls[1]![1].params.header['Idempotency-Key']
    expect(secondKey).toBe(firstKey)
    expect(w.text()).toContain('Listo.')
  })

  it('otra hora tras un fallo de red usa una clave nueva', async () => {
    mockLoad()
    postMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    respondPost(200)
    const w = await mountPage()
    await days(w)[1]!.trigger('click')
    await slots(w)[0]!.trigger('click')
    await confirmButton(w).trigger('click')
    await flushPromises()
    await slots(w)[1]!.trigger('click')
    await confirmButton(w).trigger('click')
    await flushPromises()

    const firstKey = postMock.mock.calls[0]![1].params.header['Idempotency-Key']
    const secondKey = postMock.mock.calls[1]![1].params.header['Idempotency-Key']
    expect(secondKey).not.toBe(firstKey)
  })

  it('un enlace inválido muestra el estado de error sin el selector', async () => {
    getMock.mockResolvedValue({
      data: undefined,
      error: problem(404, 'not-found'),
      response: fail(404),
    })
    const w = await mountPage()
    expect(w.text()).toContain('No pudimos abrir ese enlace')
  })

  it('un error de red al cargar ofrece reintentar', async () => {
    getMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const w = await mountPage()
    expect(w.text()).toContain('No pudimos conectar')

    mockLoad()
    await w
      .findAll('button')
      .find((b) => b.text() === 'Reintentar')!
      .trigger('click')
    await flushPromises()
    expect(w.find('[role="radiogroup"]').exists()).toBe(true)
  })

  it('no tiene violaciones de accesibilidad con una hora elegida ni al terminar', async () => {
    mockLoad()
    respondPost(200)
    const w = await mountPage()
    await slots(w)[1]!.trigger('click')
    expect(await axe(w.element)).toHaveNoViolations()

    await confirmButton(w).trigger('click')
    await flushPromises()
    expect(await axe(w.element)).toHaveNoViolations()
  })
})
