<script setup lang="ts">
// Sección «Cancelar turno» del acceso al turno (HU-099, T5). Presentacional: la
// página posee el estado, la clave de idempotencia y la llamada al API. Cuatro
// casos excluyentes: la política no permite cancelar (explica por qué y dónde
// contactar), el botón inicial, el formulario de confirmación con la consecuencia
// por delante, y el rechazo del servidor (que siempre prevalece sobre la pista local
// de `cancellationAvailability`, que usa el reloj del dispositivo).
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert, BaseButton } from '@/shared/ui'
import type { Vocabulary } from '@/shared/model'
import {
  CANCELLATION_REASON_MAX_LENGTH,
  cancellationAvailability,
} from '../model/cancellationAvailability'
import type {
  CancelAppointmentInput,
  CancellationRejection,
  CustomerAppointment,
} from '../model/customerAppointmentOutcome'

interface Props {
  appointment: CustomerAppointment
  vocabulary: Vocabulary
  /** Instante de referencia de la pista local; la página pasa `Date.now()`. */
  nowMs: number
  submitting?: boolean
  /** Rechazo de política devuelto por el servidor, si lo hubo. */
  rejection?: CancellationRejection
  /** Mensaje de error ya redactado por la página (red, inesperado, entrada inválida). */
  errorMessage?: string
  /** Abre directo la confirmación (paso 03 del acceso con código, #647): quien eligió
   * «Cancelar turno» ya dijo qué quiere y no necesita un segundo botón igual. */
  startOpen?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  submitting: false,
  rejection: null,
  errorMessage: '',
  startOpen: false,
})
const emit = defineEmits<{ submit: [input: CancelAppointmentInput]; close: [] }>()

const confirming = ref(props.startOpen)
const reason = ref('')
const reasonError = ref('')
const reasonField = ref<HTMLTextAreaElement | null>(null)

const hint = computed(() => cancellationAvailability(props.appointment, props.nowMs))
// El rechazo del servidor manda: `window-closed` cierra la acción aunque el reloj del
// dispositivo creyera otra cosa, y `reason-required` vuelve obligatorio el motivo.
const unavailable = computed(
  () => props.rejection === 'window-closed' || hint.value.mode === 'unavailable',
)
const reasonRequired = computed(
  () =>
    props.rejection === 'reason-required' ||
    (hint.value.mode === 'late-allowed' && hint.value.reasonRequired),
)
const reasonLength = computed(() => Array.from(reason.value).length)
const overLimit = computed(() => reasonLength.value > CANCELLATION_REASON_MAX_LENGTH)

const unavailableText = computed(() => {
  if (hint.value.mode === 'unavailable' && hint.value.reason === 'started') {
    return `Tu turno ya empezó, así que no puedes cancelarlo desde aquí. Contacta directamente ${props.vocabulary.toTheBusiness}.`
  }
  return `El plazo para cancelar por tu cuenta ya venció. Contacta directamente ${props.vocabulary.toTheBusiness} para cancelar.`
})

const hasContact = computed(
  () => !!props.appointment.businessContactPhone || !!props.appointment.businessContactEmail,
)

async function open() {
  confirming.value = true
  await nextTick()
  reasonField.value?.focus()
}

function close() {
  confirming.value = false
  reasonError.value = ''
  emit('close')
}

// Abierta de entrada, el foco va al título y no al campo: en un celular el teclado taparía la
// consecuencia, que es lo primero que hay que leer.
const title = ref<HTMLElement | null>(null)
onMounted(() => {
  if (props.startOpen) title.value?.focus()
})

// Tras un rechazo por motivo el formulario sigue abierto y el foco vuelve al campo.
watch(
  () => props.rejection,
  async (value) => {
    if (value === 'reason-required') {
      reasonError.value = 'Cuéntanos brevemente el motivo para poder cancelar.'
      await nextTick()
      reasonField.value?.focus()
    }
  },
)

function onSubmit() {
  const trimmed = reason.value.trim()
  reasonError.value = ''
  if (reasonRequired.value && trimmed === '') {
    reasonError.value = 'Cuéntanos brevemente el motivo para poder cancelar.'
    reasonField.value?.focus()
    return
  }
  if (overLimit.value) {
    reasonError.value = `El motivo no puede superar ${CANCELLATION_REASON_MAX_LENGTH} caracteres.`
    reasonField.value?.focus()
    return
  }
  emit('submit', { reason: trimmed === '' ? null : trimmed })
}
</script>

