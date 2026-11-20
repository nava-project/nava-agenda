<script setup lang="ts">
// Interruptor «Lo ofrezco» de un servicio para el profesional individual (DEC-115).
// Interruptor v2 (DEC-188) en tamaño de fila: pista redonda y botón circular;
// encendido en tinta, nunca en acento (el acento es solo de la acción principal). El estado se anuncia con `aria-checked` y con
// texto, nunca solo con el color. Solo cambia cuando el servidor confirma
// (`ProfessionalOffering.setOffered`), así que mientras viaja la petición queda
// ocupado y no admite un segundo clic. Usa `aria-disabled` y no `disabled`: un botón
// deshabilitado pierde el foco y el teclado volvía a BODY (CA-023-08, WCAG 2.4.3);
// el segundo clic lo descarta `setOffered`.
import { useToast } from '@/shared/composables'
import type { ProfessionalOffering } from '../model/professionalOffering'

const props = defineProps<{
  offering: ProfessionalOffering
  serviceId: string
  serviceName: string
  /** Solo la pista, sin texto: para una columna con su propio encabezado. */
  compact?: boolean
}>()

const toast = useToast()

async function onToggle() {
  const next = !props.offering.isOffered(props.serviceId)
  const outcome = await props.offering.setOffered(props.serviceId, next)
  switch (outcome) {
    case 'changed':
      toast.success(next ? 'Ahora lo ofreces' : 'Ya no lo ofreces', {
        detail: next
          ? `«${props.serviceName}» aparece en tu reserva pública.`
          : `«${props.serviceName}» deja de aparecer en tu reserva pública.`,
      })
      return
    case 'network-error':
      toast.error('No pudimos guardar el cambio', {
        detail: 'Revisa tu conexión e inténtalo de nuevo.',
      })
      return
    case 'error':
      toast.error('No pudimos guardar el cambio', {
        detail: `«${props.serviceName}» sigue como estaba.`,
      })
      return
    case 'unchanged':
      return
  }
}
</script>

<template>
  <button
    v-if="offering.status.value === 'ready'"
    type="button"
    role="switch"
    class="offer-switch"
    :class="{ 'offer-switch--on': offering.isOffered(serviceId) }"
    :aria-checked="offering.isOffered(serviceId)"
    :aria-label="`Lo ofrezco: ${serviceName}`"
    :aria-busy="offering.isBusy(serviceId)"
    :aria-disabled="offering.isBusy(serviceId) ? 'true' : undefined"
    @click="onToggle"
  >
    <span v-if="!compact" class="offer-switch__text" aria-hidden="true">{{
      offering.isOffered(serviceId) ? 'Lo ofrezco' : 'No lo ofrezco'
    }}</span>
    <span class="offer-switch__track" aria-hidden="true">
      <span class="offer-switch__thumb" />
    </span>
  </button>
</template>

<style scoped>
.offer-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 2px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  cursor: pointer;
}

.offer-switch:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Rótulo v2: tipo oración, 13px/500; encendido pasa a texto primario. */
.offer-switch__text {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

.offer-switch--on .offer-switch__text {
  color: var(--color-text-primary);
}

.offer-switch__track {
  position: relative;
  display: block;
  flex: 0 0 auto;
  width: 44px;
  height: 24px;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Encendido: pista llena de tinta, el mismo «seleccionado en tinta» del resto. */
.offer-switch--on .offer-switch__track {
  background: var(--color-text-primary);
  border-color: var(--color-text-primary);
}

/* Botón circular que se desliza (respuesta al clic, sin rebote). */
.offer-switch__thumb {
  position: absolute;
  top: 50%;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  transform: translateY(-50%);
  transition:
    left var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.offer-switch--on .offer-switch__thumb {
  left: 23px;
  background: var(--color-surface);
}

.offer-switch:hover:not([aria-disabled='true']) .offer-switch__track {
  border-color: var(--color-text-primary);
}

.offer-switch[aria-disabled='true'] {
  cursor: progress;
  opacity: 0.6;
}

@media (prefers-reduced-motion: reduce) {
  .offer-switch__text,
  .offer-switch__track,
  .offer-switch__thumb {
    transition: none;
  }
}
</style>
