<script setup lang="ts">
// Selector de hora compartido (#722). Todo Agenda le muestra la hora al dueño en
// 12 h es-CO («9:00 a. m.»), así que el disparador y el diálogo también: hora de
// 1 a 12, minutos y «a. m. / p. m.». El modelo sigue siendo `HH:MM` de 24 h, sin
// cambiar la API del componente. Quien escriba la hora en 24 h no se equivoca:
// «14» pasa a «2» con «p. m.» y «0» a «12» con «a. m.».
import { computed, nextTick, ref, useId, watch } from 'vue'
import { usePickerPopover } from '@/shared/composables/usePickerPopover'
import { formatClock } from '@/shared/model/openingHours'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    id?: string
    disabled?: boolean
    required?: boolean
    /** Hora opcional (#507): se rotula «(opcional)» y, con hora elegida, ofrece «Quitar hora». */
    optional?: boolean
    /**
     * Campo de cierre o fin (#767): la medianoche se lee «12:00 a. m. (medianoche)»
     * («Medianoche» si el campo es estrecho), porque «Cierra 12:00 a. m.» es ambiguo
     * en una jornada. Solo cambia lo que se lee; el valor emitido sigue igual.
     */
    closing?: boolean
  }>(),
  { id: undefined, disabled: false, required: false, optional: false, closing: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const uid = useId()
const triggerId = computed(() => props.id ?? `time-picker-${uid}`)
const labelId = `time-label-${uid}`
const dialogId = `time-dialog-${uid}`
const titleId = `time-title-${uid}`
const hintId = `time-hint-${uid}`
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const open = ref(false)
type Part = 'hour' | 'minute'
type Meridiem = 'am' | 'pm'
const MERIDIEMS: readonly { value: Meridiem; label: string }[] = [
  { value: 'am', label: 'a. m.' },
  { value: 'pm', label: 'p. m.' },
]
const hourText = ref('9')
const minuteText = ref('00')
const meridiem = ref<Meridiem>('am')
const pad = (value: number) => String(value).padStart(2, '0')
const digits = (text: string) => /^\d{1,2}$/.test(text)
const validHour = computed(
  () => digits(hourText.value) && Number(hourText.value) >= 1 && Number(hourText.value) <= 12,
)
const validMinute = computed(() => digits(minuteText.value) && Number(minuteText.value) <= 59)
const validTime = computed(() => validHour.value && validMinute.value)
const hour = computed(() => Number(hourText.value))
const minute = computed(() => Number(minuteText.value))
const meridiemLabel = computed(() => (meridiem.value === 'am' ? 'a. m.' : 'p. m.'))
const display = computed(() => (props.modelValue ? formatClock(props.modelValue) : ''))
const midnight = computed(
  () => props.closing && (props.modelValue === '00:00' || props.modelValue === '24:00'),
)
const labelledBy = computed(() => `${labelId} ${triggerId.value}`)
const { style } = usePickerPopover(open, root, trigger, panel, close)

/** Hora de 24 h (0–23) a partir de la de 12 h y su a. m./p. m. */
const to24 = (h12: number, m: Meridiem) => (h12 % 12) + (m === 'pm' ? 12 : 0)

function setFrom24(h24: number) {
  const normalized = ((h24 % 24) + 24) % 24
  meridiem.value = normalized < 12 ? 'am' : 'pm'
  hourText.value = String(normalized % 12 === 0 ? 12 : normalized % 12)
}

function focusMinutes() {
  const input = panel.value?.querySelector<HTMLInputElement>(`#minute-input-${uid}`)
  input?.focus({ preventScroll: true })
  input?.select()
}

function edit(part: Part, event: Event) {
  const input = event.target as HTMLInputElement
  // Solo dígitos: letras y signos no llegan a mostrarse en el campo.
  const text = input.value.replace(/\D/g, '')
  if (text !== input.value) input.value = text
  if (part === 'minute') {
    minuteText.value = text
    return
  }
  hourText.value = text
  if (!digits(text)) return
  const typed = Number(text)
  // Hora escrita en 24 h: se traduce a 12 h y elige a. m./p. m. por sí sola.
  if ((typed === 0 && text.length === 2) || (typed >= 13 && typed <= 23)) {
    setFrom24(typed)
    input.value = hourText.value
    focusMinutes()
    return
  }
  if (text.length === 2 && validHour.value) focusMinutes()
}

function partKeydown(part: Part, event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    apply()
    return
  }
  if (part === 'hour') {
    // Las flechas recorren el reloj completo: de 11 a. m. a 12 p. m. y de 11 p. m. a 12 a. m.
    const current = validHour.value ? to24(hour.value, meridiem.value) : 0
    const steps: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 5, PageDown: -5 }
    if (event.key in steps) setFrom24(current + steps[event.key]!)
    else if (event.key === 'Home') hourText.value = '1'
    else if (event.key === 'End') hourText.value = '12'
    else return
    event.preventDefault()
    return
  }
  let value = validMinute.value ? minute.value : 0
  if (event.key === 'ArrowDown') value -= 1
  else if (event.key === 'ArrowUp') value += 1
  else if (event.key === 'PageDown') value -= 5
  else if (event.key === 'PageUp') value += 5
  else if (event.key === 'Home') value = 0
  else if (event.key === 'End') value = 59
  else return
  event.preventDefault()
  minuteText.value = pad((value + 60) % 60)
}

