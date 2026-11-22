<script setup lang="ts">
// app compone las dos capacidades por sus índices públicos; ningún módulo
// conoce los componentes privados de su hermano (DEC-105, issue #286).
import { ref } from 'vue'
import { StaffPage } from '@/modules/staff'
import { ProfessionalBlocksPanel } from '@/modules/schedules'
import { professionalPhotoUrl } from '@/shared/api'
import { useVocabulary } from '@/shared/composables'
import { BaseButton, BaseDialog } from '@/shared/ui'

// Palabras del negocio (DEC-110).
const v = useVocabulary()
const isBlocksOpen = ref(false)
const selectedProfessional = ref<{ id: string; name: string; photoUrl: string | null }>()

function openBlocks(id: string, name: string, photoUrl: string | null) {
  selectedProfessional.value = { id, name, photoUrl }
  isBlocksOpen.value = true
}
</script>

<template>
  <StaffPage>
    <template #professional-actions="{ professional }">
      <BaseButton
        variant="secondary"
        class="block-action"
        :aria-label="`Bloquear a ${professional.fullName}`"
        aria-haspopup="dialog"
        @click="
          openBlocks(professional.id, professional.fullName, professionalPhotoUrl(professional))
        "
      >
        <svg
          class="block-action-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <rect x="5" y="10" width="14" height="11" rx="1" />
          <path d="M8 10V6a4 4 0 0 1 8 0v4" />
        </svg>
        Bloquear
      </BaseButton>
    </template>
  </StaffPage>
  <BaseDialog
    v-model="isBlocksOpen"
    :title="`Bloqueos de ${selectedProfessional?.name ?? v.professional}`"
    size="xl"
    content-class="blocks-workspace-dialog"
    :close-on-backdrop="false"
  >
    <ProfessionalBlocksPanel
      v-if="isBlocksOpen && selectedProfessional"
      :key="selectedProfessional.id"
      :professional-id="selectedProfessional.id"
      :professional-name="selectedProfessional.name"
      :photo-url="selectedProfessional.photoUrl"
    />
  </BaseDialog>
</template>

<style scoped>
.block-action.base-button.base-button--secondary {
  background-color: transparent;
  color: var(--color-danger-on-strong);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}
.block-action.base-button.base-button--secondary:hover:not(:disabled):not(.base-button--loading) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 50%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}
.block-action.base-button.base-button--secondary:active:not(:disabled):not(.base-button--loading) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 20%, transparent);
}

.block-action :deep(.base-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.block-action-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
</style>

<style>
/* Diálogo teletransportado en v2 (DEC-188): la superficie del modo con borde
   sutil de 1px y radio grande, sin filete de acento; conserva foco, pila y
   movimiento reducido del componente compartido (DEC-105, #286). */
.blocks-workspace-dialog {
  width: min(100%, 1092px);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}
/* «Bloqueos de …» sigue siendo el nombre accesible del diálogo, pero a la vista
   ya lo dice la cabecera del panel («Tiempo fuera de agenda» y «Disponibilidad ·
   …»). Repetido a 14 px encima solo sumaba una franja (#791): el título se oculta
   sin salir del árbol accesible y la X queda en la esquina, sobre el panel. */
.blocks-workspace-dialog .base-dialog__container {
  position: relative;
}
.blocks-workspace-dialog .base-dialog__header {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  padding: 0;
  border: 0;
}
/* La X flota sobre el panel y, en móvil, el contenido se desplaza por debajo:
   lleva el fondo de la superficie para no montarse sobre un texto. */
.base-dialog__overlay .blocks-workspace-dialog .base-dialog__close {
  background-color: var(--color-surface);
}
.base-dialog__overlay .blocks-workspace-dialog .base-dialog__close:hover {
  background-color: color-mix(in srgb, currentColor 12%, var(--color-surface));
}
.blocks-workspace-dialog .base-dialog__title {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
}
/* Sitio para la X: en escritorio, a la derecha de las acciones; en móvil, la
   cabecera se apila y solo el nombre se aparta (los botones conservan el ancho). */
.blocks-workspace-dialog .blocks-panel__header {
  padding-right: 48px;
}
@media (max-width: 767px) {
  .blocks-workspace-dialog .blocks-panel__header {
    padding-right: 0;
  }
  .blocks-workspace-dialog .blocks-panel__identity {
    padding-right: 40px;
  }
}
.blocks-workspace-dialog .base-dialog__content {
  padding: 0;
  overscroll-behavior: contain;
}
/* Escritorio con alto suficiente: el diálogo mide lo que pide su contenido, con
   un tope; al llegar al tope cada lista del panel desplaza la suya
   (ProfessionalBlocksPanel) y la cabecera y la nota quedan fijas. Antes el alto era
   fijo y, con pocos bloqueos, dejaba media ventana en blanco (issue #577). En
   móvil o con poca altura el contenido se desplaza con el diálogo. */
/* Anclado arriba y no centrado: el alto cambia al pasar del skeleton a la lista
   y, centrado, todo el diálogo saltaba (#791). Así crece solo hacia abajo. */
.base-dialog__overlay:has(> .blocks-workspace-dialog) {
  align-items: flex-start;
}
@media (min-width: 768px) and (min-height: 800px) {
  .base-dialog__overlay:has(> .blocks-workspace-dialog) {
    padding-top: clamp(16px, 8vh, 72px);
  }
  /* Con el ancestro delante para ganarle a la regla con ámbito de BaseDialog
     (.base-dialog[data-v-…], misma especificidad que una clase doble): sin él el
     tope de 780 px nunca se aplicaba (#791). */
  .base-dialog__overlay .blocks-workspace-dialog.base-dialog {
    max-height: min(
      780px,
      calc(100vh / var(--ui-zoom, 1) - clamp(16px, 8vh, 72px) - var(--space-4))
    );
  }
  .blocks-workspace-dialog .base-dialog__container {
    flex: 1 1 auto;
    min-height: 0;
  }
  .blocks-workspace-dialog .base-dialog__content {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
}
.blocks-workspace-dialog .blocks-panel {
  border: 0;
}

/* La apertura es la de BaseDialog (v2, DEC-188): ya no se traza la línea de
   acento ni se despliega el panel en 640 ms (issue #577). */
</style>
