<script setup lang="ts">
/**
 * BaseInput - Campo de entrada base del sistema visual.
 * Tipos: text | email | password | number | tel | url | search | time | date
 * Estados: default | hover | focus | invalid | disabled | readonly
 * Con label, hint, error message, leading/trailing icons
 * Accesibilidad: aria-describedby para hint/error, aria-invalid, aria-readonly,
 * focus-visible ring, autocompletado nativo
 */
import { computed, ref, useId } from 'vue'

interface Props {
  /** Valor del input (v-model) */
  modelValue?: string | number
  /** Tipo de input HTML */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'time' | 'date'
  /** Label asociado */
  label?: string
  /** Texto de ayuda (hint) */
  hint?: string
  /** Mensaje de error (muestra estado invalid) */
  error?: string
  /** Placeholder */
  placeholder?: string
  /** Si está deshabilitado */
  disabled?: boolean
  /** Si es solo lectura */
  readonly?: boolean
  /** Si es requerido */
  required?: boolean
  /** Si se dibuja el asterisco visual junto al label cuando `required` es
   * verdadero. La semántica (`required`, `aria-required`, validación) no
   * depende de esta bandera: existe solo para que una pantalla cuyo mockup
   * no representa el asterisco (nava-docs/agenda/10-backlog/evidence/
   * ui-mockups-nava-tailored-grid-2026-09-02/02-acceso-recuperacion.png)
   * pueda ocultarlo sin perder "requerido" para el resto de la app. */
  showRequiredMarker?: boolean
  /** Autocomplete */
  autocomplete?: string
  /** Nombre del campo */
  name?: string
  /** ID del input (se genera si no se proporciona) */
  id?: string
  /** Icono leading (slot name="leading") — decorativo únicamente; nunca un
   * control interactivo, porque el wrapper lleva aria-hidden. */
  /** Icono trailing (slot name="trailing") — misma restricción que leading. */
  /** Patrón de validación */
  pattern?: string
  /** Longitud mínima */
  minlength?: number
  /** Longitud máxima */
  maxlength?: number
  /** Valor mínimo (type=number) */
  min?: number | string
  /** Valor máximo (type=number) */
  max?: number | string
  /** Paso (type=number) */
  step?: number | string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  readonly: false,
  required: false,
  showRequiredMarker: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
  input: [event: Event]
  change: [event: Event]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
// vue-tsc no asocia el ref="inputRef" del template con esta variable a
// efectos de noUnusedLocals: sin esta línea, "declared but never read".
void inputRef.value
// useId() (Vue 3.5+) genera un identificador estable por instancia, a
// diferencia de Math.random(): determinista dentro del ciclo de vida del
// componente y sin riesgo de colisión entre dos instancias montadas a la
// vez (nava-docs/agenda/03-desarrollo/estandar-diseno-visual.md, auditoría HU-009:
// "IDs aleatorios o relaciones label/description/error inestables").
const generatedId = `base-input-${useId()}`
const inputId = computed(() => props.id || generatedId)
const hintId = computed(() => (props.hint ? `${inputId.value}-hint` : undefined))
const errorId = computed(() => (props.error ? `${inputId.value}-error` : undefined))
const describedBy = computed(() => {
  const ids = []
  if (hintId.value) ids.push(hintId.value)
  if (errorId.value) ids.push(errorId.value)
  return ids.length ? ids.join(' ') : undefined
})
const hasError = computed(() => !!props.error)

// Mostrar/ocultar contraseña (mockup 02-acceso-recuperacion.png): todo
// BaseInput type="password" lo gana automáticamente, sin que cada
// formulario (login, nueva contraseña, confirmar) tenga que repetir el
// botón. El tipo real solo cambia mientras el profesional mantiene la
// revelación activa; el valor y el resto de atributos (autocomplete,
// required, etc.) no se tocan.
const isPasswordField = computed(() => props.type === 'password')
const isRevealed = ref(false)
// `type="number"` es un contrato de la app, no del navegador: todos los
// campos numéricos son enteros no negativos (minutos, días, duración). El
// <input type="number"> nativo dibuja flechas de incremento/decremento que
// rompen el diseño reglado, deja teclear "-", "e", "." y "+", y su `min`
// solo valida el valor final. Se dibuja como texto con teclado numérico y
// se filtra a dígitos al escribir o pegar, así nunca muestra un signo, una
// letra ni un negativo; los límites mín./máx. los sigue validando cada
// formulario al enviar.
const isNumericField = computed(() => props.type === 'number')
const effectiveType = computed(() => {
  if (isPasswordField.value) return isRevealed.value ? 'text' : 'password'
  return isNumericField.value ? 'text' : props.type
})
const effectiveInputMode = computed(() => (isNumericField.value ? 'numeric' : undefined))
const effectivePattern = computed(
  () => props.pattern ?? (isNumericField.value ? '[0-9]*' : undefined),
)
const toggleReveal = () => {
  isRevealed.value = !isRevealed.value
}

const classes = computed(() => {
  const base = 'base-input'
  return [
    base,
    hasError.value ? `${base}--invalid` : '',
    props.disabled ? `${base}--disabled` : '',
    props.readonly ? `${base}--readonly` : '',
  ]
    .filter(Boolean)
    .join(' ')
})

const wrapperClasses = computed(() => {
  const base = 'base-input__wrapper'
  return [
    base,
    props.disabled ? `${base}--disabled` : '',
    props.readonly ? `${base}--readonly` : '',
  ]
    .filter(Boolean)
    .join(' ')
})

const labelClasses = computed(() => {
  const base = 'base-input__label'
  return [base, props.required ? `${base}--required` : ''].filter(Boolean).join(' ')
})

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (isNumericField.value) {
    const digits = target.value.replace(/\D/g, '')
    // Si el valor filtrado coincide con el del padre, Vue no vuelve a
    // renderizar y el carácter rechazado seguiría a la vista.
    if (digits !== target.value) target.value = digits
  }
  emit('update:modelValue', target.value)
  emit('input', event)
}

