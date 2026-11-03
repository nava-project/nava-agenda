<script setup lang="ts">
// HU-042 / #100 / #495: alta unificada del bloqueo por días y edición de cualquier
// serie por alcance. Son la misma serie del API (`POST /time-block-series`): solo
// cambia si se repite cada semana (`weekly`, uno o varios días de la semana) o
// si ocurre en fechas explícitas (`date_list`, RN-BLQ-01 «bloqueo de varios
// días»). El API recibe un día por serie, así que marcar varios días crea una
// serie por día con la misma hora, vigencia y motivo. El dueño de la lista es
// BarberBlocksPanel: aquí solo se pide el cambio y se devuelven las series que
// respondió la API.
import { computed, ref, useId, watch } from 'vue'
import { shiftCivilDate } from '@/shared/time/civilDate'
import { useToast } from '@/shared/composables'
import {
  BaseAlert,
  BaseButton,
  BaseDatePicker,
  BaseDialog,
  BaseInput,
  BaseSelect,
  BaseTimePicker,
} from '@/shared/ui'
import {
  createDateListSeries,
  createTimeBlockSeries,
  deleteTimeBlockSeries,
  updateTimeBlockSeries,
} from '../api/timeBlocksApi'
import { displayCivilDate } from '../model/displayDate'
import { newIdempotencyKey } from '../model/idempotencyKey'
import {
  BLOCK_TYPES,
  blockTypeLabel,
  type BlockType,
  type TimeBlockSeries,
} from '../model/timeBlock'
import { describeWeekdays, joinWeekdayNames } from '../model/workingHour'
import WeekdayMultiPicker from './WeekdayMultiPicker.vue'
import { validateDurationMinutes } from '../validation/scheduleValidation'
import { durationBetween, minutesToTime, timeToMinutes } from '../model/weekBoard'
import {
  validateEffectiveFrom,
  validateReason,
  validateStartsTime,
} from '../validation/timeBlockValidation'

type SaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'
type Scope = 'whole' | 'this_and_following'
type EndMode = 'open' | 'until'
type Repeat = 'weekly' | 'dates'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  barberId: string
  barberName: string
  series?: TimeBlockSeries | null
  // Edición de una ficha que agrupa varios días (#499): todas las series del grupo,
  // incluida `series`. El cambio se aplica a cada una con los mismos valores y los
  // días marcados añaden o quitan series (#501).
  group?: TimeBlockSeries[] | null
  today: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  created: [series: TimeBlockSeries]
  // Al editar una serie semanal se pueden quitar días: cada día quitado retira su serie.
  removed: [seriesId: string]
  // `splitFrom` es la fecha de corte cuando el alcance fue «esta y las
  // siguientes»: la serie original queda recortada el día anterior y `series`
  // es la nueva.
  updated: [payload: { originalId: string; series: TimeBlockSeries; splitFrom: string | null }]
}>()

const uid = useId()
const toast = useToast()
const isEdit = computed(() => props.mode === 'edit')
const isWeekly = computed(() => props.series?.recurrenceKind === 'weekly')
const targets = computed(() =>
  props.group && props.group.length > 1 ? props.group : props.series ? [props.series] : [],
)
// Series del grupo que aún faltan por actualizar: tras un fallo parcial el reintento
// solo toca las pendientes.
const pendingTargets = ref<TimeBlockSeries[]>([])
// Días de la semana que ya tienen serie (al abrir y a medida que se crean o retiran).
const existingDays = ref<number[]>([])
const isWeeklyEdit = computed(() => isEdit.value && isWeekly.value)

// Valores iniciales por modo: una pausa semanal suele ser una franja (almuerzo) y
// un bloqueo por fechas suele ser de día completo (vacaciones, día libre).
const REPEAT_DEFAULTS: Record<Repeat, { type: BlockType; start: string; end: string }> = {
  weekly: { type: 'lunch', start: '', end: '' },
  dates: { type: 'vacation', start: '00:00', end: '00:00' },
}
const REPEAT_OPTIONS = [
  { value: 'weekly' as Repeat, label: 'Cada semana', hint: 'Se repite los días que marques' },
  { value: 'dates' as Repeat, label: 'Fechas elegidas', hint: 'Solo en los días que elijas' },
]

