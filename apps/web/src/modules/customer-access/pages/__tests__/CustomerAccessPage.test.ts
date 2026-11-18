/**
 * Pruebas de CustomerAccessPage (HU-105, DEC-178):
 * - paso 1: contacto vacío sin llamar al servidor, contacto inválido, límite (429), red;
 * - paso 2: el contacto se muestra enmascarado, el código se verifica al completarse,
 *   un código incorrecto se limpia y a los cinco se bloquea; reenvío con cuenta atrás;
 * - paso 3: un turno abre sus acciones en la misma página (#647); varios se eligen antes en
 *   una lista, también sin salir;
 * - barbería inexistente y accesibilidad (axe-core) en cada paso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { axe } from 'vitest-axe'

const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { POST: postMock } }))

const { default: CustomerAccessPage } = await import('../CustomerAccessPage.vue')

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: 'req-7',
})

type Reply = { status: number; data?: unknown; error?: unknown; headers?: HeadersInit }
const CHALLENGE = '/public/businesses/{slug}/customer-access/challenge'
const VERIFY = '/public/businesses/{slug}/customer-access/verify'

/** Responde cada operación con su cola de respuestas, en orden. */
function script(queues: { challenge?: Reply[]; verify?: Reply[] }) {
  const pending = {
    [CHALLENGE]: [...(queues.challenge ?? [])],
    [VERIFY]: [...(queues.verify ?? [])],
  }
  postMock.mockImplementation((path: string) => {
    const next = pending[path as keyof typeof pending]?.shift()
    if (!next) return Promise.reject(new Error(`sin respuesta preparada para ${path}`))
    return Promise.resolve({
      data: next.data,
      error: next.error,
      response: {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        headers: new Headers(next.headers),
      } as Response,
    })
  })
}

const ACCEPTED: Reply = { status: 202, data: { expiresInSeconds: 600, resendAfterSeconds: 60 } }
const WRONG: Reply = { status: 401, error: problem(401, 'unauthorized') }
const appointment = (token: string, startsAt: string, service: string, barber: string) => ({
  accessToken: token,
  startsAt,
  serviceName: service,
  professionalName: barber,
})
const ONE: Reply = {
  status: 200,
  data: {
    timezone: 'America/Bogota',
    appointments: [appointment('tok-1', '2027-03-15T15:00:00Z', 'Corte clásico', 'Juan')],
  },
}
const TWO: Reply = {
  status: 200,
  data: {
    timezone: 'America/Bogota',
    appointments: [
      appointment('tok-1', '2027-03-15T15:00:00Z', 'Corte clásico', 'Juan'),
      appointment('tok-2', '2027-03-22T20:30:00Z', 'Corte y barba', 'Ana'),
    ],
  },
}

// El paso 03 delega en AppointmentActions (probado aparte): aquí basta con saber qué turno
// abre y con qué acción.
const ActionsStub = {
  name: 'AppointmentActions',
  props: ['token', 'slug', 'initialAction'],
  emits: ['cancelled', 'modeChange'],
  template:
    '<section data-test="actions" :data-token="token" :data-slug="slug" :data-action="initialAction"><h2>Tu turno</h2></section>',
}

const wrappers: VueWrapper[] = []
let router: Router

async function mountPage() {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/reservar/:slug/mi-turno',
        name: 'mi-turno-acceso',
        component: { template: '<div />' },
      },
      {
        path: '/mi-turno/:token',
        name: 'mi-turno',
        component: { template: '<div />' },
      },
    ],
  })
  await router.push('/reservar/mi-barberia/mi-turno')
  await router.isReady()
  const wrapper = mount(CustomerAccessPage, {
    props: { slug: 'mi-barberia' },
    global: { plugins: [router], stubs: { AppointmentActions: ActionsStub } },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const contactInput = (w: VueWrapper) => w.find('input[name="contact"]')
const slotInputs = (w: VueWrapper) => w.findAll('.otp-input__slots input')
const buttonByText = (w: VueWrapper, text: string) =>
  w.findAll('button').find((b) => b.text() === text)

async function sendContact(w: VueWrapper, contact = 'ana.perez@correo.test') {
  await contactInput(w).setValue(contact)
  await w.find('form').trigger('submit')
  await flushPromises()
}

async function typeCode(w: VueWrapper, code: string) {
  const inputs = slotInputs(w)
  for (let i = 0; i < code.length; i++) {
    await inputs[i]!.setValue(code[i]!)
  }
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  postMock.mockReset()
})

afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})

