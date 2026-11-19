<script setup lang="ts">
// Contenido de la sección «Recordatorios» de Configuración (DEC-174): con
// cuántos minutos de anticipación sale el recordatorio al cliente. Opciones
// fijas de 10 en 10, sin pasar de 60. Se aplica al instante, como «Código de
// acceso»: elegir una opción la guarda y lo anuncia en una región viva; si el
// guardado falla, vuelve a la que sigue vigente en el servidor.
import { computed, onMounted, ref } from 'vue'
import { BaseAlert, BaseButton, DiamondLoader } from '@/shared/ui'
import { fetchReminderSettings, saveReminderLead } from '../api/reminderSettingsApi'
import { REMINDER_LEAD_OPTIONS, type ReminderLeadMinutes } from '../model/reminderSettingsOutcome'
import OptionGroup from './OptionGroup.vue'

type Status = 'loading' | 'ready' | 'network-error' | 'unexpected-error'
type LeadValue = `${ReminderLeadMinutes}`

// OptionGroup trabaja con cadenas (valores de radios nativos).
const OPTIONS = REMINDER_LEAD_OPTIONS.map((minutes) => ({
  value: String(minutes) as LeadValue,
  label: `${minutes} minutos antes`,
}))

const status = ref<Status>('loading')
const lead = ref<ReminderLeadMinutes>(30)
const saving = ref(false)
const feedback = ref<'idle' | 'saved' | 'failed'>('idle')

const leadValue = computed<LeadValue>(() => String(lead.value) as LeadValue)

async function load() {
  status.value = 'loading'
  const outcome = await fetchReminderSettings()
  if (outcome.kind === 'success') {
    lead.value = outcome.leadMinutes
    status.value = 'ready'
  } else {
    status.value = outcome.kind
  }
}

async function choose(value: LeadValue) {
  const next = Number(value) as ReminderLeadMinutes
  if (saving.value || next === lead.value) return
  const previous = lead.value
  lead.value = next
  saving.value = true
  feedback.value = 'idle'
  const outcome = await saveReminderLead(next)
  saving.value = false
  if (outcome.kind === 'success') {
    lead.value = outcome.leadMinutes
    feedback.value = 'saved'
  } else {
    lead.value = previous
    feedback.value = 'failed'
  }
}

onMounted(load)
</script>

<template>
  <div class="reminders" :aria-busy="status === 'loading' || saving">
    <div v-if="status === 'loading'" role="status">
      <DiamondLoader label="Cargando tus recordatorios" layout="inline" />
    </div>

    <BaseAlert
      v-else-if="status !== 'ready'"
      :variant="status === 'network-error' ? 'warning' : 'danger'"
      :title="status === 'network-error' ? 'No pudimos conectar' : 'No pudimos cargar esta opción'"
      role="alert"
    >
      {{
        status === 'network-error'
          ? 'Revisa tu conexión e inténtalo de nuevo.'
          : 'Inténtalo de nuevo en unos segundos.'
      }}
      <template #action>
        <BaseButton type="button" @click="load">Reintentar</BaseButton>
      </template>
    </BaseAlert>

    <template v-else>
      <OptionGroup
        :model-value="leadValue"
        :options="OPTIONS"
        label="Anticipación del recordatorio"
        :disabled="saving"
        class="reminders__options"
        @update:model-value="choose"
      >
        <template #default="{ option, selected }">
          <span class="reminders__option" :class="{ 'reminders__option--selected': selected }">
            <span class="reminders__minutes">{{ option.value }}</span>
            <span class="reminders__unit">min antes</span>
          </span>
        </template>
      </OptionGroup>
      <p class="reminders__summary">
        Tus clientes reciben el recordatorio <strong>{{ lead }} minutos antes</strong> de su turno,
        por WhatsApp y por correo según los datos que dejaron. Si cambias la hora, los recordatorios
        que aún no salen se ajustan solos.
      </p>
      <p class="reminders__feedback" role="status" aria-live="polite">
        <template v-if="saving">Guardando…</template>
        <template v-else-if="feedback === 'saved'">Guardado.</template>
        <template v-else-if="feedback === 'failed'">
          No pudimos guardar el cambio; se mantiene la opción anterior. Inténtalo de nuevo.
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.reminders {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.reminders__options {
  --option-group-gap: 10px;

  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.reminders__option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 100%;
  min-height: 72px;
  padding: 12px 8px;
  box-sizing: border-box;
  color: var(--color-text-primary);
  text-align: center;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.reminders__option--selected {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px var(--color-text-primary);
}

.reminders__minutes {
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.reminders__unit {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.reminders__summary,
.reminders__feedback {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  overflow-wrap: anywhere;
}

.reminders__feedback {
  min-height: 20px;
}

/* En pantallas angostas, tres por fila: cada opción conserva un blanco táctil cómodo. */
@media (max-width: 560px) {
  .reminders__options {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .reminders__option {
    transition: none;
  }
}
</style>
