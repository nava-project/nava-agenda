<script setup lang="ts">
// Pantalla "Profesionales" (HU-021, DEC-104): consultar y listar el equipo del
// negocio activo, agregar un profesional, renombrarlo y ponerle (o quitarle) una
// fotografía. Un negocio unipersonal y una de cuatro personas usan
// exactamente el mismo componente y el mismo estado de datos (CA-021-01/02): la
// lista con 1 elemento y la lista con 4 no tienen ninguna rama especial.
// Estados discriminados: carga inicial, listo, vacío, error recuperable,
// guardando (trabajo requerido §4.3/§4.4). Un error recuperable NUNCA borra lo
// que el profesional ya escribió ni la foto que ya eligió; solo un guardado exitoso
// confirmado por el servidor cierra el diálogo. Cada guardado confirmado añade
// un aviso emergente (DEC-095); los errores siguen dentro del diálogo, junto al
// formulario. Mismo lenguaje visual v2 que Servicios (DEC-188: tarjeta con
// borde sutil, rótulos en tipo oración, el acento solo en «Agregar
// profesional», sin entradas animadas) con el retrato del profesional como
// protagonista.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { PAGE_MIN_HOLD_MS, useMinHoldLoading, useToast, useVocabulary } from '@/shared/composables'
import {
  ProfessionalAvatar,
  BaseAlert,
  BasePagination,
  EmptyScene,
  BaseButton,
  BaseDialog,
  BaseInput,
  DiamondLoader,
} from '@/shared/ui'
import {
  professionalPhotoUrl,
  createProfessional,
  fetchProfessionalPage,
  fetchMyProfessional,
  linkMyProfessional,
  removeProfessionalPhoto,
  renameProfessional,
  unlinkMyProfessional,
  uploadProfessionalPhoto,
} from '../api/staffApi'
import ProfessionalPhotoField from '../components/ProfessionalPhotoField.vue'
import ProfessionalDescriptionField from '../components/ProfessionalDescriptionField.vue'
import MyProfileCard from '../components/MyProfileCard.vue'
import ProfessionalReviewsPanel from '../components/ProfessionalReviewsPanel.vue'
import { newIdempotencyKey } from '../model/idempotencyKey'
import type { Professional } from '../model/professional'
import { NO_PHOTO_CHANGE, type PhotoDraft } from '../model/photoDraft'
import { capitalize, isEmployeeProfile, worksOwnProfessional } from '@/shared/model'
import { validateDescription, validateFullName } from '../validation/staffValidation'

const toast = useToast()
// Palabras del negocio (DEC-110): con los valores iniciales, el mismo texto de siempre.
const v = useVocabulary()

type LoadStatus = 'loading' | 'ready' | 'load-error'
type SaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'idempotency-conflict'
  | 'not-found'
  | 'photo-error'
  | 'network-error'
  | 'unexpected-error'

const loadStatus = ref<LoadStatus>('loading')
const professionals = ref<Professional[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const totalItems = ref(0)
const totalPages = ref(1)
const pageLoading = ref(false)
const pageFailed = ref(false)
const justAddedId = ref<string | null>(null)
const listRef = ref<HTMLElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)
const pageRef = ref<HTMLElement | null>(null)
const fitPending = ref(true)
const { start: startLoadingHold, hold: holdLoadingReveal } = useMinHoldLoading()
const { start: startPageHold, hold: holdPageReveal } = useMinHoldLoading(PAGE_MIN_HOLD_MS)
let requestToken = 0
let lastRequestedPage = 1
let pendingPaginationFocus = false
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined

async function load(page = 1, initial = false) {
  if (initial) pendingPaginationFocus = false
  else if (
    document.activeElement instanceof HTMLElement &&
    document.activeElement.closest('.base-pagination__nav')
  )
    pendingPaginationFocus = true
  const token = ++requestToken
  lastRequestedPage = page
  if (initial) {
    loadStatus.value = 'loading'
    startLoadingHold()
  } else {
    pageLoading.value = true
    pageFailed.value = false
    startPageHold()
  }
  const outcome = await fetchProfessionalPage(page, pageSize.value)
  if (token !== requestToken) return
  const reveal = () => {
    if (token !== requestToken) return
    pageLoading.value = false
    if (outcome.kind === 'success') {
      professionals.value = outcome.page.items
      currentPage.value = outcome.page.page
      pageSize.value = outcome.page.pageSize
      totalItems.value = outcome.page.total
      totalPages.value = outcome.page.totalPages
      loadStatus.value = 'ready'
      // La tarjeta del perfil individual no pagina ni mide filas de tabla
      // (DEC-115): sin esto, fitPending se quedaría en true para siempre
      // porque listRef nunca se monta en ese caso.
      if (professionals.value.length === 0 || soloCard.value) fitPending.value = false
    } else if (initial) loadStatus.value = 'load-error'
    else pageFailed.value = true
    if (pendingPaginationFocus) {
      void nextTick(() => {
        if (token !== requestToken) return
        const active = document.activeElement
        if (
          active === document.body ||
          (active instanceof HTMLElement && active.closest('.base-pagination__nav'))
        ) {
          footerRef.value?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
        }
        pendingPaginationFocus = false
      })
    }
  }
  if (initial) holdLoadingReveal(reveal)
  else holdPageReveal(reveal)
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) return node
    node = node.parentElement
  }
  return null
}

// DEC-107: mide el visor real, las filas y el pie; no oculta overflow para
// aparentar que caben filas. El padding cambia en móvil y también se mide.
async function fitPage() {
  await nextTick()
  const list = listRef.value,
    footer = footerRef.value,
    page = pageRef.value
  if (!list || !footer || !page) {
    fitPending.value = false
    return
  }
  const parent = scrollParent(list)
  if (!parent) {
    fitPending.value = false
    return
  }
  const row = list.querySelector<HTMLElement>('.staff-page__row, .staff-page__skeleton-row')
  const height = row?.getBoundingClientRect().height
  if (!height) {
    fitPending.value = false
    return
  }
  const listRect = list.getBoundingClientRect(),
    footerRect = footer.getBoundingClientRect()
  const gap = Math.max(0, footerRect.top - listRect.bottom)
  const pageStyle = getComputedStyle(page)
  const bottomPadding = parseFloat(pageStyle.paddingBottom)
  // La pantalla se centra en vertical cuando la lista es corta (issue #575):
  // el hueco que el centrado deja arriba no es espacio ocupado, así que se
  // descuenta para que el número de filas no dependa de cuánto se centró.
  const header = page.querySelector<HTMLElement>('.staff-page__header')
  const rawOffset = header
    ? header.getBoundingClientRect().top -
      page.getBoundingClientRect().top -
      (parseFloat(pageStyle.paddingTop) || 0)
    : 0
  const centeringOffset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0
  const available =
    parent.clientHeight -
    (listRect.top - centeringOffset - parent.getBoundingClientRect().top + parent.scrollTop) -
    gap -
    footerRect.height -
    bottomPadding -
    2
  const fitting = Math.max(1, Math.min(50, Math.floor(available / height)))
  if (fitting !== pageSize.value) {
    const firstIndex = (currentPage.value - 1) * pageSize.value
    pageSize.value = fitting
    const targetPage = Math.floor(firstIndex / fitting) + 1
    // Recortar la primera carga evita un segundo lote grande en pantalla.
    if (currentPage.value === 1 && !pageLoading.value && fitting <= professionals.value.length) {
      professionals.value = professionals.value.slice(0, fitting)
      totalPages.value = Math.max(1, Math.ceil(totalItems.value / fitting))
    } else {
      await load(targetPage)
    }
  }
  parent.scrollTop = 0
  fitPending.value = false
}