const handleChange = (event: Event) => {
  emit('change', event)
}

const handleBlur = (event: FocusEvent) => {
  emit('blur', event)
}

const handleFocus = (event: FocusEvent) => {
  emit('focus', event)
}
</script>

<template>
  <div :class="wrapperClasses">
    <label v-if="label" :for="inputId" :class="labelClasses">
      {{ label }}
      <span v-if="required && showRequiredMarker" class="base-input__required" aria-hidden="true"
        >*</span
      >
    </label>

    <div class="base-input__input-wrapper">
      <span
        v-if="$slots.leading"
        class="base-input__icon base-input__icon--leading"
        aria-hidden="true"
      >
        <slot name="leading" />
      </span>

      <input
        ref="inputRef"
        :id="inputId"
        :type="effectiveType"
        :class="classes"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :autocomplete="autocomplete"
        :name="name"
        :aria-describedby="describedBy"
        :aria-invalid="hasError"
        :aria-readonly="readonly"
        :aria-disabled="disabled ? 'true' : undefined"
        :aria-required="required"
        :inputmode="effectiveInputMode"
        :pattern="effectivePattern"
        :minlength="minlength"
        :maxlength="maxlength"
        :min="isNumericField ? undefined : min"
        :max="isNumericField ? undefined : max"
        :step="isNumericField ? undefined : step"
        @input="handleInput"
        @change="handleChange"
        @blur="handleBlur"
        @focus="handleFocus"
      />

      <button
        v-if="isPasswordField"
        type="button"
        class="base-input__toggle"
        :aria-label="isRevealed ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        :aria-pressed="isRevealed"
        :disabled="disabled"
        @click="toggleReveal"
      >
        {{ isRevealed ? 'Ocultar' : 'Mostrar' }}
      </button>
      <span
        v-else-if="$slots.trailing"
        class="base-input__icon base-input__icon--trailing"
        aria-hidden="true"
      >
        <slot name="trailing" />
      </span>
    </div>

    <div v-if="hint && !error" :id="hintId" class="base-input__hint" aria-live="polite">
      {{ hint }}
    </div>

    <div v-if="error" :id="errorId" class="base-input__error" aria-live="assertive" role="alert">
      {{ error }}
    </div>
  </div>
</template>

<style scoped>
.base-input__wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

/* Rótulo v2 (DEC-188): tipo oración en texto secundario, sin versalitas ni
   acento; el acento queda para la acción principal. */
.base-input__label {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.base-input__required {
  color: var(--color-danger-action);
  margin-left: 2px;
}

.base-input__input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

/* Campo v2 (DEC-188): superficie con borde de control de 1px alrededor y
   radio medio; al pasar el cursor el borde pasa a tinta. Las variables
   permiten a la reserva pública conservar su línea base propia. */
.base-input {
  --input-height: var(--control-height);
  --input-padding-x: var(--space-4);
  --input-font-size: var(--font-size-body);
  --input-line-height: var(--font-size-body-line);
  --input-bg: var(--color-surface);
  --input-border-color: var(--color-border-control);
  --input-border-base-color: var(--color-border-control);
  --input-radius: var(--radius-md);
  --input-transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
  --input-focus-ring: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-focus);

  width: 100%;
  height: var(--input-height);
  padding: 0 var(--input-padding-x);
  font-family: var(--font-family-base);
  font-size: var(--input-font-size);
  line-height: var(--input-line-height);
  color: var(--color-text-primary);
  background-color: var(--input-bg);
  border: var(--border-width-normal) solid var(--input-border-color);
  border-bottom: var(--border-width-normal) solid var(--input-border-base-color);
  border-radius: var(--input-radius);
  outline: none;
  transition: var(--input-transition);
}

