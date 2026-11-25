<script setup lang="ts">
/**
 * ManualStartPicker · el paso «Fecha y hora» de «Nuevo turno» sobre la
 * disponibilidad real (#717, DEC-190).
 *
 * - Lee los inicios libres del servicio con el profesional en 14 días desde hoy
 *   (zona del negocio) y los muestra con el mismo `DayTimePicker` de la reserva,
 *   vestido con la familia del panel: sellos de día con rombo de latón, la hora en
 *   serif y la elección en latón con su rombo; sin píldoras ni círculos.
 * - Todos los días del tramo están en la tira, también los que no tienen hueco:
 *   ese día dice «Sin horas libres el …» y ofrece «Otra hora» y el siguiente día
 *   con hueco.
 * - «Otra hora» es la salida secundaria: fecha y hora escritas a mano (12 h, con
 *   «Medianoche»), para un turno que ya empezó, uno fuera de la rejilla o una
 *   jornada que cruza la medianoche (la lectura no trae esos inicios de la
 *   madrugada). La creación manual acepta cualquier minuto (DEC-006).
 * - `refreshDay` vuelve a leer un día: la página lo llama tras un `409` (alguien
 *   tomó la hora entre la lectura y el envío). Si la elegida ya no está, se suelta;
 *   el resto del formulario no se toca.
 *
 * - Al reprogramar (#776), `excludeAppointmentId` pide la lectura sin el propio
 *   turno (su hora vuelve a estar libre y la duración es la suya) y `current`
 *   muestra esa hora en la rejilla sin dejar elegirla.
 * - Un `404` de la lectura (el servicio se desactivó o dejó de estar asignado al
 *   profesional después de reservar) dice qué pasó y ofrece «Otra hora»; no cambia
 *   de modo en silencio.
 *
 * La página posee la fecha y la hora (`v-model:date`, `v-model:time`, «HH:MM» de
 * 24 h en la zona del negocio); este componente solo propone y emite.
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  DayTimePicker,
  buildDaylightDays,
  type DaylightDay,
  type DaylightSlot,
} from '@/modules/public-booking'
import { BaseButton, BaseDatePicker, BaseTimePicker, DiamondLoader } from '@/shared/ui'
import { LOADER_FADE_MS, LOADER_MIN_VISIBLE_MS, useLoaderGrace } from '@/shared/composables'
import {
  formatCivilDateFull,
  formatCivilDateShort,
  getCivilDateInTimezone,
  shiftCivilDate,
} from '@/shared/time/civilDate'
import { fetchManualAvailability } from '../api/appointmentsApi'

const WINDOW_DAYS = 14

interface Props {
  professionalId: string
  serviceId: string
  /** Zona del negocio, si ya se conoce: fija «hoy». La respuesta trae la suya. */
  timezone: string | null
  /** Error del instante (validación o `409`), bajo la elección. */
  error?: string
  disabled?: boolean
  /** Turno que se reprograma: la lectura lo saca de la ocupación (#776). */
  excludeAppointmentId?: string
  /** Inicio actual de ese turno (ISO): se ve en la rejilla, no se elige. */
  current?: string | null
  /** Prefijo de los ids de «Otra hora», único en la página. */
  idPrefix?: string
  dateLabel?: string
  timeLabel?: string
}
const props = withDefaults(defineProps<Props>(), {
  error: undefined,
  disabled: false,
  excludeAppointmentId: undefined,
  current: null,
  idPrefix: 'new-appointment',
  dateLabel: 'Fecha del turno',
  timeLabel: 'Hora del turno',
})
const date = defineModel<string>('date', { required: true })
const time = defineModel<string>('time', { required: true })
// La duración que aplicará el servidor, leída con los inicios libres: la
// página la muestra en la tarjeta del borrador en cuanto llega (#833).
const emit = defineEmits<{ duration: [minutes: number] }>()

