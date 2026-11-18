<script setup lang="ts">
/**
 * ProfessionalSelect - Selector de profesional con retrato (issue #189, atlas
 * panel-agenda-eventos evento 12): el `<select>` nativo no puede mostrar un
 * `ProfessionalAvatar` por opción, así que esta pantalla necesita un listbox
 * propio. Vive en shared/ui (issue #533) porque lo usan Agenda, Nuevo turno y
 * Servicios por profesional, y un módulo no importa archivos internos de otro.
 *
 * No decide enrutamiento: emite `update:modelValue` con el `professionalId`
 * elegido y quien lo monta (DailyAgendaPage.vue) sigue siendo la única
 * fuente de verdad de `route.query.professionalId` (onProfessionalSelect).
 *
 * Patrón ARIA "Collapsible Listbox" (WAI-ARIA APG): botón disparador con
 * aria-haspopup="listbox"/aria-expanded, lista role="listbox" con opciones
 * role="option" y tabindex reglado a mano (roving tabindex) — el navegador
 * no ofrece un listbox nativo con contenido enriquecido por opción.
 */
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  type ComponentPublicInstance,
} from 'vue'
import { useVocabulary } from '@/shared/composables'
import ProfessionalAvatar from './ProfessionalAvatar.vue'

/** Lo mínimo que el selector necesita de un profesional: cada módulo pasa su propio resumen. */
export interface ProfessionalSelectOption {
  id: string
  fullName: string
  photoUrl?: string | null
}

interface Props {
  modelValue: string | null
  professionals: ProfessionalSelectOption[]
  disabled?: boolean
  /** id del botón disparador, para que el `<label for>` de la pantalla que
   * lo monta lo nombre. Por defecto conserva el de `/panel` (HU-062/063),
   * que ya vive en pruebas y evidencia; "Nuevo turno" (issue #190) pasa el
   * suyo para no duplicar un id en el documento. */
  triggerId?: string
  /** Texto visible mientras no hay profesional elegido. El código de cada
   * pantalla lo escribe; este componente no lo redacta. */
  placeholder?: string
  /** Campo hundido y de 44 px para una barra de controles (agenda diaria). */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  triggerId: 'daily-agenda-professional-select',
  compact: false,
})

const emit = defineEmits<{
  'update:modelValue': [professionalId: string]
}>()

// Palabras del negocio (DEC-110): sin `placeholder` de la pantalla, "Selecciona un profesional".
const v = useVocabulary()
const placeholderText = computed(() => props.placeholder ?? `Selecciona ${v.value.aProfessional}`)

const listboxId = useId()
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const optionRefs = ref<HTMLElement[]>([])
const open = ref(false)
const activeIndex = ref(0)

const selectedProfessional = computed(
  () => props.professionals.find((b) => b.id === props.modelValue) ?? null,
)

function setOptionRef(el: Element | ComponentPublicInstance | null, index: number) {
  if (el instanceof HTMLElement) optionRefs.value[index] = el
}

async function openList() {
  if (props.disabled || props.professionals.length === 0) return
  const currentIndex = props.professionals.findIndex((b) => b.id === props.modelValue)
  activeIndex.value = currentIndex >= 0 ? currentIndex : 0
  open.value = true
  await nextTick()
  optionRefs.value[activeIndex.value]?.focus()
}

function closeList(returnFocus = true) {
  open.value = false
  if (returnFocus) triggerRef.value?.focus()
}

function toggle() {
  if (open.value) closeList()
  else void openList()
}

function moveActive(delta: number) {
  const count = props.professionals.length
  if (count === 0) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  optionRefs.value[activeIndex.value]?.focus()
}

function selectActive() {
  const professional = props.professionals[activeIndex.value]
  if (!professional) return
  emit('update:modelValue', professional.id)
  closeList()
}

function selectProfessional(professionalId: string) {
  emit('update:modelValue', professionalId)
  closeList()
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
    event.preventDefault()
    void openList()
  }
}

function onListKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Home':
      event.preventDefault()
      activeIndex.value = 0
      optionRefs.value[0]?.focus()
      break
    case 'End':
      event.preventDefault()
      activeIndex.value = props.professionals.length - 1
      optionRefs.value[activeIndex.value]?.focus()
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      selectActive()
      break
    case 'Escape':
      event.preventDefault()
      closeList()
      break
    case 'Tab':
      closeList(false)
      break
  }
}

// Cierre al hacer click fuera: el widget no tiene contrafondo modal (no es
// un diálogo, BaseDialog.vue), así que escucha directamente en document,
// mismo criterio que el keydown de document en BaseAlert.vue.
function onDocumentClick(event: MouseEvent) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) closeList(false)
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocumentClick))
</script>

<template>
  <div
    ref="rootRef"
    class="professional-select"
    :class="{ 'professional-select--compact': compact }"
  >
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="professional-select__trigger"
      :disabled="disabled || professionals.length === 0"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listboxId"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <ProfessionalAvatar
        v-if="selectedProfessional"
        :full-name="selectedProfessional.fullName"
        :photo-url="selectedProfessional.photoUrl"
        size="closed"
      />
      <span v-else class="professional-select__trigger-icon" aria-hidden="true" />
      <span
        class="professional-select__trigger-label"
        :class="{ 'professional-select__trigger-label--placeholder': !selectedProfessional }"
      >
        {{ selectedProfessional?.fullName ?? placeholderText }}
      </span>
      <span class="professional-select__chevron" aria-hidden="true" />
    </button>

    <Transition name="professional-select-pop">
      <ul
        v-show="open"
        :id="listboxId"
        class="professional-select__list"
        role="listbox"
        :aria-label="v.Professional"
        @keydown="onListKeydown"
      >
        <li
          v-for="(professional, index) in professionals"
          :key="professional.id"
          :ref="(el) => setOptionRef(el, index)"
          class="professional-select__option"
          :class="{ 'professional-select__option--selected': professional.id === modelValue }"
          role="option"
          :aria-selected="professional.id === modelValue"
          tabindex="-1"
          @click="selectProfessional(professional.id)"
        >
          <ProfessionalAvatar
            :full-name="professional.fullName"
            :photo-url="professional.photoUrl"
            size="option"
          />
          <span class="professional-select__option-name">{{ professional.fullName }}</span>
          <span class="professional-select__option-mark" aria-hidden="true" />
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.professional-select {
  position: relative;
}