describe('CustomerAccessPage · paso 1, contacto', () => {
  // #649: anticipa por dónde llegará el código según lo que se escribe, sin llamar al servidor.
  it('enciende el canal que corresponde a lo escrito y lo anuncia', async () => {
    const w = await mountPage()
    const chips = () => w.findAll('.stub__chip--on').map((c) => c.text())

    expect(chips()).toEqual([])
    await contactInput(w).setValue('ana@correo.test')
    expect(chips()).toEqual(['Correo'])
    expect(w.find('.stub__channel [aria-live="polite"]').text()).toBe(
      'El código te llegará por correo.',
    )
    await contactInput(w).setValue('300 123 4567')
    expect(chips()).toEqual(['WhatsApp'])
    expect(w.find('.stub__channel [aria-live="polite"]').text()).toBe(
      'El código te llegará por WhatsApp.',
    )
    expect(postMock).not.toHaveBeenCalled()
  })

  it('abre con el título enfocado y sin llamar al servidor', async () => {
    const w = await mountPage()
    expect(w.find('h1').text()).toBe('Encuentra tu turno')
    expect(document.activeElement).toBe(w.find('h1').element)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('con el contacto vacío avisa y no llama al servidor', async () => {
    const w = await mountPage()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('Escribe tu correo o tu celular.')
    expect(postMock).not.toHaveBeenCalled()
  })

  it('pide el código con el contacto recortado y pasa al paso del código', async () => {
    script({ challenge: [ACCEPTED] })
    const w = await mountPage()
    await sendContact(w, '  ana.perez@correo.test ')

    expect(postMock).toHaveBeenCalledWith(CHALLENGE, {
      params: { path: { slug: 'mi-barberia' } },
      body: { contact: 'ana.perez@correo.test' },
    })
    expect(w.find('h1').text()).toBe('Escribe tu código')
    expect(document.activeElement).toBe(slotInputs(w)[0]!.element)
  })

  it('un contacto inválido se explica y conserva lo escrito', async () => {
    script({ challenge: [{ status: 422, error: problem(422, 'validation') }] })
    const w = await mountPage()
    await sendContact(w, 'esto no es un contacto')

    expect(w.text()).toContain('Escribe un correo o un celular válido.')
    expect((contactInput(w).element as HTMLInputElement).value).toBe('esto no es un contacto')
    expect(w.find('h1').text()).toBe('Encuentra tu turno')
  })

  it('el límite de solicitudes (429) dice cuánto esperar sin decir cuál límite fue', async () => {
    script({
      challenge: [
        { status: 429, error: problem(429, 'rate-limited'), headers: { 'Retry-After': '540' } },
      ],
    })
    const w = await mountPage()
    await sendContact(w)

    expect(w.text()).toContain('Pediste demasiados códigos. Vuelve a intentarlo en 9 min.')
    expect(w.find('h1').text()).toBe('Encuentra tu turno')
  })

  it('un error de red se avisa y no cambia de paso', async () => {
    postMock.mockRejectedValueOnce(new TypeError('red'))
    const w = await mountPage()
    await sendContact(w)
    expect(w.text()).toContain('No pudimos conectar')
    expect(w.find('h1').text()).toBe('Encuentra tu turno')
  })

  it('un enlace sin barbería muestra su propio estado', async () => {
    script({ challenge: [{ status: 404, error: problem(404, 'not-found') }] })
    const w = await mountPage()
    await sendContact(w)
    expect(w.text()).toContain('No encontramos este enlace')
  })
})

describe('CustomerAccessPage · paso 2, código', () => {
  it('muestra el contacto enmascarado y el canal, sin confirmar que haya un turno', async () => {
    script({ challenge: [ACCEPTED] })
    const w = await mountPage()
    await sendContact(w, 'ana.perez@correo.test')

    expect(w.text()).toContain('a•••@correo.test')
    expect(w.text()).not.toContain('ana.perez')
    expect(w.text()).toContain('el código va en camino por correo')
    expect(w.text()).toContain('Si ')
  })

  it('un celular se anuncia como WhatsApp', async () => {
    script({ challenge: [ACCEPTED] })
    const w = await mountPage()
    await sendContact(w, '300 123 4567')
    expect(w.text()).toContain('••• ••• 4567')
    expect(w.text()).toContain('el código va en camino por WhatsApp')
  })

  it('verifica solo al completar los seis dígitos', async () => {
    script({ challenge: [ACCEPTED], verify: [ONE] })
    const w = await mountPage()
    await sendContact(w)

    await typeCode(w, '48291')
    expect(postMock).not.toHaveBeenCalledWith(VERIFY, expect.anything())

    await slotInputs(w)[5]!.setValue('3')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith(VERIFY, {
      params: { path: { slug: 'mi-barberia' } },
      body: { contact: 'ana.perez@correo.test', code: '482913' },
    })
  })

  it('un código incorrecto se limpia, devuelve el foco y no revela el motivo', async () => {
    script({ challenge: [ACCEPTED], verify: [WRONG] })
    const w = await mountPage()
    await sendContact(w)
    await typeCode(w, '111111')

    expect(w.text()).toContain('Ese código no es válido o ya venció')
    expect(slotInputs(w).every((i) => (i.element as HTMLInputElement).value === '')).toBe(true)
    expect(document.activeElement).toBe(slotInputs(w)[0]!.element)
  })

  it('a los cinco códigos incorrectos bloquea la entrada y ofrece pedir uno nuevo', async () => {
    script({ challenge: [ACCEPTED], verify: [WRONG, WRONG, WRONG, WRONG, WRONG] })
    const w = await mountPage()
    await sendContact(w)
    for (let i = 0; i < 5; i++) await typeCode(w, `12345${i}`)

    expect(w.text()).toContain('Ese código ya no sirve. Pide uno nuevo para seguir.')
    expect(buttonByText(w, 'Entrar a mi turno')!.attributes('disabled')).toBeDefined()
    expect(slotInputs(w).every((i) => i.attributes('disabled') !== undefined)).toBe(true)
    // Sin esperar la cuenta atrás: el código ya no sirve.
    expect(buttonByText(w, 'Pedir otro código')).toBeDefined()
  })

  it('el reenvío espera la cuenta atrás y luego pide otro código y reinicia los intentos', async () => {
    script({ challenge: [ACCEPTED, ACCEPTED], verify: [WRONG] })
    const w = await mountPage()
    await sendContact(w)
    expect(w.text()).toContain('Podrás pedir otro en 1:00')
    expect(buttonByText(w, 'Pedir otro código')).toBeUndefined()

    vi.advanceTimersByTime(61_000)
    await flushPromises()
    expect(buttonByText(w, 'Pedir otro código')).toBeDefined()

    await buttonByText(w, 'Pedir otro código')!.trigger('click')
    await flushPromises()
    expect(postMock.mock.calls.filter(([path]) => path === CHALLENGE)).toHaveLength(2)
    expect(w.text()).toContain('Te enviamos otro código por correo.')
    expect(w.text()).toContain('Podrás pedir otro en 1:00')
  })

  it('un 429 al reenviar avisa y extiende la espera según Retry-After', async () => {
    script({
      challenge: [
        ACCEPTED,
        { status: 429, error: problem(429, 'rate-limited'), headers: { 'Retry-After': '300' } },
      ],
    })
    const w = await mountPage()
    await sendContact(w)
    vi.advanceTimersByTime(61_000)
    await flushPromises()
    await buttonByText(w, 'Pedir otro código')!.trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Pediste demasiados códigos. Vuelve a intentarlo en 5 min.')
    expect(buttonByText(w, 'Pedir otro código')).toBeUndefined()
  })

  it('«Cambiar el contacto» vuelve al paso 1 con lo escrito', async () => {
    script({ challenge: [ACCEPTED] })
    const w = await mountPage()
    await sendContact(w)
    await buttonByText(w, 'Cambiar el contacto')!.trigger('click')
    await flushPromises()

    expect(w.find('h1').text()).toBe('Encuentra tu turno')
    expect((contactInput(w).element as HTMLInputElement).value).toBe('ana.perez@correo.test')
  })
})

describe('CustomerAccessPage · paso 3, turno', () => {
  it('con un solo turno abre sus acciones en el paso 03, sin salir de la página', async () => {
    script({ challenge: [ACCEPTED], verify: [ONE] })
    const w = await mountPage()
    await sendContact(w)
    await typeCode(w, '482913')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('mi-turno-acceso')
    expect(w.find('h1').text()).toBe('¿Qué quieres hacer?')
    expect(document.activeElement).toBe(w.find('h1').element)
    expect(w.find('[aria-current="step"]').text()).toContain('Tu turno')
    const actions = w.find('[data-test="actions"]')
    expect(actions.attributes('data-token')).toBe('tok-1')
    expect(actions.attributes('data-slug')).toBe('mi-barberia')
    expect(buttonByText(w, '← Elegir otro turno')).toBeUndefined()
    expect(w.text()).not.toContain('tok-1')
  })

  it('al cancelar ahí mismo el título lo dice', async () => {
    script({ challenge: [ACCEPTED], verify: [ONE] })
    const w = await mountPage()
    await sendContact(w)
    await typeCode(w, '482913')
    await flushPromises()

    w.findComponent({ name: 'AppointmentActions' }).vm.$emit('cancelled')
    await flushPromises()
    expect(w.find('h1').text()).toBe('Turno cancelado')
  })

  it('con varios turnos los lista con su hora y abre el elegido sin salir', async () => {
    script({ challenge: [ACCEPTED], verify: [TWO] })
    const w = await mountPage()
    await sendContact(w)
    await typeCode(w, '482913')

    expect(w.find('h1').text()).toBe('Elige tu turno')
    expect(document.activeElement).toBe(w.find('h1').element)
    expect(w.find('[aria-current="step"]').text()).toContain('Tu turno')
    const tickets = w.findAll('button.ticket')
    expect(tickets).toHaveLength(2)
    expect(tickets[0]!.text()).toContain('10:00')
    expect(tickets[0]!.text()).toContain('Corte clásico con Juan')
    expect(tickets[1]!.text()).toContain('3:30')
    expect(tickets[1]!.text()).toContain('Corte y barba con Ana')
    expect(w.text()).toContain('Todas las horas son de Bogota.')

    await tickets[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('mi-turno-acceso')
    expect(w.find('[data-test="actions"]').attributes('data-token')).toBe('tok-2')

    await buttonByText(w, '← Elegir otro turno')!.trigger('click')
    await flushPromises()
    expect(w.find('h1').text()).toBe('Elige tu turno')
    expect(w.findAll('button.ticket')).toHaveLength(2)
  })
})

describe('CustomerAccessPage · accesibilidad', () => {
  it.each([
    ['contacto', async () => mountPage()],
    [
      'código',
      async () => {
        script({ challenge: [ACCEPTED] })
        const w = await mountPage()
        await sendContact(w)
        return w
      },
    ],
    [
      'código incorrecto',
      async () => {
        script({ challenge: [ACCEPTED], verify: [WRONG] })
        const w = await mountPage()
        await sendContact(w)
        await typeCode(w, '111111')
        return w
      },
    ],
    [
      'varios turnos',
      async () => {
        script({ challenge: [ACCEPTED], verify: [TWO] })
        const w = await mountPage()
        await sendContact(w)
        await typeCode(w, '482913')
        return w
      },
    ],
  ])('el paso %s no tiene violaciones de axe', async (_name, build) => {
    const w = await build()
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations()
  })
})