function chooseMeridiem(value: Meridiem, focus = false) {
  meridiem.value = value
  if (focus) {
    void nextTick(() =>
      panel.value?.querySelector<HTMLElement>(`[data-meridiem="${value}"]`)?.focus(),
    )
  }
}

function meridiemKeydown(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    chooseMeridiem(meridiem.value === 'am' ? 'pm' : 'am', true)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    apply()
  }
}

async function show() {
  if (props.disabled) return
  const current = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(props.modelValue) ? props.modelValue : '09:00'
  setFrom24(Number(current.slice(0, 2)))
  minuteText.value = current.slice(3)
  open.value = true
  await nextTick()
  const input = panel.value?.querySelector<HTMLInputElement>('input')
  input?.focus({ preventScroll: true })
  input?.select()
}
function close(restoreFocus = true) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function apply() {
  if (!validTime.value || props.disabled) return
  emit('update:modelValue', `${pad(to24(hour.value, meridiem.value))}:${pad(minute.value)}`)
  close()
}
function clear() {
  if (props.disabled) return
  emit('update:modelValue', '')
  close()
}
function dialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
  if (event.key !== 'Tab' || !panel.value) return
  event.stopPropagation()
  const focusables = [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input',
    ),
  ]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close(false)
  },
)
</script>