function scheduleFit() {
  if (resizeTimer !== undefined) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    void fitPage()
  }, 120)
}
watch(
  listRef,
  async (el) => {
    if (!el) return
    await fitPage()
    if (typeof ResizeObserver !== 'undefined') {
      observer?.disconnect()
      observer = new ResizeObserver(scheduleFit)
      const parent = scrollParent(el)
      if (parent) observer.observe(parent)
      const header = pageRef.value?.querySelector('.staff-page__header')
      if (header) observer.observe(header)
    }
  },
  { flush: 'post' },
)
onMounted(() => {
  void load(1, true)
  void loadMyProfessional()
  window.addEventListener('resize', scheduleFit)
})
onUnmounted(() => {
  ++requestToken
  observer?.disconnect()
  window.removeEventListener('resize', scheduleFit)
  if (resizeTimer !== undefined) clearTimeout(resizeTimer)
})
function onRetryLoad() {
  void load(1, true)
}
function goToPage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value || pageLoading.value) return
  void load(page)
}
// Perfil de profesional individual (DEC-115): esta pantalla es la ficha de quien trabaja
// solo. `soloView` cambia los textos; `soloCard` (un único profesional ya cargado) además
// quita lo que solo tiene sentido con un equipo: «Agregar», encabezados de tabla y
// paginador. Con más de un profesional la pantalla vuelve a ser la de siempre.
// El empleado (DEC-173) ve la misma ficha: el API solo le devuelve su profesional, y
// no puede dar de alta, vincularse ni moderar reseñas, así que esas acciones no se ofrecen.
const soloView = computed(
  () => worksOwnProfessional.value && !(loadStatus.value === 'ready' && totalItems.value > 1),
)
// Cuadro lateral de reseñas abierto (issue #487): la ficha deja de centrarse sola.
const soloReviewsOpen = ref(false)
const soloCard = computed(
  () => soloView.value && loadStatus.value === 'ready' && totalItems.value === 1,
)

const countLabel = computed(
  () =>
    `${totalItems.value} ${totalItems.value === 1 ? v.value.professional : v.value.professionals}`,
)
// Fotografía (DEC-104): la URL solo existe cuando el profesional tiene una.
function photoOf(professional: Professional): string | null {
  return professionalPhotoUrl(professional)
}

function hasPhoto(professional: Professional): boolean {
  return professional.photoUpdatedAt !== null
}

// Monograma de la ficha del encabezado de un diálogo: la primera letra del
// nombre, la misma inicial que abre el retrato sin foto de la fila.
function firstInitial(fullName: string): string {
  return fullName.trim().charAt(0).toUpperCase()
}

// Fecha de alta. Zona fija de la moneda del contrato (COP, DEC-067), igual que
// Servicios, para que la fecha no dependa del huso del equipo.
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

function replaceInList(professional: Professional) {
  const index = professionals.value.findIndex((b) => b.id === professional.id)
  if (index !== -1) professionals.value[index] = professional
}

// --- Detalle --------------------------------------------------------------

// detailTarget no se borra al cerrar: el diálogo sigue visible mientras dura su
// animación de salida y vaciarlo aquí lo dejaría en blanco a media salida.
const isDetailOpen = ref(false)
const detailTarget = ref<Professional | null>(null)

// Moderar una reseña cambia el promedio que el servidor calcula (DEC-128): se refleja
// en la fila y en el detalle sin recargar la página de profesionales.
function onReviewsChanged(
  professionalId: string,
  summary: { rating: number | null; ratingCount: number },
) {
  professionals.value = professionals.value.map((b) =>
    b.id === professionalId ? { ...b, ...summary } : b,
  )
  if (detailTarget.value?.id === professionalId) {
    detailTarget.value = { ...detailTarget.value, ...summary }
  }
}

function openDetailDialog(professional: Professional) {
  detailTarget.value = professional
  linkError.value = null
  isDetailOpen.value = true
}

// --- Vínculo con mi usuario (DEC-100) ---------------------------------------

// Cuál profesional es el usuario autenticado, o null si ninguno (el vínculo es
// opcional). Se lee una vez al montar; si falla, la ficha simplemente no ofrece
// la acción en vez de bloquear la pantalla: el equipo se consulta igual.
const myProfessionalId = ref<string | null>(null)
const myProfessionalKnown = ref(false)
const linkStatus = ref<'idle' | 'saving'>('idle')
const linkError = ref<string | null>(null)

async function loadMyProfessional() {
  const outcome = await fetchMyProfessional()
  if (outcome.kind === 'linked') myProfessionalId.value = outcome.professional.id
  else if (outcome.kind === 'none') myProfessionalId.value = null
  myProfessionalKnown.value = outcome.kind === 'linked' || outcome.kind === 'none'
}

const detailIsMine = computed(
  () => detailTarget.value !== null && detailTarget.value.id === myProfessionalId.value,
)

async function onToggleMine() {
  const professional = detailTarget.value
  if (!professional || linkStatus.value === 'saving') return
  linkStatus.value = 'saving'
  linkError.value = null
  if (detailIsMine.value) {
    const outcome = await unlinkMyProfessional()
    if (outcome.kind === 'success') {
      myProfessionalId.value = null
      toast.success(`Ya no eres ${professional.fullName} en Nava Agenda`)
    } else {
      linkError.value = 'No pudimos quitar el vínculo. Inténtalo de nuevo.'
    }
  } else {
    const outcome = await linkMyProfessional(professional.id)
    if (outcome.kind === 'success') {
      myProfessionalId.value = professional.id
      toast.success(`Ahora eres ${professional.fullName} en Nava Agenda`, {
        detail: 'Siguiente paso: conecta tu Google Calendar desde esta ficha.',
      })
    } else if (outcome.kind === 'taken') {
      linkError.value = `Este ${v.value.professional} ya está vinculado a otro usuario.`
    } else if (outcome.kind === 'not-found') {
      linkError.value = `Este ${v.value.professional} ya no existe.`
    } else {
      linkError.value = 'No pudimos guardar el vínculo. Inténtalo de nuevo.'
    }
  }
  linkStatus.value = 'idle'
}

function onDetailEdit() {
  const professional = detailTarget.value
  if (!professional) return
  isDetailOpen.value = false
  openRenameDialog(professional)
}

// --- Alta -----------------------------------------------------------------

