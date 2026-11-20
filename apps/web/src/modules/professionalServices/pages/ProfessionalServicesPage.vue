<script setup lang="ts">
// Pantalla "Servicios por profesional" (HU-023): elegir un profesional y marcar qué
// servicios presta, mediante una casilla por servicio del catálogo. El
// mismo componente funciona con un profesional que presta todo el catálogo,
// varios con servicios compartidos, y un equipo con especialidades
// distintas (CA-023-01/02/03): nunca hay una rama especial según el número
// de profesionales o servicios. Estados discriminados: carga inicial, listo,
// vacío (sin profesionales o sin servicios), error recuperable, cargando
// asignaciones del profesional elegido. Cada casilla se deshabilita mientras su
// propia solicitud está en curso (evita doble envío, CA-023-08); el estado
// visual solo cambia después de la respuesta real del servidor -nunca
// antes- y un error recuperable revierte la casilla a su estado real sin
// perder la selección de profesional ni el resto de casillas ya marcadas. Se
// puede retirar a cualquier profesional, también al último de un servicio (DEC-114). Cada asignación o retiro
// confirmado añade un aviso emergente (DEC-095); el error sigue en línea.
import { computed, nextTick, ref, onMounted, onUnmounted, watch } from 'vue'
import { useToast, useVocabulary } from '@/shared/composables'
import { capitalize, isEmployeeProfile, worksOwnProfessional } from '@/shared/model'
import {
  ProfessionalAvatar,
  ProfessionalSelect,
  BaseAlert,
  BaseButton,
  BasePagination,
  DiamondLoader,
  EmptyScene,
} from '@/shared/ui'
import {
  assignService,
  fetchAssignments,
  fetchProfessionalSummaries,
  fetchServiceSummaries,
  unassignService,
  type ProfessionalSummary,
  type ServiceSummary,
} from '../api/professionalServicesApi'

type PageStatus = 'loading' | 'ready' | 'load-error'
type AssignmentsStatus = 'idle' | 'loading' | 'ready' | 'error'

const pageStatus = ref<PageStatus>('loading')
const professionals = ref<ProfessionalSummary[]>([])
const services = ref<ServiceSummary[]>([])

const selectedProfessionalId = ref<string | null>(null)
const assignmentsStatus = ref<AssignmentsStatus>('idle')
const assignedServiceIds = ref<Set<string>>(new Set())
const pendingServiceIds = ref<Set<string>>(new Set())
const toggleError = ref<string | null>(null)

// Velo de carga del catálogo (issue #575): cubre la tabla mientras llegan las
// asignaciones de la persona elegida o mientras se mide cuántas filas caben.
// La tabla anterior sigue debajo (atenuada e inerte), así cambiar de persona no
// vacía la pantalla ni la hace saltar de alto.
const catalogBusy = computed(() => assignmentsStatus.value === 'loading' || fitPending.value)
// Primera carga: todavía no hay asignaciones reales que mostrar debajo del velo.
const hasShownAssignments = ref(false)

const selectedProfessional = computed(
  () => professionals.value.find((b) => b.id === selectedProfessionalId.value) ?? null,
)

// Cuántos servicios del catálogo presta la persona elegida: alimenta el
// medidor del panel lateral. Solo cuenta ids que existen en el catálogo, así
// una asignación a un servicio ya retirado del listado no infla el total.
const assignedCount = computed(
  () => services.value.filter((s) => assignedServiceIds.value.has(s.id)).length,
)
const assignedRatio = computed(() =>
  services.value.length === 0 ? 0 : assignedCount.value / services.value.length,
)

// Tabla paginada como Profesionales y Servicios (DEC-107): el catálogo ya llega
// completo (selector de hasta 50), así que se pagina en el cliente y el tamaño
// de página es el número de filas que caben en el visor real.
const FALLBACK_PAGE_SIZE = 20
// En móvil la ficha de la persona va encima y deja poco alto: un piso evita
// una página de una sola fila; ahí el cascarón simplemente se desplaza.
const MIN_FIT_ROWS = 4
const currentPage = ref(1)
const pageSize = ref(FALLBACK_PAGE_SIZE)
const fitPending = ref(true)
const pageRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined

