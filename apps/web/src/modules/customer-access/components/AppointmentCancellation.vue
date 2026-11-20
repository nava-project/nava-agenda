<script setup lang="ts">
// Sección «Cancelar turno» del acceso al turno (HU-099, T5). Presentacional: la
// página posee el estado, la clave de idempotencia y la llamada al API. Cuatro
// casos excluyentes: la política no permite cancelar (explica por qué y dónde
// contactar), el botón inicial, el formulario de confirmación con la consecuencia
// por delante, y el rechazo del servidor (que siempre prevalece sobre la pista local
// de `cancellationAvailability`, que usa el reloj del dispositivo).
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BaseAlert, SunDiamond } from '@/shared/ui'
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
  <!-- v2 (DEC-188): bloque sobrio. «Cancelar turno» es secundaria (contorno) y la
       confirmación es la única acción roja; nada usa el color del negocio. -->
  <section class="mt-section appointment-cancel" aria-labelledby="appointment-cancel-title">
    <h2 id="appointment-cancel-title" ref="title" :tabindex="startOpen ? -1 : undefined">
      Cancelar turno
    </h2>

    <template v-if="unavailable">
      <BaseAlert variant="warning" role="status">
        {{ unavailableText }}
      </BaseAlert>
      <p v-if="hasContact" class="mt-section__lead">
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
      <p v-else class="mt-section__lead">Escríbele por el mismo medio por el que reservaste.</p>
    </template>

    <template v-else-if="!confirming">
      <p class="mt-section__lead">Si ya no puedes ir, cancela para liberar el horario.</p>
      <div class="mt-section__actions">
        <button type="button" class="mt-button" @click="open">Cancelar turno</button>
      </div>
    </template>

    <form v-else class="mt-section" novalidate @submit.prevent="onSubmit">
      <p id="appointment-cancel-consequence" class="mt-section__lead">
        Se libera tu horario y este enlace seguirá mostrando el turno como cancelado. No se puede
        deshacer: para volver tendrás que reservar de nuevo.
      </p>

      <div class="mt-field">
        <label for="appointment-cancel-reason">
          Motivo
          <span class="mt-field__optional">{{
            reasonRequired ? '(obligatorio)' : '(opcional)'
          }}</span>
        </label>
        <textarea
          id="appointment-cancel-reason"
          ref="reasonField"
          v-model="reason"
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
        <div class="mt-field__foot">
          <p
            v-if="reasonError"
            id="appointment-cancel-reason-error"
            class="mt-field__error"
            role="alert"
          >
            {{ reasonError }}
          </p>
          <span
            class="mt-field__counter"
            :class="{ 'mt-field__counter--over': overLimit }"
            aria-hidden="true"
            >{{ reasonLength }} / {{ CANCELLATION_REASON_MAX_LENGTH }}</span
          >
        </div>
      </div>

      <BaseAlert v-if="errorMessage" variant="danger" role="alert">{{ errorMessage }}</BaseAlert>

      <div class="mt-section__actions">
        <button
          type="submit"
          class="mt-button mt-button--danger"
          :disabled="submitting"
          :aria-busy="submitting"
        >
          <SunDiamond v-if="submitting" size="sm" class="bk-cta__wait" />
          {{ submitting ? 'Cancelando…' : 'Sí, cancelar mi turno' }}
        </button>
        <button type="button" class="mt-button" :disabled="submitting" @click="close">
          Mantener mi turno
        </button>
      </div>
    </form>
  </section>
</template>
