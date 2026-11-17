/**
 * Dobles de prueba y utilidades comunes de las pruebas de SettingsPage
 * (SettingsPage*.test.ts). La suite de la página se reparte en varios archivos
 * para que vitest los ejecute en paralelo (#625); cada uno registra los mismos
 * `vi.mock` apuntando a `doubles` y reinicia el estado con
 * `resetSettingsPageDoubles` antes de cada prueba.
 *
 * Este módulo no importa la página ni nada de `@/modules`: las fábricas de
 * `vi.mock` lo cargan mientras se resuelven esos módulos, y un ciclo las
 * bloquearía. La página se carga al montar, cuando los dobles ya están puestos.
 */
import { vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { PAGE_MIN_HOLD_MS } from '@/shared/composables'
import { DEFAULT_BRAND, resetAppearance, resetBrand } from '@/shared/model'
import { resetToasts } from '@/shared/model/toastStore'
import { DEFAULT_LOCATION } from '../../model/brandOutcome'

export const fetchMock = vi.fn()
export const saveMock = vi.fn()
export const fetchBrandMock = vi.fn()
export const saveBrandMock = vi.fn()
export const updateBarbershopNameMock = vi.fn()
// El enlace público tiene su propio recurso y su propia prueba
// (PublicLinkPanel.test.ts): aquí solo se evita la red.
export const fetchPublicLinkMock = vi.fn(() =>
  Promise.resolve({ kind: 'success', slug: 'barberia-ejemplo-k7x2m9' }),
)

/** Módulos sustituidos, uno por cada `vi.mock` de los archivos de prueba. */
export const doubles = {
  settingsApi: {
    fetchBarbershopSettings: fetchMock,
    saveBarbershopSettings: saveMock,
  },
  brandApi: {
    fetchBrand: fetchBrandMock,
    saveBrand: saveBrandMock,
  },
  publicLinkApi: { fetchPublicLink: fetchPublicLinkMock },
  // El canal del código de acceso (DEC-139) también es un recurso propio, con su
  // prueba en LoginOtpPanel.test.ts: aquí solo se evita la red.
  loginOtpApi: {
    fetchLoginOtpChannel: vi.fn(() => Promise.resolve({ kind: 'success', channel: 'email' })),
    saveLoginOtpChannel: vi.fn(),
  },
  // Igual con la anticipación del recordatorio (DEC-174): su prueba es ReminderPanel.test.ts.
  reminderSettingsApi: {
    fetchReminderSettings: vi.fn(() => Promise.resolve({ kind: 'success', leadMinutes: 30 })),
    saveReminderLead: vi.fn(),
  },
  auth: { updateBarbershopName: updateBarbershopNameMock },
}

export function resetSettingsPageDoubles() {
  resetToasts()
  resetAppearance()
  resetBrand()
  window.localStorage.clear()
  fetchMock.mockReset()
  saveMock.mockReset()
  fetchBrandMock.mockReset()
  saveBrandMock.mockReset()
  updateBarbershopNameMock.mockReset()
}

export const loadedSettings = {
  name: 'Barbería Ejemplo',
  timezone: 'America/Bogota',
  contactEmail: 'contacto@ejemplo.test',
  contactPhone: '+573001234567',
}

export const mountOptions = {
  global: {
    stubs: {
      RouterLink: { props: ['to'], template: '<a class="stub-link"><slot /></a>' },
    },
  },
}

// El rombo de carga se sostiene PAGE_MIN_HOLD_MS aunque la respuesta ya haya
// llegado: se espera ese retraso real antes de mirar la pantalla cargada.
export async function settle() {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, PAGE_MIN_HOLD_MS + 50))
  await flushPromises()
}

export async function mountReady(brand = DEFAULT_BRAND) {
  const { default: SettingsPage } = await import('../SettingsPage.vue')
  fetchMock.mockResolvedValueOnce({ kind: 'success', settings: loadedSettings })
  fetchBrandMock.mockResolvedValueOnce({ kind: 'success', brand, location: DEFAULT_LOCATION })
  const wrapper = mount(SettingsPage, mountOptions)
  await settle()
  return wrapper
}

export const input = (wrapper: VueWrapper, name: string) =>
  wrapper.get(`input[name="${name}"]`).element as HTMLInputElement

export async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
