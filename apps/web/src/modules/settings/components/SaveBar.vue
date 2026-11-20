<script setup lang="ts">
// Barra de guardado flotante (DEC-110): aparece al pie de la columna cuando hay
// cambios del negocio sin guardar, con el resumen de qué cambió y las dos
// acciones. Mientras no hay nada pendiente no ocupa espacio ni entra en el
// orden de foco (`v-if`). El resultado se anuncia con `role="status"`. En v2
// (DEC-188) «Guardar» es el único acento lleno; la barra es una superficie
// neutra que aparece con un fundido breve, en respuesta al cambio.
import { BaseButton } from '@/shared/ui'

defineProps<{
  /** Resumen legible de lo pendiente ("Marca y vocabulario"). */
  summary: string
  saving: boolean
}>()
const emit = defineEmits<{ discard: []; save: [] }>()
</script>

<template>
  <div class="save-bar" role="status" aria-live="polite">
    <p class="save-bar__message">
      <span class="save-bar__text">
        <strong>Cambios sin guardar</strong>
        <span class="save-bar__summary">{{ summary }}</span>
      </span>
    </p>
    <div class="save-bar__actions">
      <BaseButton type="button" variant="secondary" :disabled="saving" @click="emit('discard')">
        Descartar
      </BaseButton>
      <BaseButton
        type="button"
        variant="primary"
        :loading="saving"
        loading-label="Guardando…"
        :disabled="saving"
        @click="emit('save')"
      >
        Guardar cambios
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.save-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px 12px 20px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: 0 -8px 24px -12px rgb(16 27 43 / 35%);
  animation: save-bar-enter var(--motion-duration-base) var(--motion-easing-standard) both;
}

.save-bar__message {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  min-width: 0;
}

.save-bar__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.save-bar__text strong {
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}

.save-bar__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}

.save-bar :deep(.base-button) {
  height: 40px;
  padding-inline: 16px;
}

/* Responde a una acción (el primer cambio sin guardar): fundido corto, sin rebote. */
@keyframes save-bar-enter {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .save-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 12px;
  }

  .save-bar__actions :deep(.base-button) {
    flex: 1;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .save-bar {
    animation: none;
  }
}
</style>