const totalPages = computed(() => Math.max(1, Math.ceil(services.value.length / pageSize.value)))
const pagedServices = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return services.value.slice(start, start + pageSize.value)
})
const countLabel = computed(
  () => `${services.value.length} ${services.value.length === 1 ? 'servicio' : 'servicios'}`,
)
function goToPage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) return
  currentPage.value = page
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) return node
    node = node.parentElement
  }
  return null
}

// Mide el visor, la fila real y el pie; no oculta desborde para aparentar que
// caben filas. El padding cambia en móvil y también se mide.
async function fitPage() {
  await nextTick()
  const list = listRef.value
  const footer = footerRef.value
  const page = pageRef.value
  const parent = list ? scrollParent(list) : null
  const row = list?.querySelector<HTMLElement>('.professional-services-page__row')
  const height = row?.getBoundingClientRect().height
  if (!list || !footer || !page || !parent || !height) {
    fitPending.value = false
    return
  }
  const listRect = list.getBoundingClientRect()
  const footerRect = footer.getBoundingClientRect()
  const gap = Math.max(0, footerRect.top - listRect.bottom)
  const bottomPadding = parseFloat(getComputedStyle(page).paddingBottom)
  const available =
    parent.clientHeight -
    (listRect.top - parent.getBoundingClientRect().top + parent.scrollTop) -
    gap -
    footerRect.height -
    bottomPadding -
    2
  const fitting = Math.max(MIN_FIT_ROWS, Math.min(50, Math.floor(available / height)))
  if (fitting !== pageSize.value) {
    // Conserva la primera fila visible al cambiar el tamaño de página.
    const firstIndex = (currentPage.value - 1) * pageSize.value
    pageSize.value = fitting
    currentPage.value = Math.floor(firstIndex / fitting) + 1
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
    if (typeof ResizeObserver === 'undefined') return
    observer?.disconnect()
    observer = new ResizeObserver(scheduleFit)
    const parent = scrollParent(el)
    if (parent) observer.observe(parent)
    const header = pageRef.value?.querySelector('.professional-services-page__header')
    if (header) observer.observe(header)
  },
  { flush: 'post' },
)

onMounted(() => window.addEventListener('resize', scheduleFit))
onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('resize', scheduleFit)
  if (resizeTimer !== undefined) clearTimeout(resizeTimer)
})

async function loadPage() {
  pageStatus.value = 'loading'
  const [professionalsOutcome, servicesOutcome] = await Promise.all([
    fetchProfessionalSummaries(),
    fetchServiceSummaries(),
  ])

  if (professionalsOutcome.kind !== 'success' || servicesOutcome.kind !== 'success') {
    pageStatus.value = 'load-error'
    return
  }

  professionals.value = professionalsOutcome.items
  services.value = servicesOutcome.items
  currentPage.value = 1
  pageStatus.value = 'ready'

  // El selector solo se muestra (y solo entonces tiene sentido pedir
  // asignaciones) cuando existe AL MENOS un profesional Y un servicio: con
  // cualquiera de las dos colecciones vacía, la plantilla muestra el estado
  // vacío correspondiente en vez del selector.
  if (professionals.value.length > 0 && services.value.length > 0) {
    await selectProfessional(professionals.value[0]!.id)
  }
}

onMounted(loadPage)

function onRetryLoad() {
  void loadPage()
}

const toast = useToast()
// Palabras del negocio (DEC-110): con los valores iniciales, el texto de siempre.
const v = useVocabulary()
// El empleado (DEC-173) solo recibe su propio profesional: no hay a quién elegir.
const hideProfessionalPicker = computed(
  () => worksOwnProfessional.value && professionals.value.length === 1,
)

async function selectProfessional(professionalId: string) {
  selectedProfessionalId.value = professionalId
  toggleError.value = null
  assignmentsStatus.value = 'loading'

  const outcome = await fetchAssignments(professionalId)
  // El profesional seleccionado pudo cambiar mientras la solicitud estaba en
  // vuelo (cambio rápido en el selector): descarta una respuesta obsoleta.
  if (selectedProfessionalId.value !== professionalId) return

  if (outcome.kind === 'success') {
    assignedServiceIds.value = new Set(outcome.page.items.map((a) => a.serviceId))
    assignmentsStatus.value = 'ready'
    hasShownAssignments.value = true
    return
  }
  assignmentsStatus.value = 'error'
}

function onRetryAssignments() {
  if (selectedProfessionalId.value) void selectProfessional(selectedProfessionalId.value)
}