type Status = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'
const status = ref<Status>('idle')
const mode = ref<'grid' | 'manual'>('grid')
const days = ref<DaylightDay[]>([])
const zone = ref<string>(props.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
const grid = ref(15)
const duration = ref(30)
const activeDate = ref<string | null>(null)
const root = ref<HTMLElement | null>(null)
// La franja anima su llegada solo la primera vez que aparece en este paso.
const arrived = ref(false)
let request = 0

const errorId = `manual-start-error-${Math.random().toString(36).slice(2, 9)}`
const dateId = computed(() => `${props.idPrefix}-date`)
const ready = computed(() => !!props.professionalId && !!props.serviceId)
const today = computed(() => getCivilDateInTimezone(props.timezone ?? zone.value))

function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Los 14 días del tramo, con hueco o sin él, en orden. */
function windowDays(starts: string[], timezone: string, from: string): DaylightDay[] {
  const withSlots = new Map(
    buildDaylightDays(
      starts.map((startsAt) => ({ startsAt, professionalId: '' })),
      timezone,
      null,
    ).map((d) => [d.civilDate, d]),
  )
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const civilDate = shiftCivilDate(from, i)
    return withSlots.get(civilDate) ?? { civilDate, slots: [], groups: [], freeRatio: 0 }
  })
}

// La espera lleva la gracia del cargador (#843, CA-7): con una respuesta rápida el
// esqueleto no asoma (aparece a los 300 ms, en CSS) y, si asomó, se queda lo
// bastante para leerse.
const loadGrace = useLoaderGrace({ minVisibleMs: LOADER_FADE_MS + LOADER_MIN_VISIBLE_MS })

// El selector puede cargar dentro de un diálogo aún cerrado (Reprogramar lo
// prepara con la página): el esqueleto empieza a asomar al abrirse, no al montar.
// Su animación de entrada lo dice (#843).
function onSkeletonAppear(event: AnimationEvent) {
  if (event.animationName.includes('manual-start-skeleton-in')) loadGrace.markAppeared()
}

async function load() {
  const ticket = ++request
  if (!ready.value) {
    status.value = 'idle'
    days.value = []
    return
  }
  status.value = 'loading'
  loadGrace.start()
  const from = today.value
  const outcome = await fetchManualAvailability(
    props.professionalId,
    props.serviceId,
    from,
    shiftCivilDate(from, WINDOW_DAYS - 1),
    props.excludeAppointmentId,
  )
  if (ticket !== request) return
  await loadGrace.settled()
  if (ticket !== request) return
  if (outcome.kind !== 'success') {
    status.value = outcome.kind === 'not-found' ? 'not-found' : 'error'
    return
  }
  const { availability } = outcome
  zone.value = availability.timezone
  grid.value = availability.slotGridMinutes
  duration.value = availability.durationMinutes
  emit('duration', availability.durationMinutes)
  days.value = windowDays(availability.starts, availability.timezone, from)
  // Abre en el día ya elegido si está en el tramo; si no, en el primero con hueco.
  const keep = days.value.find((d) => d.civilDate === date.value)
  activeDate.value = (keep ??
    days.value.find((d) => d.slots.length > 0) ??
    days.value[0])!.civilDate
  status.value = 'ready'
}

// «Reintentar» desaparece al empezar la carga: el foco pasa antes al selector, que
// sigue ahí (#843, CA-13).
function retry() {
  root.value?.focus()
  void load()
}

watch(
  () => [props.professionalId, props.serviceId] as const,
  () => {
    // Otro profesional u otro servicio: otra rejilla. La hora de la rejilla
    // anterior ya no vale; la escrita a mano se conserva.
    if (mode.value === 'grid') time.value = ''
    void load()
  },
  { immediate: true },
)

/** Vuelve a leer `civilDate` tras un `409` y suelta la elegida si ya no está. */
async function refreshDay(civilDate: string) {
  if (status.value !== 'ready') return
  const outcome = await fetchManualAvailability(
    props.professionalId,
    props.serviceId,
    civilDate,
    civilDate,
    props.excludeAppointmentId,
  )
  if (outcome.kind !== 'success') return
  const [fresh] = windowDays(outcome.availability.starts, outcome.availability.timezone, civilDate)
  days.value = days.value.map((d) => (d.civilDate === civilDate && fresh ? fresh : d))
  if (
    mode.value === 'grid' &&
    civilDate === date.value &&
    !fresh?.slots.some((s) => clockOf(s.minutes) === time.value)
  )
    time.value = ''
}
defineExpose({ refreshDay })

