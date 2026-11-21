<script setup lang="ts">
// Contenido de la sección «Horario de atención» de Configuración (HU-107,
// DEC-182): el horario semanal del local, el que ven los clientes en la reserva
// y el que Odin consulta. Es informativo: no cambia la disponibilidad de los
// profesionales, que sale de su propio horario.
//
// A diferencia de «Recordatorios», no se guarda al instante: el dueño arma la
// semana día por día y la guarda con un botón propio (no entra en la barra de
// guardado de la página, que es del borrador de marca y contacto).
import { computed, onMounted, ref } from 'vue'
import { BaseAlert, BaseButton, BaseTimePicker, DiamondLoader } from '@/shared/ui'
import { DAY_LABELS, type DayOfWeek } from '@/shared/model/openingHours'
import { fetchOpeningHours, saveOpeningHours } from '../api/openingHoursApi'
import {
  copyDay,
  draftFromSettings,
  draftSignature,
  MAX_SEGMENTS_PER_DAY,
  newInterval,
  settingsFromDraft,
  validateDraft,
  type DraftDay,
  type OpeningHoursDraft,
} from '../model/openingHoursDraft'
import SwitchField from './SwitchField.vue'

type Status = 'loading' | 'ready' | 'network-error' | 'unexpected-error'
type Feedback = 'idle' | 'saved' | 'invalid' | 'rejected' | 'network-error' | 'unexpected-error'

const WEEKDAYS: readonly DayOfWeek[] = ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']

const status = ref<Status>('loading')
const draft = ref<OpeningHoursDraft | null>(null)
const savedSignature = ref('')
const saving = ref(false)
const feedback = ref<Feedback>('idle')
const showErrors = ref(false)

const errors = computed(() => (draft.value ? validateDraft(draft.value) : {}))
const dirty = computed(() => !!draft.value && draftSignature(draft.value) !== savedSignature.value)
const openDays = computed(() => draft.value?.days.filter((d) => d.open).length ?? 0)

function adopt(settings: Parameters<typeof draftFromSettings>[0]) {
  draft.value = draftFromSettings(settings)
  savedSignature.value = draftSignature(draft.value)
  showErrors.value = false
}

async function load() {
  status.value = 'loading'
  const outcome = await fetchOpeningHours()
  if (outcome.kind === 'success') {
    adopt(outcome.settings)
    status.value = 'ready'
  } else {
    status.value = outcome.kind === 'network-error' ? 'network-error' : 'unexpected-error'
  }
}

function toggleDay(day: DraftDay, open: boolean) {
  day.open = open
  if (open && day.intervals.length === 0) day.intervals.push(newInterval())
  feedback.value = 'idle'
}

function addInterval(day: DraftDay) {
  if (day.intervals.length >= MAX_SEGMENTS_PER_DAY) return
  // El tramo nuevo empieza donde terminó el último, para no cruzarse con él.
  const last = day.intervals.at(-1)
  day.intervals.push(
    last ? newInterval(last.closes === '00:00' ? '23:00' : last.closes, '00:00') : newInterval(),
  )
  feedback.value = 'idle'
}

function removeInterval(day: DraftDay, key: number) {
  day.intervals = day.intervals.filter((i) => i.key !== key)
  if (day.intervals.length === 0) day.open = false
  feedback.value = 'idle'
}

function copyMondayToWeekdays() {
  if (!draft.value) return
  copyDay(draft.value, 'MONDAY', WEEKDAYS)
  feedback.value = 'idle'
}

async function save() {
  if (!draft.value || saving.value) return
  if (Object.keys(errors.value).length > 0) {
    showErrors.value = true
    feedback.value = 'invalid'
    return
  }
  saving.value = true
  feedback.value = 'idle'
  const outcome = await saveOpeningHours(settingsFromDraft(draft.value))
  saving.value = false
  if (outcome.kind === 'success') {
    adopt(outcome.settings)
    feedback.value = 'saved'
  } else if (outcome.kind === 'validation-error') {
    feedback.value = 'rejected'
  } else {
    feedback.value = outcome.kind
  }
}

function discard() {
  void load()
  feedback.value = 'idle'
}

onMounted(load)
</script>