function isPending(serviceId: string): boolean {
  return pendingServiceIds.value.has(serviceId)
}

function isAssigned(serviceId: string): boolean {
  return assignedServiceIds.value.has(serviceId)
}

function setPending(serviceId: string, pending: boolean) {
  const next = new Set(pendingServiceIds.value)
  if (pending) next.add(serviceId)
  else next.delete(serviceId)
  pendingServiceIds.value = next
}

function setAssigned(serviceId: string, assigned: boolean) {
  const next = new Set(assignedServiceIds.value)
  if (assigned) next.add(serviceId)
  else next.delete(serviceId)
  assignedServiceIds.value = next
}

async function onToggleService(service: ServiceSummary, event: Event) {
  const professionalId = selectedProfessionalId.value
  const checkbox = event.target as HTMLInputElement

  if (!professionalId || isPending(service.id)) {
    // Mientras guarda, la casilla usa aria-disabled y no `disabled`: un control
    // deshabilitado pierde el foco y el teclado volvía a BODY (CA-023-08, WCAG 2.4.3).
    // Por eso un segundo cambio aún puede llegar: se descarta y se revierte de
    // inmediato al estado real.
    checkbox.checked = isAssigned(service.id)
    return
  }

  const wantsAssigned = checkbox.checked

  setPending(service.id, true)
  toggleError.value = null

  const outcome = wantsAssigned
    ? await assignService(professionalId, service.id)
    : await unassignService(professionalId, service.id)

  setPending(service.id, false)

  if (outcome.kind === 'success') {
    setAssigned(service.id, wantsAssigned)
    toast.success(wantsAssigned ? 'Servicio asignado' : 'Servicio retirado', {
      detail: wantsAssigned
        ? `«${service.name}» quedó asignado a ${v.value.thisProfessional}.`
        : `«${service.name}» ya no está asignado a ${v.value.thisProfessional}.`,
    })
    return
  }

  // Ningún error recuperable cambia el estado real: se revierte la casilla
  // al valor que el servidor ya había confirmado antes de este intento.
  // Se asigna DIRECTAMENTE sobre el elemento del DOM que disparó el evento
  // (no solo la fuente reactiva `:checked`): si el valor reactivo no
  // cambió de contenido (por ejemplo, seguía asignado antes y sigue
  // asignado después de un rechazo), Vue no vuelve a tocar la propiedad
  // `checked` del elemento porque, desde su óptica, nada cambió -aunque el
  // navegador ya la haya alternado al hacer clic-; fijarla aquí garantiza
  // que la casilla siempre refleje el estado real, sin depender de esa
  // optimización de Vue.
  checkbox.checked = isAssigned(service.id)

  switch (outcome.kind) {
    case 'not-found':
      toggleError.value = `${capitalize(v.value.thisProfessional)} o servicio ya no está disponible. Recarga la página.`
      break
    case 'network-error':
      toggleError.value = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
      break
    case 'unexpected-error':
      toggleError.value = 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.'
      break
  }
}
</script>

