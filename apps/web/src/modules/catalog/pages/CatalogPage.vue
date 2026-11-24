<script setup lang="ts">
// Pantalla "Servicios" (HU-022, HU-024): consultar y listar el catálogo de
// el negocio activo, crear un servicio, editarlo y cambiar su ciclo de
// vida (desactivar/reactivar). Estados discriminados: carga inicial, listo,
// vacío, error recuperable, guardando (mismo patrón que StaffPage.vue). Un
// error recuperable NUNCA borra lo que el profesional ya escribió; solo un
// guardado exitoso confirmado por el servidor cierra el diálogo. Nunca
// muestra asignaciones a profesionales (HU-023), disponibilidad ni citas: fuera
// de alcance de esta historia. Cada cambio confirmado por el servidor añade un
// aviso emergente de confirmación (DEC-095); el resultado persistente sigue
// siendo la propia lista, y los errores siguen dentro del diálogo, junto al
// formulario que conservan.
import { computed, onMounted, onUnmounted, ref, useSlots, watch } from 'vue'
import { PAGE_MIN_HOLD_MS, useMinHoldLoading, useToast, useVocabulary } from '@/shared/composables'
import {
  BaseAlert,
  BaseBadge,
  BaseButton,
  BaseDialog,
  BaseInput,
  BasePagination,
  BrassMonogram,
  DialogSeal,
  DiamondLoader,
  EmptyScene,
  ContentReveal,
} from '@/shared/ui'
import {
  createService,
  deactivateService,
  fetchServices,
  previewDeactivation,
  reactivateService,
  updateService,
  type ServiceInput,
} from '../api/catalogApi'
import { formatMoney, moneyParts } from '@/shared/model/money'
import { newIdempotencyKey } from '../model/idempotencyKey'
import type { Service } from '../model/service'
import {
  validateDescription,
  validateDurationMinutes,
  validateName,
  validatePrice,
} from '../validation/catalogValidation'

const toast = useToast()

// Columna opcional «Lo ofrezco» (DEC-115): `app` la aporta con el slot
// `service-offer` solo en el perfil de profesional individual. Sin el slot la tabla
// conserva exactamente su geometría de siempre. Este módulo no sabe qué hay
// dentro ni importa `professionalServices`: solo le reserva el hueco.
// Se lee en cada render y NO en un `computed`: los slots no son reactivos, y el
// interruptor puede llegar después de montar (cuando termina de cargar qué ofrece).
const slots = useSlots()
const hasOfferColumn = () => !!slots['service-offer']

// Un servicio recién creado se anuncia hacia afuera para que `app` pueda,
// por ejemplo, ofrecérselo al único profesional sin que este módulo lo sepa.
const emit = defineEmits<{ 'service-created': [service: Service] }>()
// Palabras del negocio (DEC-110): con los valores iniciales, el texto de siempre.
const v = useVocabulary()

type LoadStatus = 'loading' | 'ready' | 'load-error'
type SaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'name-conflict'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'

interface FormFieldErrors {
  name?: string
  description?: string
  durationMinutes?: string
  price?: string
}

function hasFieldError(errors: FormFieldErrors): boolean {
  return !!(errors.name || errors.description || errors.durationMinutes || errors.price)
}

const loadStatus = ref<LoadStatus>('loading')
const services = ref<Service[]>([])

// effectivePageSize sustituye a un PAGE_SIZE fijo (issue reportado
// 2026-09-28, primero "colócalos en una tabla con paginador y con su
// buscador... así con scroll infinito está feo", luego "que se adapte
// según la pantalla, que no haya scroll"): cuántas filas se piden por
// página ya no es un número fijo, se calcula para llenar exactamente el
// espacio vertical disponible dentro de .private-shell__content (el único
// contenedor con scroll propio del cascarón, PrivateShell.vue) — ni una
// fila de más (que forzaría scroll) ni de menos (que dejaría hueco vacío
// evitable). DEFAULT_PAGE_SIZE solo cubre la primera carga, antes de poder
// medir la pantalla real (ver computeFittingPageSize/adjustPageSizeToFit
// más abajo); coincide con el valor por defecto del backend
// (catalog.DefaultPageSize) para que ese primer pedido nunca dispare un
// clamping silencioso.
const DEFAULT_PAGE_SIZE = 20
const effectivePageSize = ref(DEFAULT_PAGE_SIZE)

// DYNAMIC_MIN_PAGE_SIZE = 1 (issue reportado 2026-09-28, "que se adapte
// según la pantalla, que no haya scroll"): "que no haya scroll" pesa más
// que "mostrar muchas filas" — en una ventana muy baja, es preferible una
// tabla de una sola fila por página a que reaparezca scroll. MAX_PAGE_SIZE
// coincide con el techo real del backend (catalog.MaxPageSize, DEC-103):
// pedir más no cambiaría nada.
const DYNAMIC_MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 50

// ROW_HEIGHT_*_PX debe coincidir EXACTAMENTE con el alto FIJO (no
// min-height) que .catalog-page__row impone por CSS más abajo: con un alto
// variable no habría forma de predecir cuántas filas caben en el espacio
// disponible, y volvería a aparecer scroll.
const ROW_HEIGHT_DESKTOP_PX = 80
const ROW_HEIGHT_MOBILE_PX = 116
const MOBILE_BREAKPOINT_QUERY = '(max-width: 640px)'
// Pantallas bajas de escritorio/tableta: filas de 64px y cabecera más
// compacta (ver la media query del mismo nombre en <style>) para que quepan
// más filas sin scroll.
const ROW_HEIGHT_COMPACT_PX = 64
const COMPACT_QUERY = '(min-width: 641px) and (max-height: 820px)'

// typeof matchMedia === 'function': jsdom (CatalogPage.test.ts) no la
// implementa (issue detectado al verificar en vivo: un rechazo de promesa
// sin capturar por cada prueba, "window.matchMedia is not a function").
// Ningún navegador real carece de esta API; el resguardo es solo para ese
// entorno de pruebas, con el mismo resultado que ya asumía antes de que
// existiera este cálculo (ancho de escritorio).
function currentRowHeightPx(list: HTMLElement, scale: number): number {
  // El alto real de una fila ya pintada manda: refleja cualquier media query
  // sin que estas constantes tengan que adivinarlo. Las constantes (en px de
  // CSS, de ahí `scale`) solo cubren la primera medición sin filas y jsdom.
  const measured = list.querySelector('.catalog-page__row')?.getBoundingClientRect().height ?? 0
  if (measured > 0) return measured
  if (typeof window.matchMedia !== 'function') return ROW_HEIGHT_DESKTOP_PX * scale
  if (window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches) return ROW_HEIGHT_MOBILE_PX * scale
  return (
    (window.matchMedia(COMPACT_QUERY).matches ? ROW_HEIGHT_COMPACT_PX : ROW_HEIGHT_DESKTOP_PX) *
    scale
  )
}

// tableListRef/paginationFooterRef anclan la fila real de datos y el pie
// de paginador (ver plantilla): computeFittingPageSize mide sus posiciones
// reales en pantalla, nunca asume un valor fijo para nada de lo que las
// rodea (encabezado, buscador, encabezado de columnas, hueco entre tabla y
// paginador), que puede cambiar de alto sin que esta función se entere.
const tableListRef = ref<HTMLElement | null>(null)
const paginationFooterRef = ref<HTMLElement | null>(null)

// findScrollableAncestor sube por el árbol real del DOM hasta el primer
// ancestro que el CSS marca como scrolleable (overflow-y auto/scroll) —
// nunca se acopla al nombre de clase de PrivateShell.vue (otro componente,
// otro módulo): a esta pantalla solo le importa "¿cuál es mi visor con
// scroll propio?", no cómo se llama. Se basa en la propiedad CSS
// declarada, no en si HAY overflow ahora mismo: una vez que el ajuste
// funcione y ya no sobre contenido, `scrollHeight > clientHeight` dejaría
// de ser cierto y ese criterio rompería los cálculos futuros (un resize
// que agranda la ventana, por ejemplo).
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

// computeFittingPageSize calcula cuántas filas caben SIN que
// .private-shell__content necesite scroll. Fuerza scrollTop a 0 antes de
// medir: la posición real de tableListRef en el viewport depende de cuánto
// esté desplazado su contenedor, y esta pantalla quiere calcular para la
// posición de reposo (sin desplazar), que es además el estado al que
// aspira a volver.
// PAGE_BOTTOM_PADDING_PX debe coincidir con el padding-bottom real de
// .catalog-page (ver <style scoped>, "padding: 34px 32px 48px"). NO se
// puede medir en vivo como gapBelowList (abajo): .catalog-page tiene
// min-height: 100%, así que con pocas filas su borde inferior se estira
// hasta el final de .private-shell__content sin importar cuánto padding
// real tenga — medir "borde de .catalog-page menos borde del paginador" en
// ese caso da todo el hueco vacío estirado, no el padding, y hace que el
// cálculo se autodestruya (encontrado en vivo: en una pantalla baja, un
// hueco enorme se confundía con "padding", y el resultado subestimaba
// muchísimo cuántas filas caben).
const PAGE_BOTTOM_PADDING_PX = 48

function computeFittingPageSize(): number | null {
  const list = tableListRef.value
  const pagination = paginationFooterRef.value
  if (!list || !pagination) return null

  // Sin un ancestro con scroll propio no hay un viewport real contra el
  // cual ajustar nada (mismo caso, deliberado, de CatalogPage.test.ts: ahí
  // este componente se monta SOLO, sin el PrivateShell real que en la app
  // siempre lo envuelve) — caer a window.innerHeight como aproximación
  // sería adivinar un límite que no existe, no medir uno real.
  const scrollParent = findScrollableAncestor(list)
  if (!scrollParent) return null
  scrollParent.scrollTop = 0

  // Todo se mide en px de pantalla (getBoundingClientRect), no mezclando
  // clientHeight (px de CSS) con rects: con una escala de interfaz distinta
  // de 1 (zoom del documento) las dos unidades difieren y el cálculo
  // subestimaba las filas que caben. `scale` convierte los px de CSS fijos.
  const scrollRect = scrollParent.getBoundingClientRect()
  const viewportHeight = scrollRect.height
  const containerTop = scrollRect.top
  const scale =
    scrollParent.clientHeight > 0 && viewportHeight > 0
      ? viewportHeight / scrollParent.clientHeight
      : 1

  const listRect = list.getBoundingClientRect()
  const paginationRect = pagination.getBoundingClientRect()

  // gapBelowList (el hueco real entre el final de la lista y el inicio del
  // paginador) SÍ se mide en vivo, sin problema: es un gap entre dos
  // hermanos flex (.catalog-page__ready), no depende del min-height:100%
  // de un ancestro.
  const gapBelowList = paginationRect.top - listRect.bottom

  const available =
    viewportHeight -
    (listRect.top - containerTop) -
    gapBelowList -
    paginationRect.height -
    PAGE_BOTTOM_PADDING_PX * scale
  const rows = Math.floor(available / currentRowHeightPx(list, scale))

  return Math.min(Math.max(rows, DYNAMIC_MIN_PAGE_SIZE), MAX_PAGE_SIZE)
}

const currentPage = ref(1)
const totalItems = ref(0)
const totalPages = ref(1)
// searchTerm es lo que el profesional está escribiendo AHORA MISMO (v-model del
// campo); activeSearch es el término ya aplicado a la última carga, tras el
// debounce. Ambos difieren mientras la persona sigue escribiendo — solo
// activeSearch decide qué copy de "vacío" mostrar y qué parámetro viaja al
// backend.
const searchTerm = ref('')
const activeSearch = ref('')
// El término al que pertenece `totalItems`: cambia solo cuando llega la respuesta. Con la
// respuesta en vuelo `activeSearch` ya es el nuevo, y el pie anunciaba el total viejo para él
// («25 resultados para «c02»», HALL-RQ-CAT-02).
const loadedSearch = ref('')
// pageStatus cubre la carga de una página YA EN PANTALLA (cambiar de
// página o escribir en el buscador): a diferencia de loadStatus (carga
// inicial, con esqueleto de página completa), esto NUNCA reemplaza la tabla
// visible — solo la atenúa (ver :class en la plantilla) mientras llega la
// respuesta, para que teclear en el buscador no "parpadee" toda la pantalla
// en cada pulsación. Lo que cambia es el CUERPO de la tabla: sus filas se
// cambian por esqueletos (skeletonRowCount) hasta que llega el resultado.
const pageStatus = ref<'idle' | 'loading' | 'error'>('idle')

const isSearching = computed(() => activeSearch.value !== '')

// Cuántos esqueletos ocupan el lugar de las filas mientras carga una
// página/búsqueda: las mismas que había en pantalla, para que la tabla no
// cambie de alto (y el paginador no salte) al llegar el resultado; 3 si
// venía de una búsqueda sin coincidencias, que no tenía filas que igualar.
const skeletonRowCount = computed(() => Math.max(services.value.length, 3))

// resultsLabel acompaña al paginador con el dato real que un paginador
// numerado necesita para tener sentido (issue 2026-09-28, "con su
// buscador"): confirma cuántos coincidieron, no solo cuántas páginas hay.
const resultsLabel = computed(() => {
  const n = totalItems.value
  if (loadedSearch.value !== '') {
    return `${n} ${n === 1 ? 'resultado' : 'resultados'} para «${loadedSearch.value}»`
  }
  return `${n} ${n === 1 ? 'servicio' : 'servicios'}`
})

// useMinHoldLoading (issue reportado 2026-09-28: primero "espasmo cuando
// se cambia de pantallas", luego "se ve como se genera el objeto... quiero
// el tema de la carga para tapar ese evento"): el cargador/esqueleto se
// muestra DE INMEDIATO (nunca una pantalla en blanco que deje ver el
// contenido armándose), pero no se le permite ceder el paso al contenido
// real hasta que pasen al menos 400ms desde que empezó — así una carga
// rápida no lo retira a medio parpadeo. Solo protege la carga INICIAL
// (loadStatus); cambiar de página o buscar usa pageStatus, sin esqueleto.
const { start: startLoadingHold, hold: holdLoadingReveal } = useMinHoldLoading()

