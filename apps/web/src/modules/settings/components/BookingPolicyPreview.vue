<script setup lang="ts">
// Vista previa de la política de reserva: lo que se está editando, pintado con
// el mismo selector «Día y hora» que usa el cliente (BookingSamplePicker, en
// modo de muestra y de solo lectura). La lista de datos de abajo dice lo mismo
// en texto para lectores de pantalla.
import { computed } from 'vue'
import { formatDuration, type BookingPolicyFormValues } from '../model/bookingPolicy'
import BookingSamplePicker from './BookingSamplePicker.vue'

const props = defineProps<{ policy: BookingPolicyFormValues }>()

const leadText = computed(() =>
  props.policy.minAdvanceMinutes > 0
    ? `desde ${formatDuration(props.policy.minAdvanceMinutes)} de antelación`
    : 'sin antelación mínima',
)

const windowText = computed(() => {
  const days = props.policy.maxAdvanceDays
  return `hasta ${days} ${days === 1 ? 'día' : 'días'} por delante`
})

const cancelText = computed(() =>
  props.policy.cancellationDeadlineMinutes > 0
    ? `hasta ${formatDuration(props.policy.cancellationDeadlineMinutes)} antes del turno`
    : 'no puede cancelar por su cuenta',
)

const lateText = computed(() => {
  if (props.policy.cancellationDeadlineMinutes <= 0) return 'no aplica'
  if (!props.policy.lateCancellationClientAllowed) return 'no puede cancelar'
  return props.policy.lateCancellationReasonRequired
    ? 'puede cancelar, indicando un motivo'
    : 'puede cancelar sin motivo'
})
</script>

<template>
  <aside class="policy-preview" aria-labelledby="policy-preview-title">
    <p class="policy-preview__kicker">Vista previa</p>
    <h2 id="policy-preview-title" class="policy-preview__title">Así lo ve tu cliente</h2>

    <BookingSamplePicker :window="policy" class="policy-preview__sample">
      <template #default="{ firstText, lastDayText }">
        <dl class="policy-preview__facts">
          <div class="policy-preview__fact">
            <dt>Reserva</dt>
            <dd>{{ leadText }}, {{ windowText }}</dd>
          </div>
          <div class="policy-preview__fact">
            <dt>Primer horario libre</dt>
            <dd>{{ firstText }}</dd>
          </div>
          <div class="policy-preview__fact">
            <dt>Último día para reservar</dt>
            <dd>{{ lastDayText }}</dd>
          </div>
          <div class="policy-preview__fact">
            <dt>Franjas</dt>
            <dd>una cada {{ policy.slotGridMinutes }} min</dd>
          </div>
          <div class="policy-preview__fact">
            <dt>Cancelación</dt>
            <dd>{{ cancelText }}</dd>
          </div>
          <div class="policy-preview__fact">
            <dt>Fuera de plazo</dt>
            <dd>{{ lateText }}</dd>
          </div>
        </dl>
      </template>
    </BookingSamplePicker>
  </aside>
</template>

<style scoped>
.policy-preview {
  position: sticky;
  top: 24px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 20px 22px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.policy-preview__kicker {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.policy-preview__title {
  margin: -12px 0 0;
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  color: var(--color-text-primary);
}

/* La muestra la pinta BookingSamplePicker; aquí solo se ensancha un poco
   sobre el relleno de la tarjeta. */
.policy-preview__sample :deep(.booking-sample__screen) {
  margin-inline: -8px;
}

.policy-preview__facts {
  margin-top: 8px;
}

/* --- Datos en texto --------------------------------------------------------- */

.policy-preview__facts {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.policy-preview__fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 0;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.policy-preview__fact dt {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.policy-preview__fact dd {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  color: var(--color-text-primary);
}

@media (max-width: 1099px) {
  .policy-preview {
    position: static;
  }
}
</style>
