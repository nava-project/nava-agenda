/**
 * Color de marca en la reserva pública (DEC-171): el cascarón pinta el acento que
 * la barbería del enlace eligió en Configuración, solo mientras la reserva está
 * abierta y solo el de esa barbería. Con latón (valor inicial) no escribe nada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { h } from 'vue'
import PublicBookingLayout from '../PublicBookingLayout.vue'
import { resetPublicProfileCache } from '../../model/publicProfile'
import { accentByKey } from '@/shared/model'

const resolveBarbershopMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/resolveBarbershopApi', () => ({ resolveBarbershop: resolveBarbershopMock }))

const profile = (brandAccent: string) => ({
  kind: 'success' as const,
  profile: {
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
    brandAccent,
  },
})

// Pantallas de prueba como objetos de render (sin contenido propio que probar).
const Probe = { render: () => h('main', 'pantalla') }
const Elsewhere = { render: () => h('main', 'fuera') }

async function mountAt(slug: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/reservar/:slug',
        component: PublicBookingLayout,
        children: [{ path: '', name: 'reserva-publica-entrada', component: Probe }],
      },
      { path: '/fuera', component: Elsewhere },
    ],
  })
  await router.push(`/reservar/${slug}`)
  const wrapper = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router], stubs: { BookingBackdrop: true } } },
  )
  await flushPromises()
  return { wrapper, router }
}

const root = () => document.documentElement.style
const accentOnPage = () => root().getPropertyValue('--color-brand-accent-surface')

beforeEach(() => {
  resolveBarbershopMock.mockReset()
  resetPublicProfileCache()
  document.documentElement.removeAttribute('style')
})

describe('color de marca de la reserva pública (DEC-171)', () => {
  it('pinta el acento Tinta de la barbería del enlace en acentos, foco y rótulos', async () => {
    resolveBarbershopMock.mockResolvedValueOnce(profile('emerald'))
    const { wrapper } = await mountAt('barberia-verde')

    const emerald = accentByKey('emerald')
    expect(accentOnPage()).toBe(emerald.ink)
    expect(root().getPropertyValue('--color-focus')).toBe(emerald.ink)
    expect(root().getPropertyValue('--color-accent-brass')).toBe(emerald.ink)
    expect(root().getPropertyValue('--color-brand-accent-text')).toBe('#101b2b')
    wrapper.unmount()
  })

  it('con latón no escribe nada: la reserva queda como siempre', async () => {
    resolveBarbershopMock.mockResolvedValueOnce(profile('brass'))
    const { wrapper } = await mountAt('barberia')

    expect(accentOnPage()).toBe('')
    expect(root().getPropertyValue('--color-accent-brass')).toBe('')
    wrapper.unmount()
  })

  it('cambia con el enlace: cada barbería ve su propio color', async () => {
    resolveBarbershopMock
      .mockResolvedValueOnce(profile('ruby'))
      .mockResolvedValueOnce(profile('sapphire'))
    const { wrapper, router } = await mountAt('barberia-roja')
    expect(accentOnPage()).toBe(accentByKey('ruby').ink)

    await router.push('/reservar/barberia-azul')
    await flushPromises()
    expect(accentOnPage()).toBe(accentByKey('sapphire').ink)
    wrapper.unmount()
  })

  it('lo retira al salir de la reserva', async () => {
    resolveBarbershopMock.mockResolvedValueOnce(profile('copper'))
    const { wrapper, router } = await mountAt('barberia-cobre')
    expect(accentOnPage()).toBe(accentByKey('copper').ink)

    await router.push('/fuera')
    await flushPromises()
    expect(accentOnPage()).toBe('')
    expect(root().getPropertyValue('--color-focus')).toBe('')
    wrapper.unmount()
  })

  it('sin perfil (enlace desconocido) se queda en latón', async () => {
    resolveBarbershopMock.mockResolvedValueOnce({ kind: 'not-found' })
    const { wrapper } = await mountAt('no-existe')
    expect(accentOnPage()).toBe('')
    wrapper.unmount()
  })
})
