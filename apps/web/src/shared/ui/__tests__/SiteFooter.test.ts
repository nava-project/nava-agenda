/**
 * Pie del sitio público (DEC-151, issue #551): lo comparten la landing y los
 * documentos legales, así que sus enlaces deben servir desde cualquier ruta.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { axe } from 'vitest-axe'
import SiteFooter from '../SiteFooter.vue'
import { SITE_CALL_HREF, SITE_EMAIL, SITE_PHONE_DISPLAY } from '../../model/siteContact'

const axeOptions = { rules: { region: { enabled: false }, 'color-contrast': { enabled: false } } }

const mounted: VueWrapper[] = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

async function mountFooter(path = '/privacidad', props: { topHref?: string } = {}) {
  const stub = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/acceso', '/recuperar-acceso', '/privacidad', '/terminos'].map((p) => ({
      path: p,
      component: stub,
    })),
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(SiteFooter, { props, global: { plugins: [router] } })
  mounted.push(wrapper as unknown as VueWrapper)
  return wrapper
}

describe('SiteFooter', () => {
  it('enlaza el recorrido y la invitación a la landing por ruta', async () => {
    const wrapper = await mountFooter()
    const tour = wrapper.get('nav[aria-label="Recorrido"]').findAll('a')
    expect(tour.map((a) => a.attributes('href'))).toEqual([
      '/#para-quien',
      '/#asistente',
      '/#dia',
      '/#marca',
      '/#plataforma',
    ])
    expect(wrapper.get('a.sf__cta').attributes('href')).toBe('/#contacto')
  })

  it('muestra el contacto del archivo compartido y los enlaces de cuenta', async () => {
    const wrapper = await mountFooter()
    expect(wrapper.text()).toContain(SITE_PHONE_DISPLAY)
    expect(wrapper.text()).toContain(SITE_EMAIL)
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain(SITE_CALL_HREF)
    expect(hrefs.some((h) => h?.startsWith(`mailto:${SITE_EMAIL}`))).toBe(true)
    expect(hrefs).toContain('/acceso')
    expect(hrefs).toContain('/recuperar-acceso')
  })

  it('agrupa Privacidad y Condiciones en la columna Legal y marca la abierta', async () => {
    const wrapper = await mountFooter('/terminos')
    const legal = wrapper.get('nav[aria-label="Documentos legales"]')
    expect(legal.get('h2').text()).toBe('Legal')
    expect(legal.findAll('a').map((a) => a.text())).toEqual(['Privacidad', 'Condiciones'])
    expect(legal.get('a[aria-current="page"]').attributes('href')).toBe('/terminos')
  })

  it('los enlaces de recorrido no se marcan como página actual aunque estén en la landing', async () => {
    const wrapper = await mountFooter('/')
    expect(wrapper.find('nav[aria-label="Recorrido"] a[aria-current]').exists()).toBe(false)
    expect(wrapper.find('a.sf__cta[aria-current]').exists()).toBe(false)
  })

  it('no marca ningún documento fuera de las páginas legales', async () => {
    const wrapper = await mountFooter('/')
    expect(wrapper.find('nav[aria-label="Documentos legales"] a[aria-current]').exists()).toBe(
      false,
    )
  })

  it('«Volver arriba» apunta al ancla indicada por la página', async () => {
    expect((await mountFooter()).get('a.sf__top').attributes('href')).toBe('#inicio')
    const custom = await mountFooter('/', { topHref: '#arriba' })
    expect(custom.get('a.sf__top').attributes('href')).toBe('#arriba')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const wrapper = await mountFooter()
    expect(await axe(wrapper.element as HTMLElement, axeOptions)).toHaveNoViolations()
  })
})
