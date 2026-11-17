/**
 * Pruebas de CustomerAccessRefPage (HU-106, DEC-179): el enlace que Odin entrega por
 * WhatsApp abre directo en el código, lo canjea por la referencia del enlace y abre la
 * cancelación en la misma página (cancelar, #647) o lleva a «Cambiar la hora» (reprogramar). Un código incorrecto no dice por
 * qué, a los cinco se bloquea, y la referencia nunca se muestra.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { axe } from 'vitest-axe'

const postMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { POST: postMock } }))

const { default: CustomerAccessRefPage } = await import('../CustomerAccessRefPage.vue')

const VERIFY_REF = '/public/barbershops/{slug}/customer-access/verify-ref'
const REF = 'ref-opaca-de-un-solo-uso'

const problem = (status: number, code: string) => ({
  type: `/api/v1/problems/${code}`,
  title: 'x',
  status,
  code,
  requestId: 'req-9',
})

function reply(status: number, data?: unknown, error?: unknown) {
  postMock.mockResolvedValueOnce({
    data,
    error,
    response: { ok: status >= 200 && status < 300, status, headers: new Headers() } as Response,
  })
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
        path: '/reservar/:slug/mi-turno/:accessRef',
        name: 'mi-turno-acceso-ref',
        component: { template: '<div />' },
      },
      { path: '/mi-turno/:token', name: 'mi-turno', component: { template: '<div />' } },
      {
        path: '/mi-turno/:token/reprogramar',
        name: 'mi-turno-reprogramar',
        component: { template: '<div />' },
      },
    ],
  })
  await router.push(`/reservar/mi-barberia/mi-turno/${REF}`)
  await router.isReady()
  const wrapper = mount(CustomerAccessRefPage, {
    props: { slug: 'mi-barberia', accessRef: REF },
    global: { plugins: [router], stubs: { AppointmentActions: ActionsStub } },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const slotInputs = (w: VueWrapper) => w.findAll('.otp-input__slots input')

async function typeCode(w: VueWrapper, code: string) {
  const inputs = slotInputs(w)
  for (let i = 0; i < code.length; i++) await inputs[i]!.setValue(code[i]!)
  await flushPromises()
}

beforeEach(() => postMock.mockReset())
afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()))

describe('CustomerAccessRefPage', () => {
  it('abre directo en el código, sin pedir el contacto ni llamar al servidor', async () => {
    const w = await mountPage()

    expect(w.find('h1').text()).toBe('Escribe tu código')
    expect(w.text()).toContain('Te enviamos un código de 6 dígitos a tu WhatsApp')
    expect(w.find('input[name="contact"]').exists()).toBe(false)
    expect(slotInputs(w)).toHaveLength(6)
    expect(document.activeElement).toBe(w.find('h1').element)
    expect(postMock).not.toHaveBeenCalled()
    expect(w.text()).not.toContain(REF)
  })

  it('verifica solo al completar los 6 dígitos, con la referencia y el slug', async () => {
    const w = await mountPage()
    await typeCode(w, '48291')
    expect(postMock).not.toHaveBeenCalled()

    reply(200, { accessToken: 'tok-1', purpose: 'reschedule' })
    await slotInputs(w)[5]!.setValue('3')
    await flushPromises()

    expect(postMock).toHaveBeenCalledWith(VERIFY_REF, {
      params: { path: { slug: 'mi-barberia' } },
      body: { accessRef: REF, code: '482913' },
    })
  })

  it('con el propósito «reschedule» lleva a «Cambiar la hora» con su credencial', async () => {
    reply(200, { accessToken: 'tok-1', purpose: 'reschedule' })
    const w = await mountPage()
    await typeCode(w, '482913')

    expect(router.currentRoute.value.name).toBe('mi-turno-reprogramar')
    expect(router.currentRoute.value.params.token).toBe('tok-1')
    expect(w.text()).not.toContain('tok-1')
  })

  it('con el propósito «cancel» abre la cancelación en la misma página', async () => {
    reply(200, { accessToken: 'tok-2', purpose: 'cancel' })
    const w = await mountPage()
    await typeCode(w, '482913')

    expect(router.currentRoute.value.name).toBe('mi-turno-acceso-ref')
    expect(w.find('h1').text()).toBe('Cancelar tu turno')
    expect(w.find('[aria-current="step"]').text()).toContain('Tu turno')
    const actions = w.find('[data-test="actions"]')
    expect(actions.attributes('data-token')).toBe('tok-2')
    expect(actions.attributes('data-action')).toBe('cancel')
    // El código ya no se muestra: quedó gastado.
    expect(slotInputs(w)).toHaveLength(0)
    expect(w.text()).not.toContain('tok-2')
  })

  it('el título sigue al panel: opciones y cancelado', async () => {
    reply(200, { accessToken: 'tok-2', purpose: 'cancel' })
    const w = await mountPage()
    await typeCode(w, '482913')
    const actions = w.findComponent({ name: 'AppointmentActions' })

    actions.vm.$emit('modeChange', 'menu')
    await flushPromises()
    expect(w.find('h1').text()).toBe('¿Qué quieres hacer?')

    actions.vm.$emit('cancelled')
    await flushPromises()
    expect(w.find('h1').text()).toBe('Turno cancelado')
  })

  it('un código incorrecto se limpia sin decir la causa y a los cinco se bloquea', async () => {
    const w = await mountPage()
    for (let attempt = 1; attempt <= 5; attempt++) {
      reply(401, undefined, problem(401, 'unauthorized'))
      await typeCode(w, '111111')
      if (attempt < 5) {
        expect(w.text()).toContain('Ese código no es válido o ya venció')
        expect(slotInputs(w).every((i) => (i.element as HTMLInputElement).value === '')).toBe(true)
      }
    }
    expect(w.text()).toContain('Ese código ya no sirve. Vuelve a WhatsApp y pide un enlace nuevo.')
    expect(slotInputs(w).every((i) => (i.element as HTMLInputElement).disabled)).toBe(true)
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(postMock).toHaveBeenCalledTimes(5)
  })

  it('un enlace sin barbería muestra su propio estado', async () => {
    reply(404, undefined, problem(404, 'not-found'))
    const w = await mountPage()
    await typeCode(w, '482913')

    expect(w.text()).toContain('No encontramos este enlace')
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })

  it('sin red avisa y deja volver a intentar', async () => {
    postMock.mockRejectedValueOnce(new TypeError('fallo de red'))
    const w = await mountPage()
    await typeCode(w, '482913')

    expect(w.text()).toContain('No pudimos conectar')
    expect(slotInputs(w).every((i) => !(i.element as HTMLInputElement).disabled)).toBe(true)
  })

  it('un error inesperado muestra el código de soporte', async () => {
    reply(500, undefined, problem(500, 'internal'))
    const w = await mountPage()
    await typeCode(w, '482913')

    expect(w.text()).toContain('Código de soporte: req-9')
  })

  it.each([
    ['código', async () => mountPage()],
    [
      'código incorrecto',
      async () => {
        reply(401, undefined, problem(401, 'unauthorized'))
        const w = await mountPage()
        await typeCode(w, '111111')
        return w
      },
    ],
    [
      'enlace sin barbería',
      async () => {
        reply(404, undefined, problem(404, 'not-found'))
        const w = await mountPage()
        await typeCode(w, '482913')
        return w
      },
    ],
  ])('el paso «%s» no tiene violaciones de axe', async (_name, build) => {
    const w = await build()
    expect((await axe(w.element)).violations).toEqual([])
  })
})