<template>
  <section
    ref="pageRef"
    class="professional-services-page"
    aria-labelledby="professional-services-page-title"
  >
    <header class="professional-services-page__header">
      <h1 id="professional-services-page-title" class="professional-services-page__title">
        {{ isEmployeeProfile ? 'Mis servicios' : `Servicios por ${v.professional}` }}
      </h1>
      <p class="professional-services-page__subtitle">
        {{
          isEmployeeProfile
            ? `Elige cuáles servicios del catálogo ${v.ofTheBusiness} ofreces tú.`
            : `Gestiona los servicios que presta cada ${v.professional}.`
        }}
      </p>
    </header>

    <div
      v-if="pageStatus === 'loading'"
      class="professional-services-page__state"
      role="status"
      aria-live="polite"
    >
      <DiamondLoader :label="`Cargando ${v.professionals} y servicios…`" layout="overlay" />
      <!-- Esqueleto con la misma forma que la pantalla lista (ficha a la
           izquierda, tabla a la derecha) para que nada cambie de sitio al
           llegar los datos. -->
      <div class="professional-services-page__skeleton-workspace" aria-hidden="true">
        <span class="professional-services-page__skeleton-profile" />
        <ul class="professional-services-page__skeleton">
          <li v-for="n in 4" :key="n" class="professional-services-page__skeleton-row" />
        </ul>
      </div>
    </div>

    <BaseAlert
      v-else-if="pageStatus === 'load-error'"
      variant="warning"
      title="No pudimos cargar esta sección"
      role="alert"
    >
      Revisa tu conexión e inténtalo de nuevo.
      <template #action>
        <BaseButton type="button" variant="secondary" @click="onRetryLoad">Reintentar</BaseButton>
      </template>
    </BaseAlert>

    <template v-else>
      <EmptyScene
        v-if="professionals.length === 0"
        scene="team"
        class="professional-services-page__empty"
      >
        <template #title>{{
          isEmployeeProfile
            ? 'Tu cuenta aún no tiene un perfil.'
            : `Aún no tienes ${v.professionalsRegistered}.`
        }}</template>
        <template #hint>
          <template v-if="isEmployeeProfile">
            Pídele {{ v.toTheBusiness }} que vincule tu usuario con tu perfil de
            {{ v.professional }}.
          </template>
          <template v-else>
            Agrega {{ v.oneProfessional }} en la sección
            <RouterLink :to="{ name: 'staff-profesionales' }">“{{ v.Professionals }}”</RouterLink>
            antes de asignarle servicios.
          </template>
        </template>
      </EmptyScene>
      <EmptyScene
        v-else-if="services.length === 0"
        scene="services"
        class="professional-services-page__empty"
      >
        <template #title>{{
          isEmployeeProfile
            ? `${capitalize(v.theBusiness)} aún no tiene servicios en el catálogo.`
            : 'Aún no tienes servicios en el catálogo.'
        }}</template>
        <template #hint>
          <template v-if="isEmployeeProfile">
            Cuando {{ v.theBusiness }} agregue servicios, aquí eliges cuáles ofreces.
          </template>
          <template v-else>
            Agrega uno en la sección
            <RouterLink :to="{ name: 'catalog-servicios' }">“Servicios”</RouterLink>
            antes de asignarlo a {{ v.aProfessional }}.
          </template>
        </template>
      </EmptyScene>

      <div v-else class="professional-services-page__workspace">
        <!-- Ficha de la persona elegida: retrato, selector y medidor. Sin
             entrada animada (v2, DEC-188). -->
        <aside
          class="professional-services-page__profile"
          :class="{ 'professional-services-page__profile--picker': !hideProfessionalPicker }"
        >
          <!-- La ficha cambia en su sitio: re-montarla (o una transición de salida y
               entrada) la dejaba vacía un instante y la pantalla parpadeaba. -->
          <div class="professional-services-page__identity">
            <ProfessionalAvatar
              v-if="selectedProfessional"
              :full-name="selectedProfessional.fullName"
              size="hero"
              class="professional-services-page__avatar"
            />
            <p class="professional-services-page__identity-name">
              {{ selectedProfessional?.fullName }}
            </p>
          </div>

          <div v-if="!hideProfessionalPicker" class="professional-services-page__picker">
            <label
              for="professional-services-professional-select"
              class="professional-services-page__label"
            >
              {{ v.Professional }}
            </label>
            <ProfessionalSelect
              :model-value="selectedProfessionalId"
              :professionals="professionals"
              trigger-id="professional-services-professional-select"
              @update:model-value="selectProfessional"
            />
          </div>

          <!-- El medidor no desaparece mientras carga la siguiente persona: solo se
               atenúa, así la ficha conserva su alto. -->
          <div
            class="professional-services-page__meter"
            :class="{ 'professional-services-page__meter--busy': assignmentsStatus !== 'ready' }"
            role="group"
            aria-label="Servicios asignados"
          >
            <p class="professional-services-page__meter-figure">
              <span class="professional-services-page__meter-count">{{ assignedCount }}</span>
              <span class="professional-services-page__meter-total">/ {{ services.length }}</span>
              <span class="professional-services-page__meter-unit">servicios</span>
            </p>
            <span class="professional-services-page__meter-track" aria-hidden="true">
              <span
                class="professional-services-page__meter-fill"
                :style="{ transform: `scaleX(${assignedRatio})` }"
              />
            </span>
          </div>
        </aside>

        <div
          class="professional-services-page__panel"
          :class="{ 'professional-services-page__panel--busy': catalogBusy }"
          :aria-busy="catalogBusy ? 'true' : undefined"
        >
          <Transition name="professional-services-veil">
            <div
              v-if="catalogBusy && assignmentsStatus !== 'error'"
              class="professional-services-page__veil"
              role="status"
              aria-live="polite"
            >
              <DiamondLoader
                :label="`Cargando los servicios de ${selectedProfessional?.fullName ?? v.theProfessional}…`"
              />
            </div>
          </Transition>

          <BaseAlert
            v-if="assignmentsStatus === 'error'"
            variant="warning"
            :title="`No pudimos cargar los servicios ${v.ofThisProfessional}`"
            role="alert"
          >
            Revisa tu conexión e inténtalo de nuevo.
            <template #action>
              <BaseButton type="button" variant="secondary" @click="onRetryAssignments">
                Reintentar
              </BaseButton>
            </template>
          </BaseAlert>

          <!-- Sin :key por persona: re-montar la tabla en cada cambio repetía la
               entrada escalonada de todas las filas y la pantalla «temblaba».
               `inert` se quita con undefined: Vue escribiría inert="false" y el
               navegador trata cualquier valor como activo. -->
          <fieldset
            v-else
            class="professional-services-page__fieldset"
            :class="{
              'professional-services-page__fieldset--hidden': !hasShownAssignments,
              'professional-services-page__fieldset--dimmed': hasShownAssignments && catalogBusy,
            }"
            :inert="catalogBusy || undefined"
          >
            <legend class="professional-services-page__legend">
              Servicios que presta {{ selectedProfessional?.fullName }}
            </legend>

            <BaseAlert
              v-if="toggleError"
              variant="danger"
              title="No pudimos guardar el cambio"
              role="alert"
              class="professional-services-page__toggle-error"
            >
              {{ toggleError }}
            </BaseAlert>

            <div class="professional-services-page__table">
              <div class="professional-services-page__columns" aria-hidden="true">
                <span>Servicio</span><span>Asignación</span>
              </div>
              <ul
                ref="listRef"
                class="professional-services-page__list"
                aria-label="Catálogo de servicios"
              >
                <li
                  v-for="service in pagedServices"
                  :key="service.id"
                  class="professional-services-page__row"
                  :class="{
                    'professional-services-page__row--assigned': isAssigned(service.id),
                    'professional-services-page__row--pending': isPending(service.id),
                  }"
                >
                  <label
                    :for="`professional-services-service-${service.id}`"
                    class="professional-services-page__item-label"
                  >
                    <input
                      :id="`professional-services-service-${service.id}`"
                      type="checkbox"
                      class="professional-services-page__checkbox"
                      :checked="isAssigned(service.id)"
                      :aria-disabled="isPending(service.id) ? 'true' : undefined"
                      :aria-busy="isPending(service.id) ? 'true' : undefined"
                      @change="onToggleService(service, $event)"
                    />
                    <span class="professional-services-page__service-icon" aria-hidden="true">{{
                      service.name.trim().charAt(0).toUpperCase()
                    }}</span>
                    <span class="professional-services-page__service-name">{{ service.name }}</span>
                  </label>
                  <span
                    v-if="isPending(service.id)"
                    class="professional-services-page__pending"
                    aria-live="polite"
                  >
                    <span class="professional-services-page__spinner" aria-hidden="true" />
                    Guardando…
                  </span>
                  <span
                    v-else
                    :key="isAssigned(service.id) ? 'on' : 'off'"
                    class="professional-services-page__assignment"
                    :class="{
                      'professional-services-page__assignment--assigned': isAssigned(service.id),
                    }"
                  >
                    {{ isAssigned(service.id) ? 'Asignado' : 'No asignado' }}
                  </span>
                </li>
              </ul>
            </div>

            <div ref="footerRef" class="professional-services-page__footer">
              <BasePagination
                :current-page="currentPage"
                :total-pages="totalPages"
                :count-label="countLabel"
                nav-label="Paginación de servicios"
                @change="goToPage"
              />
            </div>
          </fieldset>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Lenguaje v2 «La luz del día» (DEC-188), igual que Agenda, Servicios y
   Profesionales: tarjetas con borde sutil, rótulos en tipo oración, lo
   seleccionado en tinta y sin acento (esta pantalla no tiene una acción
   principal con botón: cada fila se guarda sola). Composición propia: a la
   izquierda la ficha de la persona con su medidor, a la derecha el catálogo
   como filas de casilla; en móvil la ficha pasa arriba y el catálogo debajo. */
