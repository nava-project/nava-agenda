/**
 * Pruebas de PublicBookingLayout (DEC-111, v2 DEC-188): el cascarón aloja las
 * pantallas con las rutas reales del módulo, marca el paso vigente de los tres
 * (Servicio, Día y hora, Tus datos), ofrece el retorno al paso anterior con
 * sus parámetros, se completa cuando la página de datos confirma el turno y
 * firma al pie como «Reservas con NAVA», con enlace a su banda en nava.wtf.
 * Al cambiar de paso, la pantalla que sale se va en el mismo cuadro en que
 * entra la nueva y el foco pasa al título nuevo (#820).
 * Las pantallas se sustituyen por un doble: aquí no se prueba su contenido.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import { axe } from 'vitest-axe'
import PublicBookingLayout from '../PublicBookingLayout.vue'
import { useBookingChrome } from '../../model/bookingChrome'
import { resetPublicProfileCache } from '../../model/publicProfile'
import { publicBookingRoutes } from '../../routes'

// El cascarón lee el perfil del enlace: con negocio hay recorrido (pasos); sin
// él (enlace inexistente) no.
const getMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ httpClient: { GET: getMock, POST: vi.fn() } }))

const profile = {
  name: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  contactEmail: null,
  contactPhone: null,
  vocabulary: {
    businessTerm: 'barbería',
    businessTermGender: 'feminine',
    professionalTerm: 'barbero',
    professionalTermPlural: 'barberos',
    professionalTermGender: 'masculine',
  },
  location: null,
  offersHomeService: false,
  brandAccent: 'brass',
  openingHours: [],
  closedOnHolidays: false,
  today: null,
}

beforeEach(() => {
  resetPublicProfileCache()
  getMock.mockReset()
  getMock.mockResolvedValue({
    data: profile,
    error: undefined,
    response: { ok: true, status: 200, headers: new Headers() },
  })
})

// Doble de pantalla: un `<main>` que, si se le pide, confirma el turno por el
// canal del cascarón (lo que hace la página de datos tras el éxito del API).
const Screen = defineComponent({
  props: { confirm: { type: Boolean, default: false } },
  setup(props) {
    const chrome = useBookingChrome()
    if (props.confirm) chrome.completed.value = true
    return () => h('main', 'pantalla')
  },
})

function stubbedRoutes(): RouteRecordRaw[] {
  const booking = publicBookingRoutes.map((route) => ({
    ...route,
    component: PublicBookingLayout,
    children: route.children?.map((child) =>
      child.redirect
        ? child
        : {
            ...child,
            component: Screen,
            props: child.name === 'reserva-publica-cliente' ? { confirm: true } : false,
          },
    ) as RouteRecordRaw[],
  })) as RouteRecordRaw[]
  return booking
}

// Cada montaje queda adjunto al documento (axe y los landmarks lo exigen):
// se desmonta siempre, aunque una aserción falle, para no contaminar la
// siguiente prueba con un segundo `<main>` o un segundo banner.
const mounted: Array<{ unmount: () => void }> = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

async function mountAt(path: string, routes: RouteRecordRaw[] = stubbedRoutes()) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  await flushPromises()
  mounted.push(wrapper)
  return { wrapper, router }
}

const STEP_LABELS = ['Servicio', 'Día y hora', 'Tus datos']
const SERVICE = '8f3ac2b1-e4d5-46f6-a7c8-d9e0f1a2b3c4'
const PROFESSIONAL = 'a1111111-1111-1111-1111-111111111111'
// La ruta de «Tus datos» descarta franjas pasadas (#436): siempre una futura.
const FUTURE_START = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
const DETAILS = `/reservar/b/servicios/${SERVICE}/profesional/${PROFESSIONAL}/horario/${FUTURE_START}/cliente`

describe('PublicBookingLayout', () => {
  it('shows no steps when the link leads to no business', async () => {
    getMock.mockResolvedValue({
      data: undefined,
      error: { status: 404, code: 'not-found', title: 'x' },
      response: { ok: false, status: 404, headers: new Headers() },
    })
    const { wrapper } = await mountAt('/reservar/no-existe')
    expect(wrapper.find('.bk-steps').exists()).toBe(false)
  })

  it('keeps the business in view on the inner steps', async () => {
    const { wrapper } = await mountAt(`/reservar/b/servicios/${SERVICE}/horario`)
    expect(wrapper.get('.bk-top__name').text()).toBe('Barbería Ejemplo')
  })

  it('names the NAVA signature with real spaces for screen readers', async () => {
    const { wrapper } = await mountAt('/reservar/barberia-ejemplo')
    expect(wrapper.get('.bk-foot__firm').attributes('aria-label')).toBe(
      'Reservas con Nava Agenda, en nava.wtf',
    )
  })

  it('on the entry marks «Servicio» as the current step, with no back link', async () => {
    const { wrapper } = await mountAt('/reservar/barberia-ejemplo')
    expect(wrapper.find('.bk-back').exists()).toBe(false)
    const current = wrapper.findAll('li[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0]!.text()).toBe('Servicio')
    wrapper.unmount()
  })

  it('marks the route step as current and the previous ones as completed', async () => {
    const cases: Array<[string, number]> = [[`/reservar/b/servicios/${SERVICE}/horario`, 2]]
    for (const [path, step] of cases) {
      const { wrapper } = await mountAt(path)
      const items = wrapper.findAll('ol[aria-label="Pasos de la reserva"] li')
      expect(items.map((item) => item.find('.bk-steps__label').text())).toEqual(STEP_LABELS)
      expect(items[step - 1]!.attributes('aria-current')).toBe('step')
      for (const done of items.slice(0, step - 1)) expect(done.text()).toContain('(completado)')
      wrapper.unmount()
    }
  })

  it('links back from «Día y hora» to the services of the entry', async () => {
    const dayTime = await mountAt(`/reservar/b/servicios/${SERVICE}/horario`)
    const toEntry = dayTime.wrapper.get('a.bk-back')
    expect(toEntry.text()).toContain('Servicios')
    expect(toEntry.attributes('href')).toBe('/reservar/b')
    dayTime.wrapper.unmount()
  })

  it('returns from «Tus datos» to the chosen professional, or to «Cualquiera»', async () => {
    const routes = stubbedRoutes().map((route) => ({
      ...route,
      children: (route.children ?? []).map((child) =>
        child.redirect ? child : { ...child, props: false },
      ),
    })) as RouteRecordRaw[]
    const chosen = await mountAt(DETAILS, routes)
    expect(chosen.wrapper.get('a.bk-back').attributes('href')).toBe(
      `/reservar/b/servicios/${SERVICE}/horario?profesional=${PROFESSIONAL}`,
    )
    chosen.wrapper.unmount()

    const any = await mountAt(`${DETAILS}?cualquiera=1`, routes)
    expect(any.wrapper.get('a.bk-back').attributes('href')).toBe(
      `/reservar/b/servicios/${SERVICE}/horario`,
    )
    any.wrapper.unmount()
  })

  it('completes every step and drops the back link once the booking is confirmed', async () => {
    const { wrapper } = await mountAt(DETAILS)
    expect(wrapper.find('.bk-back').exists()).toBe(false)
    const items = wrapper.findAll('ol[aria-label="Pasos de la reserva"] li')
    expect(items).toHaveLength(3)
    expect(items.every((item) => item.text().includes('(completado)'))).toBe(true)
    expect(wrapper.find('li[aria-current="step"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('links the NAVA signature to its band on nava.wtf', async () => {
    const { wrapper } = await mountAt('/reservar/barberia-ejemplo')
    expect(wrapper.get('footer a.bk-foot__firm').attributes('href')).toBe(
      'https://nava.wtf/#agenda',
    )
    wrapper.unmount()
  })

  it('signs the page as «Reservas con NAVA», never putting NAVA in the hero position', async () => {
    const { wrapper } = await mountAt('/reservar/barberia-ejemplo')
    expect(wrapper.find('footer').text()).toContain('Reservas con')
    expect(wrapper.find('footer').text()).toContain('NAVA')
    wrapper.unmount()
  })

  it('enlaza la política de privacidad y las condiciones bajo la firma (issue #545)', async () => {
    const { wrapper } = await mountAt('/reservar/barberia-ejemplo')
    const legal = wrapper.get('footer nav[aria-label="Documentos legales"]')
    expect(legal.get('a[href="https://nava.wtf/privacidad"]').text()).toBe('Privacidad')
    expect(legal.get('a[href="https://nava.wtf/terminos"]').text()).toBe('Condiciones')
    expect(wrapper.get('footer').text()).toContain('Reservas con')
    wrapper.unmount()
  })

  it('keeps one banner, one <main> and no accessibility violations', async () => {
    const { wrapper } = await mountAt(`/reservar/b/servicios/${SERVICE}/horario`)
    expect(wrapper.findAll('header')).toHaveLength(1)
    expect(wrapper.findAll('main')).toHaveLength(1)
    expect(await axe(wrapper.element)).toHaveNoViolations()
    wrapper.unmount()
  })
})

// #820 (F3): el cambio de paso no deja la reserva en blanco y el foco no cae
// en <body>. Pantallas con título; «Día y hora» carga hasta que se le diga.
const dayReady = ref(false)
const EntryScreen = defineComponent({
  setup: () => () => h('main', [h('h1', 'Servicios'), h('a', { href: '#x' }, 'Corte')]),
})
const DayScreen = defineComponent({
  setup: () => () =>
    dayReady.value
      ? h('main', [h('h1', 'Elige día y hora')])
      : h('main', { 'aria-busy': 'true' }, [h('h1', 'Cargando las horas libres…')]),
})

function stepRoutes(): RouteRecordRaw[] {
  return publicBookingRoutes.map((route) => ({
    ...route,
    component: PublicBookingLayout,
    children: route.children?.map((child) =>
      child.redirect
        ? child
        : {
            ...child,
            component: child.name === 'reserva-publica-horario' ? DayScreen : EntryScreen,
            props: false,
          },
    ) as RouteRecordRaw[],
  })) as RouteRecordRaw[]
}

async function mountSteps() {
  const router = createRouter({ history: createMemoryHistory(), routes: stepRoutes() })
  await router.push('/reservar/b')
  await router.isReady()
  const wrapper = mount(
    { template: '<RouterView />' },
    // La transición real: lo que se prueba es cómo sale la pantalla.
    { global: { plugins: [router], stubs: { transition: false } }, attachTo: document.body },
  )
  await flushPromises()
  mounted.push(wrapper)
  return { wrapper, router }
}

describe('PublicBookingLayout · cambio de paso (#820)', () => {
  beforeEach(() => {
    dayReady.value = false
  })

  it('removes the leaving step as the next one mounts: never a blank page or two <main>', async () => {
    const { wrapper, router } = await mountSteps()
    expect(wrapper.get('main h1').text()).toBe('Servicios')
    await router.push(`/reservar/b/servicios/${SERVICE}/horario`)
    await flushPromises()
    const mains = wrapper.findAll('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]!.text()).toBe('Cargando las horas libres…')
    wrapper.unmount()
  })

  it('moves the focus to the new step title once it has its content, not while it loads', async () => {
    const { wrapper, router } = await mountSteps()
    const link = wrapper.get('main a').element as HTMLElement
    link.focus()
    await wrapper.trigger('keydown', { key: 'Enter' })
    await router.push(`/reservar/b/servicios/${SERVICE}/horario`)
    await flushPromises()
    // El enlace se fue con su pantalla; mientras carga, el foco no salta.
    expect(document.activeElement).toBe(document.body)

    dayReady.value = true
    await flushPromises()
    const title = wrapper.get('main h1').element as HTMLElement
    expect(title.textContent).toBe('Elige día y hora')
    expect(document.activeElement).toBe(title)
    expect(title.getAttribute('tabindex')).toBe('-1')
    wrapper.unmount()
  })

  it('leaves the focus alone without a key or a tap (an automatic jump on opening the link)', async () => {
    const { wrapper, router } = await mountSteps()
    dayReady.value = true
    await router.replace(`/reservar/b/servicios/${SERVICE}/horario`)
    await flushPromises()
    expect(document.activeElement).toBe(document.body)
    wrapper.unmount()
  })

  it('never takes the focus from where the person already put it', async () => {
    const { wrapper, router } = await mountSteps()
    await wrapper.trigger('pointerdown')
    await router.push(`/reservar/b/servicios/${SERVICE}/horario`)
    await flushPromises()
    const back = wrapper.get('.bk-back').element as HTMLElement
    back.focus()
    dayReady.value = true
    await flushPromises()
    expect(document.activeElement).toBe(back)
    wrapper.unmount()
  })

  it('enters the next step already opaque, only sliding, and gives the leaving one no transition', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/publicBooking.css'), 'utf8')
    const rules = css.slice(
      css.indexOf('.pb-step-forward-enter-active'),
      css.indexOf('/* El título que recibe'),
    )
    expect(rules).not.toMatch(/opacity/)
    expect(rules).not.toMatch(/leave/)
    expect(rules).toMatch(/transition: transform 360ms/)
    const source = readFileSync(resolve(__dirname, '../PublicBookingLayout.vue'), 'utf8')
    expect(source).toMatch(/<Transition :name="`pb-step-\$\{direction\}`" @leave="leaveAtOnce">/)
  })

  it('keeps the loader delay with reduced motion: the booking-wide reset spares it', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/bookingV2.css'), 'utf8')
    expect(css).toMatch(
      /\.bk \*:not\(\.diamond-loader\),\s*\.bk-skel \{\s*transition: none !important;\s*animation: none !important;/,
    )
  })
})