// PAGE_MIN_HOLD_MS (issue reportado 2026-09-29, "que al buscar un servicio
// se haga una animación y no que muestre el resultado, ya que se ve feo"):
// buscar o cambiar de página ya no intercambia las filas de golpe. Mientras
// llega la respuesta las filas se sustituyen por esqueletos con pulso, y el
// resultado entra escalonado. Este segundo hold evita que una respuesta
// inmediata deje el esqueleto en pantalla apenas un fotograma (un parpadeo
// peor que el corte original); es más corto que el de la carga inicial
// porque la persona ya está dentro de la pantalla y espera algo ágil.
const { start: startPageHold, hold: holdPageReveal } = useMinHoldLoading(PAGE_MIN_HOLD_MS)

// requestToken evita que una carga obsoleta (una página o búsqueda vieja
// que sigue en vuelo) sobreescriba la lista con datos que ya no corresponden
// a la página/búsqueda vigente (mismo patrón que StaffPage.vue, ahora
// también cubre cambiar de página o escribir rápido en el buscador).
let requestToken = 0
// lastRequestedPage es la página que "Reintentar" repite: la inicial
// (loadStatus) siempre es 1, pero un fallo de pageStatus debe reintentar la
// MISMA página que falló, no volver a la primera.
let lastRequestedPage = 1
// Cuando el primer ajuste tiene que volver a pedir la página con otro tamaño,
// el esqueleto sigue encima hasta que esa segunda carga se revela, no solo
// hasta que se pide (#817): si no, se destaparía la lista a medio cambiar.
let revealEndsFit = false

async function load(page: number) {
  const token = ++requestToken
  lastRequestedPage = page
  const isInitialLoad = loadStatus.value !== 'ready'

  if (isInitialLoad) {
    loadStatus.value = 'loading'
    startLoadingHold()
  } else {
    pageStatus.value = 'loading'
    startPageHold()
  }

  const requestedSearch = activeSearch.value
  const outcome = await fetchServices({
    page,
    pageSize: effectivePageSize.value,
    search: requestedSearch || undefined,
  })
  if (token !== requestToken) return

  const apply = () => {
    if (revealEndsFit) {
      revealEndsFit = false
      fitPending.value = false
    }
    if (outcome.kind === 'success') {
      services.value = outcome.page.items
      currentPage.value = outcome.page.page
      // effectivePageSize refleja lo que el SERVIDOR confirma haber usado
      // (ya clamped ahí también, DEC-103), no solo lo que este cliente
      // pidió: cualquier cálculo posterior de "cuántas filas caben" compara
      // contra la verdad ya confirmada.
      effectivePageSize.value = outcome.page.pageSize
      totalItems.value = outcome.page.total
      loadedSearch.value = requestedSearch
      totalPages.value = outcome.page.totalPages
      loadStatus.value = 'ready'
      pageStatus.value = 'idle'
      // Sin filas no hay lista que medir (tableListRef nunca se monta): se
      // muestra el aviso de vacío directamente.
      if (outcome.page.items.length === 0) fitPending.value = false
      return
    }
    if (isInitialLoad) {
      loadStatus.value = 'load-error'
    } else {
      pageStatus.value = 'error'
    }
  }

  if (isInitialLoad) {
    holdLoadingReveal(apply)
  } else {
    holdPageReveal(apply)
  }
}

// adjustPageSizeToFit mide la pantalla real DESPUÉS de que la tabla ya
// está en el DOM (issue 2026-09-28, "que se adapte según la pantalla, que
// no haya scroll") y, si el resultado difiere de effectivePageSize, vuelve
// a pedir la página que contiene el mismo primer elemento que se veía antes
// del cambio — no simplemente "vuelve a la página 1" en cada resize, que
// sería desorientador si la persona ya había avanzado varias páginas.
async function adjustPageSizeToFit() {
  if (pageStatus.value === 'loading' || loadStatus.value !== 'ready') return
  const fitting = computeFittingPageSize()
  if (fitting === null || fitting === effectivePageSize.value) return

  const firstItemOffset = (currentPage.value - 1) * effectivePageSize.value
  effectivePageSize.value = fitting
  await load(Math.floor(firstItemOffset / fitting) + 1)
}

let resizeDebounceTimer: ReturnType<typeof setTimeout> | undefined

function onWindowResize() {
  if (resizeDebounceTimer !== undefined) clearTimeout(resizeDebounceTimer)
  resizeDebounceTimer = setTimeout(() => void adjustPageSizeToFit(), 150)
}

// El primer ajuste NO puede encadenarse tras `await load(1)` en onMounted
// ni reaccionar directamente a loadStatus (dos intentos descartados al
// verificar en vivo, issue 2026-09-28):
//   1. holdLoadingReveal (useMinHoldLoading) programa `apply` -el callback
//      que de verdad pone loadStatus en 'ready' y monta la tabla real- con
//      un setTimeout PROPIO que `load()` nunca espera: `await load(1)`
//      podía resolver mientras el DOM seguía mostrando el esqueleto.
//   2. Incluso reaccionando a loadStatus con flush: 'post', el <Transition
//      mode="out-in"> que había entonces reproducía primero la salida de la
//      rama anterior antes de montar la nueva. ContentReveal (#817) ya monta
//      la tabla al instante, pero `<ul>` puede no existir aún (catálogo
//      vacío): el ref sigue siendo la señal exacta.
// Reaccionar directamente a tableListRef (el propio ref de plantilla) es lo
// único que refleja el momento real en que Vue insertó ese nodo: por eso
// se dispara ahí, no antes. hasPerformedInitialFit evita repetir el ajuste
// cada vez que una búsqueda hace que la lista se desmonte y remonte (0
// resultados y de vuelta) — el resize sigue siendo el único disparador
// después del primer ajuste real.
let hasPerformedInitialFit = false

// fitPending mantiene la tabla real invisible (opacity, sin quitarla del
// layout: hace falta medirla) hasta que el primer ajuste termina (issue
// reportado 2026-09-30, "al cargar la tabla se expande todo feo y después
// vuelve a su estado natural antes de mostrar los servicios"): la primera
// carga pide DEFAULT_PAGE_SIZE filas, que casi nunca caben, y mostrarlas
// para luego re-pedir la página con el tamaño medido dejaba ver la tabla
// creciendo, esqueletos de la misma altura y por fin el encogimiento.
const fitPending = ref(true)

// El esqueleto tapa la lista hasta que la carga terminó Y el primer ajuste de
// filas la midió (#817): destaparla antes dejaría ver cómo encoge.
const coverLoading = computed(
  () => loadStatus.value === 'loading' || (loadStatus.value === 'ready' && fitPending.value),
)

// fitInitialPage resuelve ese primer ajuste SIN volver al servidor cuando
// puede: la página 1 con `fitting` filas son justo las primeras `fitting` de
// la página 1 ya descargada, así que basta recortarlas y recalcular
// totalPages. Solo si hacen falta más filas de las descargadas (pantalla muy
// alta y aún hay servicios sin traer) se cae al ajuste normal con re-pedido;
// entonces el ajuste lo termina la revelación de esa carga (`revealEndsFit`).
async function fitInitialPage() {
  const fitting = computeFittingPageSize()
  if (fitting === null || fitting === effectivePageSize.value) return

  if (fitting <= services.value.length || services.value.length >= totalItems.value) {
    services.value = services.value.slice(0, fitting)
    effectivePageSize.value = fitting
    totalPages.value = Math.max(1, Math.ceil(totalItems.value / fitting))
    return
  }
  const before = requestToken
  revealEndsFit = true
  await adjustPageSizeToFit()
  // Sin carga nueva no hay revelación que espere.
  if (requestToken === before) revealEndsFit = false
}

watch(tableListRef, async (el) => {
  if (!el || hasPerformedInitialFit) return
  hasPerformedInitialFit = true
  await fitInitialPage()
  if (!revealEndsFit) fitPending.value = false
})

onMounted(() => {
  void load(1)
  window.addEventListener('resize', onWindowResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  if (resizeDebounceTimer !== undefined) clearTimeout(resizeDebounceTimer)
})

function onRetryLoad() {
  void load(lastRequestedPage)
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) return
  if (pageStatus.value === 'loading') return
  void load(page)
}

// SEARCH_DEBOUNCE_MS: teclear no dispara una solicitud por pulsación — solo
// cuando la persona deja de escribir este tiempo (patrón estándar de
// buscador en vivo, ningún botón "Buscar" separado, igual que el mockup
// aprobado). requestToken (arriba) descarta la respuesta de un término ya
// obsoleto si dos búsquedas quedan en vuelo a la vez.
const SEARCH_DEBOUNCE_MS = 300
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined

function onSearchInput(value: string | number) {
  searchTerm.value = String(value)
  if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    const trimmed = searchTerm.value.trim()
    if (trimmed === activeSearch.value) return
    activeSearch.value = trimmed
    void load(1)
  }, SEARCH_DEBOUNCE_MS)
}

onUnmounted(() => {
  if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer)
})

// «$ 22.000» y no «22000.00 COP» (revisión de #720): formatMoney toma el
// símbolo de la moneda REAL del contrato vía Intl (estandar-diseno-visual.md
// §10.3: no se concatena '$' ni se asumen pesos) y agrupa el decimal exacto
// sin pasarlo nunca por `number` (estandar-openapi.md §6), igual que
// AppointmentDetailPage.vue.
function formatPrice(service: Service): string {
  return formatMoney(service.price, service.currency)
}

// Monograma de la fila: primera letra del nombre, igual criterio que
// `initials()` en StaffPage.vue, pero de una sola letra (un servicio no
// tiene "nombre y apellido" que abreviar en dos). `name` es obligatorio y no
// vacío (validateName), así que siempre hay una letra real que mostrar.
function serviceInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

// --- Detalle --------------------------------------------------------------

// detailTarget no se borra al cerrar: el diálogo sigue visible mientras dura
// su animación de salida y vaciarlo aquí lo dejaría en blanco a media salida.
const isDetailOpen = ref(false)
const detailTarget = ref<Service | null>(null)

function openDetailDialog(service: Service) {
  detailTarget.value = service
  isDetailOpen.value = true
}

function onDetailEdit() {
  const service = detailTarget.value
  if (!service) return
  isDetailOpen.value = false
  openEditDialog(service)
}

// --- Alta -----------------------------------------------------------------

const isCreateOpen = ref(false)
const createForm = ref<ServiceInput>({ name: '', description: '', durationMinutes: 30, price: '' })
const createDurationRaw = ref('30')
const createFieldErrors = ref<FormFieldErrors>({})
const createStatus = ref<SaveStatus>('idle')
const createAttempted = ref(false)
// Clave de idempotencia del intento lógico vigente (RN-IDE-01): se genera
// al abrir el diálogo y se REUTILIZA en cada reintento del mismo intento;
// solo un envío exitoso o cerrar y reabrir el diálogo la renueva (mismo
// intento lógico != mismo clic).
let createIdempotencyKey = newIdempotencyKey()

function openCreateDialog() {
  createForm.value = { name: '', description: '', durationMinutes: 30, price: '' }
  createDurationRaw.value = '30'
  createFieldErrors.value = {}
  createStatus.value = 'idle'
  createAttempted.value = false
  createIdempotencyKey = newIdempotencyKey()
  isCreateOpen.value = true
}

function onCreateDialogClosed() {
  createStatus.value = 'idle'
}

function validateCreateFields(): FormFieldErrors {
  return {
    name: validateName(createForm.value.name),
    description: validateDescription(createForm.value.description),
    durationMinutes: validateDurationMinutes(createDurationRaw.value),
    price: validatePrice(createForm.value.price),
  }
}

function revalidateCreateIfAttempted() {
  if (createAttempted.value) createFieldErrors.value = validateCreateFields()
}

function onCreateNameInput(value: string | number) {
  createForm.value.name = String(value)
  revalidateCreateIfAttempted()
}

function onCreateDescriptionInput(value: string | number) {
  createForm.value.description = String(value)
  revalidateCreateIfAttempted()
}

// BaseInput type="number" ya descarta todo lo que no sea dígito (sin signo
// ni letras); validateDurationMinutes sigue validando el rango al enviar.
function onCreateDurationInput(value: string | number) {
  createDurationRaw.value = String(value)
  revalidateCreateIfAttempted()
}

function onCreatePriceInput(value: string | number) {
  createForm.value.price = String(value)
  revalidateCreateIfAttempted()
}

async function onSubmitCreate() {
  if (createStatus.value === 'saving') return

  createAttempted.value = true
  const errors = validateCreateFields()
  createFieldErrors.value = errors
  if (hasFieldError(errors)) return

  createStatus.value = 'saving'
  const outcome = await createService(
    {
      name: createForm.value.name.trim(),
      description: createForm.value.description,
      durationMinutes: Number(createDurationRaw.value.trim()),
      price: createForm.value.price.trim(),
    },
    createIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      isCreateOpen.value = false
      createStatus.value = 'idle'
      // El servidor es quien ordena (created_at) y cuenta (DEC-103): insertar la fila a mano
      // dejaba más filas que pageSize y un pie «N servicios · Página X de Y» obsoleto (HALL-CAT-03).
      void load(currentPage.value)
      emit('service-created', outcome.service)
      toast.success('Servicio creado', {
        detail: `«${outcome.service.name}» ya aparece en tu catálogo.`,
      })
      return
    case 'validation-error':
      createStatus.value = 'validation-error'
      return
    case 'name-conflict':
      createStatus.value = 'name-conflict'
      return
    case 'idempotency-conflict':
      createStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      createStatus.value = 'network-error'
      return
    case 'unexpected-error':
      createStatus.value = 'unexpected-error'
  }
}

// --- Edición ----------------------------------------------------------

const isEditOpen = ref(false)
const editTarget = ref<Service | null>(null)
const editForm = ref<ServiceInput>({ name: '', description: '', durationMinutes: 30, price: '' })
const editDurationRaw = ref('30')
const editFieldErrors = ref<FormFieldErrors>({})
const editStatus = ref<SaveStatus>('idle')
const editAttempted = ref(false)

// HU-029 (DEC-004): si el precio cambia y el servicio tiene turnos futuros, el profesional
// elige si el precio nuevo también se aplica a esos turnos. Desmarcada por defecto: los
// turnos conservan el precio con el que se agendaron (RN-SER-04). `null` = aún no se sabe
// cuántos son (cargando o falló la consulta): la casilla se ofrece igual, sin el número.
const editApplyToUpcoming = ref(false)
const editUpcomingCount = ref<number | null>(null)
let editImpactSeq = 0