const isCreateOpen = ref(false)
const createFullName = ref('')
const createFieldError = ref<string | undefined>(undefined)
const createDescription = ref('')
const createDescriptionError = ref<string | undefined>(undefined)
const createStatus = ref<SaveStatus>('idle')
const createAttempted = ref(false)
const createPhotoDraft = ref<PhotoDraft>(NO_PHOTO_CHANGE)
// Clave de idempotencia del intento lógico vigente (RN-IDE-01): se genera
// al abrir el diálogo y se REUTILIZA en cada reintento del mismo intento;
// solo un envío exitoso o cerrar y reabrir el diálogo la renueva (mismo
// intento lógico != mismo clic).
let createIdempotencyKey = newIdempotencyKey()

function openCreateDialog() {
  createFullName.value = ''
  createFieldError.value = undefined
  createDescription.value = ''
  createDescriptionError.value = undefined
  createStatus.value = 'idle'
  createAttempted.value = false
  createPhotoDraft.value = NO_PHOTO_CHANGE
  createIdempotencyKey = newIdempotencyKey()
  isCreateOpen.value = true
}

function onCreateDialogClosed() {
  // Cerrar sin guardar también es un intento lógico terminado: la próxima
  // apertura genera una clave nueva (ya cubierto por openCreateDialog,
  // aquí solo se limpia el estado visual para que no "parpadee" un error
  // viejo si se reabre).
  createStatus.value = 'idle'
}

function onCreateFullNameInput(value: string | number) {
  createFullName.value = String(value)
  if (createAttempted.value)
    createFieldError.value = validateFullName(createFullName.value, v.value)
}

function onCreateDescriptionInput(value: string) {
  createDescription.value = value
  if (createAttempted.value) createDescriptionError.value = validateDescription(value)
}

