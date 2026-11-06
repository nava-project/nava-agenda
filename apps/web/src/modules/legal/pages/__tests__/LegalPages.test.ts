/**
 * Documentos legales públicos (issue #545): política de privacidad y
 * condiciones del servicio. Son las URL que se registran en la pantalla de
 * consentimiento de OAuth de Google, así que la prueba protege lo que Google
 * revisa —datos de Google declarados, uso limitado, revocación, contacto— y lo
 * que una persona necesita: un solo h1, secciones ancladas, índice coherente,
 * título de pestaña propio y ausencia de violaciones axe.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { axe } from 'vitest-axe'
import PrivacyPolicyPage from '../PrivacyPolicyPage.vue'
import TermsPage from '../TermsPage.vue'
import { legalRoutes } from '../../routes'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_UPDATED,
  privacyPolicy,
  termsOfService,
} from '../../model/legalContent'

const axeOptions = {
  rules: {
    // Sin Canvas2D en jsdom; los pares de color se miden aparte.
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
}

const mounted: VueWrapper[] = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.title = ''
})

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'inicio', component: { template: '<div>inicio</div>' } },
      { path: '/privacidad', name: 'privacidad', component: PrivacyPolicyPage },
      { path: '/terminos', name: 'terminos', component: TermsPage },
    ],
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount(
    { template: '<RouterView />' },
    { global: { plugins: [router] }, attachTo: document.body },
  )
  mounted.push(wrapper as unknown as VueWrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('rutas públicas', () => {
  it('declara /privacidad y /terminos sin guard de sesión', () => {
    const paths = legalRoutes.map((route) => route.path)
    expect(paths).toEqual(['/privacidad', '/terminos'])
    expect(legalRoutes.map((route) => route.name)).toEqual(['privacidad', 'terminos'])
    for (const route of legalRoutes) expect(route.meta?.requiresSession).toBeUndefined()
  })
})

describe.each([
  ['privacidad', '/privacidad', privacyPolicy],
  ['condiciones', '/terminos', termsOfService],
])('documento de %s', (_name, path, doc) => {
  it('tiene un único h1 con el título y la fecha de vigencia', async () => {
    const { wrapper } = await mountAt(path)
    const h1 = wrapper.findAll('h1')
    expect(h1).toHaveLength(1)
    expect(h1[0]!.text()).toBe(doc.title)
    expect(wrapper.find('time').attributes('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(wrapper.text()).toContain(LEGAL_UPDATED)
  })

  it('ancla cada sección con un id único y un índice que lleva a ella', async () => {
    const { wrapper } = await mountAt(path)
    const ids = doc.sections.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const section of doc.sections) {
      const target = wrapper.find(`#${section.id}`)
      expect(target.exists()).toBe(true)
      expect(target.find('h2').text()).toBe(section.title)
      expect(
        wrapper.find(`nav[aria-label="En esta página"] a[href="#${section.id}"]`).exists(),
      ).toBe(true)
    }
  })

  it('muestra el canal de contacto y enlaza el otro documento legal', async () => {
    const { wrapper } = await mountAt(path)
    expect(wrapper.find(`a[href="mailto:${LEGAL_CONTACT_EMAIL}"]`).exists()).toBe(true)
    const legalNav = wrapper.find('nav[aria-label="Documentos legales"]')
    expect(legalNav.find('a[href="/privacidad"]').exists()).toBe(true)
    expect(legalNav.find('a[href="/terminos"]').exists()).toBe(true)
  })

  it('pone el nombre del documento en el título de la pestaña y lo restaura al salir', async () => {
    document.title = 'NAVA · Agenda de citas'
    const { wrapper } = await mountAt(path)
    expect(document.title).toBe(`${doc.title} · NAVA`)
    wrapper.unmount()
    mounted.pop()
    expect(document.title).toBe('NAVA · Agenda de citas')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { wrapper } = await mountAt(path)
    expect(await axe(wrapper.element as HTMLElement, axeOptions)).toHaveNoViolations()
  })
})

describe('política de privacidad: requisitos de la verificación de Google', () => {
  const text = privacyPolicy.sections
    .flatMap((section) => section.blocks)
    .map((block) => (block.kind === 'p' ? block.text : block.items.join(' ')))
    .join('\n')

  it('declara los alcances que la app solicita', () => {
    expect(text).toContain('calendar.events')
    expect(text).toContain('openid')
  })

  it('incluye la declaración de uso limitado en español y en inglés', () => {
    expect(text).toContain('requisitos de uso limitado')
    expect(text).toContain(
      'Google API Services User Data Policy, including the Limited Use requirements',
    )
  })

  it('explica cómo revocar el acceso y qué no se hace con los datos', () => {
    expect(text).toContain('https://myaccount.google.com/permissions')
    expect(text).toMatch(/no vendemos ni cedemos datos de Google/i)
    expect(text).toMatch(/no los usamos para entrenar modelos/i)
  })

  it('cubre conservación, derechos y la autoridad de control', () => {
    const ids = privacyPolicy.sections.map((section) => section.id)
    expect(ids).toEqual(
      expect.arrayContaining(['conservacion', 'derechos', 'google', 'proveedores']),
    )
    expect(text).toContain('Superintendencia de Industria y Comercio')
    expect(text).toContain('24 meses')
  })

  it('no contiene teléfonos ni correos personales de terceros', () => {
    const emails = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []
    expect(new Set(emails)).toEqual(new Set([LEGAL_CONTACT_EMAIL]))
    expect(text).not.toMatch(/\+57\s?\d/)
  })
})