@media (prefers-reduced-motion: reduce) {
  .base-input {
    transition: none;
  }
}

.base-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.64;
}

/* El navegador pinta los campos autocompletados (correo/contraseña
   guardados) con su propio fondo -amarillo en Chrome, azul/lavanda en
   Edge-, que rompe el fondo blanco del sistema visual. El truco del
   box-shadow inset lo sustituye sin tocar el valor real del campo. */
.base-input:-webkit-autofill,
.base-input:-webkit-autofill:hover,
.base-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--color-text-primary);
  -webkit-box-shadow: 0 0 0 1000px var(--input-bg) inset;
  box-shadow: 0 0 0 1000px var(--input-bg) inset;
  transition: background-color 9999s ease-in-out 0s;
}

.base-input:hover:not(:disabled):not(.base-input--readonly):not(.base-input--invalid) {
  border-color: var(--color-text-primary);
}

.base-input:focus-visible {
  border-color: var(--color-focus);
  box-shadow: var(--input-focus-ring);
}

.base-input:disabled,
.base-input--disabled {
  background-color: var(--color-surface-muted);
  border-color: var(--color-border-subtle);
  border-bottom-color: var(--color-border-subtle);
  color: var(--color-text-secondary);
  cursor: not-allowed;
  opacity: 0.64;
}

.base-input:read-only,
.base-input--readonly {
  background-color: var(--color-surface-muted);
  border-color: var(--color-border-subtle);
  border-bottom-color: var(--color-border-subtle);
  cursor: default;
}

/* Estado de error (03-validacion.png): el filete completo pasa a peligro,
   no solo la línea base, para que se lea como rechazo del campo entero. */
.base-input--invalid {
  border-color: var(--color-danger-border);
  border-bottom-color: var(--color-danger-border);
}

.base-input--invalid:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-danger-border);
}

/* Iconos */
.base-input__icon {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  pointer-events: none;
  flex-shrink: 0;
}

.base-input__icon--leading {
  left: var(--space-3);
}

.base-input__icon--trailing {
  right: var(--space-3);
}

/* Conmutador de contraseña: la palabra «Mostrar»/«Ocultar» subrayada, no un
   glifo de ojo (issue #212), así el control tiene nombre accesible propio
   sin depender de una forma. Sigue ocupando toda la altura del campo como
   objetivo táctil (estandar-diseno-visual.md §6.2, CA-009-03); el ancho
   mínimo reserva espacio para "OCULTAR", la palabra más larga. */
.base-input__toggle {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-height-icon);
  height: 100%;
  padding: 0 var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--input-radius);
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (prefers-reduced-motion: reduce) {
  .base-input__toggle {
    transition: none;
  }
}

.base-input__toggle:hover:not(:disabled) {
  color: var(--color-text-primary);
}

.base-input__toggle:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-focus);
}

.base-input__toggle:disabled {
  color: var(--color-border-subtle);
  cursor: not-allowed;
}

/* `.base-input` es el propio <input> (sin hijos posibles): el icono vive
   como <span> hermano dentro de `.base-input__input-wrapper`, así que el
   padding condicional debe anclarse ahí, no en `:has()` sobre el input
   mismo (nunca coincide con un elemento reemplazado sin descendientes). */
.base-input__input-wrapper:has(.base-input__icon--leading) .base-input {
  padding-left: calc(var(--input-padding-x) + 20px);
}

.base-input__input-wrapper:has(.base-input__icon--trailing) .base-input {
  padding-right: calc(var(--input-padding-x) + 20px);
}

/* "OCULTAR" (la palabra más larga del conmutador) necesita más espacio
   reservado que un icono de 18px. */
.base-input__input-wrapper:has(.base-input__toggle) .base-input {
  padding-right: 84px;
}

/* Hint y Error */
.base-input__hint,
.base-input__error {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
}

.base-input__hint {
  color: var(--color-text-secondary);
}

.base-input__error {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  color: var(--color-danger-text);
}

/* El rombo de aviso (#739): el error lleva su marca propia, un rombo hueco con
   el signo de exclamación, para no confundirse con el acento del negocio (que
   en la reserva es de la misma familia de rojos) ni depender solo del color. */
.base-input__error::before {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: calc((var(--font-size-body-sm-line) - 14px) / 2);
  content: '';
  background-color: currentColor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M7 1.2 12.8 7 7 12.8 1.2 7z' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'/%3E%3Cpath d='M7 4.2v3.6' stroke='black' stroke-width='1.5' stroke-linecap='round'/%3E%3Ccircle cx='7' cy='9.9' r='.85'/%3E%3C/svg%3E")
    center / contain no-repeat;
}
</style>
