/**
 * Pruebas de AppointmentActions, el paso 03 «Tu turno» del acceso con código (issue #647):
 * - lee el turno con la credencial y lo resume en una línea, en la zona del negocio;
 * - ofrece «Cambiar la hora» (enlace a HU-104) solo si la pista local lo permite y explica
 *   por qué no cuando no;
 * - «Cancelar turno» abre la confirmación aquí mismo, envía con la versión y la clave de
 *   idempotencia, y muestra el desenlace sin salir;
 * - `initialAction="cancel"` abre directo la confirmación (enlace de Odin);
 * - errores de lectura y accesibilidad (axe-core).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'

const getMock = vi.hoisted(() => vi.fn())
const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { GET: getMock, POST: postMock } }))

const { default: AppointmentActions } = await import('../AppointmentActions.vue')

const STARTS_AT = '2027-03-15T15:00:00Z'
const ok = (status = 200) => ({ ok: true, status, headers: new Headers() }) as Response

function view(over: Record<string, unknown> = {}) {
  return {
    businessName: 'Casa Ejemplo',
    timezone: 'America/Bogota',
    attendeeName: 'Cliente Ejemplo',
    serviceName: 'Corte clásico',
    durationMinutes: 30,
    professionalName: 'Juan',
    startsAt: STARTS_AT,
    endsAt: '2027-03-15T15:30:00Z',
    status: 'confirmed',
    cancellationDeadlineMinutes: 60,
    lateCancellationClientAllowed: false,
    lateCancellationReasonRequired: false,
    versionToken: 'v-1',
    businessContactEmail: 'contacto@ejemplo.test',
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

const wrappers: VueWrapper[] = []
async function mountActions(props: Record<string, unknown> = {}, appointment = view()) {
  getMock.mockResolvedValue({ data: appointment, error: undefined, response: ok() })
  const w = mount(AppointmentActions, {
    props: { token: 'tok-1', slug: 'mi-casa', ...props },
    attachTo: document.body,
  })
  wrappers.push(w)
  await flushPromises()
  return w
}

const byText = (w: VueWrapper, text: string) =>
  w.findAll('button').find((b) => b.text().includes(text))

beforeEach(() => {
  getMock.mockReset()
  postMock.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-03-10T12:00:00Z'))
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})

describe('AppointmentActions · el turno y sus dos acciones', () => {
  it('lee el turno con la credencial y lo resume en la hora del negocio', async () => {
    const w = await mountActions()

    expect(getMock).toHaveBeenCalledWith('/customer/appointments/{token}', {
      params: { path: { token: 'tok-1' } },
    })
    const ticket = w.find('.actions__ticket')
    expect(ticket.text()).toContain('10:00')
    expect(ticket.text()).toContain('10:30')
    expect(ticket.text()).toContain('Corte clásico con Juan')
    expect(ticket.text()).toContain('Casa Ejemplo · Hora de Colombia')
  })

  it('«Cambiar la hora» lleva a la pantalla de HU-104 y dice cuántos cambios quedan', async () => {
    const w = await mountActions()
    const link = w.find('a.actions__choice')

    expect(link.attributes('href')).toBe('/mi-turno/tok-1/reprogramar')
    expect(link.text()).toContain('Puedes cambiarla hasta 2 veces')
    expect(w.find('a.actions__full').attributes('href')).toBe('/mi-turno/tok-1')
  })

  it('sin cambios disponibles no ofrece el enlace y explica por qué', async () => {
    const w = await mountActions({}, view({ rescheduleRemaining: 0 }))

    expect(w.find('a.actions__choice').exists()).toBe(false)
    expect(w.find('.actions__choice--off').text()).toContain('Ya usaste los cambios de hora')
  })

  it('pasado el plazo explica que hay que contactar y la cancelación lo dice también', async () => {
    vi.setSystemTime(new Date('2027-03-15T14:30:00Z'))
    const w = await mountActions()

    expect(w.find('.actions__choice--off').text()).toContain('Ya pasó el plazo')
    expect(byText(w, 'Cancelar turno')!.text()).toContain('Ya no se puede cancelar desde aquí')

    await byText(w, 'Cancelar turno')!.trigger('click')
    expect(w.find('form').exists()).toBe(false)
    // Sin formulario no hay «Mantener mi turno»: el panel ofrece volver.
    await byText(w, 'Volver a las opciones')!.trigger('click')
    expect(w.find('.actions__menu').exists()).toBe(true)
  })
})

describe('AppointmentActions · cancelar aquí mismo', () => {
  it('abre la confirmación, cancela con la versión y muestra el desenlace sin salir', async () => {
    const w = await mountActions()
    await byText(w, 'Cancelar turno')!.trigger('click')

    expect(w.emitted('modeChange')?.at(-1)).toEqual(['cancel'])
    expect(document.activeElement).toBe(w.find('#appointment-cancel-title').element)

    postMock.mockResolvedValueOnce({ data: {}, error: undefined, response: ok() })
    await w.find('textarea').setValue('Viaje')
    await w.find('form').trigger('submit')
    await flushPromises()

    const [path, options] = postMock.mock.calls[0]!
    expect(path).toBe('/customer/appointments/{token}/cancel')
    expect(options.params.path.token).toBe('tok-1')
    expect(options.params.header['If-Match']).toBe('v-1')
    expect(options.body).toEqual({ reason: 'Viaje' })

    expect(w.emitted('cancelled')).toHaveLength(1)
    expect(w.text()).toContain('Tu turno quedó cancelado')
    expect(w.find('.actions__stamp').text()).toBe('Cancelado')
    expect(w.find('.actions__done-link').attributes('href')).toBe('/reservar/mi-casa')
    expect(w.find('.actions__menu').exists()).toBe(false)
    expect(document.activeElement).toBe(w.find('.actions__done').element)
  })

  it('«Mantener mi turno» vuelve a las opciones con el foco en «Cancelar turno»', async () => {
    const w = await mountActions()
    await byText(w, 'Cancelar turno')!.trigger('click')

    await byText(w, 'Mantener mi turno')!.trigger('click')
    await flushPromises()

    expect(w.find('form').exists()).toBe(false)
    expect(w.emitted('modeChange')?.at(-1)).toEqual(['menu'])
    expect(document.activeElement).toBe(w.find('.actions__choice--cancel').element)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('con initialAction="cancel" abre directo la confirmación', async () => {
    const w = await mountActions({ initialAction: 'cancel' })

    expect(w.find('form').exists()).toBe(true)
    expect(w.find('.actions__menu').exists()).toBe(false)
  })

  it('un turno ya cancelado no ofrece acciones', async () => {
    const w = await mountActions({}, view({ status: 'cancelled_by_customer' }))

    expect(w.find('.actions__menu').exists()).toBe(false)
    expect(w.text()).toContain('Este turno ya está cancelado')
  })
})

describe('AppointmentActions · lectura fallida', () => {
  it('un acceso vencido pide un código nuevo', async () => {
    getMock.mockResolvedValue({
      data: undefined,
      error: { status: 404, code: 'not-found' },
      response: { ok: false, status: 404, headers: new Headers() } as Response,
    })
    const w = mount(AppointmentActions, { props: { token: 'tok-1', slug: 'mi-casa' } })
    wrappers.push(w)
    await flushPromises()

    expect(w.text()).toContain('Pide un código nuevo')
  })

  it('sin red avisa y deja reintentar', async () => {
    getMock.mockRejectedValueOnce(new TypeError('fallo de red'))
    const w = mount(AppointmentActions, { props: { token: 'tok-1', slug: 'mi-casa' } })
    wrappers.push(w)
    await flushPromises()
    expect(w.text()).toContain('No pudimos conectar')

    getMock.mockResolvedValueOnce({ data: view(), error: undefined, response: ok() })
    await byText(w, 'Reintentar')!.trigger('click')
    await flushPromises()
    expect(w.find('.actions__menu').exists()).toBe(true)
  })
})

describe('AppointmentActions · accesibilidad', () => {
  it.each([
    ['opciones', async () => mountActions()],
    [
      'confirmación',
      async () => {
        const w = await mountActions()
        await byText(w, 'Cancelar turno')!.trigger('click')
        return w
      },
    ],
    ['sin cambios', async () => mountActions({}, view({ rescheduleRemaining: 0 }))],
  ])('«%s» no tiene violaciones de axe', async (_name, build) => {
    const w = await build()
    expect((await axe(w.element)).violations).toEqual([])
  })
})
