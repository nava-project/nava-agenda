<script setup lang="ts">
// Sección «Tu opinión» del acceso al turno (HU-100, DEC-128). Presentacional: la
// página posee el estado y llama al API. Tres casos excluyentes: el turno admite
// reseña (formulario), el cliente ya la dejó (se muestra de solo lectura) o ninguno
// (no renderiza nada: un turno no completado nunca ofrece «Calificar», CA-100-01).
import { computed, ref } from 'vue'
import { BaseAlert, StarRating, StarRatingInput } from '@/shared/ui'
import { commentLength, REVIEW_COMMENT_MAX_LENGTH } from '@/shared/model/rating'
import type { CustomerReview, ReviewInput } from '../model/customerAppointmentOutcome'

interface Props {
  canReview: boolean
  review: CustomerReview | null
  /** Nombre de quien atendió, para el título «Califica a …». */
  professionalName: string
  submitting?: boolean
  /** Mensaje de error del envío ya redactado por la página. */
  errorMessage?: string
}
const props = withDefaults(defineProps<Props>(), { submitting: false, errorMessage: '' })
const emit = defineEmits<{ submit: [input: ReviewInput] }>()

const rating = ref<number | null>(null)
const comment = ref('')
const ratingError = ref('')

const length = computed(() => commentLength(comment.value))
const overLimit = computed(() => length.value > REVIEW_COMMENT_MAX_LENGTH)
const commentError = computed(() =>
  overLimit.value ? `El comentario no puede superar ${REVIEW_COMMENT_MAX_LENGTH} caracteres.` : '',
)

function onSubmit() {
  ratingError.value = rating.value === null ? 'Elige de 1 a 5 estrellas.' : ''
  if (rating.value === null || overLimit.value) return
  const trimmed = comment.value.trim()
  emit('submit', { rating: rating.value, comment: trimmed === '' ? null : trimmed })
}
</script>

<template>
  <section
    v-if="canReview"
    class="mt-section appointment-review"
    aria-labelledby="appointment-review-title"
  >
    <h2 id="appointment-review-title">Califica a {{ professionalName }}</h2>
    <p class="mt-section__lead">Tu opinión ayuda a otras personas a elegir. Es pública.</p>

    <form class="mt-section mt-section--flush" novalidate @submit.prevent="onSubmit">
      <StarRatingInput
        v-model="rating"
        legend="Tu calificación"
        :error="ratingError"
        :disabled="submitting"
      />

      <div class="mt-field">
        <label for="appointment-review-comment">
          Comentario <span class="mt-field__optional">(opcional)</span>
        </label>
        <textarea
          id="appointment-review-comment"
          v-model="comment"
          rows="4"
          name="comment"
          :disabled="submitting"
          :aria-invalid="!!commentError"
          aria-describedby="appointment-review-hint"
        />
        <div class="mt-field__foot">
          <p id="appointment-review-hint">
            No escribas teléfonos, direcciones ni nombres de otras personas.
          </p>
          <span
            class="mt-field__counter"
            :class="{ 'mt-field__counter--over': overLimit }"
            aria-hidden="true"
            >{{ length }} / {{ REVIEW_COMMENT_MAX_LENGTH }}</span
          >
        </div>
        <p v-if="commentError" class="mt-field__error" role="alert">
          {{ commentError }}
        </p>
      </div>

      <BaseAlert v-if="errorMessage" variant="danger" role="alert">{{ errorMessage }}</BaseAlert>

      <div class="mt-section__actions">
        <button type="submit" class="bk-cta" :disabled="submitting" :aria-busy="submitting">
          {{ submitting ? 'Enviando…' : 'Enviar reseña' }}
        </button>
      </div>
    </form>
  </section>

  <section
    v-else-if="props.review"
    class="mt-section appointment-review"
    aria-labelledby="appointment-review-title"
  >
    <h2 id="appointment-review-title">Gracias por tu reseña</h2>
    <p class="mt-section__lead">Así la ven quienes eligen a {{ professionalName }}.</p>
    <StarRating :rating="props.review.rating" :count="1" :show-value="false" />
    <p v-if="props.review.comment" class="appointment-review__comment">
      {{ props.review.comment }}
    </p>
  </section>
</template>

<style scoped>
.appointment-review__comment {
  padding-left: var(--space-3);
  font-size: 15px;
  line-height: 1.5;
  border-left: 3px solid var(--color-border-control);
}
</style>