async function onSubmitCreate() {
  if (createStatus.value === 'saving') return

  createAttempted.value = true
  const error = validateFullName(createFullName.value, v.value)
  const descriptionError = validateDescription(createDescription.value)
  createFieldError.value = error
  createDescriptionError.value = descriptionError
  if (error || descriptionError) return

  createStatus.value = 'saving'
  const outcome = await createProfessional(
    createFullName.value.trim(),
    createIdempotencyKey,
    createDescription.value,
  )

  switch (outcome.kind) {
    case 'success':
      await onProfessionalCreated(outcome.professional)
      return
    case 'validation-error':
      createStatus.value = 'validation-error'
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

// El profesional ya existe en el servidor: aunque la foto falle, el alta está
// hecha. Por eso el diálogo se cierra igual y el fallo de la foto se avisa
// aparte, con la salida (Editar) a la vista, en vez de dejar al profesional
// atrapado en un formulario que ya no puede repetir el alta.
async function onProfessionalCreated(created: Professional) {
  let professional = created
  const draft = createPhotoDraft.value
  let photoFailed = false

  if (draft.kind === 'new') {
    const photo = await uploadProfessionalPhoto(created.id, draft.blob)
    if (photo.kind === 'success') professional = photo.professional
    else photoFailed = true
  }

  totalItems.value += 1
  totalPages.value = Math.max(1, Math.ceil(totalItems.value / pageSize.value))
  await load(totalPages.value)
  justAddedId.value = professional.id
  isCreateOpen.value = false
  createStatus.value = 'idle'
  createPhotoDraft.value = NO_PHOTO_CHANGE

  if (photoFailed) {
    toast.warning(
      `${v.value.Professional} agregad${v.value.professionalEnding}, pero no pudimos guardar la foto`,
      {
        detail: 'Ábrelo con «Editar» para intentarlo de nuevo.',
      },
    )
    return
  }
  toast.success(`${v.value.Professional} agregad${v.value.professionalEnding}`, {
    detail: 'Ya aparece en tu equipo.',
  })
}

// --- Edición (nombre y foto) ------------------------------------------------

const isRenameOpen = ref(false)
const renameTarget = ref<Professional | null>(null)
const renameFullName = ref('')
const renameFieldError = ref<string | undefined>(undefined)
const renameDescription = ref('')
const renameDescriptionError = ref<string | undefined>(undefined)
const renameStatus = ref<SaveStatus>('idle')
const renameAttempted = ref(false)
const renamePhotoDraft = ref<PhotoDraft>(NO_PHOTO_CHANGE)

function openRenameDialog(professional: Professional) {
  renameTarget.value = professional
  renameFullName.value = professional.fullName
  renameFieldError.value = undefined
  renameDescription.value = professional.description ?? ''
  renameDescriptionError.value = undefined
  renameStatus.value = 'idle'
  renameAttempted.value = false
  renamePhotoDraft.value = NO_PHOTO_CHANGE
  isRenameOpen.value = true
}

function onRenameDialogClosed() {
  renameStatus.value = 'idle'
}

function onRenameFullNameInput(value: string | number) {
  renameFullName.value = String(value)
  if (renameAttempted.value)
    renameFieldError.value = validateFullName(renameFullName.value, v.value)
}

function onRenameDescriptionInput(value: string) {
  renameDescription.value = value
  if (renameAttempted.value) renameDescriptionError.value = validateDescription(value)
}

type StepFailure = 'validation-error' | 'not-found' | 'network-error' | 'unexpected-error'

// Un fallo de la foto (formato, tamaño) no es un error de campo del nombre: se
// muestra con su propio mensaje. Los demás se traducen igual que el nombre.
function failureStatus(kind: StepFailure, isPhoto: boolean): SaveStatus {
  if (kind === 'validation-error') return isPhoto ? 'photo-error' : 'validation-error'
  return kind
}

// Guardar aplica en orden lo que cambió: primero el nombre y la descripción (un
// solo PATCH) y luego la foto. Cada
// paso confirmado actualiza al profesional de la lista y el objetivo del diálogo,
// así un reintento tras un fallo a medias (el nombre ya quedó, la foto no)
// nunca repite lo que ya se guardó. Sin cambios no envía nada.
async function onSubmitRename() {
  const target = renameTarget.value
  if (renameStatus.value === 'saving' || !target) return

  renameAttempted.value = true
  const error = validateFullName(renameFullName.value, v.value)
  const descriptionError = validateDescription(renameDescription.value)
  renameFieldError.value = error
  renameDescriptionError.value = descriptionError
  if (error || descriptionError) return

  const fullName = renameFullName.value.trim()
  const description = renameDescription.value.trim()
  const nameChanged = fullName !== target.fullName
  const descriptionChanged = description !== (target.description ?? '')
  const detailsChanged = nameChanged || descriptionChanged
  const draft = renamePhotoDraft.value
  if (!detailsChanged && draft.kind === 'none') {
    isRenameOpen.value = false
    return
  }

  renameStatus.value = 'saving'
  let current = target

  if (detailsChanged) {
    // La descripción solo viaja si cambió: si no, el PATCH la conserva.
    const renamed = await renameProfessional(
      current.id,
      fullName,
      descriptionChanged ? description : undefined,
    )
    if (renamed.kind !== 'success') {
      renameStatus.value = failureStatus(renamed.kind, false)
      return
    }
    current = renamed.professional
    renameTarget.value = current
    replaceInList(current)
  }

  if (draft.kind === 'new') {
    const uploaded = await uploadProfessionalPhoto(current.id, draft.blob)
    if (uploaded.kind !== 'success') {
      renameStatus.value = failureStatus(uploaded.kind, true)
      return
    }
    current = uploaded.professional
    renameTarget.value = current
    replaceInList(current)
  } else if (draft.kind === 'remove') {
    const removed = await removeProfessionalPhoto(current.id)
    if (removed.kind !== 'success') {
      renameStatus.value = failureStatus(removed.kind, true)
      return
    }
    current = { ...current, photoUpdatedAt: null }
    renameTarget.value = current
    replaceInList(current)
  }

  isRenameOpen.value = false
  renameStatus.value = 'idle'
  renamePhotoDraft.value = NO_PHOTO_CHANGE

  if (nameChanged && !descriptionChanged && draft.kind === 'none') {
    toast.success('Nombre actualizado', {
      detail: `Guardamos el nuevo nombre ${v.value.ofTheProfessional}.`,
    })
  } else if (!nameChanged && descriptionChanged && draft.kind === 'none') {
    toast.success('Descripción actualizada', {
      detail: 'Los clientes la verán al elegir en la reserva.',
    })
  } else if (!detailsChanged && draft.kind === 'new') {
    toast.success('Foto actualizada', { detail: 'El nuevo retrato ya aparece en tu equipo.' })
  } else if (!detailsChanged && draft.kind === 'remove') {
    toast.success('Foto quitada', {
      detail: `${capitalize(v.value.theProfessional)} vuelve a mostrarse con su monograma.`,
    })
  } else {
    toast.success(`${v.value.Professional} actualizad${v.value.professionalEnding}`, {
      detail: `Guardamos los cambios ${v.value.ofTheProfessional}.`,
    })
  }
}
</script>

<template>
  <section ref="pageRef" class="staff-page" aria-labelledby="staff-page-title">
    <header class="staff-page__header">
      <div>
        <h1 id="staff-page-title" class="staff-page__title">
          {{ soloView ? 'Mi perfil' : v.Professionals }}
        </h1>
        <p class="staff-page__subtitle">
          {{
            soloView
              ? 'Tu ficha en Nava Agenda: nombre, foto y bloqueos.'
              : 'Tu equipo en Nava Agenda.'
          }}
        </p>
      </div>
      <!-- Una acción principal por región: con el equipo vacío, el CTA vive en el
           propio estado vacío y no se repite en la cabecera. -->
      <BaseButton
        v-if="loadStatus === 'ready' && professionals.length > 0 && !soloCard && !isEmployeeProfile"
        type="button"
        variant="primary"
        class="staff-page__create"
        @click="openCreateDialog"
      >
        Agregar {{ v.professional }}
      </BaseButton>
    </header>

    <!-- Un solo fundido entre carga/error/listo (mismo criterio que Servicios):
         sin esto el paso del cargador a la lista real sería un corte seco.
         mode="out-in" espera a que lo anterior termine de desvanecerse. -->
    <Transition name="staff-content" mode="out-in">
      <div
        v-if="loadStatus === 'loading'"
        class="staff-page__state staff-page__loading"
        role="status"
        aria-live="polite"
      >
        <DiamondLoader label="Cargando el equipo…" layout="inline" />
        <ul class="staff-page__list" aria-hidden="true">
          <li v-for="n in 3" :key="n" class="staff-page__skeleton-row">
            <span class="staff-page__skeleton-portrait" />
            <span class="staff-page__skeleton-text">
              <span class="staff-page__skeleton-bar staff-page__skeleton-bar--name" />
              <span class="staff-page__skeleton-bar staff-page__skeleton-bar--meta" />
            </span>
            <span class="staff-page__skeleton-bar staff-page__skeleton-bar--button" />
          </li>
        </ul>
      </div>

      <BaseAlert
        v-else-if="loadStatus === 'load-error'"
        variant="warning"
        title="No pudimos cargar el equipo"
        role="alert"
      >
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton variant="secondary" type="button" @click="onRetryLoad">Reintentar</BaseButton>
        </template>
      </BaseAlert>

      <div
        v-else
        class="staff-page__ready"
        :class="{ 'staff-page__ready--fitting': fitPending }"
        :aria-busy="pageLoading"
      >
        <EmptyScene v-if="professionals.length === 0" scene="team" class="staff-page__empty">
          <template #title>{{
            soloView ? 'Aún no tienes tu perfil.' : `Aún no tienes ${v.professionalsRegistered}.`
          }}</template>
          <template #hint>
            {{
              isEmployeeProfile
                ? `Pídele ${v.toTheBusiness} que vincule tu usuario con tu perfil de ${v.professional}.`
                : soloView
                  ? 'Créalo con tu nombre y, si quieres, tu foto: tu agenda y tus horarios cuelgan de él.'
                  : 'Agrega al primero de tu equipo: con su nombre y, si quieres, su foto.'
            }}
          </template>
          <template v-if="!isEmployeeProfile" #action>
            <BaseButton type="button" variant="primary" @click="openCreateDialog">
              {{ soloView ? 'Crear mi perfil' : `Agregar ${v.professional}` }}
            </BaseButton>
          </template>
        </EmptyScene>

        <!-- Perfil individual (DEC-115): su propia tarjeta, no una fila de
             tabla sin cabecera. StaffPage sigue siendo dueño de los datos y
             del diálogo de edición; la tarjeta solo presenta. -->
        <div
          v-if="soloCard"
          class="staff-page__solo"
          :class="{ 'staff-page__solo--reviews': soloReviewsOpen }"
        >
          <MyProfileCard
            :full-name="professionals[0]!.fullName"
            :description="professionals[0]!.description"
            :photo-url="photoOf(professionals[0]!)"
            :has-photo="hasPhoto(professionals[0]!)"
            :since-label="formatDate(professionals[0]!.createdAt)"
            :role-label="v.Professional"
            @edit="openRenameDialog(professionals[0]!)"
          >
            <template #reviews>
              <!-- Las reseñas se abren en un cuadro a la derecha de la tarjeta
                   (issue #487), no dentro de ella. -->
              <ProfessionalReviewsPanel
                :professional-id="professionals[0]!.id"
                :rating="professionals[0]!.rating"
                :rating-count="professionals[0]!.ratingCount"
                aside-to="#staff-solo-reviews"
                :read-only="isEmployeeProfile"
                @changed="onReviewsChanged(professionals[0]!.id, $event)"
                @open-change="soloReviewsOpen = $event"
              />
            </template>
            <template #actions>
              <slot name="professional-actions" :professional="professionals[0]!" />
              <!-- El empleado no tiene «Configuración»: llega aquí a su Google Calendar. -->
              <RouterLink
                v-if="isEmployeeProfile"
                :to="{ name: 'integraciones-google-calendar' }"
                class="staff-page__card-gcal"
              >
                Google Calendar <span aria-hidden="true">→</span>
              </RouterLink>
            </template>
          </MyProfileCard>
          <div id="staff-solo-reviews" class="staff-page__solo-aside"></div>
        </div>

        <div v-else class="staff-page__table">
          <div class="staff-page__columns" aria-hidden="true">
            <span>{{ v.Professional }}</span
            ><span>En Nava Agenda desde</span><span>Foto</span><span>Acción</span>
          </div>
          <ul
            ref="listRef"
            class="staff-page__list"
            :aria-label="`${v.Professionals} ${v.ofTheBusiness}`"
          >
            <li
              v-for="professional in pageLoading ? [] : professionals"
              :key="professional.id"
              class="staff-page__row"
              :class="{
                'staff-page__row--new': professional.id === justAddedId,
              }"
            >
              <div class="staff-page__item-heading">
                <ProfessionalAvatar
                  class="staff-page__portrait"
                  size="row"
                  :full-name="professional.fullName"
                  :photo-url="photoOf(professional)"
                />
                <div class="staff-page__item-text">
                  <!-- El nombre es el disparador real del detalle: un <button>
                       nativo para teclado y lector de pantalla; su ::after cubre
                       TODA la fila, así clic o toque en cualquier parte la abren,
                       y la acción (z-index superior) sigue siendo un botón
                       independiente. -->
                  <button
                    type="button"
                    class="staff-page__item-trigger"
                    aria-haspopup="dialog"
                    @click="openDetailDialog(professional)"
                  >
                    <span class="staff-page__item-name" :title="professional.fullName">{{
                      professional.fullName
                    }}</span>
                    <span class="staff-page__item-chevron" aria-hidden="true">›</span>
                  </button>
                  <span class="staff-page__item-since-inline">
                    Desde {{ formatDate(professional.createdAt) }}
                  </span>
                </div>
              </div>
              <span class="staff-page__item-meta staff-page__item-since">
                {{ formatDate(professional.createdAt) }}
              </span>
              <span
                class="staff-page__photo-state"
                :class="{ 'staff-page__photo-state--has': hasPhoto(professional) }"
              >
                {{ hasPhoto(professional) ? 'Con foto' : 'Sin foto' }}
              </span>
              <div class="staff-page__item-actions">
                <slot name="professional-actions" :professional="professional" />
                <BaseButton
                  type="button"
                  variant="secondary"
                  :aria-label="`Editar ${professional.fullName}`"
                  @click="openRenameDialog(professional)"
                >
                  Editar
                </BaseButton>
              </div>
            </li>
            <!-- Mientras llega la siguiente página, esqueletos con la forma de
                 una fila en el lugar donde van a entrar. -->
            <template v-if="pageLoading">
              <li
                v-for="n in Math.min(pageSize, Math.max(1, professionals.length))"
                :key="`skeleton-${n}`"
                class="staff-page__skeleton-row staff-page__skeleton-row--page"
                aria-hidden="true"
              >
                <span class="staff-page__skeleton-portrait" />
                <span class="staff-page__skeleton-text">
                  <span class="staff-page__skeleton-bar staff-page__skeleton-bar--name" />
                  <span class="staff-page__skeleton-bar staff-page__skeleton-bar--meta" />
                </span>
                <span class="staff-page__skeleton-bar staff-page__skeleton-bar--button" />
              </li>
            </template>
          </ul>
        </div>

        <div
          v-if="professionals.length > 0 && !soloCard"
          ref="footerRef"
          class="staff-page__footer"
        >
          <BaseAlert
            v-if="pageFailed"
            variant="warning"
            title="No pudimos cargar esta página"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo.
          </BaseAlert>
          <BasePagination
            :current-page="currentPage"
            :total-pages="totalPages"
            :count-label="countLabel"
            :nav-label="`Paginación de ${v.professionals}`"
            :disabled="pageLoading"
            @change="goToPage"
          />
          <BaseButton
            v-if="pageFailed"
            type="button"
            variant="secondary"
            @click="load(lastRequestedPage)"
            >Reintentar página</BaseButton
          >
        </div>
      </div>
    </Transition>

    <!-- Detalle: ficha del profesional con su retrato grande. Va ANTES de los demás
         diálogos a propósito: al pulsar "Editar" se cierra este y se abre el de
         edición en el mismo ciclo, y BaseDialog guarda como "foco previo" el
         elemento activo al abrirse; con este orden el foco ya volvió a la fila
         cuando el de edición lo lee. -->
    <BaseDialog
      v-model="isDetailOpen"
      :title="detailTarget?.fullName"
      size="md"
      content-class="staff-page__dialog staff-page__detail-dialog"
    >
      <div v-if="detailTarget" class="staff-page__ink staff-page__detail">
        <div class="staff-page__detail-hero">
          <span class="staff-page__detail-frame">
            <ProfessionalAvatar
              size="hero"
              :full-name="detailTarget.fullName"
              :photo-url="photoOf(detailTarget)"
            />
          </span>
          <p class="staff-page__detail-role">{{ v.Professional }}</p>
          <p v-if="detailTarget.description" class="staff-page__detail-description">
            {{ detailTarget.description }}
          </p>
        </div>

        <dl class="staff-page__facts">
          <div>
            <dt>En Nava Agenda desde</dt>
            <dd>{{ formatDate(detailTarget.createdAt) }}</dd>
          </div>
          <div>
            <dt>Foto</dt>
            <dd>{{ hasPhoto(detailTarget) ? 'Con foto' : 'Sin foto' }}</dd>
          </div>
        </dl>
        <ProfessionalReviewsPanel
          :professional-id="detailTarget.id"
          :rating="detailTarget.rating"
          :rating-count="detailTarget.ratingCount"
          :read-only="isEmployeeProfile"
          @changed="onReviewsChanged(detailTarget.id, $event)"
        />
        <!-- Vínculo con mi usuario (DEC-100): el control vive DENTRO del área con
             scroll, junto al dato que cambia. Así la ficha no pierde altura en el
             pie y, si en una pantalla baja se vuelve desplazable, la región ya
             contiene un control enfocable (axe: scrollable-region-focusable). -->
        <div v-if="myProfessionalKnown && !isEmployeeProfile" class="staff-page__link">
          <div class="staff-page__link-text">
            <span class="staff-page__link-label">Tu usuario</span>
            <span class="staff-page__link-state">{{
              detailIsMine ? 'Eres tú' : 'Sin vincular'
            }}</span>
            <span v-if="!detailIsMine" class="staff-page__link-hint"
              >Vincúlate para publicar tu agenda en Google Calendar.</span
            >
          </div>
          <BaseButton
            type="button"
            variant="secondary"
            :disabled="linkStatus === 'saving'"
            @click="onToggleMine"
          >
            {{ detailIsMine ? 'Ya no soy yo' : 'Este soy yo' }}
          </BaseButton>
        </div>
        <BaseAlert v-if="linkError" variant="danger" role="alert">{{ linkError }}</BaseAlert>
        <!-- Siguiente paso natural tras vincularse: ir a conectar Google Calendar. -->
        <RouterLink
          v-if="myProfessionalKnown && detailIsMine"
          :to="{ name: 'integraciones-google-calendar' }"
          class="staff-page__gcal"
        >
          <span class="staff-page__link-text">
            <span class="staff-page__gcal-title">Conectar Google Calendar</span>
            <span class="staff-page__link-hint"
              >Tus turnos y bloqueos aparecerán en tu calendario.</span
            >
          </span>
          <span class="staff-page__gcal-arrow" aria-hidden="true">→</span>
        </RouterLink>
      </div>
      <!-- Pie fuera del área con scroll: "Cerrar"/"Editar" nunca quedan fuera de
           la pantalla. -->
      <template #footer>
        <div class="staff-page__ink staff-page__detail-footer">
          <BaseButton type="button" variant="secondary" @click="isDetailOpen = false">
            Cerrar
          </BaseButton>
          <BaseButton type="button" variant="primary" @click="onDetailEdit">Editar</BaseButton>
        </div>
      </template>
    </BaseDialog>

    <!-- Alta -->
    <BaseDialog
      v-model="isCreateOpen"
      :title="`Agregar ${v.professional}`"
      description="Aparece en tu equipo en cuanto lo guardes."
      size="lg"
      content-class="staff-page__dialog staff-page__create-dialog"
      @close="onCreateDialogClosed"
    >
      <template #icon>
        <span class="staff-page__dialog-chip" aria-hidden="true">+</span>
      </template>
      <form
        class="staff-page__ink staff-page__form staff-page__create-form"
        novalidate
        @submit.prevent="onSubmitCreate"
      >
        <BaseAlert
          v-if="createStatus === 'validation-error'"
          variant="danger"
          title="No pudimos guardar los datos"
          role="alert"
        >
          Revisa el nombre y la descripción e inténtalo de nuevo. Lo que escribiste sigue aquí.
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

        <ProfessionalPhotoField
          v-model:draft="createPhotoDraft"
          :full-name="createFullName || `Nuev${v.professionalEnding} ${v.professional}`"
          :current-url="null"
          :disabled="createStatus === 'saving'"
        />

        <BaseInput
          :model-value="createFullName"
          name="fullName"
          label="Nombre"
          required
          :maxlength="120"
          :disabled="createStatus === 'saving'"
          :error="createFieldError"
          @update:model-value="onCreateFullNameInput"
        />

        <ProfessionalDescriptionField
          :model-value="createDescription"
          :disabled="createStatus === 'saving'"
          :error="createDescriptionError"
          @update:model-value="onCreateDescriptionInput"
        />

        <div class="staff-page__dialog-actions">
          <BaseButton type="button" variant="secondary" @click="isCreateOpen = false">
            Cancelar
          </BaseButton>
          <BaseButton
            type="submit"
            variant="primary"
            :loading="createStatus === 'saving'"
            :disabled="createStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>

    <!-- Edición -->
    <BaseDialog
      v-model="isRenameOpen"
      :title="`Editar ${v.professional}`"
      size="lg"
      content-class="staff-page__dialog staff-page__edit-dialog"
      @close="onRenameDialogClosed"
    >
      <template #icon>
        <span class="staff-page__dialog-chip" aria-hidden="true">{{
          renameTarget ? firstInitial(renameTarget.fullName) : ''
        }}</span>
      </template>
      <form
        class="staff-page__ink staff-page__form staff-page__rename-form"
        novalidate
        @submit.prevent="onSubmitRename"
      >
        <BaseAlert
          v-if="renameStatus === 'validation-error'"
          variant="danger"
          title="No pudimos guardar los datos"
          role="alert"
        >
          Revisa el nombre y la descripción e inténtalo de nuevo. Lo que escribiste sigue aquí.
        </BaseAlert>
        <BaseAlert
          v-if="renameStatus === 'not-found'"
          variant="warning"
          :title="`${capitalize(v.thisProfessional)} ya no está disponible`"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-if="renameStatus === 'photo-error'"
          variant="warning"
          title="No pudimos guardar la foto"
          role="alert"
        >
          Prueba con otra imagen o inténtalo de nuevo. Lo que escribiste sigue aquí.
        </BaseAlert>
        <BaseAlert
          v-if="renameStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="renameStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <ProfessionalPhotoField
          v-model:draft="renamePhotoDraft"
          :full-name="renameFullName || renameTarget?.fullName || ''"
          :current-url="renameTarget ? photoOf(renameTarget) : null"
          :disabled="renameStatus === 'saving'"
        />

        <BaseInput
          :model-value="renameFullName"
          name="fullName"
          label="Nombre"
          required
          :maxlength="120"
          :disabled="renameStatus === 'saving'"
          :error="renameFieldError"
          @update:model-value="onRenameFullNameInput"
        />

        <ProfessionalDescriptionField
          :model-value="renameDescription"
          :disabled="renameStatus === 'saving'"
          :error="renameDescriptionError"
          @update:model-value="onRenameDescriptionInput"
        />

        <div class="staff-page__dialog-actions">
          <BaseButton type="button" variant="secondary" @click="isRenameOpen = false">
            Cancelar
          </BaseButton>
          <BaseButton
            type="submit"
            variant="primary"
            :loading="renameStatus === 'saving'"
            :disabled="renameStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>
  </section>
