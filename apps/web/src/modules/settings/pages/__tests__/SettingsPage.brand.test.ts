/**
 * Pruebas de SettingsPage (HU-020, DEC-110): vista previa y descarte del acento, el panel que deciden los roles (DEC-134) y presets
 * y concordancia del vocabulario.
 * settingsApi, brandApi y auth.updateBarbershopName se sustituyen por dobles de prueba
 * (settingsPageHarness.ts); el recorrido real contra el API vive en el E2E. La suite de la
 * página se reparte en varios archivos SettingsPage*.test.ts para que vitest los ejecute en
 * paralelo (#625).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  brandState,
  DEFAULT_BRAND,
  effectiveAccent,
  setAccentPreview,
  setBrand,
} from '@/shared/model'
import { DEFAULT_LOCATION } from '../../model/brandOutcome'
import {
  saveBrandMock,
  mountReady,
  input,
  submit,
  resetSettingsPageDoubles,
} from './settingsPageHarness'

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

  describe('acento de la marca', () => {
    it('previews the chosen accent on the whole app before saving and drops it on discard', async () => {
      const wrapper = await mountReady()
      expect(effectiveAccent.value).toBe('brass')

      await wrapper.get('input[type="radio"][value="emerald"]').setValue(true)

      expect(effectiveAccent.value).toBe('emerald')
      // Todavía no se confirmó: la marca guardada no cambió.
      expect(brandState.brand.accent).toBe('brass')
      expect(wrapper.get('.save-bar').text()).toContain('Marca y vocabulario')

      const discard = wrapper.findAll('.save-bar button').find((b) => b.text() === 'Descartar')!
      await discard.trigger('click')
      expect(effectiveAccent.value).toBe('brass')
    })

    it('stops previewing the accent when the screen is left without saving', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[type="radio"][value="ruby"]').setValue(true)
      expect(effectiveAccent.value).toBe('ruby')

      wrapper.unmount()

      expect(effectiveAccent.value).toBe('brass')
      setAccentPreview(null)
    })

    it('saves the accent and keeps it as the confirmed one', async () => {
      const wrapper = await mountReady()
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: DEFAULT_LOCATION,
      }))

      await wrapper.get('input[type="radio"][value="sapphire"]').setValue(true)
      await submit(wrapper)

      expect(saveBrandMock.mock.calls[0]![0]).toMatchObject({ accent: 'sapphire' })
      expect(brandState.brand.accent).toBe('sapphire')
      expect(effectiveAccent.value).toBe('sapphire')
    })
  })

  describe('el panel lo deciden los roles (DEC-134)', () => {
    it('no longer offers a «Perfil del panel» section', async () => {
      const wrapper = await mountReady()

      expect(wrapper.find('[role="radiogroup"][aria-label="Perfil del panel"]').exists()).toBe(
        false,
      )
      expect(wrapper.find('#configuracion-perfil').exists()).toBe(false)
      expect(wrapper.find('a[href="#configuracion-perfil"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Cómo trabajas')
    })

    it('numbers the remaining sections without a gap', async () => {
      const wrapper = await mountReady()

      const numbers = wrapper.findAll('.settings-panel__number').map((n) => n.text())
      expect(numbers).toEqual([
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
      ])
    })

    it('keeps the panel of the user when the brand is saved, and never sends it', async () => {
      const wrapper = await mountReady({ ...DEFAULT_BRAND, panelProfile: 'employee' })
      saveBrandMock.mockImplementation(async (brand) => ({
        kind: 'success',
        brand,
        location: DEFAULT_LOCATION,
      }))

      await wrapper.get('input[type="radio"][value="sapphire"]').setValue(true)
      await submit(wrapper)

      expect(saveBrandMock).toHaveBeenCalledTimes(1)
      expect(brandState.brand.panelProfile).toBe('employee')
    })
  })

  describe('vocabulario', () => {
    it('fills the word, its plural and its gender from a preset', async () => {
      const wrapper = await mountReady()

      const preset = wrapper.findAll('.preset-chip').find((b) => b.text() === 'estilista')!
      await preset.trigger('click')

      expect(input(wrapper, 'professionalTerm').value).toBe('estilista')
      expect(input(wrapper, 'professionalTermPlural').value).toBe('estilistas')
      expect(
        (
          wrapper.get('input[name^="option-group"][value="feminine"]:checked')
            .element as HTMLInputElement
        ).value,
      ).toBe('feminine')
    })

    it('suggests the plural while the singular is typed, until it is edited by hand', async () => {
      const wrapper = await mountReady()

      await wrapper.get('input[name="professionalTerm"]').setValue('colorista')
      expect(input(wrapper, 'professionalTermPlural').value).toBe('coloristas')

      await wrapper.get('input[name="professionalTermPlural"]').setValue('coloristas expertas')
      await wrapper.get('input[name="professionalTerm"]').setValue('maestro')
      expect(input(wrapper, 'professionalTermPlural').value).toBe('coloristas expertas')
    })

    it('previews the sentences with the draft vocabulary and its grammatical agreement', async () => {
      const wrapper = await mountReady()

      const preset = wrapper.findAll('.preset-chip').find((b) => b.text() === 'estilista')!
      await preset.trigger('click')

      const preview = wrapper.get('[aria-label="Vista previa del vocabulario"]').text()
      expect(preview).toContain('Estilistas')
      expect(preview).toContain('+ Agregar estilista')
      expect(preview).toContain('Aún no tienes estilistas registradas en el negocio.')
      expect(preview).toContain('Elige a la estilista y el servicio.')
    })

    it.each(['solo', 'employee'] as const)(
      'does not simulate team actions in the preview of the %s panel (DEC-134)',
      async (profile) => {
        // El panel del usuario llega al estado compartido al iniciar la sesión.
        setBrand({ ...DEFAULT_BRAND, panelProfile: profile })
        const wrapper = await mountReady({ ...DEFAULT_BRAND, panelProfile: profile })

        const preset = wrapper.findAll('.preset-chip').find((b) => b.text() === 'estilista')!
        await preset.trigger('click')

        const preview = wrapper.get('[aria-label="Vista previa del vocabulario"]').text()
        expect(preview).not.toContain('Agregar')
        expect(preview).not.toContain('Aún no tienes')
        expect(preview).not.toContain('Elige a la estilista')
        expect(preview).toContain('Mi perfil de estilista')
        expect(preview).toContain('Tus clientes reservan en el negocio.')
      },
    )

    it('writes the scope of each section with the confirmed barbershop word', async () => {
      // La marca confirmada llega al estado compartido al iniciar la sesión.
      const salon = {
        ...DEFAULT_BRAND,
        businessTerm: 'salón',
        businessTermGender: 'masculine' as const,
      }
      setBrand(salon)
      const wrapper = await mountReady(salon)

      expect(wrapper.text()).toContain('Para el salón')
      expect(wrapper.text()).toContain('cómo se llama el salón')
    })
  })
})
