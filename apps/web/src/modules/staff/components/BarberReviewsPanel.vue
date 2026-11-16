<script setup lang="ts">
// Reseñas de un barbero para quien administra (HU-100, DEC-128, CA-100-05). Muestra
// el promedio y, bajo demanda, TODAS las reseñas —las ocultas incluidas, con la fecha
// en que se ocultaron— y permite ocultar o volver a mostrar cada una. Ocultar no
// borra: es reversible y solo saca la reseña del promedio y de la lista pública.
// Autocontenido (pide sus datos por `barberId`) para usarlo igual en el detalle de
// un barbero y en la ficha del perfil individual.
//
// Dos colocaciones (issue #487): sin `asideTo` la lista se despliega debajo del
// resumen (detalle de barbero); con `asideTo` —un selector— el resumen sigue en la
// tarjeta y la lista se dibuja en un cuadro propio a la derecha, en ese contenedor,
// con scroll vertical interno. El estado vive aquí en ambos casos.
import { computed, nextTick, ref, watch } from 'vue'
import { BaseButton, StarRating } from '@/shared/ui'
import { listBarberReviews, setReviewHidden } from '../api/reviewsApi'
import type { BarberReview, BarberReviewList } from '../model/review'

interface Props {
  barberId: string
  /** Promedio y total que ya trae la lista de barberos, para pintar sin pedir nada. */
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
  | { status: 'success'; reviews: BarberReviewList }
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
  const outcome = await listBarberReviews(props.barberId)
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

async function toggleHidden(review: BarberReview) {
  if (busyId.value) return
  busyId.value = review.id
  actionError.value = ''
  const outcome = await setReviewHidden(props.barberId, review.id, review.hiddenAt === null)
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
  () => props.barberId,
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
  <section class="barber-reviews" aria-label="Reseñas">
    <!-- Fila-resumen (issue #491): la calificación y el acceso a las reseñas son una sola
         pieza interactiva, no un botón suelto junto a los diamantes. Resaltada mientras
         el cuadro está abierto. -->
    <button
      ref="toggleRef"
      type="button"
      class="barber-reviews__toggle"
      :class="{ 'barber-reviews__toggle--open': open }"
      :aria-expanded="open"
      :aria-controls="`barber-reviews-${barberId}`"
      @click="toggle"
    >
      <StarRating :rating="shown.rating" :count="shown.count" />
      <span class="barber-reviews__cta">
        {{ open ? 'Ocultar' : 'Ver reseñas' }}
        <svg
          class="barber-reviews__cta-arrow"
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
        :id="`barber-reviews-${barberId}`"
        class="barber-reviews__panel"
        :class="{ 'barber-reviews__panel--aside': asideTo }"
        :aria-label="asideTo ? 'Reseñas' : undefined"
        @keydown.esc="asideTo && close()"
      >
        <header v-if="asideTo" class="barber-reviews__aside-head">
          <div class="barber-reviews__aside-title">
            <p class="barber-reviews__eyebrow">Reseñas</p>
            <StarRating :rating="shown.rating" :count="shown.count" />
          </div>
          <BaseButton
            type="button"
            variant="secondary"
            class="barber-reviews__close"
            @click="close"
          >
            Cerrar
          </BaseButton>
        </header>

        <div
          class="barber-reviews__body"
          :class="{ 'barber-reviews__body--scroll': asideTo }"
          :tabindex="asideTo ? 0 : undefined"
          :role="asideTo ? 'region' : undefined"
          :aria-label="asideTo ? 'Lista de reseñas' : undefined"
        >
          <p v-if="state.status === 'loading'" class="barber-reviews__note" role="status">
            Cargando reseñas…
          </p>
          <p v-else-if="state.status === 'error'" class="barber-reviews__note" role="alert">
            No pudimos cargar las reseñas.
            <BaseButton type="button" variant="secondary" @click="load">Reintentar</BaseButton>
          </p>
          <template v-else-if="state.status === 'success'">
            <p v-if="actionError" class="barber-reviews__error" role="alert">{{ actionError }}</p>
            <p v-if="state.reviews.items.length === 0" class="barber-reviews__note">
              Todavía no hay reseñas.
            </p>
            <ul v-else class="barber-reviews__list">
              <li
                v-for="review in state.reviews.items"
                :key="review.id"
                class="barber-reviews__item"
                :class="{ 'barber-reviews__item--hidden': review.hiddenAt !== null }"
              >
                <div class="barber-reviews__head">
                  <StarRating
                    :rating="review.rating"
                    :count="1"
                    size="sm"
                    :show-value="false"
                    :label="`${review.rating} de 5 estrellas`"
                  />
                  <time :datetime="review.createdAt" class="barber-reviews__date">{{
                    formatDate(review.createdAt)
                  }}</time>
                  <span v-if="review.hiddenAt" class="barber-reviews__badge">
                    Oculta desde el {{ formatDate(review.hiddenAt) }}
                  </span>
                </div>
                <p v-if="review.comment" class="barber-reviews__comment">{{ review.comment }}</p>
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
.barber-reviews {
  /* Sobre tinta, los diamantes usan el latón claro de la marca (issue #489). */
  --star-filled-color: var(--color-brand-accent-surface);
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.barber-reviews__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.barber-reviews__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Fila-resumen: tinta hundida con filete lateral de latón, como las demás piezas de la
   ficha; al abrir el cuadro queda resaltada para ligarla con él. */
.barber-reviews__toggle {
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
  background-color: var(--color-surface-strong);
  border: var(--border-width-normal) solid var(--color-field-strong-border);
  border-left: 3px solid color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
  border-radius: 2px;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.barber-reviews__toggle:hover,
.barber-reviews__toggle--open {
  background-color: color-mix(
    in srgb,
    var(--color-brand-accent-surface) 10%,
    var(--color-surface-strong)
  );
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 45%, transparent);
  border-left-color: var(--color-brand-accent-surface);
}

.barber-reviews__toggle:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--color-focus);
  outline-offset: 2px;
}

.barber-reviews__cta {
  display: inline-flex;
  white-space: nowrap;
  gap: 8px;
  align-items: center;
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.barber-reviews__cta-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

.barber-reviews__toggle:hover .barber-reviews__cta-arrow {
  transform: translateX(3px);
}

/* Abierto: la flecha apunta de vuelta al cuadro que se cierra. */
.barber-reviews__toggle--open .barber-reviews__cta-arrow,
.barber-reviews__toggle--open:hover .barber-reviews__cta-arrow {
  transform: rotate(180deg);
}

.barber-reviews__close.base-button.base-button--secondary {
  background-color: transparent;
  color: var(--color-brand-accent-surface);
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 50%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.barber-reviews__close.base-button.base-button--secondary:hover:not(:disabled):not(
    .base-button--loading
  ) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 12%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .barber-reviews__toggle,
  .barber-reviews__cta-arrow {
    transition: none;
  }

  .barber-reviews__toggle:hover .barber-reviews__cta-arrow {
    transform: none;
  }
}

/* Cuadro lateral (issue #487): misma tinta hundida y filete de latón que la tarjeta
   del perfil; el scroll vive en la lista, no en la página ni en la tarjeta. */
.barber-reviews__panel--aside {
  gap: var(--space-4);
  width: 100%;
  box-sizing: border-box;
  padding: 24px 24px 16px;
  background-color: var(--color-field-strong);
  color: var(--color-on-strong);
  border: var(--border-width-normal) solid var(--color-field-strong-border);
  border-top: var(--border-width-emphasis) solid var(--color-brand-accent-surface);
  border-radius: 4px;
  animation: barber-reviews-enter 260ms var(--motion-easing-standard) both;
}

@keyframes barber-reviews-enter {
  from {
    opacity: 0;
    transform: translateX(10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.barber-reviews__aside-head {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: var(--space-3);
  border-bottom: var(--border-width-normal) solid var(--color-field-strong-border);
}

.barber-reviews__aside-title {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.barber-reviews__eyebrow {
  margin: 0;
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.barber-reviews__body--scroll {
  flex: 1;
  min-height: 0;
  padding-right: var(--space-2);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.barber-reviews__body--scroll:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--color-focus);
  outline-offset: 2px;
}

.barber-reviews__panel--aside .barber-reviews__date {
  color: var(--color-on-strong-muted);
}

.barber-reviews__panel--aside .barber-reviews__item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.barber-reviews__panel--aside .barber-reviews__item .base-button--secondary {
  color: var(--color-brand-accent-surface);
  background-color: transparent;
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 50%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .barber-reviews__panel--aside {
    animation: none;
  }
}

.barber-reviews__note,
.barber-reviews__error {
  margin: 0;
  font-size: var(--font-size-body-sm);
}

.barber-reviews__error {
  color: var(--color-danger-text, currentColor);
}

.barber-reviews__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.barber-reviews__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid currentColor;
  border-bottom-color: color-mix(in srgb, currentColor 18%, transparent);
}

.barber-reviews__item--hidden .barber-reviews__comment {
  opacity: 0.7;
}

.barber-reviews__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
}

.barber-reviews__date {
  font-size: var(--font-size-caption, 13px);
}

.barber-reviews__badge {
  padding: 2px var(--space-2);
  font-size: var(--font-size-caption, 13px);
  font-weight: 600;
  border: 1px solid currentColor;
  border-radius: 999px;
}

.barber-reviews__comment {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