</template>

<style scoped>
.staff-page__ready--fitting {
  visibility: hidden;
}
/* Fundido entre carga/error/listo: --motion-duration-base, el mismo token que
   el resto de transiciones de estado (estandar-diseno-visual.md §12). */
.staff-content-enter-active,
.staff-content-leave-active {
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);
}

.staff-content-enter-from,
.staff-content-leave-to {
  opacity: 0;
}

/* Fondo transparente sobre el canvas del cascarón, igual que Agenda y
   Servicios; columna de lectura centrada. */
.staff-page {
  --staff-width: 920px;
  --staff-row-height: 84px;

  display: flex;
  flex-direction: column;
  /* Con pocos profesionales el bloque queda centrado en el visor en vez de pegado
     arriba con un gran vacío debajo (issue #575); con muchos llena el alto y
     el centrado no desplaza nada. */
  justify-content: center;
  gap: 16px;
  min-height: 100%;
  padding: 34px 32px 48px;
  color: var(--color-on-strong);
  /* Transparente: la tinta y el fondo animado los pone el cascarón. */
  background: transparent;
  box-sizing: border-box;
}

.staff-page__header,
.staff-page__state,
.staff-page__ready,
.staff-page > :deep(.base-alert) {
  width: min(100%, var(--staff-width));
  margin-inline: auto;
}