const selectedStart = computed(() => {
  if (mode.value !== 'grid' || !date.value || !time.value) return null
  const day = days.value.find((d) => d.civilDate === date.value)
  return day?.slots.find((s) => clockOf(s.minutes) === time.value)?.startsAt ?? null
})

function onSelect(slot: DaylightSlot) {
  if (!activeDate.value) return
  date.value = activeDate.value
  time.value = clockOf(slot.minutes)
  arrived.value = true
}

function nextDayWithGaps(after: string): DaylightDay | null {
  return days.value.find((d) => d.civilDate > after && d.slots.length > 0) ?? null
}

function goTo(civilDate: string) {
  activeDate.value = civilDate
}

// Al cambiar de modo, el botón pulsado desaparece: el foco se lleva a lo que
// sigue en vez de caer en <body> (WCAG 2.4.3).
async function focusIn(selectors: string[]) {
  await nextTick()
  for (const selector of selectors) {
    const target = root.value?.querySelector<HTMLElement>(selector)
    if (target) {
      target.focus()
      return
    }
  }
}

function useOtherTime() {
  // La fecha de la tira pasa al campo para no escribirla otra vez.
  if (!date.value && activeDate.value) date.value = activeDate.value
  mode.value = 'manual'
  void focusIn([`#${dateId.value}`])
}

function useGrid() {
  mode.value = 'grid'
  // Una hora escrita a mano que la rejilla no ofrece no queda elegida a escondidas.
  if (!selectedStart.value) time.value = ''
  if (date.value && days.value.some((d) => d.civilDate === date.value))
    activeDate.value = date.value
  void focusIn([
    '.bk-min[aria-checked="true"]',
    '.bk-day[aria-checked="true"]',
    '.manual-start__switch',
  ])
}

watch(status, (value) => {
  if (value === 'ready') queueMicrotask(() => (arrived.value = true))
})
</script>