.professional-services-page {
  --professional-services-width: 920px;
  --professional-services-row-height: 72px;

  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  padding: 34px 32px 48px;
  color: var(--color-on-strong);
  /* Transparente: la tinta y el fondo animado los pone el cascarón. */
  background: transparent;
}

.professional-services-page__header,
.professional-services-page__state,
.professional-services-page__empty,
.professional-services-page > :deep(.base-alert),
.professional-services-page__workspace {
  width: min(100%, var(--professional-services-width));
  margin-inline: auto;
}

.professional-services-page__header {
  padding-bottom: 16px;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

/* h1 v2 (DEC-188): el mismo título que DailyAgendaPage.vue. */
.professional-services-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-page-title);
  font-weight: 400;
  line-height: var(--font-size-page-title-line);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

.professional-services-page__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

.professional-services-page__state {
  padding: var(--space-4) 0;
  color: var(--color-on-strong-muted);
}

.professional-services-page__state-text {
  margin: 0 0 var(--space-3);
}

/* Esqueleto: filas del tamaño de las reales con el brillo que cruza de
   izquierda a derecha, para que la carga ocupe el lugar del contenido. Es
   carga (dura lo que dura la petición), por eso v2 lo permite; con
   movimiento reducido queda quieto (ver abajo). */
.professional-services-page__skeleton {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0;
  margin: 0;
  list-style: none;
  overflow: hidden;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.professional-services-page__skeleton-row {
  height: 68px;
  background: linear-gradient(
    100deg,
    transparent 30%,
    color-mix(in srgb, var(--color-on-strong) 8%, transparent) 50%,
    transparent 70%
  );
  background-size: 200% 100%;
  animation: nava-shimmer 1.6s linear infinite;
}

.professional-services-page__workspace {
  display: grid;
  align-items: start;
  gap: 24px;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 900px) {
  .professional-services-page__workspace {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 32px;
  }

  .professional-services-page__profile {
    position: sticky;
    top: 0;
  }
}

/* Ficha de la persona */
.professional-services-page__profile {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  /* Tarjeta v2: borde sutil de 1px, sin filete superior de acento. */
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.professional-services-page__identity {
  display: flex;
  align-items: center;
  gap: 16px;
}

.professional-services-page__identity-name {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
  line-height: var(--font-size-title-item-line);
  color: var(--color-on-strong);
}

@media (max-width: 899px) {
  .professional-services-page .professional-services-page__avatar {
    --avatar-size: 64px;
  }

  /* Con selector, en angosto el nombre salía dos veces seguidas (revisión de
     #720): el selector ya lo muestra y hace de título, así que la ficha deja
     el retrato a su izquierda y oculta el nombre repetido. Sin selector (el
     empleado ve solo su perfil) el nombre se queda. */
  .professional-services-page__profile--picker {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: 16px;
  }

  .professional-services-page__profile--picker .professional-services-page__identity-name {
    display: none;
  }

  .professional-services-page__profile--picker .professional-services-page__meter {
    grid-column: 1 / -1;
  }
}

/* Escritorio: retrato y nombre centrados en la ficha, con el nombre en
   tamaño de título de sección (pedido del propietario, 2026-11-15: el retrato
   se veía corrido y el nombre pequeño y desalineado). */
@media (min-width: 900px) {
  .professional-services-page__identity {
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding-bottom: 4px;
    text-align: center;
  }

  .professional-services-page__identity-name {
    font-size: var(--font-size-title-section);
    line-height: var(--font-size-title-section-line);
  }
}

.professional-services-page__picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Rótulo v2 (DEC-188): tipo oración, 13px/500 en texto secundario. */
.professional-services-page__label {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

/* Medidor: cifra grande y una barra que se llena, ambas en tinta (v2: el
   acento es solo de la acción principal). */
.professional-services-page__meter {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.professional-services-page__meter-figure {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
}

.professional-services-page__meter-count {
  /* Dato, no titular: va en la sans con cifras tabulares (#726). */
  font-family: var(--font-sans);
  font-size: var(--font-size-title-page);
  line-height: 1;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.professional-services-page__meter-total {
  /* Dato, no titular: va en la sans con cifras tabulares (#726). */
  font-family: var(--font-sans);
  font-size: var(--font-size-title-item);
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
}

.professional-services-page__meter-unit {
  margin-left: 2px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.professional-services-page__meter-track {
  display: block;
  height: 4px;
  overflow: hidden;
  background-color: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-radius: 2px;
}

.professional-services-page__meter-fill {
  display: block;
  width: 100%;
  height: 100%;
  background-color: var(--color-text-primary);
  transform-origin: left center;
  /* Respuesta a asignar o cambiar de persona: ≤200 ms (v2, DEC-188). */
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

/* Catálogo */
.professional-services-page__fieldset {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0;
  margin: 0;
  min-width: 0;
  border: none;
}

.professional-services-page__legend {
  padding: 0;
  margin-bottom: 14px;
  /* Dato, no titular: va en la sans con cifras tabulares (#726). */
  font-family: var(--font-sans);
  font-size: var(--font-size-title-item);
  line-height: var(--font-size-title-item-line);
  color: var(--color-on-strong);
}

.professional-services-page__toggle-error {
  margin: 0;
}

/* Velo de carga del catálogo (issue #575). La tabla de debajo conserva su alto:
   en la primera carga no se ve (aún no hay datos reales), al cambiar de
   persona se atenúa. */
.professional-services-page__panel {
  position: relative;
  min-height: 320px;
}

.professional-services-page__fieldset {
  transition: opacity 220ms var(--motion-easing-standard);
}

.professional-services-page__fieldset--hidden {
  visibility: hidden;
}

.professional-services-page__fieldset--dimmed {
  opacity: 0.22;
  /* Mismo retraso que el velo: una respuesta rápida no llega a atenuar. */
  transition-delay: 120ms;
}

.professional-services-page__veil {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-surface) 55%, transparent);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(2px);
}

/* El velo entra con un retraso breve: si la respuesta llega antes, nunca se
   pinta y una carga casi instantánea no destella. */
.professional-services-veil-enter-active {
  transition: opacity 220ms var(--motion-easing-standard) 120ms;
}

.professional-services-veil-leave-active {
  transition: opacity 180ms var(--motion-easing-standard);
}

.professional-services-veil-enter-from,
.professional-services-veil-leave-to {
  opacity: 0;
}

.professional-services-page__meter {
  transition: opacity 220ms var(--motion-easing-standard);
}

.professional-services-page__meter--busy {
  opacity: 0.35;
}

/* Esqueleto de la primera carga con la forma de la pantalla lista. */
.professional-services-page__skeleton-workspace {
  display: grid;
  gap: 24px;
  grid-template-columns: minmax(0, 1fr);
  margin-top: var(--space-3);
}

.professional-services-page__skeleton-profile {
  height: 220px;
  background: linear-gradient(
    100deg,
    transparent 30%,
    color-mix(in srgb, var(--color-on-strong) 8%, transparent) 50%,
    transparent 70%
  );
  background-color: var(--color-surface);
  background-size: 200% 100%;
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  animation: nava-shimmer 1.6s linear infinite;
}

@media (min-width: 900px) {
  .professional-services-page__skeleton-workspace {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 32px;
  }

  .professional-services-page__skeleton-profile {
    height: 320px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .professional-services-page__fieldset,
  .professional-services-page__meter,
  .professional-services-veil-enter-active,
  .professional-services-veil-leave-active {
    transition: none;
  }

  .professional-services-page__skeleton-profile {
    animation: none;
  }
}

/* Encabezado de columnas: rótulo v2 en tipo oración, igual que Profesionales y
   Servicios. Comparte columnas con la fila. */
.professional-services-page__columns,
.professional-services-page__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px;
  align-items: center;
  gap: 12px;
}

.professional-services-page__columns {
  min-height: 44px;
  padding: 0 16px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.professional-services-page__columns span:last-child {
  text-align: right;
}

.professional-services-page__list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
  overflow: hidden;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.professional-services-page__row {
  position: relative;
  height: var(--professional-services-row-height);
  padding: 0 16px;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  transition: background-color var(--motion-duration-base) var(--motion-easing-standard);
}

.professional-services-page__row:first-child {
  border-top: none;
}

/* Asignado: seleccionado en tinta (v2, DEC-188), un velo leve de tinta en vez
   del filete y el tinte de acento de v1. */
.professional-services-page__row--assigned {
  background-color: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
}

@media (hover: hover) {
  .professional-services-page__row:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  }

  .professional-services-page__row--assigned:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  }
}

/* El label ENVUELVE casilla y nombre; su ::after cubre toda la fila para que
   cualquier clic o toque alterne el servicio (objetivo de 72px de alto). */
.professional-services-page__item-label {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  height: 100%;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-lg);
  font-weight: 500;
  color: var(--color-on-strong);
  cursor: pointer;
}

.professional-services-page__item-label::after {
  content: '';
  position: absolute;
  inset: 0;
}

/* Casilla propia v2: contorno de control que se rellena de tinta y dibuja la
   marca (sin acento ni rebote). */
.professional-services-page__checkbox {
  position: relative;
  appearance: none;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  margin: 0;
  cursor: pointer;
  background-color: var(--color-surface);
  border: var(--border-width-emphasis) solid var(--color-border-control);
  border-radius: var(--radius-sm);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.professional-services-page__checkbox::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 7px;
  width: 6px;
  height: 11px;
  border-right: var(--border-width-emphasis) solid var(--color-surface);
  border-bottom: var(--border-width-emphasis) solid var(--color-surface);
  opacity: 0;
  transform: rotate(45deg) scale(0.4);
  transition:
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.professional-services-page__checkbox:checked {
  background-color: var(--color-text-primary);
  border-color: var(--color-text-primary);
}

.professional-services-page__checkbox:checked::after {
  opacity: 1;
  transform: rotate(45deg) scale(1);
}

.professional-services-page__checkbox[aria-disabled='true'] {
  cursor: progress;
  opacity: 0.6;
}

.professional-services-page__checkbox:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.professional-services-page__service-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  /* Letra de monograma: sans 600. La serif por debajo de 20 px se ensucia (#726). */
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: var(--font-size-body-lg);
  line-height: 1;
  color: var(--color-text-secondary);
  background-color: var(--color-surface-muted);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.professional-services-page__service-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Estado como rótulo con punto quieto (mismo lenguaje v2 que Servicios y
   Profesionales: tipo oración, sin rombo ni entrada animada). */
.professional-services-page__assignment,
.professional-services-page__pending {
  position: relative;
  z-index: 1;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-family-base);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  color: var(--color-on-strong-muted);
  pointer-events: none;
}

.professional-services-page__assignment::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
}

.professional-services-page__assignment--assigned {
  color: var(--color-success-on-strong);
}

/* Pie de la tabla: el paginador compartido ocupa todo el ancho. */
.professional-services-page__footer {
  display: flex;
  flex-direction: column;
}

.professional-services-page__spinner {
  width: 12px;
  height: 12px;
  /* «Guardando…»: aro en texto secundario que gira mientras dura el guardado
     (es carga, finita); sin acento. */
  border: var(--border-width-emphasis) solid var(--color-text-secondary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: professional-services-spin 800ms linear infinite;
}

@keyframes professional-services-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .professional-services-page__spinner,
  .professional-services-page__skeleton-row,
  .professional-services-page__skeleton-profile {
    animation: none;
  }

  .professional-services-page__row,
  .professional-services-page__checkbox,
  .professional-services-page__checkbox::after,
  .professional-services-page__meter-fill {
    transition: none;
  }
}

/* «Animaciones reducidas» de Configuración (DEC-110): esqueletos y aro quedan
   quietos igual que con la preferencia del sistema. */
:global(:root[data-motion='reduced']) .professional-services-page__spinner,
:global(:root[data-motion='reduced']) .professional-services-page__skeleton-row,
:global(:root[data-motion='reduced']) .professional-services-page__skeleton-profile {
  animation: none;
}

@media (max-width: 640px) {
  .professional-services-page {
    gap: 12px;
    padding: 20px 16px 28px;
  }

  .professional-services-page__profile {
    padding: 16px;
  }

  .professional-services-page {
    --professional-services-row-height: 64px;
  }

  /* Sin encabezado en móvil (como Profesionales): la fila ya se explica sola. */
  .professional-services-page__columns {
    display: none;
  }

  .professional-services-page__row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 0 12px;
  }

  .professional-services-page__item-label {
    gap: 10px;
    font-size: var(--font-size-body);
  }

  .professional-services-page__service-icon {
    display: none;
  }
}
</style>