.staff-page__ready {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Perfil individual con reseñas (issue #487): la ficha va centrada sola; al abrir
   las reseñas, el cuadro se coloca a su derecha y el conjunto sigue centrado. En
   pantallas angostas el cuadro baja bajo la ficha. */
.staff-page__solo {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: var(--space-5);
}

.staff-page__solo > :deep(.my-profile-card) {
  flex: 0 0 auto;
  margin-inline: 0;
}

.staff-page__solo-aside {
  display: none;
  flex: 1 1 0;
  min-width: 0;
  max-width: 460px;
}

.staff-page__card-gcal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--space-3);
  /* Enlace secundario en tinta (v2, DEC-188): el acento es solo de la acción
     principal. */
  color: var(--color-text-primary);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid var(--color-border-control);
}

.staff-page__card-gcal:hover {
  background-color: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
}

.staff-page__card-gcal:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.staff-page__solo--reviews {
  align-items: stretch;
}

.staff-page__solo--reviews .staff-page__solo-aside {
  position: relative;
  display: block;
}

/* El cuadro toma la altura de la ficha (no la empuja): si hay más reseñas de las que
   caben, la lista se desplaza dentro de él. */
.staff-page__solo-aside > :deep(.professional-reviews__panel--aside) {
  position: absolute;
  inset: 0;
}