<template>
  <section class="appointment-cancel" aria-labelledby="appointment-cancel-title">
    <h2
      id="appointment-cancel-title"
      ref="title"
      class="appointment-cancel__title"
      :tabindex="startOpen ? -1 : undefined"
    >
      Cancelar turno
    </h2>

    <template v-if="unavailable">
      <BaseAlert variant="warning" role="status">
        {{ unavailableText }}
      </BaseAlert>
      <p v-if="hasContact" class="appointment-cancel__contact">
        Contacto:
        <a
          v-if="appointment.businessContactPhone"
          :href="`tel:${appointment.businessContactPhone}`"
          >{{ appointment.businessContactPhone }}</a
        >
        <template v-if="appointment.businessContactPhone && appointment.businessContactEmail">
          ·
        </template>
        <a
          v-if="appointment.businessContactEmail"
          :href="`mailto:${appointment.businessContactEmail}`"
          >{{ appointment.businessContactEmail }}</a
        >
      </p>
      <p v-else class="appointment-cancel__contact">
        Escríbele por el mismo medio por el que reservaste.
      </p>
    </template>

    <template v-else-if="!confirming">
      <p class="appointment-cancel__lead">
        Si ya no puedes asistir, cancela para liberar el horario.
      </p>
      <BaseButton variant="secondary" @click="open">Cancelar turno</BaseButton>
    </template>

    <form v-else class="appointment-cancel__form" novalidate @submit.prevent="onSubmit">
      <p id="appointment-cancel-consequence" class="appointment-cancel__consequence">
        Al cancelar se libera tu horario y este enlace seguirá mostrando el turno como cancelado. No
        se puede deshacer: para volver a venir tendrás que reservar de nuevo.
      </p>

      <div class="appointment-cancel__field">
        <label for="appointment-cancel-reason" class="appointment-cancel__label">
          Motivo
          <span class="appointment-cancel__optional">{{
            reasonRequired ? '(obligatorio)' : '(opcional)'
          }}</span>
        </label>
        <textarea
          id="appointment-cancel-reason"
          ref="reasonField"
          v-model="reason"
          class="appointment-cancel__textarea"
          rows="3"
          name="reason"
          :disabled="submitting"
          :required="reasonRequired"
          :aria-invalid="!!reasonError"
          :aria-describedby="
            reasonError
              ? 'appointment-cancel-consequence appointment-cancel-reason-error'
              : 'appointment-cancel-consequence'
          "
        />
        <div class="appointment-cancel__foot">
          <p
            v-if="reasonError"
            id="appointment-cancel-reason-error"
            class="appointment-cancel__error"
            role="alert"
          >
            {{ reasonError }}
          </p>
          <span
            class="appointment-cancel__counter"
            :class="{ 'appointment-cancel__counter--over': overLimit }"
            aria-hidden="true"
            >{{ reasonLength }} / {{ CANCELLATION_REASON_MAX_LENGTH }}</span
          >
        </div>
      </div>

      <BaseAlert v-if="errorMessage" variant="danger" role="alert">{{ errorMessage }}</BaseAlert>

      <div class="appointment-cancel__actions">
        <BaseButton type="submit" variant="danger" :loading="submitting">
          Sí, cancelar mi turno
        </BaseButton>
        <BaseButton variant="ghost" :disabled="submitting" @click="close">
          Mantener mi turno
        </BaseButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.appointment-cancel {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-3);
  padding-top: var(--space-5);
  text-align: left;
  border-top: 1px solid color-mix(in srgb, var(--color-on-strong) 14%, transparent);
}

.appointment-cancel__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 400;
  line-height: 36px;
  color: var(--color-on-strong);
}

/* Recibe el foco solo para anunciar la sección (tabindex -1): no es un control. */
.appointment-cancel__title:focus {
  outline: none;
}

.appointment-cancel__lead,
.appointment-cancel__consequence,
.appointment-cancel__contact {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  color: var(--color-on-strong-soft);
  overflow-wrap: anywhere;
}

.appointment-cancel__contact a {
  color: var(--color-on-strong);
}

.appointment-cancel__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.appointment-cancel__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.appointment-cancel__label {
  font-family: var(--font-family-base);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.appointment-cancel__optional {
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  color: var(--color-on-strong-soft);
}

.appointment-cancel__textarea {
  width: 100%;
  min-height: 80px;
  padding: 12px var(--space-4);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--color-on-strong);
  resize: vertical;
  background-color: color-mix(in srgb, #000 46%, var(--color-surface-strong));
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  border-bottom: var(--border-width-emphasis) solid
    color-mix(in srgb, var(--color-brand-accent-surface) 75%, transparent);
  border-radius: 2px;
}

.appointment-cancel__textarea:focus-visible {
  outline: 2px solid var(--color-brand-accent-surface);
  outline-offset: 2px;
}

.appointment-cancel__foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.appointment-cancel__counter,
.appointment-cancel__error {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: 13px;
  color: var(--color-on-strong-soft);
}

.appointment-cancel__counter {
  flex: none;
  margin-left: auto;
}

.appointment-cancel__counter--over,
.appointment-cancel__error {
  color: var(--color-danger-on-strong);
}

.appointment-cancel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* La sección vive sobre tinta oscura: el fantasma de la biblioteca trae texto de tinta pensado
   para papel y aquí casi no se leía «Mantener mi turno» (#647). */
.appointment-cancel__actions :deep(.base-button--ghost) {
  color: var(--color-on-strong);
}

.appointment-cancel__actions
  :deep(.base-button--ghost:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent);
}
</style>