const editPriceChanged = computed(() => {
  if (!editTarget.value) return false
  const next = Number(editForm.value.price.trim())
  return (
    editForm.value.price.trim() !== '' &&
    Number.isFinite(next) &&
    next !== Number(editTarget.value.price)
  )
})
const showApplyToUpcoming = computed(
  () => editPriceChanged.value && (editUpcomingCount.value === null || editUpcomingCount.value > 0),
)

async function loadUpcomingCount(serviceId: string) {
  const seq = ++editImpactSeq
  const outcome = await previewDeactivation(serviceId)
  // Una respuesta de un diálogo anterior no pisa la del servicio que se edita ahora.
  if (seq !== editImpactSeq) return
  editUpcomingCount.value = outcome.kind === 'success' ? outcome.affectedAppointments : null
}

function openEditDialog(service: Service) {
  editTarget.value = service
  editApplyToUpcoming.value = false
  editUpcomingCount.value = null
  void loadUpcomingCount(service.id)
  editForm.value = {
    name: service.name,
    description: service.description ?? '',
    durationMinutes: service.durationMinutes,
    price: service.price,
  }
  editDurationRaw.value = String(service.durationMinutes)
  editFieldErrors.value = {}
  editStatus.value = 'idle'
  editAttempted.value = false
  isEditOpen.value = true
}

function onEditDialogClosed() {
  editStatus.value = 'idle'
}

function validateEditFields(): FormFieldErrors {
  return {
    name: validateName(editForm.value.name),
    description: validateDescription(editForm.value.description),
    durationMinutes: validateDurationMinutes(editDurationRaw.value),
    price: validatePrice(editForm.value.price),
  }
}

function revalidateEditIfAttempted() {
  if (editAttempted.value) editFieldErrors.value = validateEditFields()
}

function onEditNameInput(value: string | number) {
  editForm.value.name = String(value)
  revalidateEditIfAttempted()
}

function onEditDescriptionInput(value: string | number) {
  editForm.value.description = String(value)
  revalidateEditIfAttempted()
}

function onEditDurationInput(value: string | number) {
  editDurationRaw.value = String(value)
  revalidateEditIfAttempted()
}

function onEditPriceInput(value: string | number) {
  editForm.value.price = String(value)
  revalidateEditIfAttempted()
}

async function onSubmitEdit() {
  if (editStatus.value === 'saving' || !editTarget.value) return

  editAttempted.value = true
  const errors = validateEditFields()
  editFieldErrors.value = errors
  if (hasFieldError(errors)) return

  editStatus.value = 'saving'
  const outcome = await updateService(
    editTarget.value.id,
    {
      name: editForm.value.name.trim(),
      description: editForm.value.description,
      durationMinutes: Number(editDurationRaw.value.trim()),
      price: editForm.value.price.trim(),
    },
    showApplyToUpcoming.value && editApplyToUpcoming.value,
  )

  switch (outcome.kind) {
    case 'success': {
      // Reemplaza por id sin duplicar ni reordenar de forma inestable:
      // solo cambian los campos editados y updatedAt del elemento
      // existente, en su misma posición.
      const index = services.value.findIndex((s) => s.id === outcome.service.id)
      if (index !== -1) services.value[index] = outcome.service
      isEditOpen.value = false
      editStatus.value = 'idle'
      toast.success('Servicio actualizado', {
        detail:
          outcome.upcomingAppointmentsUpdated > 0
            ? `Guardamos los cambios de «${outcome.service.name}» y el precio nuevo en ${outcome.upcomingAppointmentsUpdated} ${outcome.upcomingAppointmentsUpdated === 1 ? 'turno' : 'turnos'} futuros.`
            : `Guardamos los cambios de «${outcome.service.name}».`,
      })
      return
    }
    case 'validation-error':
      editStatus.value = 'validation-error'
      return
    case 'name-conflict':
      editStatus.value = 'name-conflict'
      return
    case 'not-found':
      editStatus.value = 'not-found'
      return
    case 'network-error':
      editStatus.value = 'network-error'
      return
    case 'unexpected-error':
      editStatus.value = 'unexpected-error'
  }
}

// --- HU-024: desactivar/reactivar ------------------------------------------

type ImpactStatus = 'loading' | 'ready' | 'error'
type LifecycleStatus =
  | 'idle'
  | 'saving'
  | 'transition-conflict'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'

const lifecycleTarget = ref<Service | null>(null)
const lifecycleIntent = ref<'deactivate' | 'reactivate' | null>(null)
const isLifecycleOpen = ref(false)
const lifecycleStatus = ref<LifecycleStatus>('idle')
const impactStatus = ref<ImpactStatus>('loading')
const affectedAppointments = ref(0)
// Una clave por intento lógico (RN-IDE-01), igual disciplina que
// createIdempotencyKey: se genera al abrir el diálogo y se REUTILIZA en
// cada reintento del mismo intento (network-error/unexpected-error);
// confirmar con éxito o cerrar el diálogo exige abrirlo de nuevo para
// obtener una clave nueva.
let lifecycleIdempotencyKey = newIdempotencyKey()

async function openDeactivateDialog(service: Service) {
  lifecycleTarget.value = service
  lifecycleIntent.value = 'deactivate'
  lifecycleStatus.value = 'idle'
  lifecycleIdempotencyKey = newIdempotencyKey()
  isLifecycleOpen.value = true
  await loadDeactivationImpact(service)
}

// CA-024-01: la advertencia solo muestra impacto respaldado por el
// servidor, nunca un valor por defecto asumido en el cliente. Se reutiliza al
// volver a "desactivar" dentro del mismo diálogo tras una reactivación.
async function loadDeactivationImpact(service: Service) {
  impactStatus.value = 'loading'
  affectedAppointments.value = 0

  const outcome = await previewDeactivation(service.id)
  if (lifecycleIntent.value !== 'deactivate' || lifecycleTarget.value?.id !== service.id) return

  if (outcome.kind === 'success') {
    affectedAppointments.value = outcome.affectedAppointments
    impactStatus.value = 'ready'
    return
  }
  if (outcome.kind === 'not-found') {
    lifecycleStatus.value = 'not-found'
    impactStatus.value = 'error'
    return
  }
  impactStatus.value = 'error'
}

// Un cambio confirmado NO cierra el diálogo (issue 2026-09-29, "si cambio de
// estado no significa que cierre la ventana... hasta que le dé a salir"): el
// diálogo pasa a mostrar el estado nuevo con el interruptor ya en su sitio,
// listo para revertirlo. Cada cambio es un intento lógico distinto, así que
// lleva su propia clave de idempotencia (RN-IDE-01).
function settleLifecycleAfterChange(updated: Service) {
  lifecycleTarget.value = updated
  lifecycleStatus.value = 'idle'
  lifecycleIdempotencyKey = newIdempotencyKey()
  if (updated.isActive) {
    lifecycleIntent.value = 'deactivate'
    void loadDeactivationImpact(updated)
  } else {
    lifecycleIntent.value = 'reactivate'
    impactStatus.value = 'ready'
  }
}

function openLifecycleDialog(service: Service) {
  if (service.isActive) void openDeactivateDialog(service)
  else openReactivateDialog(service)
}

function openReactivateDialog(service: Service) {
  lifecycleTarget.value = service
  lifecycleIntent.value = 'reactivate'
  lifecycleStatus.value = 'idle'
  impactStatus.value = 'ready'
  lifecycleIdempotencyKey = newIdempotencyKey()
  isLifecycleOpen.value = true
}

// Fechas del detalle y de "Inactivo desde…" del diálogo de reactivación. Zona
// fija de la moneda del contrato (COP, DEC-067) para que la fecha no dependa
// del huso del equipo.
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(date)
}

const deactivatedSince = computed(() => formatDate(lifecycleTarget.value?.deactivatedAt))

// Fecha del detalle en palabras («15 de noviembre de 2026»): en la cabecera se
// lee mejor que la forma numérica que usan los mensajes de estado.
function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(date)
}

// Precio del detalle descompuesto para la ficha (símbolo, cifra agrupada y
// código), sin convertir el decimal del contrato a número.
const detailPrice = computed(() =>
  detailTarget.value ? moneyParts(detailTarget.value.price, detailTarget.value.currency) : null,
)

// Posición del interruptor: refleja el estado actual y salta al destino en
// cuanto se pide el cambio (durante "saving"); si el servidor lo rechaza
// vuelve solo, porque lifecycleStatus deja de ser "saving".
const lifecycleSwitchOn = computed(() => {
  const activeNow = lifecycleIntent.value === 'deactivate'
  return lifecycleStatus.value === 'saving' ? !activeNow : activeNow
})

function onLifecycleDialogClosed() {
  lifecycleStatus.value = 'idle'
  lifecycleIntent.value = null
  lifecycleTarget.value = null
}

function replaceServiceInList(service: Service) {
  const index = services.value.findIndex((s) => s.id === service.id)
  if (index !== -1) services.value[index] = service
}

async function onConfirmDeactivate() {
  const target = lifecycleTarget.value
  if (!target || lifecycleStatus.value === 'saving') return

  lifecycleStatus.value = 'saving'
  const outcome = await deactivateService(target.id, lifecycleIdempotencyKey)

  switch (outcome.kind) {
    case 'success':
      replaceServiceInList(outcome.service)
      settleLifecycleAfterChange(outcome.service)
      toast.success('Servicio desactivado', { detail: `«${outcome.service.name}» quedó inactivo.` })
      return
    case 'not-found':
      lifecycleStatus.value = 'not-found'
      return
    case 'transition-conflict':
      // CA-024-04/Frontend §3: un conflicto de estado recarga el impacto
      // real, nunca asume éxito optimista.
      lifecycleStatus.value = 'transition-conflict'
      void reloadAfterConflict(target.id)
      return
    case 'idempotency-conflict':
      lifecycleStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      lifecycleStatus.value = 'network-error'
      return
    case 'unexpected-error':
      lifecycleStatus.value = 'unexpected-error'
  }
}

async function onConfirmReactivate() {
  const target = lifecycleTarget.value
  if (!target || lifecycleStatus.value === 'saving') return

  lifecycleStatus.value = 'saving'
  const outcome = await reactivateService(target.id, lifecycleIdempotencyKey)

  switch (outcome.kind) {
    case 'success':
      replaceServiceInList(outcome.service)
      settleLifecycleAfterChange(outcome.service)
      toast.success('Servicio reactivado', {
        detail: `«${outcome.service.name}» volvió a estar activo.`,
      })
      return
    case 'not-found':
      lifecycleStatus.value = 'not-found'
      return
    case 'transition-conflict':
      lifecycleStatus.value = 'transition-conflict'
      void reloadAfterConflict(target.id)
      return
    case 'idempotency-conflict':
      lifecycleStatus.value = 'idempotency-conflict'
      return
    case 'network-error':
      lifecycleStatus.value = 'network-error'
      return
    case 'unexpected-error':
      lifecycleStatus.value = 'unexpected-error'
  }
}

function onConfirmLifecycle() {
  if (lifecycleIntent.value === 'deactivate') void onConfirmDeactivate()
  else if (lifecycleIntent.value === 'reactivate') void onConfirmReactivate()
}

// reloadAfterConflict trae el estado real tras un conflicto de transición
// (CA-024-04): la lista refleja lo que el servidor confirma, nunca lo que
// el cliente esperaba. Repite la MISMA página/búsqueda que la persona tiene
// en pantalla (nunca vuelve silenciosamente a la página 1 sin filtro): con
// paginación real, el servicio afectado podría no estar en absoluto en la
// primera página, y esta función solo parchea esa fila puntual, no
// reemplaza la lista completa.
async function reloadAfterConflict(serviceId: string) {
  const outcome = await fetchServices({
    page: currentPage.value,
    pageSize: effectivePageSize.value,
    search: activeSearch.value || undefined,
  })
  if (outcome.kind !== 'success') return
  const fresh = outcome.page.items.find((s) => s.id === serviceId)
  if (fresh) replaceServiceInList(fresh)
}
</script>