<template>
  <div ref="root" class="base-time-picker" :aria-owns="open ? dialogId : undefined">
    <label :id="labelId" :for="triggerId" class="base-time-picker__label">
      {{ label }}<span v-if="required" class="base-time-picker__sr-only"> (obligatoria)</span
      ><span v-if="required" aria-hidden="true"> *</span
      ><span v-if="optional" class="base-time-picker__optional"> (opcional)</span>
    </label>
    <button
      :id="triggerId"
      ref="trigger"
      type="button"
      class="base-time-picker__trigger"
      :disabled="disabled"
      :aria-labelledby="labelledBy"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="dialogId"
      @click="open ? close() : show()"
      @keydown.down.prevent="show"
      @keydown.up.prevent="show"
    >
      <!-- Medianoche de cierre: dos rótulos y el contenedor elige el que cabe; el
           oculto va con display:none y no entra en el nombre accesible. -->
      <span v-if="midnight" class="base-time-picker__value">
        <span class="base-time-picker__midnight-long">12:00 a. m. (medianoche)</span>
        <span class="base-time-picker__midnight-short">Medianoche</span>
      </span>
      <span v-else :class="{ 'base-time-picker__placeholder': !modelValue }">{{
        display || 'Elegir hora'
      }}</span>
      <!-- Reloj en rombo (#767): la familia no dibuja círculos. -->
      <svg
        class="base-time-picker__icon"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8 1.25 14.75 8 8 14.75 1.25 8Z" />
        <path d="M8 4.75V8l2.25 1.5" stroke-linecap="round" />
      </svg>
    </button>
    <Teleport to="body">
      <Transition name="time-picker-pop">
        <div
          v-if="open"
          :id="dialogId"
          ref="panel"
          role="dialog"
          :aria-labelledby="titleId"
          :aria-describedby="hintId"
          class="base-time-picker__dialog"
          :style="style"
          @keydown="dialogKeydown"
        >
          <header class="base-time-picker__header">
            <div>
              <h3 :id="titleId">{{ label }}</h3>
              <p :id="hintId">Formato de 12 horas</p>
            </div>
            <button
              type="button"
              class="base-time-picker__close"
              :aria-label="`Cerrar selector de ${label.toLowerCase()}`"
              @click="close()"
            >
              ×
            </button>
          </header>
          <div class="base-time-picker__columns">
            <div class="base-time-picker__column">
              <label :id="`hour-label-${uid}`" :for="`hour-input-${uid}`">Hora</label>
              <input
                :id="`hour-input-${uid}`"
                :value="hourText"
                type="text"
                inputmode="numeric"
                maxlength="2"
                autocomplete="off"
                role="spinbutton"
                aria-valuemin="1"
                aria-valuemax="12"
                :aria-valuenow="validHour ? hour : undefined"
                :aria-valuetext="validHour ? `${hour} ${meridiemLabel}` : undefined"
                :aria-invalid="!validHour"
                :aria-describedby="!validTime ? `time-error-${uid}` : undefined"
                @input="edit('hour', $event)"
                @keydown="partKeydown('hour', $event)"
                @focus="($event.target as HTMLInputElement).select()"
              />
            </div>
            <span class="base-time-picker__colon" aria-hidden="true">:</span>
            <div class="base-time-picker__column">
              <label :id="`minute-label-${uid}`" :for="`minute-input-${uid}`">Minutos</label>
              <input
                :id="`minute-input-${uid}`"
                :value="minuteText"
                type="text"
                inputmode="numeric"
                maxlength="2"
                autocomplete="off"
                role="spinbutton"
                aria-valuemin="0"
                aria-valuemax="59"
                :aria-valuenow="validMinute ? minute : undefined"
                :aria-invalid="!validMinute"
                :aria-describedby="!validTime ? `time-error-${uid}` : undefined"
                @input="edit('minute', $event)"
                @keydown="partKeydown('minute', $event)"
                @focus="($event.target as HTMLInputElement).select()"
              />
            </div>
            <div
              class="base-time-picker__meridiem"
              role="radiogroup"
              :aria-label="`Mañana o tarde de ${label.toLowerCase()}`"
            >
              <button
                v-for="m in MERIDIEMS"
                :key="m.value"
                type="button"
                role="radio"
                class="base-time-picker__meridiem-option"
                :class="{ 'base-time-picker__meridiem-option--on': meridiem === m.value }"
                :data-meridiem="m.value"
                :aria-checked="meridiem === m.value"
                :tabindex="meridiem === m.value ? 0 : -1"
                @click="chooseMeridiem(m.value)"
                @keydown="meridiemKeydown"
              >
                {{ m.label }}
              </button>
            </div>
          </div>

          <p
            v-if="!validTime"
            :id="`time-error-${uid}`"
            class="base-time-picker__error"
            role="alert"
          >
            Hora de 1 a 12 y minutos de 00 a 59.
          </p>
          <footer class="base-time-picker__footer">
            <button type="button" @click="close()">Cancelar</button>
            <button v-if="optional && modelValue" type="button" @click="clear">Quitar hora</button>
            <button
              type="button"
              class="base-time-picker__apply"
              :disabled="!validTime"
              @click="apply"
            >
              Aplicar hora
            </button>
          </footer>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.base-time-picker__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.base-time-picker {
  min-width: 0;
  display: grid;
  gap: 8px;
}
.base-time-picker__label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}
.base-time-picker__label span {
  color: var(--color-danger-on-strong);
}
.base-time-picker__label .base-time-picker__optional {
  color: var(--color-on-strong-muted);
  text-transform: none;
}
.base-time-picker__trigger {
  container-type: inline-size;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 0 14px;
  font: inherit;
  color: var(--color-on-strong);
  background: var(--color-field-strong);
  border: 1px solid var(--color-field-strong-border);
  border-bottom: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.base-time-picker__trigger svg {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.base-time-picker__placeholder {
  color: var(--color-on-strong-muted);
}
.base-time-picker__value {
  min-width: 0;
}
.base-time-picker__midnight-short {
  display: none;
}
/* A 390 el campo de cierre mide ~155 px: «12:00 a. m. (medianoche)» no cabe. */
@container (max-width: 220px) {
  .base-time-picker__midnight-long {
    display: none;
  }
  .base-time-picker__midnight-short {
    display: inline;
  }
}
.base-time-picker__trigger:hover:not(:disabled),
.base-time-picker__trigger[aria-expanded='true'] {
  border-color: var(--color-text-primary);
}
.base-time-picker__trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.base-time-picker__dialog {
  position: fixed;
  z-index: var(--layer-dialog);
  box-sizing: border-box;
  width: min(clamp(192px, var(--picker-trigger-width, 212px), 240px), calc(100vw - 16px));
  max-height: calc(var(--viewport-height) - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px;
  color: var(--color-on-strong);
  background: var(--color-field-strong);
  border: 1px solid var(--color-field-strong-border);
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dialog);
}
.base-time-picker__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.base-time-picker__header h3 {
  margin: 0;
  font: 600 12px/1.4 var(--font-family-base);
}
.base-time-picker__header p {
  margin: 2px 0 0;
  color: var(--color-on-strong-muted);
  font-size: 12px;
}
.base-time-picker__dialog button {
  min-height: 44px;
  font-family: var(--font-family-base);
  font-size: 14px;
  color: var(--color-on-strong);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.base-time-picker__dialog button:hover {
  background: var(--color-field-strong-raised);
  border-color: var(--color-text-primary);
}
.base-time-picker__close {
  min-width: 44px;
  font-size: 24px !important;
}
.base-time-picker__columns {
  display: grid;
  grid-template-columns: 1fr 12px 1fr 52px;
  gap: 4px;
  margin-top: 4px;
}
.base-time-picker__column {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.base-time-picker__column label {
  text-align: center;
  font-size: var(--font-size-caption);
  font-weight: 600;
  color: var(--color-on-strong-muted);
}
.base-time-picker__column input {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  padding: 0;
  text-align: center;
  /* Las cifras en la serif de la familia, como la hora de la tarjeta de turno. */
  font: 400 28px/1 var(--font-display, var(--font-family-base));
  font-variant-numeric: tabular-nums;
  color: var(--color-on-strong);
  background: var(--color-field-strong-raised);
  border: 1px solid var(--color-field-strong-border);
  border-bottom: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
}
.base-time-picker__colon {
  padding-top: 28px;
  color: var(--color-text-secondary);
  font: 500 20px/1 var(--font-family-base);
  text-align: center;
}
/* Selección de la familia (#767): latón tenue en lugar del bloque nativo. El
   select() al enfocar se conserva para sobrescribir al teclear; el foco lo marca
   el anillo doble. */
.base-time-picker__column input::selection {
  background: color-mix(in srgb, var(--color-brass-line) 28%, transparent);
  color: inherit;
}
/* «a. m. / p. m.»: dos mitades de una ranura; la elegida en latón con su rombo,
   como el resto de selecciones de la familia. */
.base-time-picker__meridiem {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 4px;
  align-self: end;
  height: 66px;
  margin-left: 4px;
}
.base-time-picker__dialog .base-time-picker__meridiem-option {
  position: relative;
  min-height: 0;
  padding: 0 4px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-field-strong-border);
  border-radius: 3px;
}
.base-time-picker__dialog .base-time-picker__meridiem-option--on {
  color: var(--color-text-primary);
  font-weight: 600;
  background: color-mix(in srgb, var(--color-brass-body) 16%, var(--color-field-strong));
  border-color: var(--color-brass-line);
}
.base-time-picker__meridiem-option--on::after {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  content: '';
  background: var(--color-brass-body);
  rotate: 45deg;
}
.base-time-picker__error {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--color-danger-on-strong);
}
.base-time-picker__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid var(--color-field-strong-border);
}
.base-time-picker__footer button {
  padding: 0 8px;
  font-size: 12px;
}
.base-time-picker__footer .base-time-picker__apply {
  background: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-text-primary);
}
.base-time-picker__footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.base-time-picker__trigger:focus-visible,
.base-time-picker__dialog button:focus-visible,
.base-time-picker__dialog .base-time-picker__meridiem-option:focus-visible,
.base-time-picker__column input:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.time-picker-pop-enter-active,
.time-picker-pop-leave-active {
  transition: opacity 120ms ease;
}
.time-picker-pop-enter-from,
.time-picker-pop-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .time-picker-pop-enter-active,
  .time-picker-pop-leave-active {
    transition: none;
  }
}
</style>