const repeat = ref<Repeat>('weekly')
const weekdays = ref<number[]>([])
const blockType = ref<BlockType>('lunch')
const startsTime = ref('')
const endsTime = ref('')
const effectiveFrom = ref('')
const endMode = ref<EndMode>('open')
const effectiveUntil = ref('')
const reason = ref('')
const dates = ref<string[]>([])
const pendingDate = ref('')
const scope = ref<Scope>('whole')
const splitDate = ref('')
const error = ref<string | undefined>(undefined)
const status = ref<SaveStatus>('idle')
let idempotencyKey = newIdempotencyKey()
// Una clave por día de la semana: un reintento tras un fallo parcial repite el mismo
// intento lógico de cada día (RN-IDE-01) sin duplicar los que ya se crearon.
const weekdayKeys = new Map<number, string>()

const END_OPTIONS = [
  { value: 'open' as EndMode, label: 'Sin fecha de fin' },
  { value: 'until' as EndMode, label: 'Hasta una fecha' },
]
const SCOPE_OPTIONS = [
  { value: 'whole' as Scope, label: 'Toda la serie' },
  { value: 'this_and_following' as Scope, label: 'Esta fecha y las siguientes' },
]

const title = computed(() =>
  isEdit.value ? 'Editar serie de bloqueo' : 'Agregar bloqueo por días',
)
const description = computed(() =>
  isEdit.value
    ? isWeekly.value
      ? `Cambia el tipo, los días, la hora o la vigencia de este bloqueo de ${props.barberName}.`
      : `Cambia el tipo, la hora o la vigencia de esta serie de ${props.barberName}.`
    : `Elige si se repite cada semana o solo ocurre en fechas concretas, para ${props.barberName}.`,
)
const isWeeklyCreate = computed(() => !isEdit.value && repeat.value === 'weekly')
const isDatesCreate = computed(() => !isEdit.value && repeat.value === 'dates')
// En fechas elegidas la vigencia sale de las propias fechas: no se pide aparte.
const showValidity = computed(() => !isDatesCreate.value)
const splitting = computed(
  () => isEdit.value && isWeekly.value && scope.value === 'this_and_following',
)
const busy = computed(() => status.value === 'saving')
const duration = computed(() => durationBetween(startsTime.value, endsTime.value))

function reset() {
  error.value = undefined
  status.value = 'idle'
  pendingDate.value = ''
  scope.value = 'whole'
  splitDate.value = ''
  idempotencyKey = newIdempotencyKey()
  weekdayKeys.clear()
  pendingTargets.value = [...targets.value]
  const initialDays = targets.value.flatMap((item) => (item.isoWeekday ? [item.isoWeekday] : []))
  existingDays.value = initialDays
  weekdays.value = isEdit.value ? [...initialDays] : []
  const current = props.series
  if (isEdit.value && current) {
    blockType.value = current.blockType
    startsTime.value = current.startsTime
    endsTime.value = minutesToTime(timeToMinutes(current.startsTime) + current.durationMinutes)
    effectiveFrom.value = current.effectiveFrom
    endMode.value = current.effectiveUntil ? 'until' : 'open'
    effectiveUntil.value = current.effectiveUntil ?? ''
    reason.value = current.reason ?? ''
    dates.value = []
    return
  }
  repeat.value = 'weekly'
  blockType.value = REPEAT_DEFAULTS.weekly.type
  startsTime.value = REPEAT_DEFAULTS.weekly.start
  endsTime.value = REPEAT_DEFAULTS.weekly.end
  effectiveFrom.value = ''
  endMode.value = 'open'
  effectiveUntil.value = ''
  reason.value = ''
  dates.value = []
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  },
  { immediate: true },
)

// Al cambiar de modo se cambian también los valores iniciales, salvo lo que la persona
// ya tocó: solo se reemplaza lo que sigue valiendo el predeterminado del modo anterior.
watch(repeat, (next, previous) => {
  const from = REPEAT_DEFAULTS[previous]
  const to = REPEAT_DEFAULTS[next]
  error.value = undefined
  if (blockType.value === from.type) blockType.value = to.type
  if (startsTime.value === from.start && endsTime.value === from.end) {
    startsTime.value = to.start
    endsTime.value = to.end
  }
})

function onRepeatKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const next = repeat.value === 'weekly' ? 'dates' : 'weekly'
  repeat.value = next
  const group = event.currentTarget as HTMLElement
  group.querySelector<HTMLButtonElement>(`[data-repeat="${next}"]`)?.focus()
}

function addPendingDate() {
  error.value = undefined
  const date = pendingDate.value
  if (!date) return
  if (dates.value.includes(date)) {
    error.value = `El ${displayCivilDate(date)} ya está en la lista.`
    return
  }
  dates.value = [...dates.value, date].sort()
  pendingDate.value = ''
}
function removePendingDate(date: string) {
  dates.value = dates.value.filter((item) => item !== date)
}

const summary = computed(() => {
  const kind = blockTypeLabel(blockType.value)
  const clock = `${startsTime.value || '—'} → ${endsTime.value || '—'}`
  if (isEdit.value && isWeekly.value && props.series?.isoWeekday) {
    const days = weekdays.value.length > 0 ? describeWeekdays(weekdays.value) : 'elige los días'
    return `${kind} · ${days} · ${clock}`
  }
  if (isWeeklyCreate.value) {
    const days =
      weekdays.value.length > 0 ? `cada ${joinWeekdayNames(weekdays.value)}` : 'elige los días'
    return `${kind} · ${days} · ${clock}`
  }
  if (isDatesCreate.value) {
    const count = dates.value.length
    const when = count === 0 ? 'elige las fechas' : count === 1 ? '1 fecha' : `${count} fechas`
    return `${kind} · ${when} · ${clock}`
  }
  return `${kind} · ${clock}`
})

function validate(): string | undefined {
  const base =
    validateStartsTime(startsTime.value) ??
    validateStartsTime(endsTime.value) ??
    validateDurationMinutes(duration.value) ??
    validateReason(reason.value)
  if (base) return base
  if ((isWeeklyCreate.value || isWeeklyEdit.value) && weekdays.value.length === 0) {
    return 'Elige al menos un día de la semana.'
  }
  if (isDatesCreate.value) {
    return dates.value.length === 0 ? 'Agrega al menos una fecha.' : undefined
  }

  const from = splitting.value ? splitDate.value : effectiveFrom.value
  const fromError = validateEffectiveFrom(from)
  if (fromError) return splitting.value ? 'Elige desde qué fecha aplica el cambio.' : fromError
  if (splitting.value && props.series) {
    if (splitDate.value <= props.series.effectiveFrom) {
      return `El corte debe ser posterior al inicio de la serie (${displayCivilDate(props.series.effectiveFrom)}).`
    }
    if (props.series.effectiveUntil && splitDate.value > props.series.effectiveUntil) {
      return `El corte debe caer dentro de la vigencia (hasta ${displayCivilDate(props.series.effectiveUntil)}).`
    }
  }
  if (endMode.value === 'until') {
    const untilError = validateEffectiveFrom(effectiveUntil.value)
    if (untilError) return 'Elige la fecha de fin de la vigencia.'
    if (effectiveUntil.value < from) return 'La vigencia no puede terminar antes de empezar.'
  }
  return undefined
}

function fail(kind: Exclude<SaveStatus, 'idle' | 'saving'>) {
  status.value = kind
}

async function onSubmit() {
  if (busy.value) return
  error.value = undefined
  const problem = validate()
  if (problem) {
    error.value = problem
    return
  }
  const trimmed = reason.value.trim()
  const common = {
    blockType: blockType.value,
    startsTime: startsTime.value,
    durationMinutes: duration.value,
    effectiveUntil: endMode.value === 'until' ? effectiveUntil.value : null,
    reason: trimmed === '' ? null : trimmed,
  }

  status.value = 'saving'
  if (isDatesCreate.value) {
    // La vigencia abarca desde la primera fecha elegida, sin fin: así las fechas
    // que se añadan después desde «Fechas y excepciones» siguen dentro de ella.
    const outcome = await createDateListSeries(
      props.barberId,
      {
        ...common,
        effectiveFrom: dates.value[0]!,
        effectiveUntil: null,
        explicitDates: dates.value,
      },
      idempotencyKey,
    )
    if (outcome.kind === 'success') {
      status.value = 'idle'
      emit('created', outcome.series)
      emit('update:modelValue', false)
      toast.success('Bloqueo agregado', {
        detail:
          outcome.series.dates.length === 1
            ? 'La fecha ya está en el calendario.'
            : `Las ${outcome.series.dates.length} fechas ya están en el calendario.`,
      })
      return
    }
    fail(outcome.kind)
    return
  }

  if (isWeeklyCreate.value) {
    await createWeekly(common)
    return
  }

  if (!props.series) return
  await applyEdit(common)
}