<template>
  <div
    ref="root"
    class="manual-start"
    :class="{ 'manual-start--manual': mode === 'manual' }"
    tabindex="-1"
  >
    <template v-if="mode === 'grid'">
      <p v-if="status === 'idle'" class="manual-start__hint">
        Elige el profesional y el servicio para ver sus horas libres.
      </p>

      <div
        v-else-if="status === 'loading'"
        class="manual-start__skeleton"
        role="status"
        aria-live="polite"
        @animationstart.self="onSkeletonAppear"
      >
        <DiamondLoader label="Cargando las horas libres…" layout="column" />
        <div class="manual-start__skeleton-days" aria-hidden="true">
          <span v-for="i in WINDOW_DAYS" :key="i" class="manual-start__skeleton-day" />
        </div>
        <span
          class="manual-start__skeleton-bar manual-start__skeleton-bar--title"
          aria-hidden="true"
        />
        <span
          class="manual-start__skeleton-bar manual-start__skeleton-bar--strip"
          aria-hidden="true"
        />
        <!-- Un día típico: dos partes del día con cinco horas cada una. -->
        <div v-for="part in 2" :key="part" class="manual-start__skeleton-group" aria-hidden="true">
          <span class="manual-start__skeleton-bar manual-start__skeleton-bar--label" />
          <div v-for="row in 5" :key="row" class="manual-start__skeleton-row">
            <span class="manual-start__skeleton-bar manual-start__skeleton-bar--hour" />
            <span
              v-for="col in 4"
              :key="col"
              class="manual-start__skeleton-bar manual-start__skeleton-bar--min"
            />
          </div>
        </div>
      </div>

      <div v-else-if="status === 'error'" class="manual-start__notice" role="alert">
        <p class="manual-start__notice-text">No pudimos cargar las horas libres.</p>
        <div class="manual-start__actions">
          <BaseButton variant="secondary" @click="retry">Reintentar</BaseButton>
          <BaseButton variant="ghost" @click="useOtherTime">Otra hora</BaseButton>
        </div>
      </div>

      <div v-else-if="status === 'not-found'" class="manual-start__empty" role="alert">
        <span class="manual-start__empty-mark" aria-hidden="true" />
        <p class="manual-start__empty-text">
          <strong class="manual-start__empty-title"
            >Este servicio ya no tiene horas libres aquí.</strong
          >
          Se desactivó o dejó de estar asignado a este profesional, así que no hay horas que
          proponer. Puedes escribir la fecha y la hora a mano.
        </p>
        <div class="manual-start__actions">
          <BaseButton variant="secondary" @click="useOtherTime">Otra hora</BaseButton>
          <BaseButton variant="ghost" @click="retry">Reintentar</BaseButton>
        </div>
      </div>

      <div v-else class="manual-start__picker">
        <DayTimePicker
          v-model:active-date="activeDate"
          :days="days"
          :selected-start="selectedStart"
          :current="props.current"
          :slot-grid-minutes="grid"
          :duration-minutes="duration"
          :timezone="zone"
          selected-label="La hora"
          :disabled="props.disabled"
          :arrive="!arrived"
          :hours-describedby="props.error ? errorId : undefined"
          @select="onSelect"
        >
          <template #notice>
            <p v-if="props.error" :id="errorId" class="manual-start__error" role="alert">
              <span class="manual-start__error-mark" aria-hidden="true" />{{ props.error }}
            </p>
          </template>
          <template #empty="{ day }">
            <div class="manual-start__empty">
              <span class="manual-start__empty-mark" aria-hidden="true" />
              <p class="manual-start__empty-text">
                Sin horas libres el {{ formatCivilDateFull(day.civilDate) }}.
              </p>
              <div class="manual-start__actions">
                <BaseButton
                  v-if="nextDayWithGaps(day.civilDate)"
                  variant="secondary"
                  @click="goTo(nextDayWithGaps(day.civilDate)!.civilDate)"
                >
                  Ver el {{ formatCivilDateFull(nextDayWithGaps(day.civilDate)!.civilDate) }}
                </BaseButton>
              </div>
            </div>
          </template>
        </DayTimePicker>
        <button type="button" class="manual-start__switch" @click="useOtherTime">
          Otra hora<span class="manual-start__switch-hint"> · escribir la fecha y la hora</span>
        </button>
      </div>

      <button
        v-if="status === 'idle'"
        type="button"
        class="manual-start__switch"
        @click="useOtherTime"
      >
        Otra hora<span class="manual-start__switch-hint"> · escribir la fecha y la hora</span>
      </button>
    </template>

    <div v-else class="manual-start__manual">
      <div class="manual-start__row">
        <div class="manual-start__field">
          <label :id="`${dateId}-label`" :for="dateId" class="manual-start__label"
            >{{ props.dateLabel }}<span class="manual-start__sr-only"> (obligatoria)</span
            ><span class="manual-start__required" aria-hidden="true"> *</span></label
          >
          <BaseDatePicker
            :model-value="date || null"
            :trigger-id="dateId"
            :label-id="`${dateId}-label`"
            :today="today"
            :format-value="(value: string) => formatCivilDateShort(value, today)"
            required
            @update:model-value="(value: string) => (date = value)"
          />
        </div>
        <BaseTimePicker v-model="time" :label="props.timeLabel" required />
      </div>
      <p v-if="props.error" :id="errorId" class="manual-start__error" role="alert">
        <span class="manual-start__error-mark" aria-hidden="true" />{{ props.error }}
      </p>
      <button v-if="ready" type="button" class="manual-start__switch" @click="useGrid">
        Ver las horas libres
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Las clases `bk-*` son las del selector de la reserva (bookingV2.css, que llega
   con el módulo público). Aquí se dan sus variables y se visten con la familia del
   panel (DEC-189): sellos rectos, rombo de latón y la hora en serif. */
.manual-start {
  --bk-line: var(--color-border-subtle);
  --bk-ease: var(--motion-easing-standard);
  --bk-spring: var(--motion-easing-standard);

  display: grid;
  gap: 12px;
  min-width: 0;
}

.manual-start__picker {
  display: grid;
  gap: 10px;
  min-width: 0;
  animation: manual-start-in 260ms var(--motion-easing-standard) both;
}

/* Sellos de día: rectos, papel, la cifra en serif. El elegido lleva el borde y
   el rombo de latón encima, como un sello sobre la regla del día. */
.manual-start :deep(.bk-days) {
  margin-top: 6px;
  margin-bottom: 10px;
  padding-top: 8px;
}

