<script setup lang="ts">
// Vista previa de la política de reserva: traduce lo que se está editando a lo
// que verá la persona que reserva. Es solo lectura y deriva de los valores del
// formulario (no consulta ni crea nada). La regla dibuja la ventana de reserva
// desde «ahora»: el tramo rayado es la anticipación mínima, que todavía no se
// puede reservar. Debajo, las franjas de una mañana de ejemplo con la rejilla
// elegida. El gráfico es decorativo (`aria-hidden`); la lista de datos lleva
// el mismo contenido en texto para lectores de pantalla. En v2 (DEC-188) la
// tarjeta es neutra, quieta al cargar, y «ahora» es la marca del Sol.
import { computed } from 'vue'
import {
  blockedShareOfWindow,
  formatDuration,
  sampleSlotLabels,
  type BookingPolicyFormValues,
} from '../model/bookingPolicy'

const props = defineProps<{ policy: BookingPolicyFormValues }>()

const blockedPercent = computed(
  () => blockedShareOfWindow(props.policy.minAdvanceMinutes, props.policy.maxAdvanceDays) * 100,
)

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

const slots = computed(() => sampleSlotLabels(props.policy.slotGridMinutes))
</script>

<template>
  <aside class="policy-preview" aria-labelledby="policy-preview-title">
    <p class="policy-preview__kicker">Vista previa</p>
    <h2 id="policy-preview-title" class="policy-preview__title">Así lo ve tu cliente</h2>

    <div class="policy-preview__window" aria-hidden="true">
      <div class="policy-preview__track">
        <span class="policy-preview__blocked" :style="{ width: `${blockedPercent}%` }" />
        <span class="policy-preview__open" :style="{ left: `${blockedPercent}%` }" />
        <span class="policy-preview__now" />
      </div>
      <div class="policy-preview__legend">
        <span>Ahora</span>
        <span>+{{ policy.maxAdvanceDays }} d</span>
      </div>
    </div>

    <dl class="policy-preview__facts">
      <div class="policy-preview__fact">
        <dt>Reserva</dt>
        <dd>{{ leadText }}, {{ windowText }}</dd>
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

    <div v-if="slots.length > 0" class="policy-preview__sample" aria-hidden="true">
      <span class="policy-preview__sample-label">Ejemplo de franjas</span>
      <ul class="policy-preview__slots">
        <li
          v-for="slot in slots"
          :key="`${policy.slotGridMinutes}-${slot}`"
          class="policy-preview__slot"
        >
          {{ slot }}
        </li>
      </ul>
    </div>
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

/* --- Ventana de reserva ---------------------------------------------------- */

.policy-preview__window {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.policy-preview__track {
  position: relative;
  height: 14px;
  overflow: hidden;
  background: var(--color-surface-muted);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
}

/* Las barras responden al valor que se edita: transición corta, sin rebote. */
.policy-preview__blocked,
.policy-preview__open {
  position: absolute;
  top: 0;
  bottom: 0;
  transition:
    width var(--motion-duration-base) var(--motion-easing-standard),
    left var(--motion-duration-base) var(--motion-easing-standard);
}

/* Tramo cerrado: rayado fino, el «aún no» de la anticipación mínima. */
.policy-preview__blocked {
  left: 0;
  background: repeating-linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-text-primary) 28%, transparent) 0 2px,
    transparent 2px 6px
  );
}

/* Tramo abierto: tinta tenue; el acento queda para la acción principal. */
.policy-preview__open {
  right: 0;
  background: color-mix(in srgb, var(--color-text-primary) 55%, transparent);
}

/* «Ahora» es una marca de tiempo: la pinta el Sol. */
.policy-preview__now {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--color-sun);
}

.policy-preview__legend {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: 16px;
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

/* --- Franjas de ejemplo ------------------------------------------------------ */

.policy-preview__sample {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.policy-preview__sample-label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.policy-preview__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.policy-preview__slot {
  padding: 5px 10px;
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  color: var(--color-text-primary);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
}

@media (max-width: 1099px) {
  .policy-preview {
    position: static;
  }
}

@media (prefers-reduced-motion: reduce) {
  .policy-preview__blocked,
  .policy-preview__open {
    transition: none;
  }
}
</style>