// Edición: actualiza las series que siguen, crea las de los días añadidos y retira las
// de los días quitados (solo con alcance «toda la serie»; al dividir en una fecha los días
// quedan como están). Cada paso se anota al completarse, así un fallo a medias conserva
// lo hecho y el reintento solo recorre lo pendiente.
async function applyEdit(common: {
  blockType: BlockType
  startsTime: string
  durationMinutes: number
  effectiveUntil: string | null
  reason: string | null
}) {
  const cut = splitting.value ? splitDate.value : null
  const canChangeDays = isWeekly.value && cut === null
  const chosen = weekdays.value
  const keeps = (item: TimeBlockSeries) =>
    !canChangeDays || (item.isoWeekday !== null && chosen.includes(item.isoWeekday))
  const toUpdate = pendingTargets.value.filter(keeps)
  const toCreate = canChangeDays ? chosen.filter((day) => !existingDays.value.includes(day)) : []
  const toRemove = canChangeDays ? pendingTargets.value.filter((item) => !keeps(item)) : []
  const total = toUpdate.length + toCreate.length + toRemove.length
  let done = 0
  let failure: Exclude<SaveStatus, 'idle' | 'saving'> | null = null

  for (const target of toUpdate) {
    const outcome = await updateTimeBlockSeries(
      props.barberId,
      target.id,
      { ...common, effectiveFrom: cut ?? effectiveFrom.value },
      cut ? { effectiveDate: cut } : null,
    )
    if (outcome.kind !== 'success') {
      failure = outcome.kind
      break
    }
    done++
    pendingTargets.value = pendingTargets.value.filter((item) => item.id !== target.id)
    emit('updated', { originalId: target.id, series: outcome.series, splitFrom: cut })
  }
  for (const day of failure === null ? toCreate : []) {
    let key = weekdayKeys.get(day)
    if (!key) {
      key = newIdempotencyKey()
      weekdayKeys.set(day, key)
    }
    const outcome = await createTimeBlockSeries(
      props.barberId,
      common.blockType,
      day,
      common.startsTime,
      common.durationMinutes,
      effectiveFrom.value,
      common.reason,
      key,
      common.effectiveUntil,
    )
    if (outcome.kind !== 'success') {
      failure = outcome.kind
      break
    }
    done++
    existingDays.value = [...existingDays.value, day]
    emit('created', outcome.series)
  }
  for (const target of failure === null ? toRemove : []) {
    const outcome = await deleteTimeBlockSeries(props.barberId, target.id)
    if (outcome.kind !== 'success' && outcome.kind !== 'not-found') {
      failure = outcome.kind
      break
    }
    done++
    pendingTargets.value = pendingTargets.value.filter((item) => item.id !== target.id)
    existingDays.value = existingDays.value.filter((day) => day !== target.isoWeekday)
    emit('removed', target.id)
  }

  if (failure === null) {
    status.value = 'idle'
    emit('update:modelValue', false)
    toast.success(cut ? 'Serie dividida' : 'Serie actualizada', {
      detail: cut
        ? `El cambio aplica desde el ${displayCivilDate(cut)}; antes se conserva lo anterior.`
        : 'Los cambios ya están en el calendario.',
    })
    return
  }
  if (done > 0) {
    error.value = `Se aplicaron ${done} de ${total} cambios. Inténtalo de nuevo para el resto.`
  }
  fail(failure)
}

