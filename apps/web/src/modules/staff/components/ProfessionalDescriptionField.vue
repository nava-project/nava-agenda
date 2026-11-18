<script setup lang="ts">
// Campo «Descripción» del profesional (DEC-127): un texto corto y opcional que la
// reserva pública muestra junto a su nombre y su foto. BaseInput no admite
// varias líneas, así que el campo vive aquí con la misma piel del diálogo de
// Staff (tinta hundida, filete inferior, etiqueta de latón). El contador cuenta
// caracteres Unicode igual que el servidor y no fija `maxlength`: un exceso
// pegado produce el mensaje de validación real en vez de truncarse en silencio.
import { computed, useId } from 'vue'
import { DESCRIPTION_MAX_LENGTH, descriptionLength } from '../validation/staffValidation'

interface Props {
  modelValue: string
  disabled?: boolean
  error?: string
}

const props = withDefaults(defineProps<Props>(), { disabled: false, error: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const id = `professional-description-${useId()}`
const hintId = `${id}-hint`
const errorId = `${id}-error`

const length = computed(() => descriptionLength(props.modelValue))
const overLimit = computed(() => length.value > DESCRIPTION_MAX_LENGTH)

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div
    class="professional-description"
    :class="{
      'professional-description--filled': !!modelValue.trim(),
      'professional-description--invalid': !!error,
    }"
  >
    <label :for="id" class="professional-description__label">Descripción</label>
    <textarea
      :id="id"
      name="description"
      class="professional-description__textarea"
      rows="3"
      :value="modelValue"
      :disabled="disabled"
      :aria-invalid="!!error"
      :aria-describedby="error ? `${hintId} ${errorId}` : hintId"
      @input="onInput"
    />
    <div class="professional-description__foot">
      <p :id="hintId" class="professional-description__hint">
        Texto público: los clientes lo verán al elegir. Opcional.
      </p>
      <span
        class="professional-description__counter"
        :class="{ 'professional-description__counter--over': overLimit }"
        aria-hidden="true"
        >{{ length }} / {{ DESCRIPTION_MAX_LENGTH }}</span
      >
    </div>
    <p v-if="error" :id="errorId" class="professional-description__error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.professional-description {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.professional-description__label {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.professional-description__textarea {
  width: 100%;
  min-height: 84px;
  padding: 12px var(--space-4);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--color-on-strong);
  resize: vertical;
  background-color: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-bottom: var(--border-width-emphasis) solid
    color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  border-radius: 2px;
  outline: none;
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.professional-description__textarea:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-on-strong) 26%, transparent);
}

.professional-description__textarea:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.professional-description__textarea:disabled {
  color: var(--color-on-strong-muted);
  opacity: 0.45;
}

/* El filete dorado inferior marca el campo YA RESUELTO (mismo criterio que el
   nombre en este diálogo). */
.professional-description--filled .professional-description__textarea {
  background-color: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.professional-description--invalid .professional-description__textarea {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 7%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.professional-description__foot {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
}

.professional-description__hint {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

.professional-description__counter {
  flex: none;
  font-family: var(--font-family-base);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  color: var(--color-on-strong-muted);
}

.professional-description__counter--over {
  font-weight: 600;
  color: var(--color-danger-on-strong);
}

.professional-description__error {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-danger-on-strong);
}
</style>