@media (max-width: 960px) {
  .staff-page__solo {
    flex-direction: column;
    align-items: stretch;
  }

  .staff-page__solo > :deep(.my-profile-card) {
    align-self: center;
  }

  .staff-page__solo-aside {
    max-width: none;
  }

  .staff-page__solo-aside > :deep(.professional-reviews__panel--aside) {
    position: static;
    max-height: 70dvh;
  }
}

.staff-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: 16px;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

/* h1 v2 (DEC-188): el mismo título que DailyAgendaPage.vue. */
.staff-page__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 28px;
  font-weight: 600;
  line-height: 32px;
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

@media (min-width: 1024px) {
  .staff-page__title {
    font-size: 32px;
    line-height: 36px;
  }
}

.staff-page__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

/* "Agregar profesional" es la acción principal y la ÚNICA con el acento lleno
   (v2, DEC-188), con el acento del negocio como "Agregar servicio". */
.staff-page__create.base-button {
  height: 40px;
  padding-inline: 18px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
}

.staff-page__create :deep(.base-button__content)::before {
  content: '+';
  margin-right: 6px;
}

.staff-page__create.base-button--primary {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

.staff-page__create.base-button--primary:hover:not(:disabled):not(.base-button--loading) {
  filter: brightness(92%);
}

.staff-page__create.base-button--primary:active:not(:disabled):not(.base-button--loading) {
  filter: brightness(84%);
}

.staff-page__state {
  padding: var(--space-4);
  color: var(--color-on-strong-muted);
}

.staff-page__loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: 0;
}

/* Esqueletos: la forma de una fila real (retrato cuadrado, dos líneas de texto,
   un botón) con el pulso de Servicios/Agenda: es carga (dura lo que dura la
   petición), por eso v2 lo permite; se apaga con movimiento reducido. */
.staff-page__skeleton-row {
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--staff-row-height);
  padding: 16px;
  overflow: hidden;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.staff-page__skeleton-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.staff-page__skeleton-portrait,
.staff-page__skeleton-bar {
  display: block;
  flex: 0 0 auto;
  background-color: color-mix(in srgb, var(--color-on-strong) 16%, transparent);
  border-radius: var(--radius-sm);
  animation: staff-skeleton-pulse 1400ms ease-in-out infinite;
}

.staff-page__skeleton-portrait {
  width: 52px;
  height: 52px;
}

.staff-page__skeleton-bar--name {
  width: 55%;
  max-width: 180px;
  height: 16px;
}

.staff-page__skeleton-bar--meta {
  width: 96px;
  height: 12px;
  background-color: color-mix(in srgb, var(--color-on-strong) 10%, transparent);
}

.staff-page__skeleton-bar--button {
  width: 72px;
  height: 34px;
}

@keyframes staff-skeleton-pulse {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}

/* Tarjeta v2 (DEC-188): superficie con borde sutil de 1px y radio grande, la
   misma que la tabla de Servicios. */
.staff-page__list {
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

.staff-page__columns,
.staff-page__row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 128px 108px 212px;
  align-items: center;
  gap: 12px;
}

.staff-page__columns {
  min-height: 44px;
  padding: 0 16px;
  font-family: var(--font-sans);
  /* Rótulo v2 (DEC-188): tipo oración, 13px/500 en texto secundario, igual
     que el encabezado de Servicios. */
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.staff-page__columns span:last-child {
  text-align: right;
}

.staff-page__row {
  position: relative;
  height: var(--staff-row-height);
  padding: 16px;
  overflow: hidden;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Profesional recién agregado: un velo de tinta quieto, detrás del contenido
   (v2, DEC-188: sin destello animado ni acento; seleccionado en tinta). */
.staff-page__row--new::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-color: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
}

.staff-page__item-heading {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 14px;
}

.staff-page__portrait {
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.staff-page__item-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.staff-page__item-name {
  overflow: hidden;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-lg);
  font-weight: 500;
  color: var(--color-on-strong);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Disparador del detalle: botón sin cromo que hereda la tipografía del nombre.
   Su ::after se estira sobre toda la fila (.staff-page__row es position:
   relative), de modo que cualquier clic o toque la abre; la acción sube por
   z-index y conserva su propio clic. */
.staff-page__item-trigger {
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

.staff-page__item-trigger::after {
  content: '';
  position: absolute;
  inset: 0;
}

.staff-page__item-trigger:focus-visible {
  outline: none;
}

.staff-page__item-trigger:focus-visible::after {
  box-shadow: inset 0 0 0 2px var(--color-focus);
}

.staff-page__item-chevron {
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-lg);
  line-height: 1;
  opacity: 0.55;
  transition:
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Solo con puntero real: en táctil :hover se queda pegado tras el toque. */
@media (hover: hover) {
  .staff-page__row:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  }

  .staff-page__row:hover .staff-page__item-chevron {
    opacity: 1;
    transform: translateX(3px);
  }

  .staff-page__row:hover .staff-page__portrait {
    transform: scale(1.06);
  }
}

.staff-page__item-since-inline {
  display: none;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}

.staff-page__item-meta {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Estado de la foto como rótulo con punto (mismo lenguaje que Activo/Inactivo
   de Servicios): sin caja, tipo oración y un punto quieto de color (v2,
   DEC-188: sin rombo parpadeante ni versalitas). */
.staff-page__photo-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-on-strong-muted);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}

.staff-page__photo-state::before {
  content: '';
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
}

.staff-page__photo-state--has {
  color: var(--color-success-on-strong);
}

.staff-page__item-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

/* "Editar" usa el BaseButton--secondary v2 tal cual (contorno neutro); solo
   se compacta para caber en la fila. */
.staff-page__item-actions :deep(.base-button) {
  height: 36px;
  padding-inline: 14px;
  font-size: var(--font-size-body-sm);
}

/* Pie de la tabla: conteo a la izquierda, "Cargar más" a la derecha. */
.staff-page__footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.staff-page__load-more.base-button {
  height: 34px;
  padding-inline: 14px;
  font-size: var(--font-size-caption);
}

/* Diálogos (alta, edición, detalle): mismo tratamiento v2 que los de
   Servicios (DEC-188). Solo aplica dentro de .staff-page__ink (el contenido
   que esta plantilla pone en el diálogo); el fondo y el borde —que BaseDialog
   renderiza en <Teleport to="body">— se ajustan en el bloque sin "scoped" del
   final. La ficha del encabezado es neutra (tinta sobre velo de tinta) y no
   se anima: ya entra con el propio diálogo. */
.staff-page__dialog-chip {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
  line-height: 1;
}

.staff-page__ink {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  color: var(--color-on-strong);
}

/* Los campos usan BaseInput v2 tal cual (DEC-188). Botones del pie: el
   principal de cada diálogo es su única acción con el acento lleno, con el
   acento del negocio como "Agregar profesional"; "Cancelar"/"Cerrar" son el
   BaseButton--secondary v2 neutro. */

.staff-page__ink :deep(.base-button--primary) {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

.staff-page__ink :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  filter: brightness(92%);
}

.staff-page__ink :deep(.base-button--primary:active:not(:disabled):not(.base-button--loading)) {
  filter: brightness(84%);
}

.staff-page__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-2);
  flex-wrap: wrap;
}

