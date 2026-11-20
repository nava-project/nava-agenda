<script setup lang="ts">
// Interruptor accesible (`role="switch"`) en el lenguaje v2 (DEC-188): pista
// y botón redondos; encendido se pinta en tinta, no en el acento. El estado
// se anuncia con `aria-checked` y también con texto ("Activado"/"Desactivado"),
// nunca solo con el color.
import { useId } from 'vue'

defineProps<{
  modelValue: boolean
  label: string
  hint?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const id = useId()
</script>

<template>
  <div class="switch-field" :class="{ 'switch-field--on': modelValue }">
    <div class="switch-field__copy">
      <label :id="`${id}-label`" :for="`${id}-control`" class="switch-field__label">{{
        label
      }}</label>
      <p v-if="hint" :id="`${id}-hint`" class="switch-field__hint">{{ hint }}</p>
    </div>
    <button
      :id="`${id}-control`"
      type="button"
      role="switch"
      class="switch-field__control"
      :aria-checked="modelValue"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      :disabled="disabled"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="switch-field__state" aria-hidden="true">{{
        modelValue ? 'Activado' : 'Desactivado'
      }}</span>
      <span class="switch-field__track" aria-hidden="true">
        <span class="switch-field__thumb" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.switch-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.switch-field__copy {
  min-width: 0;
}

.switch-field__label {
  display: block;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  line-height: 20px;
  color: var(--color-text-primary);
}

.switch-field__hint {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.switch-field__control {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 2px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  cursor: pointer;
}

.switch-field__control:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* El estado en palabras, en tipo oración: el color nunca lo dice solo. */
.switch-field__state {
  min-width: 76px;
  text-align: right;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.switch-field--on .switch-field__state {
  color: var(--color-text-primary);
}

.switch-field__track {
  position: relative;
  display: block;
  width: 44px;
  height: 24px;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-pill);
  background: var(--color-surface-muted);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.switch-field--on .switch-field__track {
  background: var(--color-text-primary);
  border-color: var(--color-text-primary);
}

.switch-field__thumb {
  position: absolute;
  top: 50%;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  transform: translateY(-50%);
  transition:
    left var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.switch-field--on .switch-field__thumb {
  left: 23px;
  background: var(--color-surface);
}

.switch-field__control:hover:not(:disabled) .switch-field__track {
  border-color: var(--color-text-primary);
}

.switch-field__control:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .switch-field__track,
  .switch-field__thumb {
    transition: none;
  }
}
</style>
