<script setup lang="ts">
/**
 * ProfessionalPhotoField - Espacio para la fotografía del profesional dentro de los
 * diálogos de alta y edición (DEC-104). Muestra el retrato (o su monograma),
 * deja elegir un archivo o soltarlo sobre el marco, lo recorta al centro en un
 * cuadrado y lo reduce en el navegador (photo/preparePhoto.ts), y publica el
 * cambio pendiente como `PhotoDraft`. No habla con el servidor: quien lo monta
 * decide cuándo enviarlo (al pulsar «Guardar»).
 *
 * Accesibilidad: el marco es decorativo (el nombre del profesional ya está en el
 * formulario); todo se opera con botones reales. El estado ("nueva foto lista",
 * "se quitará al guardar") y los errores se anuncian en una región `aria-live`.
 * El giro del indicador de «preparando» (carga, finita) se apaga con
 * `prefers-reduced-motion` y con «Animaciones reducidas» (DEC-110).
 */
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { BaseButton, ProfessionalAvatar, SunDiamond } from '@/shared/ui'
import { NO_PHOTO_CHANGE, type PhotoDraft } from '../model/photoDraft'
import {
  PHOTO_ACCEPT_ATTRIBUTE,
  preparePhoto,
  type PreparePhotoFailure,
} from '../photo/preparePhoto'

interface Props {
  fullName: string
  /** Fotografía que el profesional ya tiene guardada (null si no tiene). */
  currentUrl: string | null
  draft: PhotoDraft
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), { disabled: false })

const emit = defineEmits<{ 'update:draft': [draft: PhotoDraft] }>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const hintId = `${useId()}-hint`
const preparing = ref(false)
const dragging = ref(false)
const failure = ref<PreparePhotoFailure | null>(null)

const failureMessages: Record<PreparePhotoFailure, string> = {
  'unsupported-type': 'Ese archivo no es una imagen JPG, PNG o WebP.',
  'too-large': 'La imagen es demasiado pesada. Elige una de menos de 12 MB.',
  'too-small': 'La imagen es muy pequeña. Elige una de al menos 64 × 64 píxeles.',
  unreadable: 'No pudimos leer esa imagen. Prueba con otra.',
}

// Foto que se ve en el marco: la nueva elegida, ninguna si se pidió quitarla, o
// la guardada.
const shownUrl = computed<string | null>(() => {
  if (props.draft.kind === 'new') return props.draft.previewUrl
  if (props.draft.kind === 'remove') return null
  return props.currentUrl
})

const hasChange = computed(() => props.draft.kind !== 'none')
const canRemove = computed(() => shownUrl.value !== null)
const canUndo = computed(() => hasChange.value && props.currentUrl !== null)

const chooseLabel = computed(() => (shownUrl.value ? 'Cambiar foto' : 'Elegir foto'))

const statusMessage = computed(() => {
  if (failure.value) return failureMessages[failure.value]
  if (preparing.value) return 'Preparando la foto…'
  if (props.draft.kind === 'new') return 'Foto lista. Se guardará al pulsar «Guardar».'
  if (props.draft.kind === 'remove') return 'La foto se quitará al pulsar «Guardar».'
  return ''
})

function openPicker() {
  if (props.disabled || preparing.value) return
  fileInputRef.value?.click()
}

async function useFile(file: File) {
  if (props.disabled) return
  failure.value = null
  preparing.value = true
  const result = await preparePhoto(file)
  preparing.value = false

  if (result.kind === 'error') {
    failure.value = result.reason
    return
  }
  emit('update:draft', { kind: 'new', blob: result.blob, previewUrl: result.previewUrl })
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Se vacía para que elegir el mismo archivo otra vez vuelva a disparar change.
  input.value = ''
  if (file) await useFile(file)
}

