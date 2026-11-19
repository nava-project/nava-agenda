<script setup lang="ts">
// Teléfono con el prefijo en su propia casilla. El selector nativo conserva
// teclado, lectores de pantalla y la lista del sistema; encima se dibuja la
// cara del selector (bandera + prefijo) y el `<select>` queda transparente.
// Pegar un número con prefijo (`+57 300…`) elige el país y deja solo el
// número nacional en la casilla.
import { computed, useId } from 'vue'
import {
  PHONE_COUNTRIES,
  flagEmoji,
  phoneCountry,
  splitInternationalPhone,
} from '../model/phoneCountries'

interface Props {
  /** ISO del país elegido (`v-model:country`). */
  country: string
  /** Número nacional, sin prefijo (`v-model:national`). */
  national: string
  label?: string
  error?: string
  required?: boolean
  disabled?: boolean
  /** `name` de la casilla del número (formularios y pruebas). */
  name?: string
  /** `ink` (hoja de tinta, por defecto) o `paper` (fondo claro, como `BaseInput`). */
  tone?: 'ink' | 'paper'
  /** Muestra el asterisco junto a la etiqueta cuando `required` es verdadero. */
  showRequiredMarker?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  label: 'Teléfono',
  error: undefined,
  required: false,
  disabled: false,
  name: undefined,
  tone: 'ink',
  showRequiredMarker: true,
})

const emit = defineEmits<{
  'update:country': [iso: string]
  'update:national': [value: string]
  blur: [event: FocusEvent]
}>()

const uid = useId()
const inputId = `phone-field-${uid}`
const errorId = `${inputId}-error`

const selected = computed(() => phoneCountry(props.country))

function onSelect(event: Event) {
  emit('update:country', (event.target as HTMLSelectElement).value)
}

// Lo escrito se respeta: dígitos y los separadores de siempre (espacios,
// guiones, puntos, paréntesis) se quedan a la vista; solo viajan los dígitos
// (composePhone). Lo que no puede ser parte de un teléfono, sí se descarta.
function cleanTyping(value: string): string {
  // Los espacios iniciales no significan nada (y esconderían el `+`).
  const kept = value.replace(/^\s+/, '').replace(/[^\d\s().+-]/g, '')
  // `+` solo al principio, donde empieza un prefijo.
  return kept.replace(/(?!^)\+/g, '')
}

// Quita del texto el prefijo internacional (`+57` o `0057`) conservando el
// formato de lo que sigue: «+57 300 123 4567» → «300 123 4567».
function stripDial(value: string, dial: string): string {
  let rest = value.trim().replace(/^(\+|00)/, '')
  let pending = dial.replace(/\D/g, '').length
  while (pending > 0 && rest.length > 0) {
    if (/\d/.test(rest[0]!)) pending -= 1
    rest = rest.slice(1)
  }
  return rest.replace(/^[\s().-]+/, '')
}

function onInput(event: Event) {
  const target = event.target as HTMLInputElement
  let value = cleanTyping(target.value)
  // Un número con prefijo (pegado o escrito) elige el país en cuanto llega su
  // primer dígito nacional; mientras se escribe «+57», se deja tal cual.
  const international = /^\s*(\+|00)/.test(value) ? splitInternationalPhone(value) : null
  if (international && international.national.length > 0) {
    emit('update:country', international.country)
    value = stripDial(value, phoneCountry(international.country).dial)
  }
  if (value !== target.value) target.value = value
  emit('update:national', value)
}
</script>

<template>
  <div class="phone-field" :class="{ 'phone-field--paper': tone === 'paper' }">
    <label :for="inputId" class="phone-field__label">
      {{ label }}
      <span v-if="required && showRequiredMarker" class="phone-field__required" aria-hidden="true"
        >*</span
      >
    </label>

    <div
      class="phone-field__row"
      :class="{ 'phone-field__row--invalid': !!error, 'phone-field__row--disabled': disabled }"
    >
      <div class="phone-field__prefix">
        <span class="phone-field__face" aria-hidden="true">
          <span class="phone-field__flag">{{ flagEmoji(selected.iso) }}</span>
          <span class="phone-field__dial">{{ selected.dial }}</span>
          <span class="phone-field__chevron"></span>
        </span>
        <select
          class="phone-field__select"
          aria-label="Prefijo del país"
          autocomplete="tel-country-code"
          :value="country"
          :disabled="disabled"
          @change="onSelect"
        >
          <option v-for="item in PHONE_COUNTRIES" :key="item.iso" :value="item.iso">
            {{ flagEmoji(item.iso) }} {{ item.name }} ({{ item.dial }})
          </option>
        </select>
      </div>

      <input
        :id="inputId"
        :name="name"
        class="phone-field__input"
        type="tel"
        inputmode="tel"
        autocomplete="tel-national"
        placeholder="300 123 4567"
        :value="national"
        :required="required"
        :disabled="disabled"
        :aria-required="required"
        :aria-invalid="!!error"
        :aria-describedby="error ? errorId : undefined"
        @input="onInput"
        @blur="emit('blur', $event)"
      />
    </div>

    <div v-if="error" :id="errorId" class="phone-field__error" role="alert">{{ error }}</div>
  </div>
</template>

<style scoped>
/* Mismo campo reglado que `BaseInput` sobre la hoja de tinta: recuesto oscuro,
   filete perimetral y línea base de latón. Aquí el filete envuelve las dos
   casillas para que se lean como un solo teléfono, con un tabique entre ellas. */
