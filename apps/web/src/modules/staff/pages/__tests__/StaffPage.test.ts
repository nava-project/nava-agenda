/**
 * Pruebas de StaffPage (HU-021, DEC-104): carga (una fila, cuatro filas, vacío),
 * error recuperable, alta (éxito, validación, conflicto de idempotencia, error
 * de red, doble envío bloqueado, con y sin foto), edición (nombre, foto, quitar
 * foto, fallos a medias, sin cambios, no encontrado), detalle, paginación
 * (numerada, DEC-107), foco y ausencia de campos fuera de alcance. staffApi se
 * sustituye por un doble de prueba; el recorrido real contra el API vive en el
 * E2E de HU-021.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetToasts, toastState } from '@/shared/model/toastStore'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import { DEFAULT_MIN_HOLD_MS, PAGE_MIN_HOLD_MS } from '@/shared/composables'
import { DEFAULT_BRAND, resetBrand, setBrand } from '@/shared/model'

const fetchMock = vi.hoisted(() => vi.fn())
const createMock = vi.hoisted(() => vi.fn())
const renameMock = vi.hoisted(() => vi.fn())
const uploadPhotoMock = vi.hoisted(() => vi.fn())
const removePhotoMock = vi.hoisted(() => vi.fn())
const fetchMyProfessionalMock = vi.hoisted(() => vi.fn())
const linkMyProfessionalMock = vi.hoisted(() => vi.fn())
const unlinkMyProfessionalMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/composables/useLoaderGrace', async (original) =>
  (await import('@/shared/composables/__tests__/instantLoaderGrace')).instantLoaderGrace(
    await original(),
  ),
)
vi.mock('../../api/staffApi', () => ({
  fetchProfessionalPage: async (page: number, pageSize: number) => {
    const outcome = await fetchMock(page, pageSize)
    if (outcome.kind !== 'success') return outcome
    return {
      kind: 'success',
      page: {
        page,
        pageSize,
        total: outcome.page.items.length + (outcome.page.nextCursor ? 1 : 0),
        totalPages: outcome.page.nextCursor ? 2 : 1,
        ...outcome.page,
      },
    }
  },
  createProfessional: createMock,
  renameProfessional: renameMock,
  uploadProfessionalPhoto: uploadPhotoMock,
  removeProfessionalPhoto: removePhotoMock,
  fetchMyProfessional: fetchMyProfessionalMock,
  linkMyProfessional: linkMyProfessionalMock,
  unlinkMyProfessional: unlinkMyProfessionalMock,
  // La URL real depende del cliente HTTP; aquí basta una forma reconocible.
  professionalPhotoUrl: (b: { id: string; photoUpdatedAt: string | null }) =>
    b.photoUpdatedAt ? `/photo/${b.id}?v=${b.photoUpdatedAt}` : null,
}))

const { default: StaffPage } = await import('../StaffPage.vue')
const { default: ProfessionalPhotoField } =
  await import('../../components/ProfessionalPhotoField.vue')

function professional(
  id: string,
  fullName: string,
  photoUpdatedAt: string | null = null,
  description: string | null = null,
) {
  return {
    id,
    fullName,
    createdAt: '2026-08-23T15:04:05Z',
    updatedAt: '2026-08-23T15:04:05Z',
    photoUpdatedAt,
    description,
  }
}

function openDialogDescription(wrapper: VueWrapper): HTMLTextAreaElement {
  return openDialogElement(wrapper).querySelector(
    'textarea[name="description"]',
  ) as HTMLTextAreaElement
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value
  textarea.dispatchEvent(new Event('input'))
}

const oneProfessional = [professional('b-1', 'Carlos Ramírez')]
const fourProfessionals = [
  professional('b-1', 'Carlos Ramírez'),
  professional('b-2', 'Ana Torres'),
  professional('b-3', 'Luis Gómez'),
  professional('b-4', 'María Pérez'),
]

// stubs.teleport hace que Vue Test Utils renderice el contenido de
// <Teleport to="body"> EN EL LUGAR, dentro del árbol del wrapper, en vez de
// moverlo al document.body real: cada mount() queda completamente aislado
// en su propio wrapper.element, sin ningún riesgo de que un diálogo de una
// prueba anterior contamine la siguiente (BaseDialog usa Teleport;
// shared/ui/__tests__/BaseDialog.test.ts monta contra el DOM real y por eso
// sí necesita limpiarlo a mano, un problema que este stub evita aquí desde
// la raíz). stubs.transition: jsdom no tiene motor CSS (nunca dispara
// transitionend), así que el <Transition mode="out-in"> de carga/error/listo
// cambia de hijo al instante.
function mountPage() {
  return mount(StaffPage, {
    global: {
      stubs: { teleport: true, transition: true, RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

// Reloj simulado en todo el archivo (#834). La página espera con setTimeout y
// Date.now(): la mínima del esqueleto (useMinHoldLoading), la de cada página
// pedida y el ajuste de 120 ms tras un resize. Con esperas reales en las pruebas,
// un CI cargado las reordenaba frente a las del componente y las aserciones veían
// otro momento. setImmediate sigue real porque lo usa flushPromises.
const COMPONENT_WAITS = {
  // useMinHoldLoading: el esqueleto de la primera carga, con margen.
  initialLoadHold: DEFAULT_MIN_HOLD_MS + 50,
  // La mínima de una página pedida («Cargar más», paginación, reajuste).
  moreHold: PAGE_MIN_HOLD_MS + 50,
  // Más que el ajuste de 120 ms que sigue a un resize o al aviso del ResizeObserver.
  refit: 160,
} as const

async function passComponentWait(wait: keyof typeof COMPONENT_WAITS) {
  await vi.advanceTimersByTimeAsync(COMPONENT_WAITS[wait])
}

function waitOutInitialLoadHold() {
  return passComponentWait('initialLoadHold')
}

function waitOutMoreHold() {
  return passComponentWait('moreHold')
}

// axe-core programa su trabajo con setTimeout y no avanza con el reloj simulado.
// Cada prueba de accesibilidad lo corre al final, ya sin esperas del componente
// por medir, así que vuelve al reloj real justo antes.
function axeWithRealClock(...args: Parameters<typeof axe>) {
  vi.useRealTimers()
  return axe(...args)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

async function mountReady(items = oneProfessional, nextCursor: string | null = null) {
  // Clona el arreglo (StaffPage.vue asigna professionals.value = outcome.page.items
  // por referencia, y "Cargar más" hace push directo sobre ese mismo
  // arreglo): sin clonar, dos pruebas que reutilizan la misma constante
  // oneProfessional/fourProfessionals mutarían el fixture compartido de la otra,
  // exactamente como haría un backend real que SIEMPRE devuelve un arreglo
  // nuevo por respuesta.
  fetchMock.mockResolvedValueOnce({ kind: 'success', page: { items: [...items], nextCursor } })
  const wrapper = mountPage()
  await flushPromises()
  await waitOutInitialLoadHold()
  await flushPromises()
  return wrapper
}

// La pila de BaseDialog mantiene los diálogos (detalle, alta y edición) SIEMPRE
// en el DOM (v-show, no v-if): se selecciona el que esté visualmente abierto en
// vez de "form" a secas, que ambigüaría entre ellos.
function openDialogElement(wrapper: VueWrapper): HTMLElement {
  const el = wrapper.element.querySelector('.base-dialog--open')
  if (!el) throw new Error('no open dialog found')
  return el as HTMLElement
}

function openDialogInput(wrapper: VueWrapper): HTMLInputElement {
  return openDialogElement(wrapper).querySelector('input[name="fullName"]') as HTMLInputElement
}

function openDialogForm(wrapper: VueWrapper): HTMLFormElement {
  return openDialogElement(wrapper).querySelector('form') as HTMLFormElement
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

function submitOpenDialog(wrapper: VueWrapper) {
  openDialogForm(wrapper).dispatchEvent(new Event('submit', { cancelable: true }))
}

// color-contrast se desactiva: jsdom no implementa Canvas2D (mismo
// criterio documentado en shared/ui/__tests__/BaseButton.test.ts); el
// contraste ya está verificado en la tabla aprobada de
// estandar-diseno-visual.md §4.3.
const axeOptions = { rules: { 'color-contrast': { enabled: false } } }

function findButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === text)
  if (!button) throw new Error(`button ${JSON.stringify(text)} not found`)
  return button
}

// Elige una foto en el campo del diálogo abierto. El campo emite `update:draft`
// con la imagen ya preparada (el recorte y el input de archivo se prueban en
// ProfessionalPhotoField.test.ts y preparePhoto.test.ts): aquí se ejercita lo que la
// página hace con ese borrador. Se emite desde el componente en vez de
// disparar `change` en el DOM porque el stub de Teleport de Vue Test Utils
// vuelve a montar el contenido de los diálogos en cada re-render, y una
// preparación asíncrona en curso emitiría desde una instancia ya descartada.
async function pickPhoto(wrapper: VueWrapper, previewUrl = 'blob:preview') {
  const blob = new Blob(['prepared'], { type: 'image/jpeg' })
  const open = openDialogElement(wrapper)
  const field = wrapper
    .findAllComponents(ProfessionalPhotoField)
    .find((candidate) => open.contains(candidate.element))
  if (!field) throw new Error('no photo field in the open dialog')
  field.vm.$emit('update:draft', { kind: 'new', blob, previewUrl })
  await flushPromises()
  return blob
}

function dialogButton(wrapper: VueWrapper, text: string) {
  const button = Array.from(openDialogElement(wrapper).querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  if (!button) throw new Error(`dialog button ${JSON.stringify(text)} not found`)
  return button as HTMLButtonElement
}

describe('StaffPage', () => {
  beforeEach(() => {
    resetToasts()
    resetBrand()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => {
      const created = await createMock.mock.results.at(-1)?.value
      const photo = await uploadPhotoMock.mock.results.at(-1)?.value
      const added = photo?.kind === 'success' ? photo.professional : created?.professional
      return {
        kind: 'success',
        page: {
          items: added ? [...oneProfessional, added] : [...oneProfessional],
          nextCursor: null,
        },
      }
    })
    createMock.mockReset()
    renameMock.mockReset()
    uploadPhotoMock.mockReset()
    removePhotoMock.mockReset()
    fetchMyProfessionalMock.mockReset()
    fetchMyProfessionalMock.mockResolvedValue({ kind: 'none' })
    linkMyProfessionalMock.mockReset()
    unlinkMyProfessionalMock.mockReset()
    URL.revokeObjectURL = vi.fn()
  })

  it('shows a non-blank loading state, then the loaded team', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)))
    const wrapper = mountPage()

    expect(wrapper.text()).toContain('Cargando')
    // La carga muestra el rombo y la forma de las filas por llegar, no una
    // pantalla en blanco.
    expect(wrapper.find('.diamond-loader').exists()).toBe(true)
    expect(wrapper.findAll('.staff-page__skeleton-row').length).toBe(3)

    resolveFetch({ kind: 'success', page: { items: [...oneProfessional], nextCursor: null } })
    await flushPromises()
    // Una respuesta rápida no retira el indicador antes del mínimo.
    expect(wrapper.text()).toContain('Cargando')

    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Cargando')
    expect(wrapper.text()).toContain('Carlos Ramírez')
  })

  it('speaks with the words the business chose, in agreement (DEC-110)', async () => {
    setBrand({
      ...DEFAULT_BRAND,
      professionalTerm: 'estilista',
      professionalTermPlural: 'estilistas',
      professionalTermGender: 'feminine',
    })
    const wrapper = mountPage()
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Estilistas')
    expect(wrapper.text()).toContain('Agregar estilista')
    expect(wrapper.text()).toContain('1 estilista')
    expect(wrapper.text()).not.toContain('barbero')
    expect(wrapper.text()).not.toContain('profesional')
  })

  it('a one-person shop and a four-person shop use the same list component (CA-021-01/02)', async () => {
    const oneWrapper = await mountReady(oneProfessional)
    expect(oneWrapper.findAll('.staff-page__row').length).toBe(1)

    const fourWrapper = await mountReady(fourProfessionals)
    expect(fourWrapper.findAll('.staff-page__row').length).toBe(4)
    expect(fourWrapper.text()).toContain('Ana Torres')
    expect(fourWrapper.text()).toContain('María Pérez')
  })

  it('shows a decorative, accessible monogram with the initials of each professional without a photo (Fase 5, issue #153)', async () => {
    const wrapper = await mountReady(fourProfessionals)
    const avatars = wrapper.findAll('.staff-page__row .professional-avatar')
    expect(avatars.map((a) => a.text())).toEqual(['CR', 'AT', 'LG', 'MP'])
    for (const avatar of avatars) {
      expect(avatar.attributes('aria-hidden')).toBe('true')
    }
  })

  it('uses a single initial for a one-word name', async () => {
    const wrapper = await mountReady([professional('b-1', 'Madonna')])
    expect(wrapper.get('.staff-page__row .professional-avatar').text()).toBe('M')
  })

  it('shows the real photo of a professional who has one and the monogram of one who does not (DEC-104)', async () => {
    const wrapper = await mountReady([
      professional('b-1', 'Carlos Ramírez', '2026-09-30T12:00:00Z'),
      professional('b-2', 'Ana Torres'),
    ])
    const rows = wrapper.findAll('.staff-page__row')

    const photo = rows[0]!.get('img.professional-avatar__photo')
    expect(photo.attributes('src')).toBe('/photo/b-1?v=2026-09-30T12:00:00Z')
    expect(photo.attributes('alt')).toBe('')
    expect(rows[0]!.text()).toContain('Con foto')

    expect(rows[1]!.find('img').exists()).toBe(false)
    expect(rows[1]!.get('.professional-avatar__monogram').text()).toBe('AT')
    expect(rows[1]!.text()).toContain('Sin foto')
  })

  it('shows the enrolment date of each professional in the shop timezone', async () => {
    const wrapper = await mountReady()
    expect(wrapper.get('.staff-page__item-since').text()).toBe('23/08/2026')
  })

  it('shows an empty state with no special data shape when there are no professionals', async () => {
    const wrapper = await mountReady([])
    expect(wrapper.text()).toContain('Aún no tienes profesionales registrados')
    expect(wrapper.find('.staff-page__ready--fitting').exists()).toBe(false)
    expect(wrapper.findAll('li').length).toBe(0)
    expect(wrapper.find('.staff-page__footer').exists()).toBe(false)
  })

  it('with an empty team offers a single «Agregar», in the header, and the scene names it', async () => {
    const wrapper = await mountReady([])
    const header = wrapper.get('.staff-page__header')
    expect(header.get('.staff-page__create').text()).toBe('Agregar profesional')
    const empty = wrapper.get('.staff-page__empty')
    expect(empty.findAll('button')).toHaveLength(0)
    expect(empty.text()).toContain('«Agregar profesional», arriba')
    // En el teléfono conserva el texto que la pista nombra (no el «+» solo) y la
    // cabecera puede bajarlo de línea en vez de recortarlo.
    expect(header.get('.staff-page__create').classes()).toContain('staff-page__create--labeled')
    expect(header.classes()).toContain('staff-page__header--labeled')
  })

  it('with a team, the header action stays the compact one on the phone', async () => {
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    expect(wrapper.get('.staff-page__create').classes()).not.toContain(
      'staff-page__create--labeled',
    )
    expect(wrapper.get('.staff-page__header').classes()).not.toContain(
      'staff-page__header--labeled',
    )
  })

  it('shows a recoverable error with Reintentar when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = mountPage()
    await flushPromises()
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos cargar el equipo')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: [...oneProfessional], nextCursor: null },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await waitOutInitialLoadHold()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Carlos Ramírez')
  })

  it('replaces the page, shows exact total and returns to the previous page', async () => {
    const wrapper = await mountReady(oneProfessional, 'opaque-cursor')
    expect(wrapper.find('nav[aria-label="Paginación de profesionales"]').exists()).toBe(true)
    expect(wrapper.get('.base-pagination__count').text()).toContain('Página 1 de 2')
    fetchMock.mockResolvedValueOnce({
      kind: 'success',
      page: {
        items: [professional('b-2', 'Ana Torres')],
        page: 2,
        pageSize: 20,
        total: 2,
        totalPages: 2,
      },
    })
    await wrapper.get('button[aria-label="Página siguiente"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.staff-page__skeleton-row--page').length).toBe(1)
    await waitOutMoreHold()
    await flushPromises()
    expect(wrapper.findAll('.staff-page__row').length).toBe(1)
    expect(wrapper.text()).toContain('Ana Torres')
    expect(wrapper.text()).not.toContain('Carlos Ramírez')
    expect(wrapper.get('button[aria-label="Página 2"]').attributes('aria-current')).toBe('page')
    fetchMock.mockResolvedValueOnce({
      kind: 'success',
      page: { items: oneProfessional, page: 1, pageSize: 20, total: 2, totalPages: 2 },
    })
    await wrapper.get('button[aria-label="Página anterior"]').trigger('click')
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()
    expect(wrapper.text()).toContain('Carlos Ramírez')
    expect(fetchMock).toHaveBeenLastCalledWith(1, 20)
  })

  it('keeps the loaded page on error and retries the failed target page', async () => {
    const wrapper = await mountReady(oneProfessional, 'cursor')
    fetchMock.mockResolvedValueOnce({ kind: 'network-error' })
    await wrapper.get('button[aria-label="Página siguiente"]').trigger('click')
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()
    expect(wrapper.text()).toContain('No pudimos cargar esta página')
    expect(wrapper.text()).toContain('Carlos Ramírez')
    fetchMock.mockResolvedValueOnce({
      kind: 'success',
      page: {
        items: [professional('b-2', 'Ana Torres')],
        page: 2,
        pageSize: 20,
        total: 2,
        totalPages: 2,
      },
    })
    await findButtonByText(wrapper, 'Reintentar página').trigger('click')
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith(2, 20)
    expect(wrapper.text()).toContain('Ana Torres')
  })

  it('fits the initial page and ignores an old page response after a smaller resize (#288)', async () => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    let height = 600
    Object.defineProperty(scroller, 'clientHeight', { get: () => height })
    document.body.appendChild(scroller)
    const style = document.createElement('style')
    style.textContent = '.staff-page { padding-bottom:48px }'
    document.head.appendChild(style)
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this === scroller) return rect(0, height)
        if (
          this.classList.contains('staff-page__row') ||
          this.classList.contains('staff-page__skeleton-row')
        )
          return rect(0, 84)
        const rows = scroller.querySelectorAll('.staff-page__row,.staff-page__skeleton-row').length
        if (this.classList.contains('staff-page__list')) return rect(200, rows * 84 + 2)
        if (this.classList.contains('staff-page__footer')) return rect(218 + rows * 84, 34)
        return rect(0, 0)
      })
    let wrapper: VueWrapper | undefined
    try {
      fetchMock.mockResolvedValueOnce({
        kind: 'success',
        page: { items: fourProfessionals, page: 1, pageSize: 20, total: 17, totalPages: 1 },
      })
      wrapper = mount(StaffPage, {
        attachTo: scroller,
        global: {
          stubs: { teleport: true, transition: true, RouterLink: { template: '<a><slot /></a>' } },
        },
      })
      await flushPromises()
      await waitOutInitialLoadHold()
      await flushPromises()
      expect(wrapper.findAll('.staff-page__row')).toHaveLength(3)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      let resolveOld: (value: unknown) => void = () => {}
      fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }),
      )
      await wrapper.get('button[aria-label="Página siguiente"]').trigger('click')
      await flushPromises()
      fetchMock.mockResolvedValueOnce({
        kind: 'success',
        page: { items: oneProfessional, page: 1, pageSize: 1, total: 17, totalPages: 17 },
      })
      height = 420
      window.dispatchEvent(new Event('resize'))
      await passComponentWait('refit')
      await flushPromises()
      await waitOutMoreHold()
      await flushPromises()
      expect(fetchMock).toHaveBeenLastCalledWith(1, 1)
      resolveOld({
        kind: 'success',
        page: { items: fourProfessionals, page: 2, pageSize: 3, total: 17, totalPages: 6 },
      })
      await flushPromises()
      await waitOutMoreHold()
      await flushPromises()
      expect(wrapper.findAll('.staff-page__row')).toHaveLength(1)
      expect(wrapper.get('button[aria-label="Página 1"]').attributes('aria-current')).toBe('page')
    } finally {
      wrapper?.unmount()
      spy.mockRestore()
      scroller.remove()
      style.remove()
    }
  })

  it('keeps the skeleton cover until the refit page is revealed, not just requested (#817)', async () => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'clientHeight', { get: () => 600 })
    document.body.appendChild(scroller)
    const style = document.createElement('style')
    style.textContent = '.staff-page { padding-bottom:48px }'
    document.head.appendChild(style)
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this === scroller) return rect(0, 600)
        if (
          this.classList.contains('staff-page__row') ||
          this.classList.contains('staff-page__skeleton-row')
        )
          return rect(0, 84)
        const rows = scroller.querySelectorAll('.staff-page__row,.staff-page__skeleton-row').length
        if (this.classList.contains('staff-page__list')) return rect(200, rows * 84 + 2)
        if (this.classList.contains('staff-page__footer')) return rect(218 + rows * 84, 34)
        return rect(0, 0)
      })
    // El navegador avisa al ResizeObserver en cuanto empieza a observar: ese
    // segundo ajuste no debe destapar la lista antes de la revelación.
    class InstantResizeObserver {
      private readonly callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe() {
        this.callback()
      }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', InstantResizeObserver)
    let wrapper: VueWrapper | undefined
    try {
      // La primera página trae menos filas de las que caben: el ajuste vuelve
      // a pedirla con el tamaño medido.
      fetchMock.mockResolvedValueOnce({
        kind: 'success',
        page: { items: oneProfessional, page: 1, pageSize: 20, total: 17, totalPages: 1 },
      })
      let resolveRefit: (value: unknown) => void = () => {}
      fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefit = resolve
        }),
      )
      wrapper = mount(StaffPage, {
        attachTo: scroller,
        global: {
          stubs: { teleport: true, transition: true, RouterLink: { template: '<a><slot /></a>' } },
        },
      })
      await flushPromises()
      await waitOutInitialLoadHold()
      await flushPromises()
      expect(fetchMock).toHaveBeenLastCalledWith(1, 3)
      await passComponentWait('refit')
      await flushPromises()
      expect(wrapper.find('.content-reveal__cover').exists()).toBe(true)

      resolveRefit({
        kind: 'success',
        page: {
          items: fourProfessionals.slice(0, 3),
          page: 1,
          pageSize: 3,
          total: 17,
          totalPages: 6,
        },
      })
      await flushPromises()
      // Pedida y respondida, pero aún sin revelar: el esqueleto sigue encima.
      expect(wrapper.find('.content-reveal__cover').exists()).toBe(true)
      await waitOutMoreHold()
      await flushPromises()
      expect(wrapper.find('.content-reveal__cover').exists()).toBe(false)
      expect(wrapper.findAll('.staff-page__row')).toHaveLength(3)
    } finally {
      wrapper?.unmount()
      vi.unstubAllGlobals()
      spy.mockRestore()
      scroller.remove()
      style.remove()
    }
  })

  // --- Detalle ------------------------------------------------------------

  it('opens the professional detail with the portrait, and its Editar button hands over to the edit dialog', async () => {
    const wrapper = await mountReady([
      professional('b-1', 'Carlos Ramírez', '2026-09-30T12:00:00Z'),
    ])

    await wrapper.get('.staff-page__item-trigger').trigger('click')
    await flushPromises()

    const dialog = openDialogElement(wrapper)
    expect(dialog.textContent).toContain('Carlos Ramírez')
    expect(dialog.querySelector('img.professional-avatar__photo')).toBeTruthy()
    // La ficha dice la fecha en palabras, como la del servicio (#762).
    expect(dialog.textContent).toContain('23 de agosto de 2026')
    expect(dialog.textContent).toContain('Con foto')
    expect(
      [...dialog.querySelectorAll('.staff-page__fact dt')].map((dt) => dt.textContent?.trim()),
    ).toEqual(['En Nava Agenda desde', 'Foto'])

    dialogButton(wrapper, 'Editar').click()
    await flushPromises()

    expect(openDialogInput(wrapper).value).toBe('Carlos Ramírez')
  })

  // --- Vínculo con mi usuario (DEC-100) -------------------------------------

  async function openDetail(wrapper: VueWrapper) {
    await wrapper.get('.staff-page__item-trigger').trigger('click')
    await flushPromises()
  }

  it('offers «Este soy yo» for a professional that is not mine and links it by professional id only', async () => {
    linkMyProfessionalMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos Ramírez'),
    })
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    await openDetail(wrapper)

    expect(openDialogElement(wrapper).textContent).toContain('Sin vincular')
    // Sin vínculo todavía no hay acceso a Google Calendar: se explica para qué sirve vincular.
    expect(openDialogElement(wrapper).textContent).toContain('Vincúlate para publicar')
    expect(openDialogElement(wrapper).textContent).not.toContain('Conectar Google Calendar')
    dialogButton(wrapper, 'Este soy yo').click()
    await flushPromises()

    expect(linkMyProfessionalMock).toHaveBeenCalledTimes(1)
    expect(linkMyProfessionalMock).toHaveBeenCalledWith('b-1')
    expect(openDialogElement(wrapper).textContent).toContain('Eres tú')
    expect(dialogButton(wrapper, 'Ya no soy yo')).toBeTruthy()
    // Al vincularse aparece el siguiente paso: ir a conectar Google Calendar.
    expect(openDialogElement(wrapper).textContent).toContain('Conectar Google Calendar')
    expect(toastState.items.some((t) => t.title.includes('Ahora eres Carlos Ramírez'))).toBe(true)
  })

  it('shows «Eres tú» for my professional and «Ya no soy yo» removes the link', async () => {
    fetchMyProfessionalMock.mockResolvedValue({
      kind: 'linked',
      professional: professional('b-1', 'Carlos Ramírez'),
    })
    unlinkMyProfessionalMock.mockResolvedValueOnce({ kind: 'success' })
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    await openDetail(wrapper)

    expect(openDialogElement(wrapper).textContent).toContain('Eres tú')
    dialogButton(wrapper, 'Ya no soy yo').click()
    await flushPromises()

    expect(unlinkMyProfessionalMock).toHaveBeenCalledOnce()
    expect(openDialogElement(wrapper).textContent).toContain('Sin vincular')
    expect(dialogButton(wrapper, 'Este soy yo')).toBeTruthy()
  })

  it('explains a professional that already belongs to another user and keeps the state', async () => {
    linkMyProfessionalMock.mockResolvedValueOnce({ kind: 'taken' })
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    await openDetail(wrapper)

    dialogButton(wrapper, 'Este soy yo').click()
    await flushPromises()

    const dialog = openDialogElement(wrapper)
    expect(dialog.textContent).toContain('ya está vinculado a otro usuario')
    expect(dialog.textContent).toContain('Sin vincular')
    expect(dialogButton(wrapper, 'Este soy yo').disabled).toBe(false)
  })

  it('does not offer the link when the current link could not be read: it says so instead (#843)', async () => {
    fetchMyProfessionalMock.mockResolvedValue({ kind: 'network-error' })
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    await openDetail(wrapper)

    const dialog = openDialogElement(wrapper)
    expect(dialog.textContent).not.toContain('Este soy yo')
    expect(dialog.textContent).not.toContain('Ya no soy yo')
    expect(dialog.textContent).toContain('No pudimos comprobarlo')
  })

  it('when the link cannot be read, the «Tu usuario» line offers Reintentar in place and keeps focus (#843, CA-13)', async () => {
    fetchMyProfessionalMock.mockResolvedValueOnce({ kind: 'network-error' })
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    document.body.appendChild(wrapper.element)
    await openDetail(wrapper)

    const line = openDialogElement(wrapper).querySelector('.staff-page__link')!
    expect(line.textContent).toContain('No pudimos comprobarlo')
    expect(line.hasAttribute('inert')).toBe(false)
    const retry = dialogButton(wrapper, 'Reintentar')
    retry.focus()

    let resolve: (value: unknown) => void = () => {}
    fetchMyProfessionalMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    retry.click()
    await flushPromises()
    const detail = openDialogElement(wrapper).querySelector('.staff-page__detail')
    expect(document.activeElement).toBe(detail)
    expect(openDialogElement(wrapper).querySelector('.staff-page__link--pending')).toBeTruthy()

    resolve({ kind: 'none' })
    await flushPromises()
    expect(dialogButton(wrapper, 'Este soy yo')).toBeTruthy()
    expect(document.activeElement).toBe(detail)
    wrapper.unmount()
  })

  it('keeps the «Tu usuario» line in place, hidden and inert, while the link is still being read (#843)', async () => {
    let resolve: (value: unknown) => void = () => {}
    fetchMyProfessionalMock.mockReturnValue(new Promise((r) => (resolve = r)))
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez')])
    await openDetail(wrapper)

    const pending = openDialogElement(wrapper).querySelector('.staff-page__link')!
    expect(pending.classList.contains('staff-page__link--pending')).toBe(true)
    expect(pending.getAttribute('aria-hidden')).toBe('true')
    expect(pending.hasAttribute('inert')).toBe(true)

    resolve({ kind: 'none' })
    await flushPromises()
    const ready = openDialogElement(wrapper).querySelector('.staff-page__link')!
    expect(ready.classList.contains('staff-page__link--pending')).toBe(false)
    expect(ready.getAttribute('aria-hidden')).toBeNull()
    expect(ready.hasAttribute('inert')).toBe(false)
    expect(dialogButton(wrapper, 'Este soy yo')).toBeTruthy()
  })

  // --- Alta -----------------------------------------------------------

  it('opens the create dialog and blocks submission for an empty name', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    expect(openDialogInput(wrapper)).toBeTruthy()
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(createMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Escribe el nombre del profesional.')
  })

  it('on success, prepends the confirmed professional once and closes the dialog', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Nuevo Barbero')
    await flushPromises()

    createMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-new', 'Nuevo Barbero'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(uploadPhotoMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.staff-page__row').length).toBe(2)
    expect(wrapper.text()).toContain('Nuevo Barbero')
    expect(toastState.items.map((item) => item.title)).toEqual(['Profesional agregado'])
    // La fila recién agregada se ilumina un instante.
    expect(wrapper.get('.staff-page__row--new').text()).toContain('Nuevo Barbero')
    expect(wrapper.find('.base-dialog--open').exists()).toBe(false)
  })

  it('creates the professional and then uploads the chosen photo, showing it in the new row (DEC-104)', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Con Foto')
    const blob = await pickPhoto(wrapper)
    createMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-new', 'Con Foto'),
    })
    uploadPhotoMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-new', 'Con Foto', '2026-09-30T13:00:00Z'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(uploadPhotoMock).toHaveBeenCalledWith('b-new', blob)
    const row = wrapper.findAll('.staff-page__row').find((row) => row.text().includes('Con Foto'))!
    expect(row.get('img.professional-avatar__photo').attributes('src')).toBe(
      '/photo/b-new?v=2026-09-30T13:00:00Z',
    )
    expect(toastState.items.map((item) => item.title)).toEqual(['Profesional agregado'])
  })

  it('keeps the professional and warns when only the photo fails after a successful create', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Foto Fallida')
    await pickPhoto(wrapper)
    createMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-new', 'Foto Fallida'),
    })
    uploadPhotoMock.mockResolvedValueOnce({ kind: 'network-error' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    // El alta ya ocurrió: el profesional está en la lista y el diálogo se cerró.
    expect(wrapper.text()).toContain('Foto Fallida')
    expect(wrapper.find('.base-dialog--open').exists()).toBe(false)
    expect(toastState.items.map((item) => [item.variant, item.title])).toEqual([
      ['warning', 'Profesional agregado, pero no pudimos guardar la foto'],
    ])
  })

  it('sends the same idempotency key across a submit and a network-error retry of the same logical attempt', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Reintentado')
    await flushPromises()

    createMock.mockResolvedValueOnce({ kind: 'network-error' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    createMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-retry', 'Reintentado'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(2)
    const firstKey = createMock.mock.calls[0]![1]
    const secondKey = createMock.mock.calls[1]![1]
    expect(secondKey).toBe(firstKey)
  })

  it('blocks a second submit while the first is still in flight (no double POST)', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Doble Envío')
    await flushPromises()

    let resolveCreate: (value: unknown) => void = () => {}
    createMock.mockReturnValueOnce(new Promise((resolve) => (resolveCreate = resolve)))
    submitOpenDialog(wrapper)
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(createMock).toHaveBeenCalledTimes(1)
    resolveCreate({ kind: 'success', professional: professional('b-x', 'Doble Envío') })
    await flushPromises()
  })

  it('on idempotency-conflict, shows a recoverable message and keeps the typed value and the chosen photo', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    const input = openDialogInput(wrapper)
    setInputValue(input, 'Conflicto')
    await pickPhoto(wrapper)
    await flushPromises()

    createMock.mockResolvedValueOnce({ kind: 'idempotency-conflict' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos completar el intento anterior')
    expect(input.value).toBe('Conflicto')
    expect(openDialogElement(wrapper).querySelector('img.professional-avatar__photo')).toBeTruthy()
    expect(uploadPhotoMock).not.toHaveBeenCalled()
  })

  // F-RQ-PB-01 (#431): un 422 del servidor dejaba el diálogo abierto sin ningún mensaje.
  it('on a server validation-error, says so in the create dialog and keeps what was typed', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    const input = openDialogInput(wrapper)
    setInputValue(input, 'Rechazado')
    await flushPromises()

    createMock.mockResolvedValueOnce({ kind: 'validation-error' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    const alert = openDialogElement(wrapper).querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('No pudimos guardar los datos')
    expect(input.value).toBe('Rechazado')
  })

  it('on a server validation-error, says so in the edit dialog and keeps what was typed', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    const input = openDialogInput(wrapper)
    setInputValue(input, 'Nombre rechazado')
    await flushPromises()

    renameMock.mockResolvedValueOnce({ kind: 'validation-error' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    const alert = openDialogElement(wrapper).querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('No pudimos guardar los datos')
    expect(input.value).toBe('Nombre rechazado')
  })

  it('never shows placeholders for service, schedule, active status, or linked user', async () => {
    const wrapper = await mountReady(fourProfessionals)
    // El nombre del producto («Nava Agenda», DEC-183) no es un marcador de la agenda.
    const text = wrapper.text().toLowerCase().replaceAll('nava agenda', '')
    for (const forbidden of [
      'servicio',
      'horario',
      'disponib',
      'activo',
      'inactivo',
      'usuario vinculado',
      'agenda',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  // --- Edición ----------------------------------------------------------

  it('opens the edit dialog prefilled with the professional name and renames on success', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    const input = openDialogInput(wrapper)
    expect(input.value).toBe('Carlos Ramírez')

    setInputValue(input, 'Carlos A. Ramírez')
    await flushPromises()

    renameMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos A. Ramírez'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(renameMock).toHaveBeenCalledWith('b-1', 'Carlos A. Ramírez', undefined)
    expect(uploadPhotoMock).not.toHaveBeenCalled()
    expect(removePhotoMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.staff-page__row').length).toBe(1)
    expect(wrapper.text()).toContain('Carlos A. Ramírez')
    expect(toastState.items.map((item) => item.title)).toEqual(['Nombre actualizado'])
  })

  // --- Descripción pública (DEC-127) -----------------------------------------

  it('creates a professional with the public description the user wrote', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    expect(openDialogDescription(wrapper).value).toBe('')
    expect(openDialogElement(wrapper).textContent).toContain('Texto público')

    setInputValue(openDialogInput(wrapper), 'Nuevo Barbero')
    setTextareaValue(openDialogDescription(wrapper), 'Fade y barba.')
    await flushPromises()
    expect(openDialogElement(wrapper).textContent).toContain('13 / 280')

    createMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-new', 'Nuevo Barbero', null, 'Fade y barba.'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(createMock).toHaveBeenCalledWith('Nuevo Barbero', expect.any(String), 'Fade y barba.')
  })

  it('rejects a description over 280 characters without calling the API', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Nuevo Barbero')
    setTextareaValue(openDialogDescription(wrapper), 'a'.repeat(281))
    await flushPromises()
    submitOpenDialog(wrapper)
    await flushPromises()

    expect(createMock).not.toHaveBeenCalled()
    expect(openDialogElement(wrapper).querySelector('[role="alert"]')?.textContent).toContain(
      'La descripción no puede superar 280 caracteres.',
    )
    expect(openDialogElement(wrapper).textContent).toContain('281 / 280')

    // Corregir el texto limpia el error al instante (ya se intentó enviar).
    setTextareaValue(openDialogDescription(wrapper), 'a'.repeat(280))
    await flushPromises()
    expect(openDialogElement(wrapper).textContent).not.toContain('no puede superar 280')
  })

  it('prefills the edit dialog with the description and sends only what changed', async () => {
    fetchMock.mockReset()
    const withDescription = [professional('b-1', 'Carlos Ramírez', null, 'Fade y barba.')]
    const wrapper = await mountReady(withDescription)
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    expect(openDialogDescription(wrapper).value).toBe('Fade y barba.')

    // Sin cambios no se envía nada.
    submitOpenDialog(wrapper)
    await flushPromises()
    expect(renameMock).not.toHaveBeenCalled()

    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()
    setTextareaValue(openDialogDescription(wrapper), 'Navaja clásica.')
    renameMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos Ramírez', null, 'Navaja clásica.'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(renameMock).toHaveBeenCalledWith('b-1', 'Carlos Ramírez', 'Navaja clásica.')
    expect(toastState.items.map((item) => item.title)).toEqual(['Descripción actualizada'])
  })

  it('removes the description by clearing the field', async () => {
    fetchMock.mockReset()
    const wrapper = await mountReady([professional('b-1', 'Carlos Ramírez', null, 'Fade y barba.')])
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    setTextareaValue(openDialogDescription(wrapper), '')
    renameMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos Ramírez'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(renameMock).toHaveBeenCalledWith('b-1', 'Carlos Ramírez', '')
  })

  it('replaces the item by id without duplicating or reordering unstably', async () => {
    const wrapper = await mountReady(fourProfessionals)
    const editButtons = wrapper.findAll('button').filter((b) => b.text() === 'Editar')
    await editButtons[2]!.trigger('click') // "Luis Gómez", third item
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Luis A. Gómez')
    renameMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-3', 'Luis A. Gómez'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    const names = wrapper.findAll('.staff-page__item-name').map((n) => n.text())
    expect(names).toEqual(['Carlos Ramírez', 'Ana Torres', 'Luis A. Gómez', 'María Pérez'])
  })

  it('closes without sending anything when nothing changed', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(renameMock).not.toHaveBeenCalled()
    expect(uploadPhotoMock).not.toHaveBeenCalled()
    expect(removePhotoMock).not.toHaveBeenCalled()
    expect(wrapper.find('.base-dialog--open').exists()).toBe(false)
    expect(toastState.items).toEqual([])
  })

  it('uploads a new photo without renaming when only the photo changed', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    const blob = await pickPhoto(wrapper)
    uploadPhotoMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos Ramírez', '2026-09-30T13:00:00Z'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(renameMock).not.toHaveBeenCalled()
    expect(uploadPhotoMock).toHaveBeenCalledWith('b-1', blob)
    expect(wrapper.get('.staff-page__row img.professional-avatar__photo').attributes('src')).toBe(
      '/photo/b-1?v=2026-09-30T13:00:00Z',
    )
    expect(toastState.items.map((item) => item.title)).toEqual(['Foto actualizada'])
  })

  it('removes the photo and shows the monogram again', async () => {
    const wrapper = await mountReady([
      professional('b-1', 'Carlos Ramírez', '2026-09-30T12:00:00Z'),
    ])
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    dialogButton(wrapper, 'Quitar foto').click()
    await flushPromises()
    removePhotoMock.mockResolvedValueOnce({ kind: 'success' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(removePhotoMock).toHaveBeenCalledWith('b-1')
    expect(renameMock).not.toHaveBeenCalled()
    const row = wrapper.get('.staff-page__row')
    expect(row.find('img').exists()).toBe(false)
    expect(row.get('.professional-avatar__monogram').text()).toBe('CR')
    expect(row.text()).toContain('Sin foto')
    expect(toastState.items.map((item) => item.title)).toEqual(['Foto quitada'])
  })

  it('renames and replaces the photo in one save, in that order', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Carlos A. Ramírez')
    await pickPhoto(wrapper)
    const order: string[] = []
    renameMock.mockImplementationOnce(async () => {
      order.push('rename')
      return { kind: 'success', professional: professional('b-1', 'Carlos A. Ramírez') }
    })
    uploadPhotoMock.mockImplementationOnce(async () => {
      order.push('photo')
      return {
        kind: 'success',
        professional: professional('b-1', 'Carlos A. Ramírez', '2026-09-30T13:00:00Z'),
      }
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(order).toEqual(['rename', 'photo'])
    expect(toastState.items.map((item) => item.title)).toEqual(['Profesional actualizado'])
  })

  it('after a partial failure (name saved, photo failed) a retry does not rename again', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Carlos A. Ramírez')
    const blob = await pickPhoto(wrapper)
    renameMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos A. Ramírez'),
    })
    uploadPhotoMock.mockResolvedValueOnce({ kind: 'validation-error' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    // El nombre ya quedó en la lista; la foto se avisa aparte y el diálogo sigue abierto.
    expect(wrapper.findAll('.staff-page__item-name').map((n) => n.text())).toEqual([
      'Carlos A. Ramírez',
    ])
    expect(wrapper.text()).toContain('No pudimos guardar la foto')
    expect(openDialogInput(wrapper).value).toBe('Carlos A. Ramírez')

    uploadPhotoMock.mockResolvedValueOnce({
      kind: 'success',
      professional: professional('b-1', 'Carlos A. Ramírez', '2026-09-30T13:00:00Z'),
    })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(renameMock).toHaveBeenCalledTimes(1)
    expect(uploadPhotoMock).toHaveBeenCalledTimes(2)
    expect(uploadPhotoMock).toHaveBeenLastCalledWith('b-1', blob)
    expect(wrapper.find('.base-dialog--open').exists()).toBe(false)
  })

  it('on a network error while saving the photo, keeps the dialog open with the chosen photo', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    await pickPhoto(wrapper)
    uploadPhotoMock.mockResolvedValueOnce({ kind: 'network-error' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos conectar')
    expect(openDialogElement(wrapper).querySelector('img.professional-avatar__photo')).toBeTruthy()
  })

  it('on not-found, shows a recoverable message', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    setInputValue(openDialogInput(wrapper), 'Otro Nombre')
    renameMock.mockResolvedValueOnce({ kind: 'not-found' })
    submitOpenDialog(wrapper)
    await flushPromises()
    await waitOutMoreHold()
    await flushPromises()

    expect(wrapper.text()).toContain('ya no está disponible')
  })

  // --- Accesibilidad ------------------------------------------------------

  it('has no axe violations in the list view', async () => {
    const wrapper = await mountReady(fourProfessionals)
    const results = await axeWithRealClock(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations in the empty state', async () => {
    const wrapper = await mountReady([])
    const results = await axeWithRealClock(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations with the create dialog open', async () => {
    const wrapper = await mountReady()
    await findButtonByText(wrapper, 'Agregar profesional').trigger('click')
    await flushPromises()

    const results = await axeWithRealClock(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations with the edit dialog open on a professional with a photo', async () => {
    const wrapper = await mountReady([
      professional('b-1', 'Carlos Ramírez', '2026-09-30T12:00:00Z'),
    ])
    await findButtonByText(wrapper, 'Editar').trigger('click')
    await flushPromises()

    const results = await axeWithRealClock(wrapper.element, axeOptions)
    expect(results).toHaveNoViolations()
  })
  describe('perfil de profesional individual (DEC-115)', () => {
    const solo = { ...DEFAULT_BRAND, panelProfile: 'solo' as const }

    it('is the card of the only professional: "Mi perfil", no team controls', async () => {
      setBrand(solo)
      const wrapper = await mountReady()

      expect(wrapper.get('h1').text()).toBe('Mi perfil')
      expect(wrapper.text()).toContain('Carlos Ramírez')
      // Sin «Agregar», encabezados de tabla ni paginador: solo tienen sentido con un equipo.
      expect(wrapper.find('.staff-page__create').exists()).toBe(false)
      expect(wrapper.find('.staff-page__columns').exists()).toBe(false)
      expect(wrapper.find('.staff-page__footer').exists()).toBe(false)
      // Su propia tarjeta, no una fila de tabla sin cabecera (DEC-115).
      expect(wrapper.find('.staff-page__row').exists()).toBe(false)
      expect(wrapper.text()).toContain('En Nava Agenda desde')
      // Lo propio de la persona sigue ahí: editar y la acción de «Bloquear» del slot.
      expect(wrapper.find('button[aria-label="Editar Carlos Ramírez"]').exists()).toBe(true)
    })

    it('still lets the one professional be edited from the card', async () => {
      setBrand(solo)
      const wrapper = await mountReady()

      await wrapper.get('button[aria-label="Editar Carlos Ramírez"]').trigger('click')
      await flushPromises()

      expect(openDialogInput(wrapper).value).toBe('Carlos Ramírez')
    })

    it('asks to create the profile when there is nobody yet', async () => {
      setBrand(solo)
      const wrapper = await mountReady([])

      expect(wrapper.get('h1').text()).toBe('Mi perfil')
      expect(wrapper.text()).toContain('Aún no tienes tu perfil')
      // Una sola acción, en la cabecera, con lo mismo que ofrecía la escena.
      expect(wrapper.get('.staff-page__header .staff-page__create').text()).toBe('Crear mi perfil')
      const empty = wrapper.get('.staff-page__empty')
      expect(empty.findAll('button')).toHaveLength(0)
      expect(empty.text()).toContain('«Crear mi perfil», arriba')
      // El diálogo de alta vive siempre en el DOM; lo que importa es el estado vacío visible.
      expect(empty.text()).not.toContain('Agregar')
    })

    it('goes back to the team screen when there are several professionals', async () => {
      setBrand(solo)
      const wrapper = await mountReady(fourProfessionals)

      expect(wrapper.get('h1').text()).toBe('Profesionales')
      expect(wrapper.find('.staff-page__create').exists()).toBe(true)
      expect(wrapper.find('.staff-page__footer').exists()).toBe(true)
    })

    it('keeps the full panel untouched with one professional', async () => {
      const wrapper = await mountReady()

      expect(wrapper.get('h1').text()).toBe('Profesionales')
      expect(wrapper.find('.staff-page__create').exists()).toBe(true)
      expect(wrapper.find('.staff-page__columns').exists()).toBe(true)
    })

    it('has no axe violations on the card', async () => {
      setBrand(solo)
      const wrapper = await mountReady()

      expect(await axeWithRealClock(wrapper.element.outerHTML, axeOptions)).toHaveNoViolations()
    })
  })

  describe('panel del empleado (DEC-173)', () => {
    const employee = { ...DEFAULT_BRAND, panelProfile: 'employee' as const }

    it('is the card of their own professional, with Google Calendar and without team controls', async () => {
      setBrand(employee)
      fetchMyProfessionalMock.mockResolvedValue({
        kind: 'linked',
        professional: professional('b-1', 'Carlos Ramírez'),
      })
      const wrapper = await mountReady()

      expect(wrapper.get('h1').text()).toBe('Mi perfil')
      expect(wrapper.find('.staff-page__create').exists()).toBe(false)
      expect(wrapper.find('.staff-page__row').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Editar Carlos Ramírez"]').exists()).toBe(true)
      expect(wrapper.get('.staff-page__card-gcal').text()).toContain('Google Calendar')
      // El vínculo lo fija el alta: el empleado no puede cambiarlo (403 en el API).
      expect(wrapper.text()).not.toContain('Este soy yo')
      expect(wrapper.text()).not.toContain('Ya no soy yo')
    })

    it('asks the business to link the account instead of offering to create a profile', async () => {
      setBrand(employee)
      const wrapper = await mountReady([])

      const empty = wrapper.get('.staff-page__empty')
      expect(empty.text()).toContain('Pídele al negocio que vincule tu usuario')
      expect(empty.findAll('button')).toHaveLength(0)
    })

    it('has no axe violations on the card', async () => {
      setBrand(employee)
      const wrapper = await mountReady()

      expect(await axeWithRealClock(wrapper.element.outerHTML, axeOptions)).toHaveNoViolations()
    })
  })
})
