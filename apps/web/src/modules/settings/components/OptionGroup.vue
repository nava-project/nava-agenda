<script setup lang="ts" generic="T extends string">
// Grupo de opciones excluyentes accesible (DEC-110): un `radiogroup` real con
// inputs nativos ocultos dentro de cada etiqueta, así el navegador resuelve las
// flechas, el foco y el anuncio de "n de m" sin código propio. El aspecto de
// cada opción lo pone el consumidor por el slot; aquí solo viven la semántica,
// el foco visible. Sin entrada animada al montar (v2, DEC-188: nada se mueve
// solo al cargar la página).
//
// La opción elegida es de latón con su rombo (#759): el grupo define el material
// (`--option-selected-*`) y dibuja el rombo en la esquina; cada consumidor lo usa
// en su forma. El rombo aterriza solo cuando la persona cambia la opción.
import { ref, useId } from 'vue'

const props = defineProps<{
  modelValue: T
  options: readonly { value: T; label: string; hint?: string }[]
  /** Nombre accesible del grupo. */
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const name = `option-group-${useId()}`
const touched = ref(false)

function onChange(value: T) {
  touched.value = true
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    class="option-group"
    :class="{ 'option-group--touched': touched }"
    role="radiogroup"
    :aria-label="label"
  >
    <label
      v-for="option in options"
      :key="option.value"
      class="option-group__option"
      :class="{ 'option-group__option--selected': option.value === props.modelValue }"
    >
      <input
        class="option-group__input"
        type="radio"
        :name="name"
        :value="option.value"
        :checked="option.value === props.modelValue"
        :disabled="disabled"
        @change="onChange(option.value)"
      />
      <slot :option="option" :selected="option.value === props.modelValue" />
    </label>
  </div>
</template>

<style scoped>
.option-group {
  --option-selected-bg: color-mix(in srgb, var(--color-brass-body) 13%, var(--color-surface));
  --option-selected-border: var(--color-brass-line);
  --option-hover-border: color-mix(
    in srgb,
    var(--color-brass-line) 55%,
    var(--color-border-control)
  );

  display: flex;
  flex-wrap: wrap;
  gap: var(--option-group-gap, 10px);
}

/* El rombo de la elegida. Un consumidor que lo pone en otro sitio (el segmento de
   género, la gema del acento) apaga este con `--option-mark-display: none`. */
.option-group__option--selected::after {
  position: absolute;
  top: var(--option-mark-top, 9px);
  right: var(--option-mark-right, 9px);
  z-index: 2;
  display: var(--option-mark-display, block);
  width: 8px;
  height: 8px;
  pointer-events: none;
  content: '';
  background: var(--color-brass-body);
  transform: rotate(45deg);
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .option-group--touched .option-group__option--selected::after {
    animation: option-mark-land 260ms cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }
}

@keyframes option-mark-land {
  from {
    opacity: 0;
    transform: rotate(-45deg) scale(0.2);
  }
}

.option-group__option {
  position: relative;
  display: block;
  cursor: pointer;
}

/* Oculto a la vista pero operable: sigue siendo el control real. */
.option-group__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  /* Por encima del contenido de la opción: un clic sobre cualquier adorno del
     slot llega igualmente al radio real. */
  z-index: 1;
}

.option-group__input:disabled {
  cursor: not-allowed;
}

.option-group__option:has(.option-group__input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

/* El foco visible lo dibuja el contenedor de la opción, no el input invisible. */
.option-group__option:has(.option-group__input:focus-visible) {
  border-radius: var(--radius-md);
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}
</style>
