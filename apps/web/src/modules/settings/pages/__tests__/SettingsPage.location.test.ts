/**
 * Pruebas de SettingsPage (HU-020, DEC-110): ubicación del local y atención a domicilio (DEC-130, DEC-131, DEC-170, HU-102, HU-103).
 * settingsApi, brandApi y auth.updateBusinessName se sustituyen por dobles de prueba
 * (settingsPageHarness.ts); el recorrido real contra el API vive en el E2E. La suite de la
 * página se reparte en varios archivos SettingsPage*.test.ts para que vitest los ejecute en
 * paralelo (#625).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { DEFAULT_BRAND } from '@/shared/model'
import { toastState } from '@/shared/model/toastStore'
import { DEFAULT_LOCATION } from '../../model/brandOutcome'
import {
  fetchMock,
  saveMock,
  fetchBrandMock,
  saveBrandMock,
  loadedSettings,
  mountOptions,
  settle,
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
vi.mock('@/modules/auth', async () => (await import('./settingsPageHarness')).doubles.auth)

const { default: SettingsPage } = await import('../SettingsPage.vue')

describe('SettingsPage', () => {
  beforeEach(resetSettingsPageDoubles)

  describe('ubicación (DEC-130, HU-102)', () => {
    const savedLocation = {
      hasPhysicalLocation: true,
      address: 'Calle 10 # 5-20, Bogotá',
      latitude: 4.598056,
      longitude: -74.076111,
      offersHomeService: false,
    }

    async function mountWithLocation(location: typeof savedLocation | typeof DEFAULT_LOCATION) {
      fetchMock.mockResolvedValueOnce({ kind: 'success', settings: loadedSettings })
      fetchBrandMock.mockResolvedValueOnce({ kind: 'success', brand: DEFAULT_BRAND, location })
      const wrapper = mount(SettingsPage, mountOptions)
      await settle()
      return wrapper
    }

    it('adds the section 06 with the switch and the saved address', async () => {
      const wrapper = await mountWithLocation(savedLocation)

      const panel = wrapper.get('#configuracion-ubicacion')
      expect(panel.get('.settings-panel__number').text()).toBe('06')
      expect(panel.get('h2').text()).toBe('Ubicación')
      expect(panel.get('[role="switch"]').attributes('aria-checked')).toBe('true')
      expect((panel.get('input[name="address"]').element as HTMLInputElement).value).toBe(
        'Calle 10 # 5-20, Bogotá',
      )
      expect(wrapper.get('a[href="#configuracion-ubicacion"]').text()).toContain('Ubicación')
      wrapper.unmount()
    })

    // DEC-170: con el local activado siempre hay buscador y mapa con pin, aunque la
    // dirección aún no tenga coordenadas; apagado, solo se recuerda el punto guardado.
    it('the address field is the place search, and the pin map shows whenever the local is on, even without coordinates', async () => {
      for (const location of [savedLocation, DEFAULT_LOCATION]) {
        const wrapper = await mountWithLocation(location)
        const panel = wrapper.get('#configuracion-ubicacion')
        // Un solo campo de dirección, que también busca (sin un segundo buscador).
        expect(panel.findAll('input[name="address"][role="combobox"]')).toHaveLength(1)
        expect(panel.text()).not.toContain('Busca tu local')
        expect(panel.get('.settings-location-picker').text()).toContain('Ubicación en el mapa')
        wrapper.unmount()
      }
    })

    it('choosing a suggestion in the address field writes it and sends its point (DEC-170)', async () => {
      const wrapper = await mountWithLocation(DEFAULT_LOCATION)
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: { ...savedLocation },
      }))

      await wrapper.get('input[name="address"]').setValue('Vibras Barbería')
      await new Promise((resolve) => setTimeout(resolve, 400))
      await settle()
      await wrapper.findAll('#configuracion-ubicacion [role="option"]')[0]!.trigger('click')
      await settle()

      const chosen = (wrapper.get('input[name="address"]').element as HTMLInputElement).value
      expect(chosen).not.toBe('Vibras Barbería')
      await submit(wrapper)
      const sent = saveBrandMock.mock.calls[0]![1]
      expect(sent.address).toBe(chosen)
      expect(typeof sent.latitude).toBe('number')
      expect(typeof sent.longitude).toBe('number')
      wrapper.unmount()
    })

    it('with the local off, hides the pin map and only previews the saved point', async () => {
      const wrapper = await mountWithLocation({ ...savedLocation, hasPhysicalLocation: false })
      expect(wrapper.find('.settings-location-picker').exists()).toBe(false)
      expect(wrapper.find('#configuracion-ubicacion iframe').exists()).toBe(true)
      expect(wrapper.get('#configuracion-ubicacion').text()).toContain('oculta')
      wrapper.unmount()
    })

    it('moving the map sends the hand-placed point with the written address (DEC-170)', async () => {
      const wrapper = await mountWithLocation(savedLocation)
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: { ...savedLocation, latitude: 4.599056 },
      }))

      await wrapper.get('[aria-label="Mover el mapa al norte"]').trigger('click')
      await settle()
      expect(wrapper.get('.save-bar').text()).toContain('Ubicación')
      await submit(wrapper)

      expect(saveBrandMock.mock.calls[0]![1]).toEqual({
        address: 'Calle 10 # 5-20, Bogotá',
        latitude: 4.599056,
        longitude: -74.076111,
      })
      expect(wrapper.find('.save-bar').exists()).toBe(false)
      wrapper.unmount()
    })

    it('a hand-placed point without a written address asks for the address and does not save', async () => {
      const wrapper = await mountWithLocation(DEFAULT_LOCATION)

      await wrapper.get('[aria-label="Mover el mapa al este"]').trigger('click')
      await settle()
      await submit(wrapper)

      expect(saveBrandMock).not.toHaveBeenCalled()
      expect(wrapper.get('#configuracion-ubicacion').text()).toContain(
        'Escribe la dirección del local',
      )
      wrapper.unmount()
    })

    it('warns that the address is public', async () => {
      const wrapper = await mountWithLocation(DEFAULT_LOCATION)

      expect(wrapper.get('#configuracion-ubicacion').text()).toContain('La dirección es pública')
      wrapper.unmount()
    })

    it('sends only the new address (trimmed) and keeps the switch untouched', async () => {
      const wrapper = await mountWithLocation(DEFAULT_LOCATION)
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: { ...savedLocation },
      }))

      await wrapper.get('input[name="address"]').setValue('  Calle 10   # 5-20, Bogotá ')
      expect(wrapper.get('.save-bar').text()).toContain('Ubicación')
      await submit(wrapper)

      expect(saveBrandMock).toHaveBeenCalledTimes(1)
      expect(saveBrandMock.mock.calls[0]![1]).toEqual({ address: 'Calle 10 # 5-20, Bogotá' })
      expect(saveMock).not.toHaveBeenCalled()
      // Sin tocar el mapa no viaja ningún punto: lo fija el servidor al geocodificar.
      expect(wrapper.find('.save-bar').exists()).toBe(false)
      wrapper.unmount()
    })

    it('turning on «Atiendo a domicilio» sends only that switch (DEC-131, HU-103)', async () => {
      const wrapper = await mountWithLocation(savedLocation)
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: { ...savedLocation, offersHomeService: true },
      }))

      // El segundo interruptor del panel: el primero es «Tengo local físico».
      const homeSwitch = wrapper.findAll('#configuracion-ubicacion [role="switch"]')[1]!
      expect(homeSwitch.attributes('aria-checked')).toBe('false')
      await homeSwitch.trigger('click')
      await submit(wrapper)

      expect(saveBrandMock.mock.calls[0]![1]).toEqual({ offersHomeService: true })
      expect(wrapper.get('#configuracion-ubicacion').text()).toContain('tus clientes podrán elegir')
      wrapper.unmount()
    })

    it('does not offer the Google listing id: it is managed in the database (DEC-137)', async () => {
      const wrapper = await mountWithLocation(savedLocation)

      expect(wrapper.find('input[name="googlePlaceId"]').exists()).toBe(false)
      expect(wrapper.get('#configuracion-ubicacion').text()).not.toContain('ficha de Google')
      wrapper.unmount()
    })

    it('turning the switch off sends only the switch, never the address', async () => {
      const wrapper = await mountWithLocation(savedLocation)
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: { ...savedLocation, hasPhysicalLocation: false },
      }))

      await wrapper.get('#configuracion-ubicacion [role="switch"]').trigger('click')
      await submit(wrapper)

      expect(saveBrandMock.mock.calls[0]![1]).toEqual({ hasPhysicalLocation: false })
      expect(wrapper.get('#configuracion-ubicacion').text()).toContain('oculta')
      wrapper.unmount()
    })

    it('clearing the address sends null to remove it with its coordinates', async () => {
      const wrapper = await mountWithLocation(savedLocation)
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: DEFAULT_LOCATION,
      }))

      await wrapper.get('input[name="address"]').setValue('   ')
      await submit(wrapper)

      expect(saveBrandMock.mock.calls[0]![1]).toEqual({ address: null })
      wrapper.unmount()
    })

    it('shows a recoverable error next to the field when the address cannot be located (CA-102-01)', async () => {
      const wrapper = await mountWithLocation(savedLocation)
      saveBrandMock.mockResolvedValueOnce({ kind: 'location-error' })

      await wrapper.get('input[name="address"]').setValue('Ninguna parte 999')
      await submit(wrapper)

      const panel = wrapper.get('#configuracion-ubicacion')
      expect(panel.text()).toContain('No pudimos ubicar esa dirección')
      expect(panel.get('input[name="address"]').attributes('aria-invalid')).toBe('true')
      // Lo escrito se conserva y no se anuncia un guardado que no ocurrió.
      expect((panel.get('input[name="address"]').element as HTMLInputElement).value).toBe(
        'Ninguna parte 999',
      )
      expect(toastState.items).toHaveLength(0)
      expect(wrapper.find('.save-bar').exists()).toBe(true)
      wrapper.unmount()
    })

    it('rejects an address over 200 characters before sending', async () => {
      const wrapper = await mountWithLocation(DEFAULT_LOCATION)

      await wrapper.get('input[name="address"]').setValue('x'.repeat(201))
      await submit(wrapper)

      expect(saveBrandMock).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('discarding restores the saved address and switch', async () => {
      const wrapper = await mountWithLocation(savedLocation)

      await wrapper.get('input[name="address"]').setValue('Otra dirección')
      await wrapper.get('#configuracion-ubicacion [role="switch"]').trigger('click')
      await wrapper.get('.save-bar button[type="button"]').trigger('click')

      expect((wrapper.get('input[name="address"]').element as HTMLInputElement).value).toBe(
        'Calle 10 # 5-20, Bogotá',
      )
      expect(
        wrapper.get('#configuracion-ubicacion [role="switch"]').attributes('aria-checked'),
      ).toBe('true')
      wrapper.unmount()
    })
  })
})