<template>
  <div class="opening" :aria-busy="status === 'loading' || saving">
    <div v-if="status === 'loading'" role="status">
      <DiamondLoader label="Cargando tu horario" layout="inline" />
    </div>

    <BaseAlert
      v-else-if="status !== 'ready' || !draft"
      :variant="status === 'network-error' ? 'warning' : 'danger'"
      :title="status === 'network-error' ? 'No pudimos conectar' : 'No pudimos cargar tu horario'"
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
      <p class="opening__intro">
        Es el horario que ven tus clientes al reservar y el que responde el asistente de WhatsApp
        cuando preguntan si estás abierto. No cambia los turnos que se pueden reservar: esos salen
        del horario de cada profesional.
      </p>

      <ul class="opening__days" aria-label="Horario por día">
        <li
          v-for="d in draft.days"
          :key="d.day"
          class="opening__day"
          :class="{
            'opening__day--closed': !d.open,
            'opening__day--invalid': showErrors && errors[d.day],
          }"
        >
          <div class="opening__day-head">
            <span :id="`opening-${d.day}`" class="opening__day-name">{{ DAY_LABELS[d.day] }}</span>
            <label class="opening__toggle">
              <input
                type="checkbox"
                :checked="d.open"
                :aria-describedby="`opening-${d.day}`"
                @change="toggleDay(d, ($event.target as HTMLInputElement).checked)"
              />
              <span class="opening__state">{{ d.open ? 'Abierto' : 'Cerrado' }}</span>
            </label>
          </div>

          <!-- Día cerrado: puntos guía en lugar del hueco, como una línea de libreta. -->
          <span v-if="!d.open" class="opening__closed-leader" aria-hidden="true" />

          <div v-if="d.open" class="opening__intervals">
            <div
              v-for="(interval, index) in d.intervals"
              :key="interval.key"
              class="opening__interval"
              role="group"
              :aria-label="`${DAY_LABELS[d.day]}, horario ${index + 1}`"
            >
              <BaseTimePicker v-model="interval.opens" label="Abre" />
              <BaseTimePicker v-model="interval.closes" label="Cierra" />
              <button
                type="button"
                class="opening__remove"
                :aria-label="`Quitar el horario ${index + 1} del ${DAY_LABELS[d.day].toLowerCase()}`"
                @click="removeInterval(d, interval.key)"
              >
                Quitar
              </button>
            </div>
            <button
              v-if="d.intervals.length < MAX_SEGMENTS_PER_DAY"
              type="button"
              class="opening__add"
              @click="addInterval(d)"
            >
              + Añadir otro horario
              <span class="visually-hidden"> el {{ DAY_LABELS[d.day].toLowerCase() }}</span>
            </button>
          </div>

          <p v-if="showErrors && errors[d.day]" class="opening__error" role="alert">
            {{ errors[d.day] }}
          </p>
        </li>
      </ul>

      <p class="opening__hint">
        Si atiendes hasta la medianoche, cierra a las 12:00 a. m. Si sigues abierto después, añade
        el resto en el día siguiente desde las 12:00 a. m. Para el almuerzo, usa dos horarios el
        mismo día.
      </p>

      <button type="button" class="opening__add" @click="copyMondayToWeekdays">
        Copiar el horario del lunes de martes a viernes
      </button>

      <SwitchField
        :model-value="draft.closedOnHolidays"
        label="Cerramos los festivos"
        hint="En los festivos de Colombia verán el local cerrado."
        @update:model-value="
          (value: boolean) => {
            if (draft) draft.closedOnHolidays = value
            feedback = 'idle'
          }
        "
      />

      <div class="opening__actions">
        <BaseButton
          type="button"
          :loading="saving"
          loading-label="Guardando…"
          :disabled="!dirty"
          @click="save"
        >
          Guardar horario
        </BaseButton>
        <BaseButton v-if="dirty && !saving" type="button" variant="ghost" @click="discard">
          Descartar cambios
        </BaseButton>
      </div>

      <p
        class="opening__feedback"
        :class="{ 'opening__feedback--saved': feedback === 'saved' && !saving }"
        role="status"
        aria-live="polite"
      >
        <!-- El botón ya dice «Guardando…» a la vista; aquí solo lo oye el lector. -->
        <span v-if="saving" class="visually-hidden">Guardando…</span>
        <template v-else-if="feedback === 'saved'">
          {{
            openDays === 0
              ? 'Guardado. Sin días abiertos, tus clientes no verán un horario.'
              : 'Guardado. Tus clientes ya ven este horario.'
          }}
        </template>
        <template v-else-if="feedback === 'invalid'"
          >Revisa los días marcados antes de guardar.</template
        >
        <template v-else-if="feedback === 'rejected'">
          No pudimos guardar este horario. Revisa las horas de cada día e inténtalo de nuevo.
        </template>
        <template v-else-if="feedback === 'network-error'">
          No pudimos conectar; tu horario no se guardó. Inténtalo de nuevo.
        </template>
        <template v-else-if="feedback === 'unexpected-error'">
          No pudimos guardar tu horario. Inténtalo de nuevo en unos segundos.
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.opening {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.opening__intro,
.opening__hint,
.opening__feedback {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  overflow-wrap: anywhere;
}

.opening__hint {
  color: var(--color-text-secondary);
}

.opening__feedback {
  min-height: 20px;
}

.opening__days {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.opening__day {
  display: grid;
  grid-template-columns: minmax(150px, 200px) minmax(0, 1fr);
  gap: 12px 24px;
  align-items: start;
  padding: 14px 0;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

.opening__day--invalid {
  box-shadow: inset 3px 0 0 var(--color-danger-border);
  padding-left: 12px;
}

.opening__day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
}

.opening__day-name {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 400;
  line-height: 24px;
  color: var(--color-text-primary);
}

.opening__day--closed .opening__day-name {
  opacity: 0.65;
}

.opening__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: var(--font-size-body-sm);
  cursor: pointer;
}

/* La casilla es un rombo de latón (#759): hueco si el día está cerrado, lleno
   con un filo de papel si abre. Sigue siendo un checkbox nativo, así que el
   teclado, el lector de pantalla y el foco no cambian; el foco sigue la forma. */
.opening__toggle input {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  margin: 4px;
  appearance: none;
  background: transparent;
  border: 1.5px solid var(--color-brass-line);
  border-radius: 0;
  rotate: 45deg;
  cursor: pointer;
}

.opening__toggle input:checked {
  background: var(--color-brass-body);
  border-color: var(--color-brass-text);
  box-shadow: inset 0 0 0 2px var(--color-surface);
}

.opening__toggle input:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}

