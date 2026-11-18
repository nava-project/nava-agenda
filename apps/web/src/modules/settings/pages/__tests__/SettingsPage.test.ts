/**
 * Pruebas de SettingsPage (HU-020, DEC-110): carga de los dos recursos (datos básicos y marca), borrador con detección de cambios,
 * guardado por grupos, error de validación y de red conservando lo escrito (CA-020-08) y
 * doble envío bloqueado.
 * settingsApi, brandApi y auth.updateBarbershopName se sustituyen por dobles de prueba
 * (settingsPageHarness.ts); el recorrido real contra el API vive en el E2E. La suite de la
 * página se reparte en varios archivos SettingsPage*.test.ts para que vitest los ejecute en
 * paralelo (#625).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { brandState, DEFAULT_BRAND } from '@/shared/model'
import { toastState } from '@/shared/model/toastStore'
import { DEFAULT_LOCATION } from '../../model/brandOutcome'
import {
  fetchMock,
  saveMock,
  fetchBrandMock,
  saveBrandMock,
  updateBarbershopNameMock,
  loadedSettings,
  mountOptions,
  settle,
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

const { default: SettingsPage } = await import('../SettingsPage.vue')

describe('SettingsPage', () => {
  beforeEach(resetSettingsPageDoubles)

  describe('carga', () => {
    it('shows a non-blank loading state, then the loaded values of both resources', async () => {
      let resolveFetch: (value: unknown) => void = () => {}
      fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)))
      fetchBrandMock.mockResolvedValueOnce({
        kind: 'success',
        brand: DEFAULT_BRAND,
        location: DEFAULT_LOCATION,
      })
      const wrapper = mount(SettingsPage, mountOptions)

      expect(wrapper.text()).toContain('Cargando')

      resolveFetch({ kind: 'success', settings: loadedSettings })
      await settle()

      expect(input(wrapper, 'name').value).toBe('Barbería Ejemplo')
      expect(input(wrapper, 'contactEmail').value).toBe('contacto@ejemplo.test')
      expect(input(wrapper, 'businessTerm').value).toBe('negocio')
      expect(input(wrapper, 'professionalTerm').value).toBe('profesional')
      expect(input(wrapper, 'professionalTermPlural').value).toBe('profesionales')
      // La zona vive en el combobox del selector de zonas.
      expect((wrapper.get('[role="combobox"]').element as HTMLInputElement).value).toBe(
        'America/Bogota',
      )
    })

    it.each([
      ['datos básicos', () => fetchMock.mockResolvedValueOnce({ kind: 'network-error' })],
      ['marca', () => fetchBrandMock.mockResolvedValueOnce({ kind: 'unexpected-error' })],
    ])(
      'shows a recoverable error with Reintentar when the %s fail to load',
      async (_name, fail) => {
        fetchMock.mockResolvedValue({ kind: 'success', settings: loadedSettings })
        fetchBrandMock.mockResolvedValue({
          kind: 'success',
          brand: DEFAULT_BRAND,
          location: DEFAULT_LOCATION,
        })
        fail()
        const wrapper = mount(SettingsPage, mountOptions)
        await settle()

        expect(wrapper.text()).toContain('No pudimos cargar la configuración')
        expect(wrapper.find('input[name="name"]').exists()).toBe(false)

        await wrapper.get('button').trigger('click')
        await settle()

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(wrapper.find('input[name="name"]').exists()).toBe(true)
      },
    )

    it('renders empty contact fields (not "null") when the barbershop has none configured', async () => {
      fetchMock.mockResolvedValueOnce({
        kind: 'success',
        settings: { ...loadedSettings, contactEmail: null, contactPhone: null },
      })
      fetchBrandMock.mockResolvedValueOnce({
        kind: 'success',
        brand: DEFAULT_BRAND,
        location: DEFAULT_LOCATION,
      })
      const wrapper = mount(SettingsPage, mountOptions)
      await settle()

      expect(input(wrapper, 'contactEmail').value).toBe('')
      expect(input(wrapper, 'contactPhone').value).toBe('')
    })
  })

  describe('borrador y guardado', () => {
    it('shows no save bar until something changes, and hides it when the change is undone', async () => {
      const wrapper = await mountReady()
      expect(wrapper.find('.save-bar').exists()).toBe(false)

      await wrapper.get('input[name="name"]').setValue('Otro nombre')
      expect(wrapper.find('.save-bar').exists()).toBe(true)
      expect(wrapper.get('.save-bar').text()).toContain('Datos básicos')

      await wrapper.get('input[name="name"]').setValue('Barbería Ejemplo')
      expect(wrapper.find('.save-bar').exists()).toBe(false)
    })

    it('blocks submission and shows a field error for an empty name (client-side validation)', async () => {
      const wrapper = await mountReady()

      await wrapper.get('input[name="name"]').setValue('   ')
      await submit(wrapper)

      expect(saveMock).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Escribe el nombre del negocio.')
    })

    it.each([
      ['con dígitos', 'salón 24', 'Usa solo letras, espacios, guion o apóstrofo.'],
      ['de una letra', 's', 'Usa al menos 2 letras.'],
      ['vacío', '   ', 'Escribe una palabra.'],
    ])('blocks a business word %s and shows why', async (_name, value, message) => {
      const wrapper = await mountReady()

      await wrapper.get('input[name="businessTerm"]').setValue(value)
      await submit(wrapper)

      expect(saveBrandMock).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain(message)
    })

    it('saves only the basic data when only they changed, updates the header and announces it', async () => {
      const wrapper = await mountReady()
      saveMock.mockResolvedValueOnce({
        kind: 'success',
        settings: { ...loadedSettings, name: 'Barbería Renombrada' },
      })

      await wrapper.get('input[name="name"]').setValue('Barbería Renombrada')
      await submit(wrapper)

      expect(saveMock).toHaveBeenCalledTimes(1)
      expect(saveBrandMock).not.toHaveBeenCalled()
      expect(updateBarbershopNameMock).toHaveBeenCalledWith('Barbería Renombrada')
      expect(wrapper.find('.save-bar').exists()).toBe(false)
      expect(toastState.items.map((item) => item.title)).toEqual(['Configuración guardada'])
    })

    it('saves only the brand when only it changed, normalized, and publishes it to the whole app', async () => {
      const wrapper = await mountReady()
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: DEFAULT_LOCATION,
      }))

      await wrapper.get('input[name="businessTerm"]').setValue('  Salón   de Belleza ')
      await submit(wrapper)

      expect(saveMock).not.toHaveBeenCalled()
      expect(saveBrandMock).toHaveBeenCalledTimes(1)
      expect(saveBrandMock.mock.calls[0]![0]).toMatchObject({ businessTerm: 'salón de belleza' })
      // La marca confirmada llega al estado compartido que lee toda la app.
      expect(brandState.brand.businessTerm).toBe('salón de belleza')
      expect(wrapper.find('.save-bar').exists()).toBe(false)
    })

    it('saves both resources when both changed', async () => {
      const wrapper = await mountReady()
      saveMock.mockResolvedValueOnce({
        kind: 'success',
        settings: { ...loadedSettings, name: 'Nuevo' },
      })
      saveBrandMock.mockImplementationOnce(async (brand) => ({
        kind: 'success',
        brand,
        location: DEFAULT_LOCATION,
      }))

      await wrapper.get('input[name="name"]').setValue('Nuevo')
      await wrapper.get('input[name="businessTerm"]').setValue('estudio')
      await submit(wrapper)

      expect(saveMock).toHaveBeenCalledTimes(1)
      expect(saveBrandMock).toHaveBeenCalledTimes(1)
      expect(wrapper.find('.save-bar').exists()).toBe(false)
    })

    describe('teléfono de contacto con país y número', () => {
      const phoneSelect = (wrapper: VueWrapper) =>
        wrapper.get('.phone-field select').element as HTMLSelectElement

      it('reparte el teléfono guardado en país y número nacional', async () => {
        const wrapper = await mountReady()

        expect(phoneSelect(wrapper).value).toBe('CO')
        expect(wrapper.get('.phone-field__dial').text()).toBe('+57')
        expect(input(wrapper, 'contactPhone').value).toBe('3001234567')
        expect(wrapper.find('.save-bar').exists()).toBe(false)
      })

      it('guarda el E.164 compuesto con el país elegido y el número escrito', async () => {
        const wrapper = await mountReady()
        saveMock.mockResolvedValueOnce({
          kind: 'success',
          settings: { ...loadedSettings, contactPhone: '+525512345678' },
        })

        await wrapper.get('.phone-field select').setValue('MX')
        await wrapper.get('input[name="contactPhone"]').setValue('55 1234 5678')
        await submit(wrapper)

        expect(saveMock.mock.calls[0]![0]).toMatchObject({ contactPhone: '+525512345678' })
        expect(phoneSelect(wrapper).value).toBe('MX')
        expect(input(wrapper, 'contactPhone').value).toBe('5512345678')
      })

      it('al pegar un número con prefijo elige el país', async () => {
        const wrapper = await mountReady()

        await wrapper.get('input[name="contactPhone"]').setValue('+593 99 123 4567')

        expect(phoneSelect(wrapper).value).toBe('EC')
        expect(input(wrapper, 'contactPhone').value).toBe('991234567')
        expect(wrapper.find('.save-bar').exists()).toBe(true)
      })

      it('vaciar el número guarda «sin teléfono» y conserva el país elegido', async () => {
        const wrapper = await mountReady()
        saveMock.mockResolvedValueOnce({
          kind: 'success',
          settings: { ...loadedSettings, contactPhone: null },
        })

        await wrapper.get('.phone-field select').setValue('MX')
        await wrapper.get('input[name="contactPhone"]').setValue('')
        await submit(wrapper)

        expect(saveMock.mock.calls[0]![0]).toMatchObject({ contactPhone: '' })
        expect(phoneSelect(wrapper).value).toBe('MX')
      })

      it('avisa de un número incompleto y no guarda', async () => {
        const wrapper = await mountReady()

        await wrapper.get('input[name="contactPhone"]').setValue('300')
        await submit(wrapper)

        expect(saveMock).not.toHaveBeenCalled()
        expect(wrapper.get('.phone-field__error').text()).toContain('no parece completo')
      })

      it('descartar devuelve el país y el número guardados', async () => {
        const wrapper = await mountReady()

        await wrapper.get('.phone-field select').setValue('MX')
        await wrapper.get('input[name="contactPhone"]').setValue('5512345678')
        const discard = wrapper.findAll('.save-bar button').find((b) => b.text() === 'Descartar')!
        await discard.trigger('click')
        await flushPromises()

        expect(phoneSelect(wrapper).value).toBe('CO')
        expect(input(wrapper, 'contactPhone').value).toBe('3001234567')
      })
    })

    it('keeps the unsaved resource pending when only the other one fails to save', async () => {
      const wrapper = await mountReady()
      saveMock.mockResolvedValueOnce({
        kind: 'success',
        settings: { ...loadedSettings, name: 'Nuevo' },
      })
      saveBrandMock.mockResolvedValueOnce({ kind: 'network-error' })

      await wrapper.get('input[name="name"]').setValue('Nuevo')
      await wrapper.get('input[name="businessTerm"]').setValue('estudio')
      await submit(wrapper)

      // Lo guardado no se vuelve a enviar, lo fallido sigue pendiente y escrito.
      expect(updateBarbershopNameMock).toHaveBeenCalledWith('Nuevo')
      expect(toastState.items.map((item) => item.title)).toContain('No pudimos conectar')
      expect(wrapper.get('.save-bar').text()).toContain('Marca y vocabulario')
      expect(wrapper.get('.save-bar').text()).not.toContain('Datos básicos')
      expect(input(wrapper, 'businessTerm').value).toBe('estudio')
    })

    it('on a recoverable network error, keeps the typed values and never updates the header (CA-020-08)', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="name"]').setValue('Nombre editado sin guardar')
      saveMock.mockResolvedValueOnce({ kind: 'network-error' })

      await submit(wrapper)

      expect(toastState.items.map((item) => item.title)).toContain('No pudimos conectar')
      expect(updateBarbershopNameMock).not.toHaveBeenCalled()
      expect(input(wrapper, 'name').value).toBe('Nombre editado sin guardar')
      expect(wrapper.find('.save-bar').exists()).toBe(true)
    })

    // HAL-SHOP-01 (#427): una alerta al inicio del formulario quedaba fuera de pantalla en
    // móvil; DEC-095 manda avisar este fallo como toast con «Reintentar».
    it('announces a connection failure as a toast, not as an inline alert out of view', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="name"]').setValue('Nombre editado')
      saveMock.mockResolvedValueOnce({ kind: 'network-error' })

      await submit(wrapper)

      expect(wrapper.find('.settings-page__form [role="alert"]').exists()).toBe(false)
      const [toastItem] = toastState.items
      expect(toastItem).toMatchObject({ variant: 'warning', title: 'No pudimos conectar' })
      expect(toastItem?.action?.label).toBe('Reintentar')
    })

    it('announces an unexpected failure as an error toast and retries the save from it', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="name"]').setValue('Nombre editado')
      saveMock.mockResolvedValueOnce({ kind: 'unexpected-error' })

      await submit(wrapper)

      const [toastItem] = toastState.items
      expect(toastItem).toMatchObject({ variant: 'danger', title: 'Ocurrió un error inesperado' })
      expect(wrapper.find('.settings-page__form [role="alert"]').exists()).toBe(false)

      saveMock.mockResolvedValueOnce({
        kind: 'success',
        settings: { ...loadedSettings, name: 'Nombre editado' },
      })
      toastItem?.action?.run()
      await flushPromises()

      expect(saveMock).toHaveBeenCalledTimes(2)
      expect(wrapper.find('.save-bar').exists()).toBe(false)
    })

    it('on a validation-error for the basic data, keeps the typed values and never updates the header', async () => {
      const wrapper = await mountReady()
      const zone = wrapper.get('[role="combobox"]')
      await zone.setValue('COT')
      // El selector solo acepta una zona de su lista; el servidor sigue siendo
      // la autoridad, así que se fuerza el cambio por el nombre del negocio.
      await wrapper.get('input[name="name"]').setValue('Nombre nuevo')
      saveMock.mockResolvedValueOnce({ kind: 'validation-error' })

      await submit(wrapper)

      expect(wrapper.text()).toContain('No pudimos guardar los datos básicos')
      expect(updateBarbershopNameMock).not.toHaveBeenCalled()
      expect(input(wrapper, 'name').value).toBe('Nombre nuevo')
    })

    it('on a validation-error for the brand, explains the words rule and keeps what was typed', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="businessTerm"]').setValue('estudio')
      saveBrandMock.mockResolvedValueOnce({ kind: 'validation-error' })

      await submit(wrapper)

      expect(wrapper.text()).toContain('No pudimos guardar la marca ni el vocabulario')
      expect(input(wrapper, 'businessTerm').value).toBe('estudio')
    })

    it('blocks a second submit while the first is still in flight (no double PATCH)', async () => {
      const wrapper = await mountReady()
      let resolveSave: (value: unknown) => void = () => {}
      saveMock.mockReturnValueOnce(new Promise((resolve) => (resolveSave = resolve)))

      await wrapper.get('input[name="name"]').setValue('Nuevo')
      await wrapper.get('form').trigger('submit')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(saveMock).toHaveBeenCalledTimes(1)
      resolveSave({ kind: 'success', settings: { ...loadedSettings, name: 'Nuevo' } })
      await flushPromises()
    })

    it('discards every pending change and restores the confirmed values', async () => {
      const wrapper = await mountReady()
      await wrapper.get('input[name="name"]').setValue('Descartar esto')
      await wrapper.get('input[name="businessTerm"]').setValue('estudio')

      const discard = wrapper.findAll('.save-bar button').find((b) => b.text() === 'Descartar')!
      await discard.trigger('click')

      expect(input(wrapper, 'name').value).toBe('Barbería Ejemplo')
      expect(input(wrapper, 'businessTerm').value).toBe('negocio')
      expect(wrapper.find('.save-bar').exists()).toBe(false)
      expect(saveMock).not.toHaveBeenCalled()
    })
  })
})