/* Control reglado sobre tinta (atlas panel-agenda-eventos): caja tenue con
   línea base de latón de doble peso, el mismo lenguaje que BaseInput. */
.professional-select__trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  color: var(--color-on-strong);
  text-align: left;
  background-color: color-mix(in srgb, var(--color-on-strong) 5%, transparent);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 16%, transparent);
  border-bottom: var(--border-width-emphasis) solid var(--color-accent-brass);
  border-radius: 2px;
  cursor: pointer;
}

.professional-select__trigger[aria-expanded='true'] {
  border-bottom-color: var(--color-accent-brass);
}

/* Variante compacta de la agenda diaria: campo hundido (más oscuro que la
   página, --color-field-strong) de 44 px (CA-062-08/CA-063-08), con la misma
   altura y filete que el selector de fecha de al lado. Los formularios (Nuevo turno) conservan el
   velo claro y los 44 px de sus campos vecinos. */
.professional-select--compact .professional-select__trigger {
  min-height: var(--control-height);
  padding-block: 0;
  background-color: var(--color-field-strong);
  border-color: var(--color-field-strong-border);
  border-bottom-color: var(--color-accent-brass);
}

.professional-select--compact .professional-select__trigger:hover:not(:disabled),
.professional-select--compact .professional-select__trigger[aria-expanded='true'] {
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.professional-select__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  border-bottom-color: color-mix(in srgb, var(--color-on-strong) 28%, transparent);
}

.professional-select__trigger:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.professional-select__trigger-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background-color: var(--color-field-strong-raised);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
  border-radius: 2px;
}

.professional-select__trigger-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sin profesional resuelto (evento 08 del atlas): el placeholder se distingue
   por color, no solo por su texto. */
.professional-select__trigger-label--placeholder {
  color: var(--color-on-strong-muted);
}

.professional-select__chevron {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-right: var(--border-width-normal) solid var(--color-accent-brass);
  border-bottom: var(--border-width-normal) solid var(--color-accent-brass);
  transform: rotate(45deg) translateY(-2px);
  transition: transform 0.18s ease;
}

.professional-select__trigger[aria-expanded='true'] .professional-select__chevron {
  transform: rotate(225deg) translate(-1px, -1px);
}

.professional-select__list {
  position: absolute;
  z-index: var(--layer-menu);
  top: calc(100% - 1px);
  left: 0;
  width: 100%;
  padding: 0;
  margin: 0;
  list-style: none;
  background-color: var(--color-field-strong);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 16%, transparent);
  border-top: var(--border-width-emphasis) solid var(--color-accent-brass);
  border-radius: 2px;
  box-shadow: var(--shadow-dialog);
}

.professional-select__option {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  color: var(--color-on-strong);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    padding-left 0.15s ease;
}

/* Filete tenue entre opciones, no un borde perimetral por fila. */
.professional-select__option + .professional-select__option {
  border-top: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 8%, transparent);
}

/* Al pasar el cursor la fila se levanta un tono de tinta sobre el fondo del
   panel (sin grises: latón al 15 % sobre azul se ve apagado). La elegida no
   lleva relleno: barra y rombo de latón, y texto en negrita. Barra de latón a la izquierda: crece desde el centro al pasar el cursor o
   enfocar con teclado, el mismo latón que el día elegido del calendario. */
.professional-select__option::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  content: '';
  background-color: var(--color-brand-accent-surface);
  transform: scaleY(0);
  transition: transform 0.18s ease;
}

.professional-select__option:hover,
.professional-select__option:focus-visible {
  outline: none;
  padding-left: calc(var(--space-3) + 3px);
  background-color: var(--color-field-strong-raised);
}

.professional-select__option:hover::before,
.professional-select__option:focus-visible::before,
.professional-select__option--selected::before {
  transform: scaleY(1);
}

.professional-select__option:active {
  background-color: var(--color-surface-strong);
}

.professional-select__option--selected .professional-select__option-name {
  font-weight: 600;
}

.professional-select__option-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Rombo de la marca en la opción elegida: aparece con un pequeño giro al
   seleccionar y se encoge al quitar la selección. */
.professional-select__option-mark {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  background-color: var(--color-brand-accent-surface);
  opacity: 0;
  transform: rotate(0deg) scale(0);
  transition:
    opacity 0.18s ease,
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.professional-select__option--selected .professional-select__option-mark {
  opacity: 1;
  transform: rotate(45deg) scale(1);
}

/* El desplegable baja y se desvanece al abrir, y sube al cerrar. */
.professional-select-pop-enter-active,
.professional-select-pop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.professional-select-pop-enter-from,
.professional-select-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .professional-select__chevron,
  .professional-select__option,
  .professional-select__option::before,
  .professional-select__option-mark,
  .professional-select-pop-enter-active,
  .professional-select-pop-leave-active {
    transition: none;
  }
}
</style>