.manual-start :deep(.bk-day) {
  position: relative;
  width: 56px;
  height: 88px;
  background-color: var(--color-surface);
  border-color: var(--color-border-subtle);
  border-radius: 2px;
}

.manual-start :deep(.bk-day__number) {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
  line-height: 28px;
}

.manual-start :deep(.bk-day__light),
.manual-start :deep(.bk-day__light span) {
  border-radius: 0;
}

.manual-start :deep(.bk-day[aria-checked='true']) {
  color: var(--color-text-primary);
  background-color: color-mix(in srgb, var(--color-brass-line) 10%, var(--color-surface));
  border-color: var(--color-brass-line);
  box-shadow: inset 0 0 0 1px var(--color-brass-line);
}

.manual-start :deep(.bk-day[aria-checked='true'])::before {
  position: absolute;
  top: -5px;
  left: calc(50% - 4px);
  width: 8px;
  height: 8px;
  content: '';
  background-color: var(--color-brass-line);
  rotate: 45deg;
}

.manual-start :deep(.bk-day[aria-checked='true'] .bk-day__weekday),
.manual-start :deep(.bk-day[aria-checked='true'] .bk-day__month) {
  color: var(--color-brass-text);
}

.manual-start :deep(.bk-day[aria-checked='true'] .bk-day__light) {
  background-color: var(--color-surface-muted);
}

.manual-start :deep(.bk-day[aria-checked='true'] .bk-day__light span) {
  background-color: var(--color-brass-line);
}

.manual-start :deep(.bk-days__nav) {
  border-radius: 2px;
}

/* El foco del teclado, distinto de la elección (que ya es un filete de latón):
   el anillo de dos tonos de los controles del panel (#771). */
.manual-start :deep(.bk-day:focus-visible),
.manual-start :deep(.bk-min:focus-visible),
.manual-start :deep(.bk-min[aria-checked='true']:focus-visible) {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

/* Junto a las flechas, el desvanecido cubre un sello entero: nunca asoma medio
   día debajo de la columna de flechas. */
.manual-start :deep(.bk-days-wrap--before) {
  --bk-fade-before: 64px;
}

.manual-start :deep(.bk-days-wrap--after) {
  --bk-fade-after: 64px;
}

/* Los últimos 24 px antes de las flechas quedan del todo transparentes. */
.manual-start :deep(.bk-days-wrap--after .bk-days) {
  mask-image: linear-gradient(
    90deg,
    transparent 0,
    #000 var(--bk-fade-before),
    #000 calc(100% - 88px),
    transparent calc(100% - 24px)
  );
}

/* Las partes del día sin bloque de color: en el panel se leen como la libreta,
   con un filete de latón y el rombo del cielo delante del rótulo. */
.manual-start :deep(.bk-hours) {
  gap: 4px;
}

.manual-start :deep(.bk-hours__group) {
  padding: 10px 0 6px;
  background: none;
  border-top: 1px solid color-mix(in srgb, var(--color-brass-line) 55%, transparent);
  border-radius: 0;
}

.manual-start :deep(.bk-hours__label) {
  margin-bottom: 6px;
  color: var(--color-brass-text);
}

/* La hora en punto en serif, como en la libreta de turnos. */
.manual-start :deep(.bk-hrow__number) {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 400;
  letter-spacing: 0;
}

/* Los minutos: rectos. La elegida pasa a latón con su rombo, sin crecer. */
.manual-start :deep(.bk-min) {
  border-radius: 2px;
}

.manual-start :deep(.bk-min[aria-checked='true']) {
  color: var(--color-brass-text);
  background-color: color-mix(in srgb, var(--color-brass-line) 16%, var(--color-surface));
  border-color: var(--color-brass-line);
  box-shadow: inset 0 0 0 1px var(--color-brass-line);
}

.manual-start__hint,
.manual-start__notice-text,
.manual-start__empty-text {
  margin: 0;
  color: var(--color-text-secondary);
}

.manual-start__notice,
.manual-start__empty {
  display: grid;
  gap: 12px;
  justify-items: start;
  padding: 16px 0 4px;
}

/* El 404 de la lectura: la frase que dice qué pasó, en la serif del panel. */
.manual-start__empty-title {
  display: block;
  margin-bottom: 4px;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 400;
  line-height: 1.2;
  color: var(--color-text-primary);
}

.manual-start__empty-mark {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--color-brass-line);
  rotate: 45deg;
}