function onDragOver(event: DragEvent) {
  if (props.disabled) return
  event.preventDefault()
  dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

async function onDrop(event: DragEvent) {
  event.preventDefault()
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await useFile(file)
}

function onRemove() {
  failure.value = null
  emit('update:draft', props.currentUrl ? { kind: 'remove' } : NO_PHOTO_CHANGE)
}

function onUndo() {
  failure.value = null
  emit('update:draft', NO_PHOTO_CHANGE)
}

// Las URL de vista previa son objetos del navegador: se liberan al reemplazarlas
// o descartarlas, y al desmontar el campo.
watch(
  () => props.draft,
  (_next, previous) => {
    if (previous?.kind === 'new') URL.revokeObjectURL(previous.previewUrl)
  },
)

onBeforeUnmount(() => {
  if (props.draft.kind === 'new') URL.revokeObjectURL(props.draft.previewUrl)
})
</script>

<template>
  <div class="professional-photo-field">
    <div
      class="professional-photo-field__frame"
      :class="{
        'professional-photo-field__frame--dragging': dragging,
        'professional-photo-field__frame--empty': !shownUrl,
        'professional-photo-field__frame--busy': preparing,
      }"
      aria-hidden="true"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- La clave vuelve a montar el retrato cada vez que cambia la imagen
           mostrada (elegir, quitar, deshacer). -->
      <ProfessionalAvatar
        :key="shownUrl ?? 'monogram'"
        class="professional-photo-field__portrait"
        size="hero"
        :full-name="fullName"
        :photo-url="shownUrl"
      />
      <span v-if="preparing" class="professional-photo-field__busy">
        <SunDiamond size="md" class="professional-photo-field__busy-spinner" />
      </span>
      <span v-else-if="dragging" class="professional-photo-field__drop">Suelta la foto</span>
    </div>

    <div class="professional-photo-field__side">
      <p class="professional-photo-field__label">Foto</p>
      <p :id="hintId" class="professional-photo-field__hint">
        JPG, PNG o WebP. Se recorta en cuadrado desde el centro.
      </p>

      <div class="professional-photo-field__actions">
        <BaseButton
          type="button"
          variant="secondary"
          :disabled="disabled || preparing"
          :aria-describedby="hintId"
          @click="openPicker"
        >
          {{ chooseLabel }}
        </BaseButton>
        <BaseButton
          v-if="canRemove"
          type="button"
          variant="danger"
          :disabled="disabled || preparing"
          @click="onRemove"
        >
          Quitar foto
        </BaseButton>
        <BaseButton
          v-if="canUndo"
          type="button"
          variant="ghost"
          :disabled="disabled || preparing"
          @click="onUndo"
        >
          Deshacer
        </BaseButton>
      </div>

      <p
        class="professional-photo-field__status"
        :class="{ 'professional-photo-field__status--error': failure }"
        :role="failure ? 'alert' : 'status'"
        aria-live="polite"
      >
        {{ statusMessage }}
      </p>
    </div>

    <!-- Oculto (display: none): el botón visible lo abre. Fuera del orden de
         tabulación y del árbol de accesibilidad para no duplicar el control. -->
    <input
      ref="fileInputRef"
      class="professional-photo-field__input"
      type="file"
      :accept="PHOTO_ACCEPT_ATTRIBUTE"
      tabindex="-1"
      aria-hidden="true"
      data-testid="professional-photo-input"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.professional-photo-field {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.professional-photo-field__input {
  display: none;
}

/* Marco: cuadrado con borde sutil (v2, DEC-188: sin esquinas de acento).
   Vacío, lleva el borde punteado de una zona para soltar. */
.professional-photo-field__frame {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 136px;
  height: 136px;
  background-color: var(--color-surface-strong);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  transition:
    border-color var(--motion-duration-base) var(--motion-easing-standard),
    background-color var(--motion-duration-base) var(--motion-easing-standard);
}

.professional-photo-field__frame--empty {
  border-style: dashed;
  border-color: var(--color-border-control);
}

/* Arrastrando encima: seleccionado en tinta, no en acento. */
.professional-photo-field__frame--dragging {
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-style: solid;
  border-color: var(--color-text-primary);
}

.professional-photo-field__busy,
.professional-photo-field__drop {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background-color: rgb(16 27 43 / 72%);
  /* Blanco fijo: el velo es tinta en los dos modos. */
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}

/* Preparando la foto: la espera de Agenda, el diamante dentro del sol
   (#735/#737); sobre el velo de tinta, sol y caras en blanco. */
.professional-photo-field__busy-spinner {
  --sd-sun: #fff;
  --sd-ray: rgb(255 255 255 / 70%);
}

.professional-photo-field__side {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
}

/* Rótulo v2 (DEC-188): tipo oración, 13px/500 en texto secundario. */
.professional-photo-field__label {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.professional-photo-field__hint {
  margin: 0;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
}

.professional-photo-field__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.professional-photo-field__status {
  min-height: var(--font-size-caption-line);
  margin: 0;
  color: var(--color-success-on-strong);
  font-size: var(--font-size-caption);
  line-height: var(--font-size-caption-line);
}

.professional-photo-field__status--error {
  color: var(--color-danger-on-strong);
}

/* Botones compactos. «Elegir foto» y «Deshacer» usan el secundario y el
   fantasma v2 tal cual (DEC-188); «Quitar foto» es un contorno rojo, para no
   competir con el «Guardar» del diálogo, que es la acción principal. */
.professional-photo-field__actions :deep(.base-button) {
  height: 36px;
  padding-inline: 14px;
  font-size: var(--font-size-caption);
}

.professional-photo-field__actions :deep(.base-button--danger) {
  background-color: transparent;
  color: var(--color-danger-on-strong);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.professional-photo-field__actions
  :deep(.base-button--danger:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 12%, transparent);
  filter: none;
}

/* En táctil y en angosto, el piso de 44 px (CA-009-03, como en #783); con
   puntero fino bastan 36 (#791). */
@media (max-width: 767px), (pointer: coarse) {
  .professional-photo-field__actions :deep(.base-button) {
    height: 44px;
  }
}

@keyframes professional-photo-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .professional-photo-field {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
  }

  .professional-photo-field__frame {
    align-self: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .professional-photo-field__frame {
    transition: none;
  }
}
</style>
