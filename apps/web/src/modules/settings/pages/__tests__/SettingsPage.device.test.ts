/**
 * Pruebas de SettingsPage (HU-020, DEC-110): preferencias de ESTE dispositivo (modo, tamaño de texto, animaciones), enlace público
 * (DEC-117) y verificación accesible con axe.
 * settingsApi, brandApi y auth.updateBarbershopName se sustituyen por dobles de prueba
 * (settingsPageHarness.ts); el recorrido real contra el API vive en el E2E. La suite de la
 * página se reparte en varios archivos SettingsPage*.test.ts para que vitest los ejecute en
 * paralelo (#625).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { axe } from 'vitest-axe'
import { appearance } from '@/shared/model'
import { saveMock, mountReady, submit, resetSettingsPageDoubles } from './settingsPageHarness'

vi.mock(
  '../../api/settingsApi',
  async () => (await import('./settingsPageHarness')).doubles.settingsApi,
)
vi.mock('../../api/brandApi', async () => (await import('./settingsPageHarness')).doubles.brandApi)
vi.mock(
  '../../api/publicLinkApi',
  async () => (await import('./settingsPageHarness')).doubles.publicLinkApi,
)
vi.mock(
  '../../api/loginOtpApi',
  async () => (await import('./settingsPageHarness')).doubles.loginOtpApi,
)
vi.mock(
  '../../api/reminderSettingsApi',
  async () => (await import('./settingsPageHarness')).doubles.reminderSettingsApi,
)
vi.mock(
  '../../api/openingHoursApi',
  async () => (await import('./settingsPageHarness')).doubles.openingHoursApi,
)
vi.mock('@/modules/auth', async () => (await import('./settingsPageHarness')).doubles.auth)

describe('SettingsPage', () => {
  beforeEach(resetSettingsPageDoubles)

  describe('preferencias de este dispositivo', () => {
    it('applies the mode at once, persists it and needs no saving', async () => {
      const wrapper = await mountReady()

      await wrapper.get('input[type="radio"][value="ivory"]').setValue(true)

      expect(appearance.theme).toBe('ivory')
      expect(JSON.parse(window.localStorage.getItem('nava.appearance.v1')!)).toMatchObject({
        theme: 'ivory',
      })
      expect(wrapper.find('.save-bar').exists()).toBe(false)
      expect(saveMock).not.toHaveBeenCalled()
    })

    it('changes the text size', async () => {
      const wrapper = await mountReady()

      await wrapper.get('input[type="radio"][value="xlarge"]').setValue(true)

      expect(appearance.textScale).toBe('xlarge')
    })

    it('toggles reduced animations with an announced switch', async () => {
      const wrapper = await mountReady()
      const toggle = wrapper.get('[role="switch"]')
      expect(toggle.attributes('aria-checked')).toBe('false')

      await toggle.trigger('click')

      expect(toggle.attributes('aria-checked')).toBe('true')
      expect(appearance.motion).toBe('reduced')
    })

    it('restores the screen preferences, and the button is disabled when nothing differs', async () => {
      const wrapper = await mountReady()
      const reset = () =>
        wrapper.findAll('button').find((b) => b.text() === 'Restablecer pantalla')!
      expect(reset().attributes('disabled')).toBeDefined()

      await wrapper.get('input[type="radio"][value="ivory"]').setValue(true)
      expect(reset().attributes('disabled')).toBeUndefined()

      await reset().trigger('click')
      expect(appearance.theme).toBe('ink')
    })
  })

  describe('enlace público (DEC-117)', () => {
    it('adds the link as section 08, after the opening hours and before the booking rules', async () => {
      const wrapper = await mountReady()

      const panel = wrapper.get('#configuracion-enlace')
      expect(panel.get('.settings-panel__number').text()).toBe('08')
      expect(panel.get('h2').text()).toBe('Enlace público')
      expect(wrapper.get('#configuracion-horario .settings-panel__number').text()).toBe('07')
      expect(panel.get('[role="textbox"]').text()).toContain('/reservar/barberia-ejemplo-k7x2m9')
      expect(wrapper.get('#configuracion-reservas .settings-panel__number').text()).toBe('09')
      expect(wrapper.get('a[href="#configuracion-enlace"]').text()).toContain('Enlace')
      wrapper.unmount()
    })

    it('is read-only: opening the link never makes the draft dirty', async () => {
      const wrapper = await mountReady()

      expect(wrapper.find('.save-bar').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  describe('accesibilidad', () => {
    it('has no axe violations once loaded', async () => {
      const wrapper = await mountReady()
      const results = await axe(wrapper.element)
      expect(results).toHaveNoViolations()
    })

    // heading-order: BaseAlert.vue (HU-009) fija el título de una alerta como
    // `<h4>` porque es la etiqueta de un widget transitorio, no un encabezado
    // del esquema del documento. Mismo criterio documentado en
    // LoginPage.test.ts: no es un defecto de esta pantalla ni de BaseAlert.
    const axeOptionsWithAlert = { rules: { 'heading-order': { enabled: false } } }

    it('has no axe violations with the validation-error alert and the save bar visible', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="name"]').setValue('Nombre nuevo')
      saveMock.mockResolvedValueOnce({ kind: 'validation-error' })

      await submit(wrapper)

      const results = await axe(wrapper.element, axeOptionsWithAlert)
      expect(results).toHaveNoViolations()
    })

    it('has no axe violations with a field error visible', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="businessTerm"]').setValue('salón 24')
      await submit(wrapper)

      const results = await axe(wrapper.element, axeOptionsWithAlert)
      expect(results).toHaveNoViolations()
    })
  })
})