async function createWeekly(common: {
  blockType: BlockType
  startsTime: string
  durationMinutes: number
  effectiveUntil: string | null
  reason: string | null
}) {
  const created: number[] = []
  let failure: Exclude<SaveStatus, 'idle' | 'saving'> | null = null
  for (const day of weekdays.value) {
    let key = weekdayKeys.get(day)
    if (!key) {
      key = newIdempotencyKey()
      weekdayKeys.set(day, key)
    }
    const outcome = await createTimeBlockSeries(
      props.barberId,
      common.blockType,
      day,
      common.startsTime,
      common.durationMinutes,
      effectiveFrom.value,
      common.reason,
      key,
      common.effectiveUntil,
    )
    if (outcome.kind !== 'success') {
      failure = outcome.kind
      break
    }
    created.push(day)
    emit('created', outcome.series)
  }

  if (failure === null) {
    status.value = 'idle'
    emit('update:modelValue', false)
    toast.success('Bloqueo agregado', { detail: `Se repite cada ${joinWeekdayNames(created)}.` })
    return
  }
  // Fallo a medias: lo creado ya está en el calendario; quedan marcados solo los
  // días pendientes para reintentarlos sin duplicar.
  if (created.length > 0) {
    weekdays.value = weekdays.value.filter((day) => !created.includes(day))
    error.value = `Ya se agregó cada ${joinWeekdayNames(created)}. No pudimos guardar el resto: ${joinWeekdayNames(weekdays.value)}. Inténtalo de nuevo.`
  }
  fail(failure)
}

