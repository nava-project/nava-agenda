<script setup lang="ts">
// Reseñas de un profesional para quien administra (HU-100, DEC-128, CA-100-05). Muestra
// el promedio y, bajo demanda, TODAS las reseñas —las ocultas incluidas, con la fecha
// en que se ocultaron— y permite ocultar o volver a mostrar cada una. Ocultar no
// borra: es reversible y solo saca la reseña del promedio y de la lista pública.
// Autocontenido (pide sus datos por `professionalId`) para usarlo igual en el detalle de
// un profesional y en la ficha del perfil individual.
//
// Dos colocaciones (issue #487): sin `asideTo` la lista se despliega debajo del
// resumen (detalle de profesional); con `asideTo` —un selector— el resumen sigue en la
// tarjeta y la lista se dibuja en un cuadro propio a la derecha, en ese contenedor,
// con scroll vertical interno. El estado vive aquí en ambos casos.
import { computed, nextTick, ref, watch } from 'vue'
import { BaseButton, StarRating } from '@/shared/ui'
import { listProfessionalReviews, setReviewHidden } from '../api/reviewsApi'
import type { ProfessionalReview, ProfessionalReviewList } from '../model/review'

interface Props {
  professionalId: string
  /** Promedio y total que ya trae la lista de profesionales, para pintar sin pedir nada. */
  rating: number | null
  ratingCount: number
  /** Selector del contenedor donde dibujar la lista como cuadro lateral. */
  asideTo?: string
  /** Solo lectura: el empleado ve sus reseñas pero no las modera (DEC-173). */
  readOnly?: boolean
}
const props = defineProps<Props>()
// El promedio cambia al ocultar o mostrar: se avisa para que quien lo muestra se actualice.
const emit = defineEmits<{
  changed: [summary: { rating: number | null; ratingCount: number }]
  /** La lista se abrió o cerró: quien aloja el cuadro lateral ajusta su composición. */
  openChange: [open: boolean]
}>()

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; reviews: ProfessionalReviewList }
  | { status: 'error' }

const open = ref(false)
const toggleRef = ref<HTMLButtonElement | null>(null)
const state = ref<LoadState>({ status: 'idle' })
const busyId = ref<string | null>(null)
const actionError = ref('')
let requestToken = 0

const shown = computed(() =>
  state.value.status === 'success'
    ? { rating: state.value.reviews.rating, count: state.value.reviews.ratingCount }
    : { rating: props.rating, count: props.ratingCount },
)

async function load() {
  const token = ++requestToken
  state.value = { status: 'loading' }
  actionError.value = ''
  const outcome = await listProfessionalReviews(props.professionalId)
  if (token !== requestToken) return
  state.value =
    outcome.kind === 'success'
      ? { status: 'success', reviews: outcome.reviews }
      : { status: 'error' }
}

function setOpen(value: boolean) {
  open.value = value
  emit('openChange', value)
  if (value && state.value.status !== 'success') void load()
}

function toggle() {
  setOpen(!open.value)
}

// Cerrar desde el cuadro lateral devuelve el foco al botón que lo abrió, para que el
// teclado no pierda su lugar al desaparecer el cuadro.
async function close() {
  setOpen(false)
  await nextTick()
  toggleRef.value?.focus()
}

async function toggleHidden(review: ProfessionalReview) {
  if (busyId.value) return
  busyId.value = review.id
  actionError.value = ''
  const outcome = await setReviewHidden(props.professionalId, review.id, review.hiddenAt === null)
  busyId.value = null
  if (outcome.kind !== 'success') {
    actionError.value = 'No pudimos actualizar la reseña. Inténtalo de nuevo.'
    return
  }
  // El promedio lo calcula el servidor: se vuelve a leer la lista completa.
  await load()
  if (state.value.status === 'success') {
    emit('changed', {
      rating: state.value.reviews.rating,
      ratingCount: state.value.reviews.ratingCount,
    })
  }
}

watch(
  () => props.professionalId,
  () => {
    requestToken++
    if (open.value) emit('openChange', false)
    open.value = false
    state.value = { status: 'idle' }
    actionError.value = ''
  },
)

const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}
</script>

