<script setup lang="ts">
/**
 * OtpInput - Ranuras de código reglado (issue #212, auth-eventos/README.md
 * "Contrato visual común"). Seis posiciones que repiten la construcción del
 * campo reglado de BaseInput en formato estrecho: no es un componente de
 * kit de formularios genérico con caja redondeada, pertenece a la misma
 * familia visual (en v2: superficie, borde de control, radio medio y rótulo
 * en tipo oración y texto secundario).
 *
 * Expone un único valor lógico de seis dígitos hacia afuera (`modelValue`
 * string), nunca seis campos independientes: quien consume este componente
 * no debe ensamblar el código a partir de refs individuales.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'

const LENGTH = 6

interface Props {
  /** Valor completo del código (hasta 6 dígitos), v-model */
  modelValue?: string
  /** Rótulo del grupo, asociado por aria-labelledby */
  label?: string
  /** Mensaje de error (activa el estado invalid) */
  error?: string
  /** Si está deshabilitado */
  disabled?: boolean
  /** Nombre del campo lógico (no se refleja en el DOM de cada ranura) */
  name?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
  complete: [value: string]
}>()

const groupId = `otp-input-${useId()}`
const labelId = computed(() => (props.label ? `${groupId}-label` : undefined))
const errorId = computed(() => (props.error ? `${groupId}-error` : undefined))
const hasError = computed(() => !!props.error)

const digits = computed(() => {
  const value = props.modelValue.replace(/[^0-9]/g, '').slice(0, LENGTH)
  return Array.from({ length: LENGTH }, (_, index) => value[index] ?? '')
})

const slotRefs = ref<(HTMLInputElement | null)[]>([])
const setSlotRef = (el: unknown, index: number) => {
  slotRefs.value[index] = el as HTMLInputElement | null
}

const focusSlot = async (index: number) => {
  const clamped = Math.max(0, Math.min(LENGTH - 1, index))
  await nextTick()
  slotRefs.value[clamped]?.focus()
  slotRefs.value[clamped]?.select()
}

const emitValue = (nextDigits: string[]) => {
  const value = nextDigits.join('')
  emit('update:modelValue', value)
  if (value.length === LENGTH) emit('complete', value)
}

const onInput = (index: number, event: Event) => {
  const target = event.target as HTMLInputElement
  const cleaned = target.value.replace(/[^0-9]/g, '')

  if (!cleaned) {
    const next = [...digits.value]
    next[index] = ''
    emitValue(next)
    target.value = ''
    return
  }

  // Un input puede llegar con más de un carácter (autocompletado del
  // teclado, entrega por voz): se distribuye desde esta posición en vez
  // de descartar el resto, igual que un pegado.
  if (cleaned.length > 1) markPasted()
  const next = [...digits.value]
  let cursor = index
  for (const char of cleaned) {
    if (cursor >= LENGTH) break
    next[cursor] = char
    cursor += 1
  }
  emitValue(next)
  target.value = next[index] ?? ''
  focusSlot(Math.min(cursor, LENGTH - 1))
}