.phone-field {
  /* Dentro de la reserva pública (`.pb-layout`) hereda su paleta; en cualquier
     otra hoja de tinta (Configuración) cae a los tokens de tinta directamente. */
  --pf-text: var(--pb-text, var(--color-on-strong));
  --pf-muted: var(--pb-muted, var(--color-on-strong-muted));
  --pf-brass: var(--pb-brass, var(--color-brand-accent-surface));
  --pf-line-strong: var(--pb-line-strong, color-mix(in srgb, var(--pf-text) 30%, transparent));
  --pf-row-bg: var(--color-surface);
  --pf-row-bg-hover: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  --pf-row-bg-focus: color-mix(in srgb, var(--color-text-primary) 8%, var(--color-surface));
  --pf-row-base: color-mix(in srgb, var(--pf-brass) 75%, transparent);
  --pf-row-base-hover: var(--pf-brass);
  --pf-ring-gap: var(--color-surface-strong);
  --pf-focus: var(--pf-brass);
  --pf-focus-glow: 0 0 22px color-mix(in srgb, var(--pf-brass) 35%, transparent);
  --pf-danger: var(--color-danger-on-strong);

  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.phone-field__label {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--pf-brass);
}

.phone-field__required {
  margin-left: 2px;
  color: var(--pf-danger);
}

.phone-field__row {
  display: flex;
  height: var(--control-height);
  background-color: var(--pf-row-bg);
  border: var(--border-width-normal) solid var(--pf-line-strong);
  border-bottom: var(--border-width-emphasis) solid var(--pf-row-base);
  border-radius: 2px;
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.phone-field__row:hover {
  background-color: var(--pf-row-bg-hover);
  border-color: color-mix(in srgb, var(--pf-brass) 60%, transparent);
  border-bottom-color: var(--pf-row-base-hover);
}

.phone-field__row:focus-within {
  background-color: var(--pf-row-bg-focus);
  border-color: var(--pf-focus);
  box-shadow:
    0 0 0 2px var(--pf-ring-gap),
    0 0 0 4px var(--pf-focus),
    var(--pf-focus-glow);
}

.phone-field__row--invalid,
.phone-field__row--invalid:hover {
  border-color: var(--pf-danger);
  border-bottom-color: var(--pf-danger);
}

.phone-field__row--invalid:focus-within {
  box-shadow:
    0 0 0 2px var(--pf-ring-gap),
    0 0 0 4px var(--pf-danger);
}

.phone-field__prefix {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  border-right: 1px solid var(--pf-line-strong);
}

.phone-field__face {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: 0 var(--space-3);
  font-size: var(--font-size-body);
  color: var(--pf-text);
  pointer-events: none;
}

.phone-field__flag {
  font-size: 20px;
  line-height: 1;
}

.phone-field__dial {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.phone-field__chevron {
  width: 6px;
  height: 6px;
  margin: -3px 0 0 2px;
  border-right: 1.5px solid var(--pf-brass);
  border-bottom: 1.5px solid var(--pf-brass);
  transform: rotate(45deg);
}

/* El selector real cubre la cara: recibe el toque y el foco, pero no se ve. */
.phone-field__select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  color: var(--pf-text);
  cursor: pointer;
  background: transparent;
  border: 0;
  opacity: 0;
}

.phone-field__select option {
  color: #000;
}

.phone-field__input {
  flex: 1;
  /* Ancho base 0: sin él, el ancho intrínseco del `<input>` (size=20) fija el
     mínimo del contenedor y desborda las pantallas estrechas (360 px). */
  width: 0;
  min-width: 0;
  padding: 0 var(--space-4);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  color: var(--pf-text);
  background: transparent;
  border: 0;
  outline: none;
}

.phone-field__input::placeholder {
  color: var(--pf-muted);
  opacity: 1;
}

.phone-field__row--disabled {
  opacity: 0.6;
}

.phone-field__row--disabled .phone-field__select {
  cursor: not-allowed;
}

.phone-field__error {
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--pf-danger);
}

/* El foco del selector (opacity 0) se dibuja en la cara. */
.phone-field__prefix:has(.phone-field__select:focus-visible) .phone-field__face {
  outline: 2px solid var(--pf-brass);
  outline-offset: -4px;
}

/* Fondo claro: mismos tokens que `BaseInput` (campo de papel, filete de piedra,
   línea base de tinta y anillo de foco estándar). */
.phone-field--paper {
  --pf-text: var(--color-text-primary);
  --pf-muted: var(--color-text-secondary);
  --pf-brass: var(--color-accent-brass);
  --pf-line-strong: var(--color-border-subtle);
  --pf-row-bg: var(--color-surface);
  --pf-row-bg-hover: var(--color-surface);
  --pf-row-bg-focus: var(--color-surface);
  --pf-row-base: var(--color-action-primary);
  --pf-row-base-hover: var(--color-action-primary);
  --pf-ring-gap: var(--color-surface);
  --pf-focus: var(--color-focus);
  --pf-focus-glow: 0 0 0 0 transparent;
  --pf-danger: var(--color-danger-action);
}

.phone-field--paper .phone-field__row:hover {
  border-color: var(--color-text-secondary);
  border-bottom-color: var(--pf-row-base-hover);
}

.phone-field--paper .phone-field__chevron {
  border-color: var(--color-text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .phone-field__row {
    transition: none;
  }
}
</style>