const previousDay = computed(() =>
  splitting.value && splitDate.value ? shiftCivilDate(splitDate.value, -1) : null,
)
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="title"
    :description="description"
    size="lg"
    content-class="block-dialog"
    :close-on-backdrop="!busy"
    :close-on-escape="!busy"
    :show-close="!busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form :id="`series-form-${uid}`" class="block-form" @submit.prevent="onSubmit">
      <div v-if="!isEdit" class="block-form__repeat">
        <span :id="`series-repeat-label-${uid}`" class="block-form__repeat-label"
          >Cuándo ocurre</span
        >
        <div
          class="block-form__repeat-group"
          role="radiogroup"
          :aria-labelledby="`series-repeat-label-${uid}`"
          @keydown="onRepeatKeydown"
        >
          <button
            v-for="option in REPEAT_OPTIONS"
            :key="option.value"
            type="button"
            role="radio"
            class="block-form__repeat-option"
            :class="{ 'block-form__repeat-option--on': repeat === option.value }"
            :data-repeat="option.value"
            :aria-checked="repeat === option.value"
            :tabindex="repeat === option.value ? 0 : -1"
            :disabled="busy"
            @click="repeat = option.value"
          >
            <strong>{{ option.label }}</strong>
            <small>{{ option.hint }}</small>
          </button>
        </div>
      </div>
      <BaseSelect
        :id="`series-type-${uid}`"
        v-model="blockType"
        label="Tipo de bloqueo"
        :options="BLOCK_TYPES"
        :disabled="busy"
      />
      <BaseSelect
        v-if="isEdit && isWeekly"
        :id="`series-scope-${uid}`"
        v-model="scope"
        label="Qué cambia"
        :options="SCOPE_OPTIONS"
        :disabled="busy"
      />
      <div v-if="splitting" class="block-form__date-field">
        <label :id="`series-split-label-${uid}`" :for="`series-split-${uid}`"
          >Aplicar desde <span aria-hidden="true">*</span></label
        >
        <BaseDatePicker
          v-model="splitDate"
          :trigger-id="`series-split-${uid}`"
          :label-id="`series-split-label-${uid}`"
          :today="today"
          :disabled="busy"
          required
        />
      </div>
      <WeekdayMultiPicker
        v-if="isWeeklyCreate || isWeeklyEdit"
        v-model="weekdays"
        label="Días de la semana"
        :disabled="busy || splitting"
      />
      <p v-if="splitting" class="block-form__hint">
        Al dividir desde una fecha los días no cambian. Para añadir o quitar días, edita toda la
        serie.
      </p>
      <div class="block-form__row">
        <BaseTimePicker v-model="startsTime" label="Hora de inicio" required :disabled="busy" />
        <BaseTimePicker v-model="endsTime" label="Hora de fin" required :disabled="busy" />
      </div>
      <div v-if="showValidity && !splitting" class="block-form__date-field">
        <label :id="`series-from-label-${uid}`" :for="`series-from-${uid}`"
          >Vigente desde <span aria-hidden="true">*</span></label
        >
        <BaseDatePicker
          v-model="effectiveFrom"
          :trigger-id="`series-from-${uid}`"
          :label-id="`series-from-label-${uid}`"
          :today="today"
          :disabled="busy"
          required
        />
      </div>
      <BaseSelect
        v-if="showValidity"
        :id="`series-end-${uid}`"
        v-model="endMode"
        label="Fin de la vigencia"
        :options="END_OPTIONS"
        :disabled="busy"
      />
      <div v-if="showValidity && endMode === 'until'" class="block-form__date-field">
        <label :id="`series-until-label-${uid}`" :for="`series-until-${uid}`"
          >Vigente hasta <span aria-hidden="true">*</span></label
        >
        <BaseDatePicker
          v-model="effectiveUntil"
          :trigger-id="`series-until-${uid}`"
          :label-id="`series-until-label-${uid}`"
          :today="today"
          :disabled="busy"
          required
        />
      </div>

      <fieldset v-if="isDatesCreate" :disabled="busy">
        <legend>Fechas del bloqueo</legend>
        <ul v-if="dates.length" class="block-chips" aria-label="Fechas elegidas">
          <li v-for="date in dates" :key="date">
            <span>{{ displayCivilDate(date) }}</span>
            <BaseButton
              variant="secondary"
              :aria-label="`Quitar la fecha ${displayCivilDate(date)}`"
              @click="removePendingDate(date)"
              >Quitar</BaseButton
            >
          </li>
        </ul>
        <p v-else class="block-chips__empty">Aún no elegiste ninguna fecha.</p>
        <div class="block-form__date-field">
          <label :id="`series-date-label-${uid}`" :for="`series-date-${uid}`"
            >Elegir una fecha</label
          >
          <BaseDatePicker
            v-model="pendingDate"
            :trigger-id="`series-date-${uid}`"
            :label-id="`series-date-label-${uid}`"
            :today="today"
            :disabled="busy"
          />
        </div>
        <BaseButton variant="secondary" :disabled="!pendingDate || busy" @click="addPendingDate"
          >Añadir a la lista</BaseButton
        >
      </fieldset>

      <BaseInput v-model="reason" type="text" label="Motivo (opcional)" :disabled="busy" />

      <div class="block-form__summary" aria-live="polite">
        <span class="block-form__eyebrow">Así queda</span>
        <p>{{ summary }}</p>
        <p v-if="previousDay">
          La serie actual termina el {{ displayCivilDate(previousDay) }} y esta empieza el
          {{ displayCivilDate(splitDate) }}.
        </p>
        <p v-else-if="isEdit && !isWeekly">
          Las fechas y excepciones se gestionan desde «Fechas y excepciones».
        </p>
      </div>

      <BaseAlert v-if="error" variant="danger">{{ error }}</BaseAlert>
      <BaseAlert v-else-if="status === 'validation-error'" variant="danger"
        >Revisa los datos: la hora debe quedar dentro del día y las fechas ser válidas.</BaseAlert
      >
      <BaseAlert v-else-if="status === 'idempotency-conflict'" variant="danger"
        >Este intento ya se envió con otros datos. Cierra y vuelve a abrir el formulario para
        empezar de nuevo.</BaseAlert
      >
      <BaseAlert v-else-if="status === 'not-found'" variant="danger"
        >Esta serie ya no está disponible. Cierra el formulario y actualiza la lista.</BaseAlert
      >
      <BaseAlert
        v-else-if="status === 'network-error' || status === 'unexpected-error'"
        variant="danger"
        >No pudimos guardar los cambios. Tus datos siguen aquí; inténtalo de nuevo.</BaseAlert
      >
    </form>
    <template #footer>
      <div class="block-form__footer">
        <BaseButton variant="secondary" :disabled="busy" @click="emit('update:modelValue', false)"
          >Cancelar</BaseButton
        >
        <BaseButton
          type="submit"
          :form="`series-form-${uid}`"
          variant="primary"
          :loading="busy"
          :disabled="busy"
          >{{ isEdit ? 'Guardar cambios' : 'Guardar bloqueo' }}</BaseButton
        >
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped src="./block-form.css"></style>
<style scoped>
.block-form__eyebrow {
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
</style>