.manual-start__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.manual-start__error {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin: 0 0 12px;
  padding: 10px 12px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  line-height: 20px;
  color: var(--color-danger-text);
  background-color: color-mix(in srgb, var(--color-danger-text) 8%, var(--color-surface));
  border-left: 2px solid var(--color-danger-text);
  border-radius: 2px;
}

.manual-start__manual .manual-start__error {
  margin: 0;
}

.manual-start__error-mark {
  flex: none;
  width: 7px;
  height: 7px;
  background-color: currentcolor;
  translate: 0 -1px;
  rotate: 45deg;
}

/* «Otra hora»: un enlace de texto con su objetivo táctil de 44 px (DEC-039). */
.manual-start__switch {
  justify-self: start;
  min-height: 44px;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--color-brass-text);
  cursor: pointer;
  background: none;
  border: 0;
  text-decoration: underline;
  text-decoration-color: var(--color-brass-line);
  text-underline-offset: 4px;
}

.manual-start__switch-hint {
  font-weight: 400;
  color: var(--color-text-secondary);
}

.manual-start__manual {
  display: grid;
  gap: 10px;
  animation: manual-start-in 200ms var(--motion-easing-standard) both;
}

.manual-start__row {
  display: grid;
  gap: 12px;
  align-items: start;
}

/* El rótulo de la fecha, igual al de BaseTimePicker que va a su lado. */
.manual-start__field {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.manual-start__label {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.manual-start__required {
  color: var(--color-danger-on-strong);
}

@media (min-width: 640px) {
  .manual-start__row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Esqueleto con la forma real: la tira de días, el título, la franja y tres
   filas de horas, para que la llegada no empuje nada. */
.manual-start__skeleton {
  position: relative;
  display: grid;
  gap: 12px;
  min-width: 0;
  overflow: hidden;
  /* Todo el esqueleto asoma junto a los 300 ms (LOADER_APPEAR_MS), un solo
     retardo; el cargador de dentro no suma el suyo (#843, CA-7). */
  animation: manual-start-skeleton-in 200ms ease-out 300ms backwards;
}

.manual-start__skeleton :deep(.diamond-loader) {
  animation: none;
}

.manual-start:focus {
  outline: none;
}

.manual-start:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 4px;
}

@keyframes manual-start-skeleton-in {
  from {
    opacity: 0;
  }
}

.manual-start__skeleton-group {
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--color-brass-line) 35%, transparent);
}

.manual-start__skeleton-bar--label {
  width: 72px;
  height: 14px;
  margin-bottom: 6px;
}

.manual-start__skeleton-days {
  display: flex;
  gap: 8px;
  padding-top: 14px;
  padding-bottom: 14px;
  overflow: hidden;
}

.manual-start__skeleton-day,
.manual-start__skeleton-bar {
  display: block;
  flex: none;
  background-color: color-mix(in srgb, var(--color-text-primary) 9%, transparent);
  border-radius: 2px;
  animation: manual-start-pulse 1400ms ease-in-out infinite;
}

.manual-start__skeleton-day {
  width: 56px;
  height: 88px;
}

.manual-start__skeleton-bar--title {
  width: 220px;
  height: 24px;
}

.manual-start__skeleton-bar--strip {
  width: 100%;
  height: 56px;
  margin-bottom: 12px;
}

.manual-start__skeleton-row {
  display: grid;
  grid-template-columns: 3.25rem repeat(4, minmax(44px, 64px));
  gap: 6px;
  align-items: center;
}

.manual-start__skeleton-bar--hour {
  width: 28px;
  height: 28px;
}

.manual-start__skeleton-bar--min {
  height: 44px;
}

.manual-start__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@keyframes manual-start-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes manual-start-pulse {
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .manual-start__picker,
  .manual-start__manual {
    animation: none;
  }

  .manual-start__skeleton-day,
  .manual-start__skeleton-bar {
    animation: none;
    opacity: 0.8;
  }
}
</style>