const onKeydown = (index: number, event: KeyboardEvent) => {
  if (event.key === 'Backspace') {
    const current = digits.value[index]
    if (!current && index > 0) {
      event.preventDefault()
      const next = [...digits.value]
      next[index - 1] = ''
      emitValue(next)
      focusSlot(index - 1)
    }
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusSlot(index - 1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusSlot(index + 1)
  }
}

/*
 * Movimiento (#743): cada casilla da un pequeño salto con resorte al
 * llenarse (la animación se dispara al entrar la clase --filled). Un pegado
 * o autocompletado de varios dígitos marca `pasted` un instante para que
 * esos saltos vayan escalonados de izquierda a derecha; al teclear uno a uno
 * no hay retraso. Un error nuevo sacude la fila una vez.
 */
const pasted = ref(false)
let pastedTimer: ReturnType<typeof setTimeout> | undefined
const markPasted = () => {
  pasted.value = true
  clearTimeout(pastedTimer)
  pastedTimer = setTimeout(() => (pasted.value = false), 600)
}

const shaking = ref(false)
watch(
  () => props.error,
  (error) => {
    if (!error) return
    // Reinicia la sacudida aunque ya estuviera puesta (un segundo error).
    shaking.value = false
    requestAnimationFrame(() => (shaking.value = true))
  },
)

const onPaste = (index: number, event: ClipboardEvent) => {
  const pasted = event.clipboardData?.getData('text') ?? ''
  const cleaned = pasted.replace(/[^0-9]/g, '')
  if (!cleaned) return
  event.preventDefault()
  if (cleaned.length > 1) markPasted()

  const next = [...digits.value]
  let cursor = index
  for (const char of cleaned) {
    if (cursor >= LENGTH) break
    next[cursor] = char
    cursor += 1
  }
  emitValue(next)
  focusSlot(Math.min(cursor, LENGTH - 1))
}

const onFocus = (event: FocusEvent) => {
  ;(event.target as HTMLInputElement).select()
  emit('focus', event)
}

const onBlur = (event: FocusEvent) => {
  emit('blur', event)
}

const slotsClasses = (index: number) => {
  const base = 'otp-input__slot'
  return [
    base,
    hasError.value ? `${base}--invalid` : '',
    digits.value[index] ? `${base}--filled` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
</script>

<template>
  <div class="otp-input" :class="{ 'otp-input--disabled': disabled, 'otp-input--pasted': pasted }">
    <span v-if="label" :id="labelId" class="otp-input__label">{{ label }}</span>

    <div
      class="otp-input__slots"
      :class="{ 'otp-input__slots--shake': shaking }"
      role="group"
      @animationend.self="shaking = false"
      :aria-labelledby="labelId"
      :aria-describedby="errorId"
    >
      <input
        v-for="(digit, index) in digits"
        :key="index"
        :ref="(el) => setSlotRef(el, index)"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        maxlength="1"
        :class="slotsClasses(index)"
        :value="digit"
        :disabled="disabled"
        :aria-invalid="hasError"
        :aria-label="`Dígito ${index + 1} de ${LENGTH}`"
        :style="{ '--i': index }"
        @input="onInput(index, $event)"
        @keydown="onKeydown(index, $event)"
        @paste="onPaste(index, $event)"
        @focus="onFocus"
        @blur="onBlur"
      />
    </div>

    <div v-if="error" :id="errorId" class="otp-input__error" aria-live="assertive" role="alert">
      {{ error }}
    </div>
  </div>
</template>

<style scoped>
.otp-input {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  /* Dentro de una grilla con columna implícita (los formularios de mi turno),
     la pista se mide por el contenido: sin esto, Firefox la ensancha hasta
     el ancho intrínseco de las seis casillas (#733). */
  min-width: 0;
}

.otp-input__label {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.otp-input__slots {
  display: flex;
  gap: var(--space-2);
}

/* Misma construcción del campo reglado (BaseInput) en formato estrecho:
   superficie blanca, filete perimetral de baja opacidad, línea base de
   tinta de 2px, radio 2px. El dígito se compone en la serif del wordmark,
   no en la sans funcional del resto del control. */
.otp-input__slot {
  flex: 1 1 0;
  /* Un <input> trae ancho intrínseco (≈20 caracteres a 22 px). Con ancho 0
     la casilla solo toma lo que le reparte el flex y no empuja la fila (#733). */
  width: 0;
  min-width: 0;
  height: var(--control-height);
  padding: 0;
  /* Dato, no titular: va en la sans con cifras tabulares (#726). */
  font-family: var(--font-sans);
  font-size: 22px;
  line-height: 1;
  text-align: center;
  color: var(--color-text-primary);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-bottom: var(--border-width-emphasis) solid var(--color-action-primary);
  border-radius: var(--radius-md);
  outline: none;
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (prefers-reduced-motion: reduce) {
  .otp-input__slot {
    transition: none;
  }
}

.otp-input__slot:hover:not(:disabled):not(.otp-input__slot--invalid) {
  border-color: var(--color-text-secondary);
  border-bottom-color: var(--color-action-primary);
}

.otp-input__slot:focus-visible {
  border-color: var(--color-focus);
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.otp-input__slot--filled {
  border-bottom-color: var(--color-action-primary);
  animation: otp-input-fill 300ms var(--motion-ease-spring, ease-out) both;
}

.otp-input--pasted .otp-input__slot--filled {
  animation-delay: calc(var(--i, 0) * 40ms);
}

.otp-input__slots--shake {
  animation: otp-input-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

@keyframes otp-input-fill {
  from {
    transform: scale(0.88);
  }

  55% {
    transform: scale(1.06);
  }
}

@keyframes otp-input-shake {
  10%,
  90% {
    transform: translateX(-2px);
  }

  20%,
  80% {
    transform: translateX(4px);
  }

  30%,
  50%,
  70% {
    transform: translateX(-7px);
  }

  40%,
  60% {
    transform: translateX(7px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .otp-input__slot--filled,
  .otp-input__slots--shake {
    animation: none;
  }
}

:root[data-motion='reduced'] .otp-input__slot--filled,
:root[data-motion='reduced'] .otp-input__slots--shake {
  animation: none;
}

.otp-input__slot--invalid {
  border-color: var(--color-danger-border);
  border-bottom-color: var(--color-danger-border);
}

.otp-input__slot--invalid:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-danger-border);
}

.otp-input__slot:disabled {
  background-color: var(--color-surface-muted);
  border-color: var(--color-border-subtle);
  border-bottom-color: var(--color-border-subtle);
  color: var(--color-text-secondary);
  cursor: not-allowed;
  opacity: 0.64;
}

.otp-input__error {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-danger-text);
}

/* El rombo de aviso (#739), el mismo de BaseInput y PhoneField: el error del
   código no queda como texto rojo suelto ni depende solo del color. */
.otp-input__error::before {
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