/* Detalle: retrato grande, el nombre ya está en el encabezado del diálogo.
   v2 (DEC-188): sin marco de esquinas de acento ni entrada escalonada; todo
   llega con el propio diálogo. */
.staff-page__detail-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) 0 var(--space-2);
}

.staff-page__detail-frame {
  display: inline-flex;
}

.staff-page__detail-description {
  max-width: 36ch;
  margin: 0;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  text-align: center;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

/* Rótulo v2 (DEC-188): tipo oración, 13px/500 en texto secundario. */
.staff-page__detail-role {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.staff-page__facts {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--space-2);
  margin: 0;
}

.staff-page__facts > div {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.staff-page__facts dt {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.staff-page__facts dd {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-h3);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.staff-page__link {
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-3);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.staff-page__link-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.staff-page__link-label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.staff-page__link-state {
  font-family: var(--font-display);
  font-size: var(--font-size-h3);
  line-height: 1.2;
}

.staff-page__link-hint {
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
  line-height: 1.4;
}

.staff-page__gcal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 44px;
  margin-top: var(--space-2);
  padding: var(--space-3);
  color: inherit;
  text-decoration: none;
  /* Tarjeta enlace neutra (v2, DEC-188): borde de control que pasa a tinta al
     pasar el cursor; el acento es solo de la acción principal. */
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-lg);
  transition: border-color 200ms var(--motion-easing-standard);
}

.staff-page__gcal:hover,
.staff-page__gcal:focus-visible {
  border-color: var(--color-text-primary);
}

.staff-page__gcal:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.staff-page__gcal-title {
  font-weight: 600;
}

.staff-page__gcal-arrow {
  color: var(--color-text-secondary);
  transition: transform 220ms var(--motion-easing-standard);
}

.staff-page__gcal:hover .staff-page__gcal-arrow,
.staff-page__gcal:focus-visible .staff-page__gcal-arrow {
  transform: translateX(4px);
}

@media (prefers-reduced-motion: reduce) {
  .staff-page__gcal,
  .staff-page__gcal-arrow {
    transition: none;
  }
}

.staff-page__detail > .base-alert {
  margin-top: var(--space-2);
}

.staff-page__detail-footer {
  flex: 1;
  flex-flow: row wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* Zona media 641–960px: las columnas fijas ya no caben junto al mínimo de la
   de nombre; se acortan (sin apilar: el alto de fila es fijo). */
@media (max-width: 960px) and (min-width: 641px) {
  .staff-page__columns,
  .staff-page__row {
    grid-template-columns: minmax(120px, 1fr) 100px 96px 196px;
    gap: 8px;
  }

  .staff-page__item-meta {
    font-size: var(--font-size-body-sm);
  }
}

@media (max-width: 640px) {
  .staff-page {
    --staff-row-height: 104px;
    gap: 12px;
    padding: 16px 16px 28px;
  }

  .staff-page__header {
    padding-bottom: 10px;
  }

  /* CTA compacto: un "+" en un círculo (el nombre accesible sigue siendo el
     texto del botón). */
  .staff-page__create.base-button {
    width: 32px;
    height: 32px;
    padding: 0;
    overflow: hidden;
    font-size: 0;
  }

  .staff-page__create :deep(.base-button__content) {
    font-size: 0;
  }

  .staff-page__create :deep(.base-button__content)::before {
    margin: 0;
    font-size: var(--font-size-title-item);
  }

  .staff-page__columns,
  .staff-page__photo-state,
  .staff-page__item-since {
    display: none;
  }

  /* En móvil el alta va bajo el nombre y el estado de la foto se ve en el detalle. */
  .staff-page__item-since-inline {
    display: block;
  }

  .staff-page__row {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 44px 30px;
    gap: var(--space-2);
    height: var(--staff-row-height);
    padding: 10px 12px;
  }

  .staff-page__skeleton-row {
    height: var(--staff-row-height);
    gap: 12px;
    padding: 10px 12px;
  }

  .staff-page__skeleton-portrait {
    width: 44px;
    height: 44px;
  }

  .staff-page__item-heading {
    gap: 12px;
  }

  .staff-page__item-name {
    font-size: var(--font-size-body);
  }

  .staff-page__item-actions :deep(.base-button) {
    height: 30px;
    padding-inline: 10px;
  }

  .staff-page__facts {
    grid-auto-flow: row;
  }

  .staff-page__dialog-actions :deep(.base-button) {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .staff-content-enter-active,
  .staff-content-leave-active,
  .staff-page__row,
  .staff-page__portrait,
  .staff-page__item-chevron {
    transition: none;
  }

  .staff-page__skeleton-portrait,
  .staff-page__skeleton-bar {
    animation: none;
    opacity: 0.8;
  }
}

/* «Animaciones reducidas» de Configuración (DEC-110): el esqueleto queda
   quieto igual que con la preferencia del sistema. */
:global(:root[data-motion='reduced']) .staff-page__skeleton-portrait,
:global(:root[data-motion='reduced']) .staff-page__skeleton-bar {
  animation: none;
  opacity: 0.8;
}
</style>

<style>
/* SIN "scoped" a propósito, por el mismo motivo que en Servicios: BaseDialog.vue
   renderiza su tarjeta, encabezado, título, descripción y botón de cerrar en
   <Teleport to="body">, así que dejan de ser descendientes de .staff-page en el
   DOM real y un :deep() con alcance de componente nunca los alcanza. Estas
   reglas seleccionan por el nombre de clase real (.staff-page__dialog es
   exclusivo de esta pantalla). El !important es necesario porque la regla
   propia de BaseDialog tiene la misma especificidad y el orden de inserción de
   los <style> no está garantizado. Contenido a esta única pantalla. */
.staff-page__dialog.base-dialog {
  background-color: var(--color-surface) !important;
  border: var(--border-width-normal) solid var(--color-border-subtle) !important;
}

/* `size` solo fija max-width: el ancho real de cada diálogo se declara aquí. */
.staff-page__create-dialog.base-dialog,
.staff-page__edit-dialog.base-dialog {
  width: min(100%, 720px) !important;
}

.staff-page__detail-dialog.base-dialog {
  width: min(100%, 560px) !important;
}

/* v2 (DEC-188): la apertura usa la curva estándar de BaseDialog (sin rebote)
   y el encabezado conserva su separador sutil de 1px, sin filete de acento. */

.staff-page__dialog .base-dialog__title {
  color: var(--color-on-strong) !important;
  overflow-wrap: anywhere;
}

.staff-page__dialog .base-dialog__description {
  color: var(--color-on-strong-muted) !important;
}

.staff-page__detail-dialog .base-dialog__footer {
  border-top-color: var(--color-border-subtle) !important;
}

.staff-page__dialog .base-dialog__close {
  color: var(--color-on-strong-muted) !important;
}

.staff-page__dialog .base-dialog__close:hover {
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent) !important;
  color: var(--color-on-strong) !important;
}

.staff-page__dialog .base-dialog__close:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus) !important;
}
</style>
