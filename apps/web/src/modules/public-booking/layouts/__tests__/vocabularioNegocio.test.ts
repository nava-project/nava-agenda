/**
 * Vocabulario del negocio en la reserva pública (DEC-119): el cascarón lo lee del
 * perfil público del enlace y lo ofrece a las pantallas del recorrido, que dicen
 * «manicurista» y «estudio» en vez de «profesional» y «negocio». Con los valores
 * iniciales cada texto sale idéntico al anterior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import PublicBookingLayout from '../PublicBookingLayout.vue'
import { resetPublicProfileCache } from '../../model/publicProfile'
import { usePublicVocabulary } from '../../model/publicVocabulary'
import { defineComponent, h } from 'vue'

const resolveBusinessMock = vi.hoisted(() => vi.fn())
vi.mock('../../api/resolveBusinessApi', () => ({ resolveBusiness: resolveBusinessMock }))

const profile = (vocabulary: Record<string, string>) => ({
  kind: 'success' as const,
  profile: {
    name: 'Estudio Lila',
    timezone: 'America/Bogota',
    contactEmail: null,
    contactPhone: null,
    vocabulary,
  },
})

const nails = {
  businessTerm: 'estudio de uñas',
  businessTermGender: 'masculine',
  professionalTerm: 'manicurista',
  professionalTermPlural: 'manicuristas',
  professionalTermGender: 'feminine',
}

// Pantalla de prueba: dice lo que dirían las reales, a partir del vocabulario inyectado.
const Probe = defineComponent({
  setup() {
    const v = usePublicVocabulary()
    return () =>
      h('div', [
        h('p', { class: 'probe' }, `Elige tu ${v.value.professional} ${v.value.ofTheBusiness}`),
      ])
  },
})

async function mountAt(slug: string, subpath = 'servicios/s-1/profesional') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/reservar/:slug',
        component: PublicBookingLayout,
        children: [
          { path: '', name: 'reserva-publica-entrada', component: Probe },
          { path: 'servicios/:serviceId/profesional', name: 'probe', component: Probe },
        ],
      },
    ],
  })
  await router.push(`/reservar/${slug}/${subpath}`)
  const wrapper = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router], stubs: { BookingBackdrop: true } } },
  )
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  resolveBusinessMock.mockReset()
  resetPublicProfileCache()
})

describe('vocabulario de la reserva pública (DEC-119)', () => {
  it('dice la palabra configurada en el cascarón, el progreso y las pantallas de estado', async () => {
    resolveBusinessMock.mockResolvedValueOnce(profile(nails))
    const wrapper = await mountAt('estudiolila')

    expect(resolveBusinessMock).toHaveBeenCalledWith('estudiolila')
    expect(wrapper.get('.probe').text()).toBe('Elige tu manicurista del estudio de uñas')
    expect(wrapper.text()).not.toMatch(/professional(o|a|os|as|ía|ías)\b/i)
    expect(wrapper.text()).not.toMatch(/profesional(es)?\b|negocio/i)
  })

  it('conserva el vocabulario que un negocio guardó', async () => {
    resolveBusinessMock.mockResolvedValueOnce(
      profile({
        businessTerm: 'barbería',
        businessTermGender: 'feminine',
        professionalTerm: 'barbero',
        professionalTermPlural: 'barberos',
        professionalTermGender: 'masculine',
      }),
    )
    const wrapper = await mountAt('barberia')

    expect(wrapper.get('.probe').text()).toBe('Elige tu barbero de la barbería')
  })

  it('no monta las pantallas hasta saber el vocabulario, para no mostrar un instante la palabra equivocada', async () => {
    let release!: (value: unknown) => void
    resolveBusinessMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const wrapper = await mountAt('estudiolila')

    expect(wrapper.find('.probe').exists()).toBe(false)
    release(profile(nails))
    await flushPromises()
    expect(wrapper.find('.probe').exists()).toBe(true)
  })

  it('usa los valores iniciales si el enlace no resuelve y deja que cada pantalla muestre su error', async () => {
    resolveBusinessMock.mockResolvedValueOnce({ kind: 'not-found' })
    const wrapper = await mountAt('desconocido')

    expect(wrapper.get('.probe').text()).toBe('Elige tu profesional del negocio')
  })

  it('no hace esperar a la entrada: ella misma lee el perfil y comparte la petición', async () => {
    let release!: (value: unknown) => void
    resolveBusinessMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const wrapper = await mountAt('estudiolila', '')

    expect(wrapper.find('.probe').exists()).toBe(true)
    release(profile(nails))
    await flushPromises()
    expect(wrapper.get('.probe').text()).toBe('Elige tu manicurista del estudio de uñas')
  })
})
