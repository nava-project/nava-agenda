/**
 * Landing pública de NAVA (issue #515, DEC-151): presentación, asistente de
 * IA, contacto e inicio de sesión. Es estática, así que la prueba monta la
 * página con un router mínimo y comprueba lo que la persona puede usar:
 * un solo h1, las anclas, los enlaces nativos de contacto (que salen del
 * archivo de contenido, no de literales repetidos aquí), el acceso a
 * `/acceso`, «Copiar» con su aviso y la ausencia de violaciones axe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { axe } from 'vitest-axe'
import LandingPage from '../LandingPage.vue'
import { landingCapabilities, landingContacts } from '../../model/landingContent'

const axeOptions = {
  rules: {
    // Sin Canvas2D en jsdom, y la página completa no vive en un fragmento.
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'inicio', component: LandingPage },
      { path: '/acceso', name: 'acceso', component: { template: '<div>acceso</div>' } },
      {
        path: '/recuperar-acceso',
        name: 'recuperar-acceso',
        component: { template: '<div>recuperar</div>' },
      },
    ],
  })
}

async function mountPage() {
  const router = buildRouter()
  router.push('/')
  await router.isReady()
  const wrapper = mount(LandingPage, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('tiene un solo h1 y una sección con nombre para cada parte de la presentación', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(wrapper.get('h1').text()).toContain('La agenda de tu barbería')
    for (const id of ['inicio', 'asistente', 'plataforma', 'contacto']) {
      const section = wrapper.get(`#${id}`)
      expect(section.attributes('aria-labelledby')).toBeTruthy()
    }
    expect(wrapper.findAll('main')).toHaveLength(1)
  })

  it('presenta las funciones del producto sin inventar ninguna', async () => {
    const { wrapper } = await mountPage()
    const items = wrapper.findAll('#plataforma ol li')
    expect(items).toHaveLength(landingCapabilities.length)
    for (const capability of landingCapabilities) {
      expect(wrapper.get('#plataforma').text()).toContain(capability.title)
    }
  })

  it('el asistente de IA se presenta sin nombre propio y con su conversación completa', async () => {
    const { wrapper } = await mountPage()
    const section = wrapper.get('#asistente')
    expect(section.text()).toContain('Asistente de IA')
    expect(wrapper.text()).not.toMatch(/odin/i)
    // El diálogo de demostración también existe como lista de texto, completa
    // y en orden, para quien no ve la animación.
    const transcript = section.findAll('ol.ln-sr li')
    expect(transcript.length).toBeGreaterThanOrEqual(4)
    expect(transcript[0].text()).toMatch(/^Cliente:/)
    expect(transcript[1].text()).toMatch(/^Asistente:/)
  })

  it('«Iniciar sesión» lleva al acceso desde la cabecera y desde el contacto', async () => {
    const { wrapper } = await mountPage()
    const links = wrapper.findAll('a').filter((a) => a.text().includes('Iniciar sesión'))
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) expect(link.attributes('href')).toBe('/acceso')
    expect(wrapper.findAll('a').some((a) => a.attributes('href') === '/recuperar-acceso')).toBe(
      true,
    )
  })

  it('cada canal de contacto abre su acción nativa con los datos del archivo de contenido', async () => {
    const { wrapper } = await mountPage()
    const section = wrapper.get('#contacto')
    for (const contact of landingContacts) {
      expect(section.text()).toContain(contact.display)
      for (const action of contact.actions) {
        const link = section.findAll('a').find((a) => a.attributes('href') === action.href)
        expect(link, action.label).toBeTruthy()
        if (action.external) {
          expect(link?.attributes('target')).toBe('_blank')
          expect(link?.attributes('rel')).toContain('noopener')
        }
      }
    }
    const hrefs = section.findAll('a').map((a) => a.attributes('href') ?? '')
    expect(hrefs.some((h) => h.startsWith('tel:+'))).toBe(true)
    expect(hrefs.some((h) => h.startsWith('mailto:'))).toBe(true)
    expect(hrefs.some((h) => h.startsWith('https://wa.me/'))).toBe(true)
  })

  it('«Copiar» deja el dato en el portapapeles y lo anuncia en una región viva', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const { wrapper } = await mountPage()

    const first = landingContacts[0]
    const copyButtons = wrapper.findAll('button.ct__copy')
    expect(copyButtons[0].attributes('aria-label')).toBe(`Copiar ${first.display}`)
    await copyButtons[0].trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(first.copyValue)
    expect(wrapper.get('[role="status"]').text()).toContain('copiado')
  })

  it('si el portapapeles no está disponible no muestra un aviso falso', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denegado'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const { wrapper } = await mountPage()

    await wrapper.findAll('button.ct__copy')[0].trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toBe('')
  })

  it('con movimiento reducido la conversación de demostración aparece completa', async () => {
    const { wrapper } = await mountPage()
    // Una burbuja por cada línea de la conversación y ningún indicador de escritura.
    expect(wrapper.findAll('.ph__msg:not(.ph__typing)').length).toBeGreaterThanOrEqual(4)
    expect(wrapper.find('.ph__typing').exists()).toBe(false)
  })

  it('no tiene violaciones de accesibilidad automatizables', async () => {
    const { wrapper } = await mountPage()
    expect(await axe(wrapper.element as HTMLElement, axeOptions)).toHaveNoViolations()
  })
})
