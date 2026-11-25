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
import { afterEach, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { PAGE_MIN_HOLD_MS } from '@/shared/composables'
import { DEFAULT_BRAND, resetAppearance, resetBrand } from '@/shared/model'
import { resetToasts } from '@/shared/model/toastStore'
import { DEFAULT_LOCATION } from '../../model/brandOutcome'

export const fetchMock = vi.fn()
export const saveMock = vi.fn()
export const fetchBrandMock = vi.fn()
export const saveBrandMock = vi.fn()
export const updateBusinessNameMock = vi.fn()
// El enlace público tiene su propio recurso y su propia prueba
// (PublicLinkPanel.test.ts): aquí solo se evita la red.
export const fetchPublicLinkMock = vi.fn(() =>
  Promise.resolve({ kind: 'success', slug: 'barberia-ejemplo-k7x2m9' }),
)

/** Módulos sustituidos, uno por cada `vi.mock` de los archivos de prueba. */
export const doubles = {
  settingsApi: {
    fetchBusinessSettings: fetchMock,
    saveBusinessSettings: saveMock,
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
  // Igual con el horario de atención (DEC-182): su prueba es OpeningHoursPanel.test.ts.
  openingHoursApi: {
    fetchOpeningHours: vi.fn(() =>
      Promise.resolve({ kind: 'success', settings: { openingHours: [], closedOnHolidays: false } }),
    ),
    saveOpeningHours: vi.fn(),
  },
  auth: { updateBusinessName: updateBusinessNameMock },
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
  updateBusinessNameMock.mockReset()
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

// Reloj simulado (#867, como StaffPage en #834). La página espera con
// setTimeout y Date.now(): el rombo de carga se sostiene PAGE_MIN_HOLD_MS aunque
// la respuesta ya haya llegado, y el buscador de direcciones espera su debounce.
// Con esperas reales en las pruebas, un CI cargado las reordenaba frente a las
// del componente. Cada archivo que usa este arnés llama a useSimulatedClock();
// setImmediate sigue real porque lo usa flushPromises.
export const COMPONENT_WAITS = {
  // La mínima del rombo de carga (useMinHoldLoading), con margen.
  loadHold: PAGE_MIN_HOLD_MS + 50,
  // Más que el debounce de 250 ms del buscador de direcciones (AddressAutocomplete).
  addressSearch: 400,
} as const

export async function passComponentWait(wait: keyof typeof COMPONENT_WAITS) {
  await vi.advanceTimersByTimeAsync(COMPONENT_WAITS[wait])
}

export function useSimulatedClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

// axe-core programa su trabajo con setTimeout y no avanza con el reloj simulado.
// Cada prueba de accesibilidad lo corre al final, así que vuelve al reloj real justo antes.
export function realClockForAxe() {
  vi.useRealTimers()
}

export async function settle() {
  await flushPromises()
  await passComponentWait('loadHold')
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