<template>
  <section
    class="catalog-page"
    :class="{ 'catalog-page--offer': hasOfferColumn() }"
    aria-labelledby="catalog-page-title"
  >
    <header class="catalog-page__header">
      <div>
        <h1 id="catalog-page-title" class="catalog-page__title">Servicios</h1>
        <p class="catalog-page__subtitle">Catálogo de servicios {{ v.ofTheBusiness }}.</p>
      </div>
      <!-- El hueco del botón existe desde el primer cuadro (revisión de #720,
           CLS): sin él la cabecera crecía al aparecer el botón y empujaba
           el estado de carga. -->
      <div class="catalog-page__header-action">
        <BaseButton
          v-if="loadStatus === 'ready'"
          type="button"
          variant="primary"
          class="catalog-page__create"
          @click="openCreateDialog"
        >
          Agregar servicio
        </BaseButton>
      </div>
    </header>

    <!-- Buscador (issue reportado 2026-09-28, "colócalos en una tabla con
         paginador y con su buscador"): vive FUERA del <Transition> de abajo
         y solo depende de loadStatus, nunca de si la página actual tiene
         resultados — si dependiera de services.length, una búsqueda sin
         coincidencias escondería el propio campo que la persona necesita
         para corregirla o borrarla. Sin botón "Buscar": en vivo con
         debounce (ver onSearchInput), mismo criterio que el mockup
         aprobado por el propietario. -->
    <div v-if="loadStatus === 'ready'" class="catalog-page__toolbar">
      <BaseInput
        type="search"
        name="serviceSearch"
        label="Buscar"
        placeholder="Buscar servicio por nombre…"
        :model-value="searchTerm"
        class="catalog-page__search"
        @update:model-value="onSearchInput"
      />
    </div>
    <!-- Mientras carga, un esqueleto del mismo alto que el buscador (rótulo +
         campo) ocupa su sitio: así, al llegar los datos, solo cambia el
         contenido de debajo y nada salta (revisión de #720, CLS). -->
    <div v-else-if="loadStatus === 'loading'" class="catalog-page__toolbar" aria-hidden="true">
      <span class="catalog-page__search catalog-page__skeleton-search">
        <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--label" />
        <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--field" />
      </span>
    </div>

    <!-- Carga → contenido sin parpadeo (#817, ContentReveal): el contenido se
         monta debajo del esqueleto y, cuando está listo y medido, el esqueleto
         se desvanece por encima. Antes un <Transition mode="out-in"> los
         separaba con unos 200 ms casi en blanco.

         El esqueleto imita la geometría de la lista con el cargador compartido
         en miniatura, como AgendaSkeleton.vue (evento 05 del atlas
         panel-agenda-eventos), con su propio layout responsive. Se muestra DE
         INMEDIATO: useMinHoldLoading solo retrasa cuándo se le permite irse, y
         también espera al primer ajuste de filas (fitPending), para no
         destapar una lista que aún va a encogerse. -->
    <ContentReveal class="catalog-page__stage" :loading="coverLoading">
      <template #loading>
        <div class="catalog-page__state catalog-page__loading" role="status" aria-live="polite">
          <DiamondLoader label="Cargando el catálogo…" layout="overlay" />
          <ul class="catalog-page__list" aria-hidden="true">
            <li v-for="n in 3" :key="n" class="catalog-page__skeleton-row">
              <span class="catalog-page__skeleton-icon" />
              <span class="catalog-page__skeleton-text">
                <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--name" />
                <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--meta" />
              </span>
              <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--badge" />
              <span class="catalog-page__skeleton-actions">
                <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--button" />
                <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--button" />
              </span>
            </li>
          </ul>
        </div>
      </template>

      <BaseAlert
        v-if="loadStatus === 'load-error'"
        variant="warning"
        title="No pudimos cargar el catálogo"
        role="alert"
      >
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton variant="secondary" type="button" @click="onRetryLoad">Reintentar</BaseButton>
        </template>
      </BaseAlert>

      <!-- Un solo elemento: ContentReveal pone cada hijo directo en la misma
         celda, así que vacío/tabla y paginación van envueltos juntos. -->
      <div
        v-else-if="loadStatus !== 'loading'"
        class="catalog-page__ready"
        :class="{ 'catalog-page__ready--fitting': fitPending }"
      >
        <EmptyScene
          v-if="services.length === 0 && pageStatus !== 'loading'"
          :scene="isSearching ? 'search' : 'services'"
          class="catalog-page__empty"
        >
          <template #title>
            <template v-if="isSearching">
              No encontramos servicios que coincidan con «{{ activeSearch }}».
            </template>
            <template v-else>Aún no tienes servicios registrados.</template>
          </template>
          <template #hint>
            <template v-if="isSearching">Prueba con otra palabra o borra la búsqueda.</template>
            <template v-else>
              Crea el primero con su duración y precio; en cuanto lo guardes aparece en tu catálogo.
            </template>
          </template>
          <template v-if="!isSearching" #action>
            <BaseButton type="button" variant="primary" @click="openCreateDialog">
              Agregar servicio
            </BaseButton>
          </template>
        </EmptyScene>

        <div
          v-else
          class="catalog-page__table"
          :class="{
            'catalog-page__table--loading': pageStatus === 'loading',
            'catalog-page__table--offer': hasOfferColumn(),
          }"
          :aria-busy="pageStatus === 'loading'"
        >
          <div class="catalog-page__columns" aria-hidden="true">
            <span>Servicio</span><span>Duración</span><span>Precio</span><span>Estado</span>
            <span v-if="hasOfferColumn()">Lo ofrezco</span>
          </div>
          <!-- Mientras carga una búsqueda/página, esqueletos con la altura de
             una fila real (ver .catalog-page__skeleton-row--table); al llegar
             el resultado las filas montan de nuevo, sin animación de entrada
             (v2, DEC-188). El mismo <ul> conserva tableListRef para el
             cálculo de filas que caben. -->
          <ul
            ref="tableListRef"
            class="catalog-page__list"
            :aria-label="`Servicios ${v.ofTheBusiness}`"
          >
            <template v-if="pageStatus === 'loading'">
              <li
                v-for="n in skeletonRowCount"
                :key="`skeleton-${n}`"
                class="catalog-page__skeleton-row catalog-page__skeleton-row--table"
                aria-hidden="true"
              >
                <span class="catalog-page__skeleton-icon" />
                <span class="catalog-page__skeleton-text">
                  <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--name" />
                  <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--meta" />
                </span>
                <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--badge" />
                <span class="catalog-page__skeleton-actions">
                  <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--button" />
                  <span class="catalog-page__skeleton-bar catalog-page__skeleton-bar--button" />
                </span>
              </li>
            </template>
            <template v-else>
              <li
                v-for="(service, index) in services"
                :key="service.id"
                class="catalog-page__row nv-stagger"
                :style="{ '--i': index }"
              >
                <div class="catalog-page__item-heading">
                  <BrassMonogram
                    class="catalog-page__item-icon"
                    :glyph="serviceInitial(service.name)"
                    pendant
                  />
                  <div class="catalog-page__item-text">
                    <!-- El nombre es el disparador real del detalle (issue
                         2026-09-29, "que en el listado solo esté todo menos la
                         descripción y al hacer clic o tocar aparezca toda la
                         información"): un <button> nativo para teclado y lector
                         de pantalla; su ::after cubre TODA la fila, así clic o
                         toque en cualquier parte la abren, y las acciones
                         (z-index superior) siguen siendo botones independientes. -->
                    <button
                      type="button"
                      class="catalog-page__item-trigger"
                      aria-haspopup="dialog"
                      @click="openDetailDialog(service)"
                    >
                      <span class="catalog-page__item-name" :title="service.name">{{
                        service.name
                      }}</span>
                      <span class="catalog-page__item-chevron" aria-hidden="true">›</span>
                    </button>
                  </div>
                </div>
                <span class="catalog-page__item-meta catalog-page__item-duration">
                  {{ service.durationMinutes }} min
                </span>
                <span class="catalog-page__item-meta catalog-page__item-price">{{
                  formatPrice(service)
                }}</span>
                <BaseBadge
                  :variant="service.isActive ? 'success' : 'neutral'"
                  size="sm"
                  :label="service.isActive ? 'Activo' : 'Inactivo'"
                  role="status"
                >
                  {{ service.isActive ? 'Activo' : 'Inactivo' }}
                </BaseBadge>
                <div v-if="hasOfferColumn()" class="catalog-page__item-offer">
                  <slot v-if="service.isActive" name="service-offer" :service="service" />
                </div>
                <div class="catalog-page__item-actions">
                  <BaseButton
                    type="button"
                    variant="secondary"
                    :aria-label="`Editar ${service.name}`"
                    @click="openEditDialog(service)"
                  >
                    Editar
                  </BaseButton>
                  <!-- Un solo botón para ambos sentidos (issue 2026-09-29, "quita el
                   desactivar y deja ese reactivar ya que hace ambos"): el
                   diálogo decide desactivar o reactivar según service.isActive
                   y allí, en el botón de confirmación, sí se nombra el efecto. -->
                  <BaseButton
                    type="button"
                    variant="secondary"
                    class="catalog-page__state-action"
                    :aria-label="`Cambiar estado de ${service.name}`"
                    @click="openLifecycleDialog(service)"
                  >
                    Cambiar estado
                  </BaseButton>
                </div>
              </li>
            </template>
          </ul>
        </div>

        <!-- Pie de paginador (issue 2026-09-28, "colócalos en una tabla con
           paginador"): siempre visible en cuanto la carga inicial resuelve
           (incluida una búsqueda sin resultados, "0 resultados para «x»"),
           no solo cuando hay filas — el conteo real es información útil en
           ambos casos. La navegación numerada (nav) solo aparece con más de
           una página; con una sola página el conteo solo queda como
           confirmación silenciosa. -->
        <div ref="paginationFooterRef" class="catalog-page__pagination">
          <BaseAlert
            v-if="pageStatus === 'error'"
            variant="warning"
            title="No pudimos cargar esta página"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo.
            <template #action>
              <BaseButton variant="secondary" type="button" @click="onRetryLoad">
                Reintentar
              </BaseButton>
            </template>
          </BaseAlert>

          <BasePagination
            :current-page="currentPage"
            :total-pages="totalPages"
            :count-label="resultsLabel"
            nav-label="Paginación de servicios"
            :disabled="pageStatus === 'loading'"
            @change="goToPage"
          />
        </div>
      </div>
    </ContentReveal>

    <!-- Detalle (issue 2026-09-29): la descripción completa vive aquí, no en la
         fila, porque puede ser larga. Va ANTES de los demás diálogos a
         propósito: al pulsar "Editar" se cierra este y se abre el de edición
         en el mismo ciclo, y BaseDialog guarda como "foco previo" el elemento
         activo al abrirse; con este orden el foco ya volvió a la fila cuando
         el de edición lo lee. Misma ficha neutra con la inicial que los
         demás diálogos de la pantalla. -->
    <BaseDialog
      v-model="isDetailOpen"
      :title="detailTarget?.name"
      size="lg"
      content-class="catalog-page__detail-dialog"
    >
      <template #icon>
        <BrassMonogram
          class="catalog-page__detail-icon"
          :glyph="detailTarget ? serviceInitial(detailTarget.name) : ''"
          face="serif"
          pendant
        />
      </template>
      <!-- catalog-page__lifecycle aporta solo el apilado, el color de texto
           y el par de botones del pie; el resto es propio del detalle. -->
      <!-- Rediseño del issue #577: una cabecera con el estado y la fecha de
           registro, una sola ficha de cifras (precio en la moneda del
           contrato y duración) y la descripción como texto corrido. Antes
           eran dos cajas grandes con «25000.00 COP» y metadatos sueltos al
           pie. Todo está a la vista desde el primer cuadro (v2, DEC-188). -->
      <!-- Ficha de la familia (#762, DEC-189): el servicio como un renglón de la
           carta. El precio es el protagonista, en serif; la duración y las
           fechas, renglones con puntos guía de latón; el estado, un sello con
           su rombo. Mismos datos que antes, sin acciones nuevas. -->
      <div v-if="detailTarget" class="catalog-page__lifecycle catalog-page__detail">
        <article class="catalog-page__ficha" aria-label="Ficha del servicio">
          <p
            class="catalog-page__ficha-seal"
            :class="{ 'catalog-page__ficha-seal--inactive': !detailTarget.isActive }"
          >
            <span class="catalog-page__ficha-seal-mark" aria-hidden="true" />{{
              detailTarget.isActive ? 'Activo' : 'Inactivo'
            }}
          </p>
          <dl class="catalog-page__ficha-price catalog-page__detail-figure--price">
            <dt class="catalog-page__ficha-kicker">Precio</dt>
            <dd>
              <span class="catalog-page__ficha-symbol">{{ detailPrice!.symbol }}</span>
              <span class="catalog-page__ficha-amount">{{ detailPrice!.amount }}</span>
              <small class="catalog-page__ficha-currency">{{ detailPrice!.currency }}</small>
            </dd>
          </dl>
          <dl class="catalog-page__ficha-leaders">
            <div class="catalog-page__ficha-leader">
              <dt>Duración</dt>
              <dd>
                <span class="catalog-page__ficha-minutes">{{ detailTarget.durationMinutes }}</span>
                min
              </dd>
            </div>
            <div class="catalog-page__ficha-leader">
              <dt>Registrado</dt>
              <dd>{{ formatDateLong(detailTarget.createdAt) }}</dd>
            </div>
            <div v-if="detailTarget.deactivatedAt" class="catalog-page__ficha-leader">
              <dt>Inactivo desde</dt>
              <dd>{{ formatDateLong(detailTarget.deactivatedAt) }}</dd>
            </div>
          </dl>
          <div class="catalog-page__ficha-section">
            <h3 class="catalog-page__ficha-kicker">Descripción</h3>
            <p v-if="detailTarget.description" class="catalog-page__detail-text">
              {{ detailTarget.description }}
            </p>
            <p v-else class="catalog-page__detail-text catalog-page__detail-text--empty">
              Este servicio no tiene descripción.
            </p>
          </div>
        </article>
      </div>
      <!-- Pie fuera del área con scroll: con una descripción larga solo esta
           se desplaza y "Cerrar"/"Editar" nunca quedan fuera de la pantalla. -->
      <template #footer>
        <div class="catalog-page__lifecycle catalog-page__detail-footer">
          <BaseButton type="button" variant="secondary" @click="isDetailOpen = false">
            Cerrar
          </BaseButton>
          <BaseButton type="button" variant="primary" @click="onDetailEdit">Editar</BaseButton>
        </div>
      </template>
    </BaseDialog>

    <!-- Alta. contentClass="catalog-page__create-dialog" + #icon (issue
         reportado 2026-09-28, "ajusta esa ventana emergente, se ve como una
         simple ventana que aparece de la nada, sorpréndeme"; luego "aplica
         eso mismo para las pantallas emergentes de editar y eliminar", ver
         Editar y Desactivar/Reactivar más abajo — los tres diálogos
         comparten ya el mismo tinte, ficha con entrada animada y campos
         reglados). Ver estilos al final del bloque <style> para el porqué
         de cada valor (ninguno inventado: reutiliza --border-width-emphasis
         y el mismo cubic-bezier con rebote que ya usa ProfessionalSelect.vue). -->
    <BaseDialog
      v-model="isCreateOpen"
      title="Agregar servicio"
      description="Aparece en tu catálogo activo en cuanto lo guardes."
      size="lg"
      content-class="catalog-page__create-dialog"
      @close="onCreateDialogClosed"
    >
      <template #icon>
        <DialogSeal />
      </template>
      <form
        class="catalog-page__form catalog-page__create-form"
        novalidate
        @submit.prevent="onSubmitCreate"
      >
        <BaseAlert
          v-if="createStatus === 'name-conflict'"
          variant="danger"
          title="Ese nombre ya está en uso"
          role="alert"
        >
          Ya existe un servicio activo con ese nombre. Usa otro nombre.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'idempotency-conflict'"
          variant="danger"
          title="No pudimos completar el intento anterior"
          role="alert"
        >
          Inténtalo de nuevo.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <BaseInput
          :model-value="createForm.name"
          name="name"
          label="Nombre"
          required
          :maxlength="120"
          :disabled="createStatus === 'saving'"
          :error="createFieldErrors.name"
          @update:model-value="onCreateNameInput"
        />
        <BaseInput
          :model-value="createForm.description"
          name="description"
          label="Descripción (opcional)"
          :maxlength="500"
          :disabled="createStatus === 'saving'"
          :error="createFieldErrors.description"
          @update:model-value="onCreateDescriptionInput"
        />
        <BaseInput
          :model-value="createDurationRaw"
          type="number"
          name="durationMinutes"
          class="catalog-page__form-half"
          label="Duración (minutos)"
          required
          :min="1"
          :max="1440"
          :step="1"
          :disabled="createStatus === 'saving'"
          :error="createFieldErrors.durationMinutes"
          @update:model-value="onCreateDurationInput"
        />
        <BaseInput
          :model-value="createForm.price"
          name="price"
          class="catalog-page__form-half"
          label="Precio (COP)"
          required
          placeholder="45000.00"
          hint="Precio informativo en pesos colombianos, mayor que cero."
          :disabled="createStatus === 'saving'"
          :error="createFieldErrors.price"
          @update:model-value="onCreatePriceInput"
        />

        <div class="catalog-page__dialog-actions">
          <BaseButton type="button" variant="secondary" @click="isCreateOpen = false">
            Cancelar
          </BaseButton>
          <BaseButton
            type="submit"
            variant="primary"
            :loading="createStatus === 'saving'"
            loading-label="Guardando…"
            :disabled="createStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>

    <!-- Edición (issue 2026-09-28, "aplica eso mismo para las pantallas
         emergentes de editar y eliminar"): mismo tratamiento v2 que el
         diálogo de alta, arriba. La ficha del encabezado reutiliza
         serviceInitial() — la misma inicial que ya identifica a este
         servicio en la fila — en vez de un glifo genérico, así la ficha
         señala DE QUÉ servicio se trata, no solo que es "un" diálogo de
         edición. Ver estilos junto a .catalog-page__create-* y el bloque
         sin scope al final del archivo. -->
    <BaseDialog
      v-model="isEditOpen"
      title="Editar servicio"
      size="lg"
      content-class="catalog-page__edit-dialog"
      @close="onEditDialogClosed"
    >
      <template #icon>
        <DialogSeal :glyph="editTarget ? serviceInitial(editTarget.name) : undefined" />
      </template>
      <form
        class="catalog-page__form catalog-page__edit-form"
        novalidate
        @submit.prevent="onSubmitEdit"
      >
        <BaseAlert
          v-if="editStatus === 'name-conflict'"
          variant="danger"
          title="Ese nombre ya está en uso"
          role="alert"
        >
          Ya existe un servicio activo con ese nombre. Usa otro nombre.
        </BaseAlert>
        <BaseAlert
          v-if="editStatus === 'not-found'"
          variant="warning"
          title="Este servicio ya no está disponible"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-if="editStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="editStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <BaseInput
          :model-value="editForm.name"
          name="name"
          label="Nombre"
          required
          :maxlength="120"
          :disabled="editStatus === 'saving'"
          :error="editFieldErrors.name"
          @update:model-value="onEditNameInput"
        />
        <BaseInput
          :model-value="editForm.description"
          name="description"
          label="Descripción (opcional)"
          :maxlength="500"
          :disabled="editStatus === 'saving'"
          :error="editFieldErrors.description"
          @update:model-value="onEditDescriptionInput"
        />
        <BaseInput
          :model-value="editDurationRaw"
          type="number"
          name="durationMinutes"
          class="catalog-page__form-half"
          label="Duración (minutos)"
          required
          :min="1"
          :max="1440"
          :step="1"
          :disabled="editStatus === 'saving'"
          :error="editFieldErrors.durationMinutes"
          @update:model-value="onEditDurationInput"
        />
        <BaseInput
          :model-value="editForm.price"
          name="price"
          class="catalog-page__form-half"
          label="Precio (COP)"
          required
          placeholder="45000.00"
          hint="Precio informativo en pesos colombianos, mayor que cero."
          :disabled="editStatus === 'saving'"
          :error="editFieldErrors.price"
          @update:model-value="onEditPriceInput"
        />

        <label v-if="showApplyToUpcoming" class="catalog-page__apply-upcoming">
          <input
            v-model="editApplyToUpcoming"
            type="checkbox"
            class="catalog-page__apply-upcoming-box"
            :disabled="editStatus === 'saving'"
          />
          <span>
            <strong>Aplicar el precio nuevo a los turnos ya agendados</strong>
            <small>
              {{
                editUpcomingCount === null
                  ? 'Si no la marcas, los turnos futuros conservan el precio con el que se agendaron.'
                  : `Hay ${editUpcomingCount} ${editUpcomingCount === 1 ? 'turno futuro' : 'turnos futuros'} de este servicio. Si no la marcas, conservan el precio con el que se agendaron.`
              }}
            </small>
          </span>
        </label>

        <div class="catalog-page__dialog-actions">
          <BaseButton type="button" variant="secondary" @click="isEditOpen = false">
            Cancelar
          </BaseButton>
          <BaseButton
            type="submit"
            variant="primary"
            :loading="editStatus === 'saving'"
            loading-label="Guardando…"
            :disabled="editStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>

    <!-- HU-024: desactivar/reactivar (issue 2026-09-28, "aplica eso mismo
         para las pantallas emergentes de editar y eliminar"): mismo tinte
         base que alta/edición, pero la ficha del encabezado cambia a
         --color-danger-on-strong cuando la intención es "deactivate" — el
         diálogo advierte visualmente antes de que el profesional lea una
         sola palabra. "reactivate" conserva la ficha neutra. -->
    <BaseDialog
      v-model="isLifecycleOpen"
      title="Estado del servicio"
      size="lg"
      :content-class="
        lifecycleIntent === 'deactivate'
          ? 'catalog-page__lifecycle-dialog catalog-page__lifecycle-dialog--danger'
          : 'catalog-page__lifecycle-dialog'
      "
      @close="onLifecycleDialogClosed"
    >
      <template #icon>
        <DialogSeal
          :glyph="lifecycleTarget ? serviceInitial(lifecycleTarget.name) : undefined"
          :tone="lifecycleIntent === 'deactivate' ? 'danger' : 'neutral'"
        />
      </template>
      <div class="catalog-page__lifecycle">
        <BaseAlert
          v-if="lifecycleStatus === 'not-found'"
          variant="warning"
          title="Este servicio ya no está disponible"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-else-if="lifecycleStatus === 'transition-conflict'"
          variant="warning"
          title="El estado de este servicio cambió"
          role="alert"
        >
          Alguien más ya
          {{ lifecycleIntent === 'deactivate' ? 'lo desactivó' : 'lo reactivó' }}. Cierra este
          diálogo: la lista ya se actualizó con el estado real.
        </BaseAlert>
        <BaseAlert
          v-else-if="lifecycleStatus === 'idempotency-conflict'"
          variant="danger"
          title="No pudimos completar el intento anterior"
          role="alert"
        >
          Cierra este diálogo y vuelve a intentarlo.
        </BaseAlert>
        <BaseAlert
          v-else-if="lifecycleStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo.
        </BaseAlert>
        <BaseAlert
          v-else-if="lifecycleStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos.
        </BaseAlert>

        <template v-if="lifecycleIntent">
          <p
            v-if="lifecycleIntent === 'deactivate' && impactStatus === 'loading'"
            class="catalog-page__lifecycle-lead"
            role="status"
            aria-live="polite"
          >
            Consultando el impacto real…
          </p>
          <p v-else-if="lifecycleIntent === 'deactivate'" class="catalog-page__lifecycle-lead">
            <strong>{{ lifecycleTarget?.name }}</strong> dejará de estar disponible para nuevas
            reservas.
          </p>
          <p v-else class="catalog-page__lifecycle-lead">
            <strong>{{ lifecycleTarget?.name }}</strong> vuelve a ofrecerse en el catálogo.
          </p>

          <!-- El interruptor ES la acción (issue 2026-09-29, "quita ese botón de
               activar o desactivar y solo deja ese interruptor"): mover el
               interruptor confirma el cambio. La consecuencia (impacto real
               al desactivar) ya está a la vista en este mismo diálogo antes
               de poder tocarlo, y se deshabilita mientras se consulta o se
               guarda, así que no es un cambio silencioso. -->
          <button
            type="button"
            role="switch"
            class="catalog-page__lifecycle-switch"
            :class="{ 'catalog-page__lifecycle-switch--on': lifecycleSwitchOn }"
            :aria-checked="lifecycleSwitchOn"
            aria-label="Servicio activo"
            :aria-busy="lifecycleStatus === 'saving'"
            :disabled="lifecycleStatus === 'saving' || impactStatus === 'loading'"
            @click="onConfirmLifecycle"
          >
            <span class="catalog-page__lifecycle-state">Inactivo</span>
            <span class="catalog-page__lifecycle-track" aria-hidden="true">
              <span class="catalog-page__lifecycle-thumb"></span>
            </span>
            <span class="catalog-page__lifecycle-state catalog-page__lifecycle-state--on"
              >Activo</span
            >
          </button>
          <p class="catalog-page__lifecycle-hint">
            {{
              lifecycleIntent === 'deactivate'
                ? 'Mueve el interruptor para desactivarlo.'
                : 'Mueve el interruptor para reactivarlo.'
            }}
          </p>
          <dl class="catalog-page__lifecycle-facts catalog-page__facts-rich">
            <div>
              <dt>Duración</dt>
              <dd>
                {{ lifecycleTarget?.durationMinutes }}
                <small>min</small>
              </dd>
            </div>
            <div>
              <dt>Precio</dt>
              <dd>
                {{
                  lifecycleTarget
                    ? formatMoney(lifecycleTarget.price, lifecycleTarget.currency)
                    : ''
                }}
                <small>{{ lifecycleTarget?.currency }}</small>
              </dd>
            </div>
            <div v-if="deactivatedSince">
              <dt>Desde</dt>
              <dd>
                {{ deactivatedSince }}
                <small>inactivo</small>
              </dd>
            </div>
          </dl>

          <template v-if="lifecycleIntent === 'deactivate'">
            <template v-if="impactStatus === 'ready'">
              <div
                class="catalog-page__lifecycle-impact"
                :class="{ 'catalog-page__lifecycle-impact--warning': affectedAppointments > 0 }"
                role="status"
              >
                <span class="catalog-page__lifecycle-impact-icon" aria-hidden="true"
                  ><span>{{ affectedAppointments > 0 ? '!' : '✓' }}</span></span
                >
                <p class="catalog-page__lifecycle-impact-text">
                  <template v-if="affectedAppointments > 0">
                    <strong>{{ affectedAppointments }}</strong>
                    {{
                      affectedAppointments === 1
                        ? 'cita futura no se cancela'
                        : 'citas futuras no se cancelan'
                    }}
                    automáticamente.
                  </template>
                  <template v-else>No hay citas futuras afectadas.</template>
                </p>
              </div>
              <p class="catalog-page__lifecycle-note">
                El historial se conserva; el servicio nunca se elimina.
              </p>
            </template>
          </template>
          <ul v-else class="catalog-page__lifecycle-checks">
            <li>Vuelve a aparecer para nuevas reservas.</li>
            <li>Conserva duración, precio y asignaciones.</li>
            <li>No se crea otro registro; el historial sigue intacto.</li>
          </ul>
        </template>

        <div class="catalog-page__dialog-actions">
          <BaseButton type="button" variant="secondary" @click="isLifecycleOpen = false">
            Salir
          </BaseButton>
        </div>
      </div>
    </BaseDialog>
  </section>
</template>

<style scoped>
.catalog-page {
  /* Superficie tinta de punta a punta (estandar-diseno-visual.md §3, mismo
     canvas que DailyAgendaPage.vue y el cascarón AppHeader/AppNav): antes
     esta pantalla se quedó en el blanco previo a la Fase 2 del rediseño
     Tailored Grid y desentonaba del resto del panel privado (issue
     reportado por el propietario 2026-09-28, "el fondo está en blanco").
     BaseDialog/BaseAlert/BaseInput no se tocan: son superficies claras
     pensadas para flotar sobre cualquier fondo (mismo criterio que ya usan
     los diálogos y avisos de DailyAgendaPage.vue sobre tinta). */
  /* 820px (antes 760px, luego 580px): cada vez que la letra de la tabla
     sube un escalón (issues 2026-09-28 "la tabla se ve fea" y "la letra se
     ve pequeña") las columnas fijas necesitan más aire para no apretar
     precio/insignia/acciones. El resto de la pantalla sigue centrado como
     columna de lectura (no se estira a todo el ancho); solo se ensancha lo
     que la tabla necesita. */
  --catalog-width: 1280px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  max-width: none;
  padding: 34px 32px 48px;
  margin: 0 auto;
  color: var(--color-on-strong);
  /* Transparente: la tinta y el fondo animado los pone el cascarón. */
  background: transparent;
}

/* Con la columna «Lo ofrezco» (DEC-115) la tabla gana 120px para que el nombre del
   servicio no se recorte; sin ella conserva su ancho de siempre. */
.catalog-page--offer {
  --catalog-width: 1280px;
}

.catalog-page__header,
.catalog-page__toolbar,
.catalog-page__table,
.catalog-page__list,
.catalog-page__state,
.catalog-page__empty,
.catalog-page__pagination,
.catalog-page > :deep(.base-alert),
.catalog-page__stage > :deep(.base-alert) {
  width: min(100%, var(--catalog-width));
  margin-inline: auto;
}

/* Vacío/tabla y paginación van envueltos en un solo elemento (ver
   ContentReveal en la plantilla): necesitan su propio flex para conservar el
   espaciado del flex column de .catalog-page. */
.catalog-page__ready {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Invisible pero con layout, bajo el esqueleto: el primer ajuste de filas mide
   la tabla real (ver fitPending). Se destapa sin fundido propio: el que se
   desvanece es el esqueleto de encima (#817); dos fundidos a la vez volverían
   a dejar un hueco. */
.catalog-page__ready--fitting {
  opacity: 0;
}

.catalog-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: 16px;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

/* h1 v2 (DEC-188): el mismo título que DailyAgendaPage.vue
   (.daily-agenda-page__title), 28px y 32px desde 1024px. */
.catalog-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-page-title);
  font-weight: 400;
  line-height: var(--font-size-page-title-line);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

/* body-sm (antes 11px suelto): mismo reclamo del propietario sobre el
   subtítulo. Ya no encoge en el breakpoint móvil (ver media query de abajo,
   donde antes bajaba a 10px): a ese ancho es justo donde más se notaba
   "muy pequeño". */
.catalog-page__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

.catalog-page__header-action {
  display: flex;
  flex: 0 0 auto;
  min-height: 40px;
}

.catalog-page__create.base-button {
  height: 40px;
  padding-inline: 18px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
}

.catalog-page__create :deep(.base-button__content)::before {
  /* El «+» es dibujo: el texto alternativo vacío lo saca del nombre accesible
     («Agregar …», no «+ Agregar …»). La primera línea es el respaldo. */
  content: '+';
  content: '+' / '';
  margin-right: 6px;
}

/* "Agregar servicio" es la acción principal de la pantalla y la ÚNICA con el
   acento lleno (v2, DEC-188): toma el acento del negocio
   (--color-brand-accent-surface) en vez del Alba fijo de BaseButton, igual
   que la acción principal de NewAppointmentPage.vue. */
.catalog-page__create.base-button--primary {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

.catalog-page__create.base-button--primary:hover:not(:disabled):not(.base-button--loading) {
  filter: brightness(92%);
}

.catalog-page__create.base-button--primary:active:not(:disabled):not(.base-button--loading) {
  filter: brightness(84%);
}

.catalog-page__state {
  padding: var(--space-4);
  color: var(--color-on-strong-muted);
}

/* layout="inline" (cargador chico a la izquierda, mismo criterio que
   AgendaSkeleton) en vez del grande centrado: aquí no está solo,
   acompaña a las filas placeholder de abajo. */
.catalog-page__loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: 0;
}

/* Filas placeholder: layout propio (no el grid de `.catalog-page__row`,
   que solo en móvil necesita ganchos de grid-column/row muy específicos
   para su insignia/acciones) — mismo criterio que AgendaSkeleton.vue, que
   tampoco reutiliza las clases reales de fila de DailyAgendaPage.vue: es
   una aproximación de la forma, con su propio responsive, no una réplica
   acoplada a los detalles internos de la fila real. */
.catalog-page__skeleton-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 80px;
  padding: 16px;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.catalog-page__skeleton-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.catalog-page__skeleton-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

/* Mismo `agenda-skeleton-pulse` que AgendaSkeleton.vue, aquí
   `catalog-skeleton-pulse`: es un indicador de carga (dura lo que dura la
   petición), por eso v2 lo permite; se apaga con movimiento reducido. */
.catalog-page__skeleton-icon,
.catalog-page__skeleton-bar {
  display: block;
  flex: 0 0 auto;
  background-color: color-mix(in srgb, var(--color-on-strong) 16%, transparent);
  border-radius: var(--radius-sm);
  animation: catalog-skeleton-pulse 1400ms ease-in-out infinite;
}

.catalog-page__skeleton-icon {
  width: 40px;
  height: 40px;
}

.catalog-page__skeleton-bar--name {
  width: 55%;
  max-width: 180px;
  height: 16px;
}

.catalog-page__skeleton-bar--meta {
  width: 96px;
  height: 12px;
  background-color: color-mix(in srgb, var(--color-on-strong) 10%, transparent);
}

.catalog-page__skeleton-bar--badge {
  width: 64px;
  height: 12px;
}

.catalog-page__skeleton-bar--button {
  width: 72px;
  height: 34px;
}

/* Esqueleto del buscador: rótulo de 18px de línea (BaseInput) + su espacio +
   un campo de --control-height, el mismo alto que el buscador real. */
.catalog-page__skeleton-search {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.catalog-page__skeleton-bar--label {
  width: 52px;
  height: 12px;
  margin-block: 3px;
}

.catalog-page__skeleton-bar--field {
  width: 100%;
  height: var(--control-height);
  border-radius: var(--radius-md);
}

@keyframes catalog-skeleton-pulse {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-page__skeleton-icon,
  .catalog-page__skeleton-bar {
    animation: none;
    opacity: 0.8;
  }
}

/* «Animaciones reducidas» de Configuración (DEC-110): el esqueleto queda
   quieto igual que con la preferencia del sistema. */
:global(:root[data-motion='reduced']) .catalog-page__skeleton-icon,
:global(:root[data-motion='reduced']) .catalog-page__skeleton-bar {
  animation: none;
  opacity: 0.8;
}

@media (max-width: 640px) {
  .catalog-page__skeleton-row {
    gap: 10px;
    min-height: 62px;
    padding: 9px 10px;
  }

  .catalog-page__skeleton-icon {
    width: 28px;
    height: 28px;
  }

  .catalog-page__skeleton-bar--name {
    max-width: 120px;
    height: 13px;
  }

  .catalog-page__skeleton-bar--meta {
    width: 70px;
    height: 10px;
  }

  .catalog-page__skeleton-bar--badge {
    width: 48px;
    height: 10px;
  }

  .catalog-page__skeleton-actions {
    flex-direction: column;
    gap: 4px;
  }

  .catalog-page__skeleton-bar--button {
    width: 52px;
    height: 22px;
  }
}

/* Tarjeta v2 (DEC-188): superficie con borde sutil de 1px y radio grande. */
.catalog-page__list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.catalog-page__columns,
.catalog-page__row {
  display: grid;
  /* Pistas con fr (no una sola 1fr entre anchos fijos): al ensanchar la
     tabla en pantallas amplias el espacio sobrante se reparte entre nombre,
     duración, precio y estado en vez de acumularse como un vacío junto a
     las acciones, que conservan su ancho fijo y quedan pegadas a la derecha. */
  grid-template-columns:
    minmax(220px, 3fr) minmax(84px, 0.8fr) minmax(124px, 1.1fr) minmax(108px, 0.9fr)
    232px;
  align-items: center;
  gap: clamp(12px, 1.6vw, 28px);
}

.catalog-page__columns {
  /* 16px (antes 14px, luego 10px): la letra de todo el cuerpo de la tabla
     subió un escalón más (issue 2026-09-28 "la letra se ve pequeña" otra
     vez), y el encabezado sigue el mismo --font-size-body para no quedar
     más chico que los datos que etiqueta. */
  min-height: 44px;
  padding: 0 16px;
  margin: 0;
  border: none;
  font-family: var(--font-sans);
  /* Rótulo v2 (DEC-188): tipo oración, 13px/500 en texto secundario, como el
     rótulo de BaseInput; sin versalitas ni acento. */
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

/* Alto FIJO, no min-height (issue reportado 2026-09-28, "que se adapte
   según la pantalla, que no haya scroll"): calcular cuántas filas caben en
   la pantalla disponible (ver ROW_HEIGHT_PX/computeFittingPageSize en el
   script) exige que TODA fila mida exactamente lo mismo, tenga o no
   descripción — si el alto variara con el contenido, ese cálculo dejaría
   de predecir el alto real y volvería a aparecer scroll. */
.catalog-page__row {
  height: 80px;
  padding: 16px;
  overflow: hidden;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.catalog-page__item-heading {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

/* Monograma del servicio: la inicial ayuda a escanear una lista larga (issue
   2026-09-28, "se ve fea"). Es el retrato de latón de la familia
   (BrassMonogram, #799), el mismo de profesionales y de la ficha; en sans 600
   porque la serif por debajo de 20 px se ensucia (#726). */
.catalog-page__item-icon {
  --monogram-size: 40px;
  --monogram-glyph-size: var(--font-size-body-lg);
  --monogram-pendant: 9px;
}

.catalog-page__item-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.catalog-page__item-name {
  font-family: var(--font-family-base);
  /* body-lg, no body (issue 2026-09-28 "la letra se ve pequeña"): el nombre
     es el dato principal de la fila, un escalón por encima de duración/
     precio/descripción. */
  font-size: var(--font-size-body-lg);
  font-weight: 500;
  color: var(--color-on-strong);
  /* Una sola línea con "…" (issue 2026-09-28, "que se adapte según la
     pantalla, que no haya scroll"): un nombre largo ya no empuja el alto de
     la fila — el `title` del propio elemento (ver plantilla) muestra el
     texto completo al pasar el cursor, y un lector de pantalla sigue
     leyendo el texto real completo, nunca lo visualmente recortado. */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Disparador del detalle: botón sin cromo que hereda la tipografía del
   nombre. Su ::after se estira sobre toda la fila (.catalog-page__row es
   position: relative), de modo que cualquier clic o toque la abre; las
   acciones suben por z-index y conservan su propio clic. */
.catalog-page__item-trigger {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 6px;
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.catalog-page__item-trigger::after {
  content: '';
  position: absolute;
  inset: 0;
}

.catalog-page__item-trigger:focus-visible {
  outline: none;
}

.catalog-page__item-trigger:focus-visible::after {
  box-shadow: inset 0 0 0 2px var(--color-focus);
}

.catalog-page__item-chevron {
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-lg);
  line-height: 1;
  opacity: 0.55;
  transition:
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.catalog-page__row {
  position: relative;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Solo con puntero real: en táctil :hover se queda pegado tras el toque. */
@media (hover: hover) {
  .catalog-page__row:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  }

  .catalog-page__row:hover .catalog-page__item-chevron {
    opacity: 1;
    transform: translateX(3px);
  }
}

/* Columna «Lo ofrezco» (DEC-115): una pista de 46px sin texto; el encabezado y el
   nombre accesible del interruptor dicen qué es. */
.catalog-page__table--offer .catalog-page__columns,
.catalog-page__table--offer .catalog-page__row {
  grid-template-columns:
    minmax(200px, 3fr) minmax(80px, 0.8fr) minmax(116px, 1.1fr) minmax(100px, 0.9fr)
    88px 204px;
}

.catalog-page__table--offer .catalog-page__columns > :nth-child(5) {
  white-space: nowrap;
}

.catalog-page__item-offer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
}

.catalog-page__item-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.catalog-page__item-actions :deep(.base-button) {
  height: 36px;
  padding-inline: 14px;
  font-size: var(--font-size-body-sm);
}

/* "Editar" y "Cambiar estado" usan el BaseButton--secondary v2 tal cual
   (contorno neutro): el acento lleno queda solo para "Agregar servicio"
   (DEC-188) y el punto de color de la insignia ya dice el estado, así que
   "Cambiar estado" no necesita su propio verde (revisión de #720). */

/* Insignia "Activo"/"Inactivo" como rótulo, no como caja (issue reportado
   2026-09-28, "esos estados se ven feos"; pedido del propietario 2026-09-04:
   "parecen botones"): un punto de color + la palabra en tipo oración. v2
   (DEC-188) quita el rombo parpadeante y las versalitas: el punto queda
   quieto y es `currentColor`, el `color` que ya resuelve la variante (los
   tintes de estado de abajo). Se sobrescribe aquí, no en BaseBadge, porque
   el resto de sus usos sí necesitan la caja. */
.catalog-page__row :deep(.base-badge) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: auto;
  padding: 0;
  background-color: transparent;
  border: none;
  border-radius: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.catalog-page__row :deep(.base-badge)::before {
  content: '';
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 0;
  rotate: 45deg;
  background-color: currentColor;
}

/* Tintes de estado de tokens.css (AA en los dos modos), ningún color nuevo:
   el `color` de cada variant también es el que hereda el punto vía
   currentColor. */
.catalog-page__row :deep(.base-badge--success) {
  color: var(--color-success-on-strong);
}

.catalog-page__row :deep(.base-badge--neutral) {
  color: var(--color-on-strong-muted);
}

.catalog-page__item-meta {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  color: var(--color-on-strong-muted);
  /* Cifras tabulares: duración y precio (estandar-diseno-visual.md §5.2, §10.3). */
  font-variant-numeric: tabular-nums;
  /* Nunca en dos líneas (issue reportado 2026-09-28, "los botones se
     desencajan todo raro"): .catalog-page__row tiene alto FIJO (ver
     ROW_HEIGHT_PX en el script) — un precio largo envolviendo a una
     segunda línea se recortaría en silencio en vez de solo desbordar. */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Buscador (issue 2026-09-28, "con su buscador"): BaseInput type="search"
   reutilizado tal cual, con su estilo v2 (DEC-188) — solo se acota su
   ancho: no tiene sentido que un solo campo ocupe el ancho de la tabla. */
.catalog-page__toolbar {
  display: flex;
}

.catalog-page__search {
  width: 100%;
  max-width: 320px;
}

/* Buscar o cambiar de página (issue 2026-09-29, "que al buscar un servicio
   se haga una animación y no que muestre el resultado, ya que se ve feo"):
   la tabla y su encabezado de columnas se quedan (nunca el esqueleto de
   página completa de la carga inicial, eso sería el parpadeo que
   useMinHoldLoading ya resolvió); solo el cuerpo pasa a esqueletos con
   pulso -misma altura que una fila real, así el paginador no salta- y el
   resultado aparece de una vez: v2 (DEC-188) quita la entrada escalonada
   que se repetía en cada búsqueda. */
.catalog-page__skeleton-row--table {
  height: 80px;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 640px) {
  /* Igual que .catalog-page__row en móvil (ROW_HEIGHT_MOBILE_PX). */
  .catalog-page__skeleton-row--table {
    height: 100px;
  }
}

/* Pie de paginador (issue 2026-09-28, "con paginador"). */
.catalog-page__pagination {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.catalog-page__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Alta y edición: rejilla de dos columnas. Todo ocupa el ancho completo salvo
   Duración y Precio, que van lado a lado (.catalog-page__form-half). */
.catalog-page__create-form,
.catalog-page__edit-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: var(--space-5) var(--space-5);
}

.catalog-page__create-form > *,
.catalog-page__edit-form > * {
  grid-column: 1 / -1;
}

/* HU-029: casilla de «aplicar el precio a los turnos ya agendados». */
.catalog-page__apply-upcoming {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3, 0.75rem);
  cursor: pointer;
}

.catalog-page__apply-upcoming-box {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
  /* Casilla marcada en tinta: el acento es solo de la acción principal. */
  accent-color: var(--color-text-primary);
}

.catalog-page__apply-upcoming span {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.catalog-page__apply-upcoming {
  color: var(--color-on-strong);
}

.catalog-page__apply-upcoming small {
  color: var(--color-on-strong-muted);
}

.catalog-page__create-form > .catalog-page__form-half,
.catalog-page__edit-form > .catalog-page__form-half {
  grid-column: auto;
}

@media (max-width: 560px) {
  .catalog-page__create-form > .catalog-page__form-half,
  .catalog-page__edit-form > .catalog-page__form-half {
    grid-column: 1 / -1;
  }
}

/* Los tres diálogos de esta pantalla (issue 2026-09-28, alta: "se ve como
   una simple ventana que aparece de la nada, sorpréndeme", luego "sigue
   blanco, no respetas los colores del fondo... ajusta los inputs como los
   de Agenda"; edición/ciclo de vida: "aplica eso mismo para las pantallas
   emergentes de editar y eliminar"): en v2 (DEC-188) los diálogos usan la
   superficie del modo con borde sutil, los campos son BaseInput v2 tal cual
   y una ficha con la inicial del servicio en el encabezado.
   Nada de esto toca BaseDialog.vue ni BaseInput.vue para el resto de la
   app: solo aplica dentro de .catalog-page__create-dialog/__edit-dialog/
   __lifecycle-dialog y sus respectivas clases de formulario/contenedor
   (content-class y clase del <form>/<div>, ver plantilla).

   El fondo, el borde, el título, la descripción y el botón
   de cerrar (elementos propios de BaseDialog.vue, no de esta plantilla) se
   sobrescriben en el bloque <style> SIN "scoped" al final del archivo, no
   aquí: BaseDialog renderiza su contenido en <Teleport to="body">, y Vue
   compila TODO `:deep()` anteponiendo el atributo de scope de ESTE
   componente como ancestro (`[data-v-hash] .foo`, documentado así por
   Vue), incluso cuando no se escribe un selector delante — ese ancestro ya
   no existe una vez teletransportado. Verificado en el navegador: esas
   reglas nunca se aplicaban aunque compilaban sin error (issue 2026-09-28,
   "sigue blanco"). Lo que SÍ sigue funcionando aquí abajo son los
   selectores anclados en clases que esta plantilla pone directamente en su
   propio contenido (.catalog-page__create-icon, .catalog-page__create-form
   :deep(...), y sus equivalentes __edit-* / __lifecycle-*): viajan con el
   elemento sin importar dónde lo monte Vue. */

/* Ficha del encabezado de la ficha de detalle: el retrato de latón
   (BrassMonogram, #799) con la inicial en serif a 24 px, como DialogSeal en
   alta, edición y estado (#791). */
.catalog-page__detail-icon {
  --monogram-size: 44px;
  --monogram-glyph-size: 24px;
}

/* Los campos de alta y edición usan BaseInput v2 tal cual (DEC-188):
   rótulo en texto secundario, borde de control y foco en tinta.

   Botones del pie: el principal de cada diálogo (Guardar, Reactivar…) es su
   única acción con el acento lleno, con el acento del negocio como
   "Agregar servicio"; "Cancelar" es el BaseButton--secondary v2 neutro. */
.catalog-page__create-form :deep(.base-button),
.catalog-page__edit-form :deep(.base-button),
.catalog-page__lifecycle :deep(.base-button) {
  --btn-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);
}

.catalog-page__create-form :deep(.base-button--primary),
.catalog-page__edit-form :deep(.base-button--primary),
.catalog-page__lifecycle :deep(.base-button--primary) {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

.catalog-page__create-form
  :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)),
.catalog-page__edit-form
  :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)),
.catalog-page__lifecycle
  :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  filter: brightness(92%);
}

.catalog-page__create-form
  :deep(.base-button--primary:active:not(:disabled):not(.base-button--loading)),
.catalog-page__edit-form
  :deep(.base-button--primary:active:not(:disabled):not(.base-button--loading)),
.catalog-page__lifecycle
  :deep(.base-button--primary:active:not(:disabled):not(.base-button--loading)) {
  filter: brightness(84%);
}

/* "Desactivar" (variant="danger"): ghost rojo, mismo tratamiento que ya usa
   la acción "Desactivar" de la fila (arriba) — sin relleno, filete inferior
   acentuado — para que la confirmación destructiva se lea consistente con
   el botón que la disparó, en vez del relleno rojo sólido genérico de
   BaseButton (pensado para superficie clara). */
.catalog-page__lifecycle :deep(.base-button--danger) {
  background-color: transparent;
  color: var(--color-danger-on-strong);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.catalog-page__lifecycle
  :deep(.base-button--danger:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  filter: none;
}

.catalog-page__lifecycle
  :deep(.base-button--danger:active:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 20%, transparent);
  filter: none;
}

.catalog-page__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-5);
  flex-wrap: wrap;
}

/* color (issue detectado al verificar en vivo, 2026-09-28): sin esto, el
   párrafo hereda el texto casi negro por defecto de BaseDialog.vue
   (calibrado para su tarjeta blanca), invisible sobre el nuevo fondo de
   tinta de este diálogo. --color-on-strong es el mismo tono que ya usa el
   título del diálogo (bloque sin scope, al final del archivo). */
.catalog-page__lifecycle {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  color: var(--color-on-strong);
}

.catalog-page__lifecycle-lead {
  margin: 0;
  font-size: var(--font-size-body);
}

/* Impacto real (CA-024-01): antes era un segundo párrafo suelto, idéntico
   en peso visual a la frase anterior (issue reportado 2026-09-28, "el
   mensaje... lo veo muy sencillo") — el dato que de verdad importa para
   decidir (¿hay citas futuras?) se perdía entre dos oraciones largas.
   Ahora vive en su propia ficha, mismo lenguaje "hundido sobre tinta" que
   ya usa .catalog-page__list (--color-field-strong/-border), con un
   ícono de estado que resume el resultado antes de leer una palabra. */
.catalog-page__lifecycle-impact {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.catalog-page__lifecycle-impact-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 3px;
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent);
  border-radius: 3px;
  rotate: 45deg;
  color: var(--color-on-strong-muted);
  /* Letra de monograma: sans 600. La serif por debajo de 20 px se ensucia (#726). */
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: var(--font-size-body-sm);
  line-height: 1;
}

/* Sin citas futuras: "✓" en el tinte muted por defecto, la ficha no
   necesita más énfasis que el resto del diálogo — es la respuesta
   tranquilizadora. Con citas futuras: la ficha se tiñe del mismo rojo que
   ya usa el resto de este diálogo para "Desactivar" (ficha del encabezado,
   filete, botón), así el único dato realmente accionable destaca sin
   añadir un color nuevo. */
.catalog-page__lifecycle-impact--warning {
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 40%, transparent);
}

.catalog-page__lifecycle-impact-icon > span {
  rotate: -45deg;
}

.catalog-page__lifecycle-impact--warning .catalog-page__lifecycle-impact-icon {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 16%, transparent);
  color: var(--color-danger-on-strong);
}

.catalog-page__lifecycle-impact-text {
  margin: 0;
  font-size: var(--font-size-body-sm);
}

.catalog-page__lifecycle-note {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-on-strong-muted);
}

/* Diálogo "Estado del servicio", desactivar Y reactivar (issue 2026-09-29,
   "lo veo feo y sencillo", "deja ese... ya que hace ambos" y "solo deja ese
   interruptor"): un interruptor real que es la acción, la ficha del servicio
   y, al reactivar, tres garantías. Sin animaciones de entrada (issue
   2026-09-29, "al abrir esto se demora"): todo está a la vista desde el
   primer cuadro; solo el propio interruptor se desliza al tocarlo. Solo
   colores/espaciados ya existentes en tokens.css; mismo lenguaje "hundido
   sobre tinta" que __lifecycle-impact. */
.catalog-page__lifecycle-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  color: var(--color-on-strong);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.catalog-page__lifecycle-switch:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.catalog-page__lifecycle-switch:disabled {
  cursor: progress;
}

.catalog-page__lifecycle-state {
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Sin interruptor activo, "Activo" queda apagado; con él, "Inactivo". En texto
   secundario y no con opacidad 0,4, que bajaba el contraste a 3,5:1 (#791). */
.catalog-page__lifecycle-switch:not(.catalog-page__lifecycle-switch--on)
  .catalog-page__lifecycle-state--on,
.catalog-page__lifecycle-switch--on
  .catalog-page__lifecycle-state:not(.catalog-page__lifecycle-state--on) {
  color: var(--color-text-secondary);
}

.catalog-page__lifecycle-switch--on .catalog-page__lifecycle-state--on {
  color: var(--color-brass-text);
}

/* Interruptor de la familia (#791, el mismo lenguaje que SwitchField de 8c):
   ranura recta, nunca píldora, y un rombo que avanza dando un cuarto de vuelta.
   Encendido, la ranura se llena de latón. `translate` y `rotate` sueltos para
   que el avance y el giro se compongan sin pisarse. */
.catalog-page__lifecycle-track {
  position: relative;
  flex: 0 0 auto;
  width: 56px;
  height: 28px;
  background-color: var(--color-surface-muted);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: 3px;
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard);
}

.catalog-page__lifecycle-thumb {
  position: absolute;
  top: 50%;
  left: 7px;
  width: 13px;
  height: 13px;
  margin-top: -6.5px;
  background-color: var(--color-text-secondary);
  rotate: 45deg;
  translate: 0 0;
  transition:
    translate 280ms cubic-bezier(0.3, 1.35, 0.5, 1),
    rotate 280ms cubic-bezier(0.3, 1.35, 0.5, 1),
    background-color var(--motion-duration-base) var(--motion-easing-standard);
}

.catalog-page__lifecycle-switch--on .catalog-page__lifecycle-track {
  background-color: var(--color-brass-body);
  border-color: var(--color-brass-text);
}

.catalog-page__lifecycle-switch--on .catalog-page__lifecycle-thumb {
  background-color: var(--color-surface);
  rotate: 135deg;
  translate: 28px 0;
}

.catalog-page__lifecycle-switch:hover:not(:disabled) .catalog-page__lifecycle-track {
  border-color: var(--color-brass-line);
}

.catalog-page__lifecycle-hint {
  margin: calc(var(--space-2) * -1) 0 0;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
  text-align: center;
}

/* Las fichas se reparten en tantas columnas como quepan: la cifra de precio
   («$ 45.000,00 COP» a tamaño h1) necesita ~11,5 rem con su relleno, y a 320 o
   360 px tres columnas la cortaban y desbordaban el diálogo (#791). */
.catalog-page__lifecycle-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr));
  gap: var(--space-2);
  margin: 0;
}

.catalog-page__lifecycle-facts > div {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.catalog-page__lifecycle-facts dt {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.catalog-page__lifecycle-facts dd {
  margin: 0;
  /* Dato, no titular: va en la sans con cifras tabulares (#726). */
  font-family: var(--font-sans);
  font-size: var(--font-size-body);
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.catalog-page__lifecycle-facts dd small {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-on-strong-muted);
  font-family: inherit;
  font-size: var(--font-size-caption);
}

.catalog-page__lifecycle-checks {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-size-body-sm);
}

.catalog-page__lifecycle-checks li {
  position: relative;
  padding-left: var(--space-6);
}

.catalog-page__lifecycle-checks li::before {
  /* Viñeta de dibujo: el texto alternativo vacío la saca del nombre. */
  content: '✓';
  content: '✓' / '';
  position: absolute;
  top: 1px;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background-color: color-mix(in srgb, var(--color-success-on-strong) 16%, transparent);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  color: var(--color-success-on-strong);
  font-size: var(--font-size-caption);
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .catalog-page__lifecycle-state,
  .catalog-page__lifecycle-track,
  .catalog-page__lifecycle-thumb {
    transition: none;
  }
}

/* Detalle del servicio (issue 2026-09-29, rediseñado en el #577): cabecera
   con estado y fechas, una sola ficha de cifras y la descripción. Sin
   entrada escalonada (v2, DEC-188): todo llega con el propio diálogo. */
.catalog-page__detail {
  gap: var(--space-5);
}

/* Ficha de la familia (#762): una tarjeta de papel con filete de latón, como la
   tarjeta de turno. */
.catalog-page__ficha {
  position: relative;
  display: grid;
  gap: var(--space-4);
  padding: 22px 24px 24px;
  background-color: var(--color-surface);
  border: 1px solid var(--color-brass-line);
  border-radius: 4px;
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
}

/* Sello a −4°: latón si el servicio está activo, apagado si no. */
.catalog-page__ficha-seal {
  position: absolute;
  top: 20px;
  right: 20px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  color: var(--color-brass-text);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: 2px solid currentColor;
  border-radius: 3px;
  outline: 1px solid currentColor;
  outline-offset: 2px;
  transform: rotate(-4deg);
}

.catalog-page__ficha-seal--inactive {
  color: var(--color-text-secondary);
}

.catalog-page__ficha-seal-mark {
  width: 7px;
  height: 7px;
  background-color: currentColor;
  transform: rotate(45deg);
}

/* Rótulo de latón en versalitas con su rombo hueco, como los encabezados de la
   tarjeta de turno. */
.catalog-page__ficha-kicker {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  color: var(--color-brass-text);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.catalog-page__ficha-kicker::before {
  flex: none;
  width: 6px;
  height: 6px;
  content: '';
  border: 1.5px solid currentColor;
  transform: rotate(45deg);
}

.catalog-page__ficha-price {
  display: grid;
  gap: 6px;
  margin: 0;
  /* Deja sitio al sello de la esquina. */
  padding-right: 120px;
}

.catalog-page__ficha-price dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 6px;
  margin: 0;
  color: var(--color-text-primary);
}

/* El precio es la cifra protagonista de la ficha: serif grande, como la hora
   de la tarjeta (DEC-189: la serif va en lo que se lee primero y nunca por
   debajo de 20 px). */
.catalog-page__ficha-amount {
  font-family: var(--font-display);
  font-size: 64px;
  font-weight: 400;
  line-height: 0.95;
  letter-spacing: -0.01em;
}

.catalog-page__ficha-symbol {
  align-self: flex-start;
  margin-top: 6px;
  font-family: var(--font-display);
  font-size: 30px;
  line-height: 1;
  color: var(--color-brass-text);
}

.catalog-page__ficha-currency {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.08em;
}

.catalog-page__ficha-leaders {
  display: grid;
  margin: 0;
  padding-top: var(--space-3);
  border-top: 1px dashed var(--color-brass-line);
}

.catalog-page__ficha-leader {
  display: flex;
  /* Si el valor no cabe junto a su etiqueta baja a su propia línea, alineado a
     la derecha, y los puntos guía llenan la primera: nunca se sale ni se parte. */
  flex-wrap: wrap;
  gap: 2px 8px;
  align-items: baseline;
  padding: 6px 0;
}

.catalog-page__ficha-leader dt {
  flex: none;
  max-width: 55%;
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

/* Puntos guía de latón entre la etiqueta y el valor, los mismos del detalle
   del turno (#758). */
.catalog-page__ficha-leader::after {
  order: 1;
  flex: 1 1 24px;
  min-width: 24px;
  height: 2px;
  content: '';
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--color-brass-line) 80%, transparent) 1px,
    transparent 1.3px
  );
  background-repeat: repeat-x;
  background-size: 6px 2px;
  transform: translateY(-3px);
}

.catalog-page__ficha-leader dd {
  flex: none;
  order: 2;
  margin: 0 0 0 auto;
  text-align: right;
  /* Valores cortos (minutos, una fecha): no se parten; cede la línea de puntos. */
  white-space: nowrap;
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.catalog-page__ficha-minutes {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
  line-height: 20px;
}

.catalog-page__ficha-section {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--color-brass-line);
}

/* Llegada (#762): el sello cae con un rebote corto y el precio y los renglones
   suben escalonados. Finita, solo transform y opacidad, y sin movimiento con
   reduce o con el movimiento reducido del panel. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .catalog-page__ficha-price,
  :root:not([data-motion='reduced']) .catalog-page__ficha-leader,
  :root:not([data-motion='reduced']) .catalog-page__ficha-section {
    animation: ficha-rise 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced']) .catalog-page__ficha-leader:nth-child(1) {
    animation-delay: 60ms;
  }

  :root:not([data-motion='reduced']) .catalog-page__ficha-leader:nth-child(2) {
    animation-delay: 110ms;
  }

  :root:not([data-motion='reduced']) .catalog-page__ficha-leader:nth-child(3) {
    animation-delay: 160ms;
  }

  :root:not([data-motion='reduced']) .catalog-page__ficha-section {
    animation-delay: 200ms;
  }

  :root:not([data-motion='reduced']) .catalog-page__ficha-seal {
    animation: ficha-stamp 380ms 240ms cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }
}

@keyframes ficha-rise {
  from {
    opacity: 0;
    translate: 0 6px;
  }
}

@keyframes ficha-stamp {
  from {
    opacity: 0;
    scale: 1.35;
  }
}

/* Las fichas de cifra del diálogo de estado (Desactivar/Reactivar) conservan
   su composición propia. */
.catalog-page__facts-rich {
  gap: var(--space-4);
}

.catalog-page__facts-rich > div {
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.catalog-page__facts-rich dd {
  display: flex;
  align-items: baseline;
  /* Tres fichas: la cifra no cabe a 36 px sin partirse ("45000.0 / 0"), así
     que baja un escalón y la unidad pasa a la línea de abajo cuando falta
     sitio, nunca la cifra. */
  flex-wrap: wrap;
  column-gap: var(--space-2);
  row-gap: 0;
  overflow-wrap: normal;
  font-size: var(--font-size-h1);
  line-height: var(--font-size-h1-line);
}

.catalog-page__facts-rich dd small {
  display: inline;
  flex-basis: auto;
  margin: 0;
  font-size: var(--font-size-body-sm);
}

/* pre-wrap respeta los saltos de línea que la persona escribió; anywhere evita
   que una palabra sin espacios (una URL, 500 caracteres seguidos) ensanche el
   diálogo. */
.catalog-page__detail-text {
  margin: 0;
  color: var(--color-on-strong);
  font-size: var(--font-size-body-lg);
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.catalog-page__detail-text--empty {
  color: var(--color-text-secondary);
}

.catalog-page__detail-footer {
  flex: 1;
  flex-flow: row wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}

@media (max-width: 480px) {
  .catalog-page__ficha {
    padding: 18px 16px 20px;
  }

  /* En angosto el sello sube a su propia línea y el precio usa todo el ancho. */
  .catalog-page__ficha-seal {
    position: static;
    justify-self: start;
    margin: 2px 0 0 4px;
  }

  .catalog-page__ficha-price {
    padding-right: 0;
  }

  .catalog-page__ficha-amount {
    font-size: 52px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-page__item-chevron,
  .catalog-page__row {
    transition: none;
  }
}

/* Zona media 641–960px (issue reportado 2026-09-28, "los botones se
   desencajan todo raro"): entre el ancho de escritorio completo y el
   quiebre móvil de abajo, las columnas fijas (duración/precio/estado/
   acciones) ya no cabían junto al mínimo de 220px de la columna de
   nombre — el navegador forzaba ese mínimo y el resto de la fila se salía
   del ancho visible, recortando literalmente "Editar"/"Desactivar"
   (medido en vivo: a 850px ya no se veían, a 950px sí). Se acortan las
   columnas y los botones (más angostos, sin apilar: apilarlos exigiría
   una fila más alta que el resto de este quiebre, y el alto de fila es
   FIJO, ver ROW_HEIGHT_PX en el script) hasta que quepan de sobra junto al
   mínimo de la columna de nombre, verificado en vivo en todo el rango
   641–960px. */
@media (max-width: 960px) and (min-width: 641px) {
  .catalog-page {
    padding-inline: 20px;
  }

  .catalog-page__columns,
  .catalog-page__row {
    grid-template-columns: minmax(100px, 1fr) 64px 100px 88px 156px;
    gap: 8px;
  }

  .catalog-page__table--offer .catalog-page__columns,
  .catalog-page__table--offer .catalog-page__row {
    grid-template-columns: minmax(70px, 1fr) 56px 82px 70px 60px 140px;
  }

  .catalog-page__item-meta {
    font-size: var(--font-size-body-sm);
  }

  .catalog-page__item-actions {
    gap: 4px;
  }

  .catalog-page__item-actions :deep(.base-button) {
    height: 32px;
    padding-inline: 6px;
    font-size: var(--font-size-caption);
  }
}

/* Pantallas bajas con ancho de escritorio/tableta: se compacta la cabecera y
   la fila (64px) para ganar filas visibles sin scroll general. Debe coincidir
   con ROW_HEIGHT_COMPACT_PX / COMPACT_QUERY del script. */
@media (min-width: 641px) and (max-height: 820px) {
  .catalog-page {
    gap: 12px;
    padding-top: 20px;
  }

  .catalog-page__subtitle {
    display: none;
  }

  .catalog-page__row {
    height: 64px;
    padding-block: 10px;
  }

  .catalog-page__item-icon {
    --monogram-size: 36px;
  }
}

@media (max-width: 640px) {
  .catalog-page {
    gap: 12px;
    padding: 16px 16px 28px;
  }

  .catalog-page__header {
    padding-bottom: 10px;
  }

  .catalog-page__search {
    max-width: none;
  }

  .catalog-page__header-action {
    min-height: var(--control-height-icon);
  }

  .catalog-page__create.base-button {
    width: var(--control-height-icon);
    height: var(--control-height-icon);
    padding: 0;
    overflow: hidden;
    font-size: 0;
  }

  .catalog-page__create :deep(.base-button__content) {
    font-size: 0;
  }

  .catalog-page__create :deep(.base-button__content)::before {
    margin: 0;
    font-size: var(--font-size-title-item);
  }

  .catalog-page__columns {
    display: none;
  }

  /* 100px, no 62px (issue detectado al verificar en vivo, 2026-09-28,
     "que se adapte según la pantalla, que no haya scroll"): en móvil la
     fila apila DOS filas internas de grid (nombre+descripción arriba,
     duración+acciones abajo) — 62px alcanzaba de sobra cuando la
     descripción envolvía a varias líneas (min-height se estiraba), pero
     con alto FIJO (obligatorio para poder predecir cuántas filas caben,
     ver ROW_HEIGHT_MOBILE_PX en el script) recortaba el botón
     "Desactivar" por abajo. 100px es lo medido en vivo que ambas filas
     internas necesitan sin recortarse. */
  /* Tarjeta de tres franjas (nombre+estado / duración+precio+«Lo ofrezco» /
     acciones a todo el ancho). Antes las acciones compartían franja con el
     nombre y lo dejaban en ~100px ("Cor…") y el interruptor se montaba sobre
     la duración. 116px es el alto FIJO medido: 8+28 (nombre) +4 +28 (datos)
     +4 +36 (acciones) +8; debe coincidir con ROW_HEIGHT_MOBILE_PX. */
  .catalog-page__row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: 28px 28px 36px;
    gap: 4px 8px;
    height: 116px;
    padding: 8px 10px;
  }

  .catalog-page__item-heading {
    grid-column: 1 / 3;
    grid-row: 1;
  }

  .catalog-page__item-heading {
    gap: 9px;
  }

  .catalog-page__item-icon {
    --monogram-size: 28px;
    --monogram-glyph-size: var(--font-size-body-sm);
    --monogram-pendant: 8px;
  }

  .catalog-page__item-name {
    font-size: var(--font-size-body-sm);
  }

  .catalog-page__item-duration,
  .catalog-page__item-price {
    grid-row: 2;
    font-size: var(--font-size-caption);
    white-space: nowrap;
  }

  .catalog-page__item-duration {
    grid-column: 1;
    /* 28px de ficha + 9px de espacio del heading (arriba): alinea bajo el
       nombre en vez de bajo la ficha. */
    margin-left: 37px;
  }

  /* El precio ya no se oculta en móvil: hay sitio en la franja de datos. */
  .catalog-page__item-price {
    grid-column: 2;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Antes ambos compartían "1 / span 2" (misma celda que "Editar"/
     "Desactivar"): con dos elementos independientes centrados en la MISMA
     área, el texto de la insignia y los botones quedaban superpuestos
     (encontrado 2026-09-28 al revisar el nuevo alto de fila con
     descripción). Cada uno a su propia fila —insignia junto al nombre,
     acciones junto a la duración— evita el choque sin tocar el marcado. */
  .catalog-page__row > :deep(.base-badge) {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
  }

  /* Acciones a todo el ancho y con 36px de alto (más cerca del objetivo táctil
     recomendado que los 34px anteriores). */
  .catalog-page__item-actions {
    grid-column: 1 / -1;
    grid-row: 3;
    gap: 8px;
  }

  .catalog-page__item-actions :deep(.base-button) {
    flex: 1 1 0;
    height: 36px;
    padding-inline: 10px;
    font-size: var(--font-size-caption);
  }

  /* La regla de seis columnas de «Lo ofrezco» pesa más que la de móvil de arriba: se
     devuelve aquí la cuadrícula de tres columnas de la tarjeta. */
  .catalog-page__table--offer .catalog-page__row {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  /* «Lo ofrezco» (DEC-115): al extremo derecho de la franja de datos, en su
     propia columna, así ya no se monta sobre la duración. */
  .catalog-page__item-offer {
    grid-column: 3;
    grid-row: 2;
    justify-self: end;
  }

  .catalog-page__subtitle {
    display: none;
  }
}
</style>

<style>
/* SIN "scoped" a propósito (issue 2026-09-28, "sigue blanco y no respetas
   los colores del fondo"; luego "aplica eso mismo para las pantallas
   emergentes de editar y eliminar"): BaseDialog.vue renderiza sus tres
   diálogos en <Teleport to="body">, así que su tarjeta, encabezado,
   título, descripción y botón de cerrar dejan de ser descendientes de
   .catalog-page en el DOM real. Un :deep() con alcance de componente
   (arriba, <style scoped>) sigue anteponiendo el atributo de scope de
   CatalogPage.vue como ancestro exigido (así lo compila Vue, con o sin un
   selector propio delante), y ese ancestro ya no existe tras el
   teletransporte — por eso esas reglas nunca llegaban a aplicarse pese a
   compilar sin error. Este bloque selecciona por nombre de clase real, sin
   atributo de scope, así que no depende de dónde Vue monte el nodo.
   .catalog-page__create-dialog / __edit-dialog / __lifecycle-dialog son
   nombres exclusivos de esta pantalla, no genéricos, así que el riesgo de
   colisión con otra hoja es nulo. El !important es necesario porque la
   regla propia de BaseDialog.vue tiene la MISMA especificidad (una clase +
   un atributo de scope) y el orden en que Vite inserta el <style> de cada
   componente en el documento final no está garantizado — sin !important,
   quién gana dependería de ese orden, no de cuál regla describe este
   diálogo en particular. Contenido a esta única pantalla (nunca a
   BaseDialog.vue ni a otro diálogo de la app). */
.catalog-page__create-dialog.base-dialog,
.catalog-page__edit-dialog.base-dialog,
.catalog-page__detail-dialog.base-dialog,
.catalog-page__lifecycle-dialog.base-dialog {
  background-color: var(--color-surface) !important;
  border: var(--border-width-normal) solid var(--color-border-subtle) !important;
}

/* Detalle, alta y edición se ensanchan a 720 px (size="lg"): con size="sm" los
   campos quedaban apretados en una columna de 360 px. Sin ancho explícito el
   diálogo se ajusta al contenido y max-width del contenedor no basta. */
.catalog-page__detail-dialog.base-dialog,
.catalog-page__create-dialog.base-dialog,
.catalog-page__edit-dialog.base-dialog,
.catalog-page__lifecycle-dialog.base-dialog {
  width: min(100%, 720px) !important;
}

/* v2 (DEC-188): la apertura usa la curva estándar de BaseDialog (sin rebote) y
   el encabezado conserva su separador sutil de 1px; el filete de acento de
   v1 se quitó. "Desactivar" ya avisa con su ficha roja. */

.catalog-page__create-dialog .base-dialog__title,
.catalog-page__edit-dialog .base-dialog__title,
.catalog-page__detail-dialog .base-dialog__title,
.catalog-page__lifecycle-dialog .base-dialog__title {
  color: var(--color-on-strong) !important;
}

/* En la ficha (#762) el nombre es el título de la tarjeta, en serif, y el
   monograma lleva el filete y el rombo de latón del detalle del turno (#757);
   las letras siguen en sans 600 (DEC-189). */
.catalog-page__detail-dialog .base-dialog__title {
  overflow-wrap: anywhere;
  font-family: var(--font-display) !important;
  font-size: 30px !important;
  font-weight: 400 !important;
  line-height: 1.1 !important;
}

.catalog-page__detail-dialog .base-dialog__footer {
  border-top-color: var(--color-field-strong-border) !important;
}

.catalog-page__create-dialog .base-dialog__description,
.catalog-page__edit-dialog .base-dialog__description,
.catalog-page__detail-dialog .base-dialog__description,
.catalog-page__lifecycle-dialog .base-dialog__description {
  color: var(--color-on-strong-muted) !important;
}

.catalog-page__create-dialog .base-dialog__close,
.catalog-page__edit-dialog .base-dialog__close,
.catalog-page__detail-dialog .base-dialog__close,
.catalog-page__lifecycle-dialog .base-dialog__close {
  color: var(--color-on-strong-muted) !important;
}

.catalog-page__create-dialog .base-dialog__close:hover,
.catalog-page__edit-dialog .base-dialog__close:hover,
.catalog-page__detail-dialog .base-dialog__close:hover,
.catalog-page__lifecycle-dialog .base-dialog__close:hover {
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent) !important;
  color: var(--color-on-strong) !important;
}

.catalog-page__create-dialog .base-dialog__close:focus-visible,
.catalog-page__edit-dialog .base-dialog__close:focus-visible,
.catalog-page__detail-dialog .base-dialog__close:focus-visible,
.catalog-page__lifecycle-dialog .base-dialog__close:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus) !important;
}
</style>