.opening__toggle:hover input:not(:checked) {
  background: color-mix(in srgb, var(--color-brass-body) 22%, transparent);
}

.opening__state {
  color: var(--color-text-secondary);
}

.opening__day:not(.opening__day--closed) .opening__state {
  color: var(--color-brass-text);
  font-weight: 600;
}

.opening__closed-leader {
  align-self: center;
  height: 0;
  margin-top: 2px;
  border-bottom: 2px dotted color-mix(in srgb, var(--color-brass-line) 45%, transparent);
}

.opening__intervals {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.opening__interval {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.opening__remove,
.opening__add {
  min-height: 44px;
  padding: 0 12px;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-body-sm);
  background: transparent;
  border: var(--border-width-normal) solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.opening__add {
  align-self: flex-start;
  padding-left: 0;
  color: var(--color-text-primary);
  text-align: left;
}

.opening__remove:hover,
.opening__add:hover {
  text-decoration-thickness: 2px;
}

.opening__add {
  text-decoration-color: var(--color-brass-line);
}

.opening__remove:focus-visible,
.opening__add:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.opening__error {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--color-danger-text);
  font-size: var(--font-size-body-sm);
}

.opening__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* Sin cambios que guardar, «Guardar horario» espera en reposo: contorno de
   latón punteado, no el acento desvaído (que se leía como un error). */
.opening__actions .base-button--primary:disabled:not(.base-button--loading) {
  background: transparent;
  border: 1px dashed var(--color-brass-line);
  color: var(--color-text-secondary);
  opacity: 1;
}

/* «Guardado»: un rombo de latón que se posa con resorte junto al aviso. */
.opening__feedback--saved {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.opening__feedback--saved::before {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  content: '';
  background: var(--color-brass-body);
  rotate: 45deg;
  translate: 0 -1px;
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .opening__feedback--saved {
    animation: opening-saved-in 420ms cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }

  :root:not([data-motion='reduced']) .opening__feedback--saved::before {
    animation: opening-saved-mark 520ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
  }

  :root:not([data-motion='reduced']) .opening__toggle input {
    transition:
      background-color 160ms ease,
      scale 160ms ease;
  }

  :root:not([data-motion='reduced']) .opening__toggle:active input {
    scale: 0.8;
  }
}

@keyframes opening-saved-in {
  from {
    opacity: 0;
    translate: 0 6px;
  }
}

@keyframes opening-saved-mark {
  from {
    opacity: 0;
    scale: 0.2;
    rotate: -45deg;
  }
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* En pantallas angostas el día va encima de sus horarios y «Quitar» baja a su fila. */
@media (max-width: 640px) {
  .opening__day {
    grid-template-columns: minmax(0, 1fr);
  }

  .opening__closed-leader {
    display: none;
  }

  .opening__interval {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .opening__remove {
    grid-column: 1 / -1;
    justify-self: start;
    padding-left: 0;
  }
}
</style>