<template>
  <section class="professional-reviews" aria-label="Reseñas">
    <!-- Fila-resumen (issue #491): la calificación y el acceso a las reseñas son una sola
         pieza interactiva, no un botón suelto junto a los diamantes. Resaltada mientras
         el cuadro está abierto. -->
    <button
      ref="toggleRef"
      type="button"
      class="professional-reviews__toggle"
      :class="{ 'professional-reviews__toggle--open': open }"
      :aria-expanded="open"
      :aria-controls="`professional-reviews-${professionalId}`"
      @click="toggle"
    >
      <StarRating :rating="shown.rating" :count="shown.count" />
      <span class="professional-reviews__cta">
        {{ open ? 'Ocultar' : 'Ver reseñas' }}
        <svg
          class="professional-reviews__cta-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </button>

    <Teleport :to="asideTo ?? 'body'" :disabled="!asideTo" defer>
      <component
        :is="asideTo ? 'aside' : 'div'"
        v-if="open"
        :id="`professional-reviews-${professionalId}`"
        class="professional-reviews__panel"
        :class="{ 'professional-reviews__panel--aside': asideTo }"
        :aria-label="asideTo ? 'Reseñas' : undefined"
        @keydown.esc="asideTo && close()"
      >
        <header v-if="asideTo" class="professional-reviews__aside-head">
          <div class="professional-reviews__aside-title">
            <p class="professional-reviews__eyebrow">Reseñas</p>
            <StarRating :rating="shown.rating" :count="shown.count" />
          </div>
          <BaseButton
            type="button"
            variant="secondary"
            class="professional-reviews__close"
            @click="close"
          >
            Cerrar
          </BaseButton>
        </header>

        <div
          class="professional-reviews__body"
          :class="{ 'professional-reviews__body--scroll': asideTo }"
          :tabindex="asideTo ? 0 : undefined"
          :role="asideTo ? 'region' : undefined"
          :aria-label="asideTo ? 'Lista de reseñas' : undefined"
        >
          <p v-if="state.status === 'loading'" class="professional-reviews__note" role="status">
            Cargando reseñas…
          </p>
          <p v-else-if="state.status === 'error'" class="professional-reviews__note" role="alert">
            No pudimos cargar las reseñas.
            <BaseButton type="button" variant="secondary" @click="load">Reintentar</BaseButton>
          </p>
          <template v-else-if="state.status === 'success'">
            <p v-if="actionError" class="professional-reviews__error" role="alert">
              {{ actionError }}
            </p>
            <p v-if="state.reviews.items.length === 0" class="professional-reviews__note">
              Todavía no hay reseñas.
            </p>
            <ul v-else class="professional-reviews__list">
              <li
                v-for="review in state.reviews.items"
                :key="review.id"
                class="professional-reviews__item"
                :class="{ 'professional-reviews__item--hidden': review.hiddenAt !== null }"
              >
                <div class="professional-reviews__head">
                  <StarRating
                    :rating="review.rating"
                    :count="1"
                    size="sm"
                    :show-value="false"
                    :label="`${review.rating} de 5 estrellas`"
                  />
                  <time :datetime="review.createdAt" class="professional-reviews__date">{{
                    formatDate(review.createdAt)
                  }}</time>
                  <span v-if="review.hiddenAt" class="professional-reviews__badge">
                    Oculta desde el {{ formatDate(review.hiddenAt) }}
                  </span>
                </div>
                <p v-if="review.comment" class="professional-reviews__comment">
                  {{ review.comment }}
                </p>
                <BaseButton
                  v-if="!readOnly"
                  type="button"
                  variant="secondary"
                  :disabled="busyId !== null"
                  :aria-label="`${review.hiddenAt ? 'Mostrar' : 'Ocultar'} la reseña de ${review.rating} estrellas del ${formatDate(review.createdAt)}`"
                  @click="toggleHidden(review)"
                >
                  {{ review.hiddenAt ? 'Mostrar' : 'Ocultar' }}
                </BaseButton>
              </li>
            </ul>
          </template>
        </div>
      </component>
    </Teleport>
  </section>
</template>

<style scoped>
.professional-reviews {
  /* Las gemas de la valoración van en tinta (v2, DEC-188): el acento es solo
     de la acción principal (antes latón, issue #489). */
  --star-filled-color: var(--color-text-primary);
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.professional-reviews__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.professional-reviews__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Fila-resumen: tarjeta v2 con borde sutil (sin filete lateral de acento); al abrir
   el cuadro queda resaltada en tinta para ligarla con él. */
.professional-reviews__toggle {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
  font: inherit;
  color: var(--color-on-strong);
  text-align: left;
  cursor: pointer;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.professional-reviews__toggle:hover,
.professional-reviews__toggle--open {
  background-color: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  border-color: var(--color-text-primary);
}

.professional-reviews__toggle:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.professional-reviews__cta {
  display: inline-flex;
  white-space: nowrap;
  gap: 8px;
  align-items: center;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
}

.professional-reviews__cta-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

.professional-reviews__toggle:hover .professional-reviews__cta-arrow {
  transform: translateX(3px);
}

/* Abierto: la flecha apunta de vuelta al cuadro que se cierra. */
.professional-reviews__toggle--open .professional-reviews__cta-arrow,
.professional-reviews__toggle--open:hover .professional-reviews__cta-arrow {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .professional-reviews__toggle,
  .professional-reviews__cta-arrow {
    transition: none;
  }

  .professional-reviews__toggle:hover .professional-reviews__cta-arrow {
    transform: none;
  }
}

/* Cuadro lateral (issue #487): la misma tarjeta v2 que la del perfil (borde sutil,
   sin filete de acento ni entrada animada); el scroll vive en la lista. */
.professional-reviews__panel--aside {
  gap: var(--space-4);
  width: 100%;
  box-sizing: border-box;
  padding: 24px 24px 16px;
  background-color: var(--color-surface);
  color: var(--color-on-strong);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.professional-reviews__aside-head {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: var(--space-3);
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

.professional-reviews__aside-title {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Rótulo v2 (DEC-188): tipo oración, 13px/500 en texto secundario. */
.professional-reviews__eyebrow {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.professional-reviews__body--scroll {
  flex: 1;
  min-height: 0;
  padding-right: var(--space-2);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.professional-reviews__body--scroll:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.professional-reviews__panel--aside .professional-reviews__date {
  color: var(--color-on-strong-muted);
}

.professional-reviews__panel--aside .professional-reviews__item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.professional-reviews__note,
.professional-reviews__error {
  margin: 0;
  font-size: var(--font-size-body-sm);
}

.professional-reviews__error {
  color: var(--color-danger-text, currentColor);
}

.professional-reviews__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.professional-reviews__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid currentColor;
  border-bottom-color: color-mix(in srgb, currentColor 18%, transparent);
}

.professional-reviews__item--hidden .professional-reviews__comment {
  opacity: 0.7;
}

.professional-reviews__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
}

.professional-reviews__date {
  font-size: var(--font-size-caption, 13px);
}

.professional-reviews__badge {
  padding: 2px var(--space-2);
  font-size: var(--font-size-caption, 13px);
  font-weight: 600;
  border: 1px solid currentColor;
  border-radius: 999px;
}

.professional-reviews__comment {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
