<script setup lang="ts">
/**
 * OtpInput - Las seis casillas del código (issue #212; marca de la familia en
 * #751). Cada casilla es una celda de papel con un rombo de latón hueco que
 * espera el dígito: la casilla activa lo llena y lo hace asomar, el dígito
 * entra en la serif de la familia (Instrument Serif) con un salto de resorte,
 * y la celda llena toma el filete y la línea base de latón. Con las seis
 * llenas se dibuja la regla de latón bajo la fila. Un error sacude la fila y
 * deja el rombo de aviso. Es la misma pieza en mi turno, /acceso y
 * /recuperar-acceso: ninguna pantalla la reviste por su cuenta.
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

/** Las seis casillas llenas: la regla de latón se dibuja bajo la fila. */
const isComplete = computed(() => digits.value.every(Boolean))

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
      :class="{
        'otp-input__slots--shake': shaking,
        'otp-input__slots--complete': isComplete && !hasError,
      }"
      role="group"
      :aria-labelledby="labelId"
      :aria-describedby="errorId"
      @animationend.self="shaking = false"
    >
      <span
        v-for="(digit, index) in digits"
        :key="index"
        class="otp-input__cell"
        :class="{
          'otp-input__cell--filled': !!digit,
          'otp-input__cell--invalid': hasError,
        }"
        :style="{ '--i': index }"
      >
        <input
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
      </span>
      <span class="otp-input__rule" aria-hidden="true"></span>
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
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--color-text-primary);
}

.otp-input__slots {
  position: relative;
  display: flex;
  gap: var(--space-2);
  /* Deja sitio a la regla de latón sin mover nada al dibujarla (CLS 0). */
  padding-bottom: 10px;
}

/* La celda sostiene el rombo que espera el dígito: un <input> no admite
   pseudoelementos. */
.otp-input__cell {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
}

/* El rombo hueco de latón en el centro de la celda vacía. */
.otp-input__cell::before {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  width: 8px;
  height: 8px;
  content: '';
  border: 1.5px solid var(--color-brass-line);
  transform: translate(-50%, -50%) rotate(45deg);
  pointer-events: none;
  transition:
    opacity 160ms var(--motion-easing-standard, ease),
    transform 220ms var(--motion-ease-spring, ease-out);
}

/* La casilla activa: el rombo se llena, crece y marca dónde va el dígito
   (sustituye al cursor de texto, que caería encima). */
.otp-input__cell:focus-within:not(.otp-input__cell--filled)::before {
  background-color: var(--color-brass-body);
  border-color: var(--color-brass-body);
  transform: translate(-50%, -50%) rotate(45deg) scale(1.35);
}

.otp-input__cell--filled::before {
  opacity: 0;
  transform: translate(-50%, -50%) rotate(45deg) scale(0.2);
}

.otp-input__cell--invalid::before {
  border-color: var(--color-danger-border);
}

.otp-input__cell--invalid:focus-within:not(.otp-input__cell--filled)::before {
  background-color: var(--color-danger-border);
  border-color: var(--color-danger-border);
}

.otp-input__slot {
  flex: 1 1 0;
  /* Un <input> trae ancho intrínseco (≈20 caracteres a 22 px). Con ancho 0
     la casilla solo toma lo que le reparte el flex y no empuja la fila (#733). */
  width: 0;
  min-width: 0;
  height: 60px;
  padding: 0;
  /* El código es la pieza de la pantalla: va en la serif de la familia, con
     las cifras alineadas (#751; antes, sans tabular, #726). */
  font-family: var(--font-serif);
  font-size: 34px;
  font-variant-numeric: lining-nums tabular-nums;
  line-height: 1;
  text-align: center;
  color: var(--color-text-primary);
  caret-color: transparent;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-md);
  outline: none;
}

.otp-input__slot:hover:not(:disabled):not(.otp-input__slot--invalid) {
  border-color: var(--color-brass-line);
}

.otp-input__slot:focus-visible {
  border-color: var(--color-brass-line);
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

/* Llena: filete y línea base de latón, como la regla del pase. */
.otp-input__slot--filled {
  border-color: var(--color-brass-line);
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
}

.otp-input__slot--filled:focus-visible {
  box-shadow:
    inset 0 -2px 0 var(--color-brass-body),
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

/* La regla de latón con su rombo, que se dibuja al completar el código. */
.otp-input__rule {
  position: absolute;
  right: 0;
  bottom: 2px;
  left: 0;
  height: 1px;
  background-color: var(--color-brass-line);
  transform: scaleX(0);
  transform-origin: left center;
  opacity: 0;
}

.otp-input__rule::after {
  position: absolute;
  top: 50%;
  right: -1px;
  width: 7px;
  height: 7px;
  content: '';
  background-color: var(--color-brass-body);
  transform: translateY(-50%) rotate(45deg);
}

.otp-input__slots--complete .otp-input__rule {
  transform: scaleX(1);
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .otp-input__slot--filled {
    animation: otp-input-fill 300ms var(--motion-ease-spring, ease-out) both;
  }

  :root:not([data-motion='reduced']) .otp-input--pasted .otp-input__slot--filled {
    animation-delay: calc(var(--i, 0) * 40ms);
  }

  :root:not([data-motion='reduced']) .otp-input__slots--shake {
    animation: otp-input-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  :root:not([data-motion='reduced']) .otp-input__slots--complete .otp-input__rule {
    transition:
      transform 480ms var(--motion-easing-standard, ease) 120ms,
      opacity 120ms linear 120ms;
  }

  :root:not([data-motion='reduced'])
    .otp-input__cell:focus-within:not(.otp-input__cell--filled)::before {
    animation: otp-input-await 420ms var(--motion-ease-spring, ease-out) both;
  }
}

/* Con movimiento reducido el rombo cambia sin transición. */
@media (prefers-reduced-motion: reduce) {
  .otp-input__cell::before {
    transition: none;
  }
}

:root[data-motion='reduced'] .otp-input__cell::before {
  transition: none;
}

@keyframes otp-input-fill {
  from {
    transform: scale(0.88);
  }

  55% {
    transform: scale(1.06);
  }
}

@keyframes otp-input-await {
  from {
    transform: translate(-50%, -50%) rotate(45deg) scale(0.4);
  }

  60% {
    transform: translate(-50%, -50%) rotate(45deg) scale(1.6);
  }

  to {
    transform: translate(-50%, -50%) rotate(45deg) scale(1.35);
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

.otp-input__slot--invalid {
  border-color: var(--color-danger-border);
  box-shadow: none;
}

.otp-input__slot--invalid:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-danger-border);
}

.otp-input__slot:disabled {
  background-color: var(--color-surface-muted);
  border-color: var(--color-border-subtle);
  box-shadow: none;
  color: var(--color-text-secondary);
  cursor: not-allowed;
  opacity: 0.64;
}

/* Mientras se comprueba un código completo la fila queda deshabilitada, pero
   esperar no es estar apagado (#735): los dígitos conservan el papel y el latón.
   Las casillas vacías deshabilitadas (código bloqueado) sí se apagan. */
.otp-input__slot--filled:disabled:not(.otp-input__slot--invalid) {
  background-color: var(--color-surface);
  border-color: var(--color-brass-line);
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
  color: var(--color-text-primary);
  cursor: progress;
  opacity: 1;
}

.otp-input--disabled .otp-input__cell::before {
  opacity: 0.4;
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
