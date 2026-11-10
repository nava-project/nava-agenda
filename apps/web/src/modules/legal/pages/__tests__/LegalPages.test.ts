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
      expect(target.find('h2').text()).toContain(section.title)
      expect(target.find('h2 .ld__num').attributes('aria-hidden')).toBe('true')
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

  it('cierra con el pie de la landing y marca el documento abierto (issue #551)', async () => {
    const { wrapper } = await mountAt(path)
    const footer = wrapper.get('footer.sf')
    // Recorrido hacia la landing, contacto, cuenta y legal.
    const hrefs = footer.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/#contacto')
    expect(hrefs).toContain('/#para-quien')
    expect(hrefs).toContain('/acceso')
    expect(hrefs.some((h) => h?.startsWith('tel:+'))).toBe(true)
    const legal = footer.get('nav[aria-label="Documentos legales"]')
    expect(legal.get('a[href="/privacidad"]').text()).toBe('Privacidad')
    expect(legal.get('a[href="/terminos"]').text()).toBe('Condiciones')
    const current = legal.findAll('a[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]!.attributes('href')).toBe(path)
    // «Volver arriba» sube al inicio del documento, que existe en la página.
    expect(footer.get('a.sf__top').attributes('href')).toBe('#inicio')
    expect(wrapper.find('#inicio').exists()).toBe(true)
  })

  it('sugiere leer el otro documento al final', async () => {
    const { wrapper } = await mountAt(path)
    const next = wrapper.get('a.ld__next')
    expect(next.attributes('href')).toBe(path === '/privacidad' ? '/terminos' : '/privacidad')
  })

  it('marca la sección en lectura en el índice con aria-current', async () => {
    const { wrapper } = await mountAt(path)
    const current = wrapper.findAll('nav[aria-label="En esta página"] a[aria-current="location"]')
    expect(current).toHaveLength(1)
    expect(current[0]!.attributes('href')).toBe(`#${doc.sections[0]!.id}`)
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
    .map((block) => (block.kind === 'ul' ? block.items.join(' ') : block.text))
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

  it('destaca la declaración de uso limitado y marca la frase en inglés con lang', async () => {
    const { wrapper } = await mountAt('/privacidad')
    const notes = wrapper.findAll('p.ld__note')
    expect(notes).toHaveLength(2)
    expect(notes[0]!.attributes('lang')).toBeUndefined()
    expect(notes[1]!.attributes('lang')).toBe('en')
    expect(notes[1]!.text()).toContain('Limited Use requirements')
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

describe('política de privacidad: requisitos de la revisión de Meta para Nexos', () => {
  const sectionText = (id: string) =>
    privacyPolicy.sections
      .find((section) => section.id === id)!
      .blocks.map((block) => (block.kind === 'ul' ? block.items.join(' ') : block.text))
      .join('\n')
  const nexos = sectionText('nexos')

  it('describe qué es Nexos y que solo responde a quien escribe primero', () => {
    expect(nexos).toContain('Nexos')
    expect(nexos).toContain('WhatsApp Business Platform')
    expect(nexos).toMatch(/solo responde cuando la persona escribe primero/i)
  })

  it('declara qué datos guarda, el aviso previo y el enmascarado', () => {
    expect(nexos).toMatch(/primer mensaje recibe un aviso de privacidad y no se guarda/i)
    expect(nexos).toMatch(/correos, enlaces, teléfonos/i)
    expect(nexos).toMatch(/solicitud de cita/i)
  })

  it('declara el modelo de IA, que no entrena y que no vende datos de Meta', () => {
    expect(nexos).toContain('DeepInfra')
    expect(nexos).toMatch(/no usamos las conversaciones para entrenar modelos/i)
    expect(nexos).toMatch(/no los vendemos/i)
    expect(nexos).toContain('Términos de la Plataforma de Meta')
  })

  it('nombra a los proveedores y la transferencia internacional', () => {
    const providers = sectionText('proveedores')
    for (const name of ['Meta', 'DeepInfra', 'Cloudflare', 'OVHcloud']) {
      expect(providers).toContain(name)
    }
    expect(providers).toMatch(/Transferencia internacional/)
  })

  it('permite eliminar los datos por el chat y por correo, con ancla estable', async () => {
    const deletion = sectionText('eliminar-datos')
    expect(deletion).toContain('borra mis datos')
    expect(deletion).toContain(LEGAL_CONTACT_EMAIL)
    expect(deletion).toMatch(/15 días hábiles/)
    const { wrapper } = await mountAt('/privacidad')
    expect(wrapper.find('#eliminar-datos h2').exists()).toBe(true)
  })

  it('fija la retención de las conversaciones de Nexos', () => {
    expect(sectionText('conservacion')).toMatch(/hasta 12 meses/)
  })
})

describe('condiciones: Nexos', () => {
  const text = termsOfService.sections
    .flatMap((section) => section.blocks)
    .map((block) => (block.kind === 'ul' ? block.items.join(' ') : block.text))
    .join('\n')

  it('describe el asistente automático, sus límites y las políticas de WhatsApp', () => {
    expect(termsOfService.sections.map((section) => section.id)).toContain('nexos')
    expect(text).toMatch(/asistente automático, no una persona/i)
    expect(text).toMatch(/No diagnostica ni receta/)
    expect(text).toMatch(/solo la solicita; el negocio decide/i)
    expect(text).toContain('Política de mensajería de WhatsApp Business')
  })
})
