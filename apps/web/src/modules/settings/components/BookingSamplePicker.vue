<script setup lang="ts">
// Muestra de «Día y hora» (DEC-188): el MISMO selector que usa el cliente en la
// reserva pública (`DayTimePicker`, con su franja del día), pintado con una
// ventana de reserva —la del negocio o la de un profesional— sobre un horario
// fijo de ejemplo (9:00 a. m. a 7:00 p. m., servicio de 30 min; ver
// `previewStarts`). No consulta la API:
// - la rejilla decide los minutos de cada fila (15 → :00 :15 :30 :45);
// - la anticipación mínima apaga lo que queda de hoy antes de esa hora;
// - la ventana máxima decide hasta qué día se puede elegir.
// Es de solo lectura (`inert` y `aria-hidden`): elegir aquí no hace nada. Lo que
// dice en texto (primer horario libre y último día) lo recibe quien la usa por
// el slot, para escribirlo donde corresponda.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DayTimePicker, buildDaylightDays } from '@/modules/public-booking'
import { DAYS_OF_WEEK, formatClock, type OpeningSegment } from '@/shared/model/openingHours'
import { formatCivilDateFull, getCivilDateInTimezone } from '@/shared/time/civilDate'
import {
  PREVIEW_CLOSES_MINUTES,
  PREVIEW_OPENS_MINUTES,
  PREVIEW_SERVICE_MINUTES,
  latestBookableInstant,
  previewStarts,
  type BookingPolicyFormValues,
} from '../model/bookingPolicy'

const props = defineProps<{
  window: Pick<BookingPolicyFormValues, 'minAdvanceMinutes' | 'maxAdvanceDays' | 'slotGridMinutes'>
}>()

// La zona del dispositivo: la muestra se construye en hora local, así que se
// pinta en la misma zona.
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// «Ahora» avanza cada minuto para que la anticipación se lea contra la hora real.
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  tick = setInterval(() => (now.value = new Date()), 60_000)
})
onBeforeUnmount(() => clearInterval(tick))

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const opens = clock(PREVIEW_OPENS_MINUTES)
const closes = clock(PREVIEW_CLOSES_MINUTES)
const openingHours: OpeningSegment[] = DAYS_OF_WEEK.map((dayOfWeek) => ({
  dayOfWeek,
  opens,
  closes,
}))
// En 12 h, como todo lo que lee el dueño: «9:00 a. m. a 7:00 p. m.».
const openingText = `de ${formatClock(opens)} a ${formatClock(closes)}`

const days = computed(() =>
  buildDaylightDays(previewStarts(props.window, now.value), timezone, null),
)
// El primer día con horas libres, como al abrir «Día y hora»: hoy si todavía
// queda algo después de la anticipación; si no, el siguiente.
const activeDate = computed(() => days.value[0]?.civilDate ?? null)

const today = computed(() => getCivilDateInTimezone(timezone, now.value))

const firstText = computed(() => {
  const first = days.value[0]?.slots[0]
  if (!first) return 'ninguno con estos valores'
  const date = days.value[0]!.civilDate
  const when = date === today.value ? 'hoy' : formatCivilDateFull(date)
  return `${when}, ${first.label}`
})

const lastDayText = computed(() => {
  const latest = latestBookableInstant(props.window.maxAdvanceDays, now.value)
  return latest ? formatCivilDateFull(getCivilDateInTimezone(timezone, latest)) : 'sin ventana'
})
</script>

<template>
  <div class="booking-sample">
    <!-- El selector real de la reserva, de solo lectura. -->
    <div class="booking-sample__screen" aria-hidden="true" inert>
      <DayTimePicker
        v-if="activeDate"
        :days="days"
        :active-date="activeDate"
        :selected-start="null"
        :slot-grid-minutes="props.window.slotGridMinutes"
        :duration-minutes="PREVIEW_SERVICE_MINUTES"
        :opening-hours="openingHours"
        :timezone="timezone"
      />
      <p v-else class="booking-sample__empty">Sin horarios con estos valores.</p>
    </div>
    <p class="booking-sample__note">
      Ejemplo con un horario {{ openingText }} y un servicio de {{ PREVIEW_SERVICE_MINUTES }} min.
    </p>
    <slot :first-text="firstText" :last-day-text="lastDayText" />
  </div>
</template>

<style scoped>
.booking-sample {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* Las clases `bk-*` son las de la reserva pública (bookingV2.css, que el módulo
   carga con su API). Aquí solo se dan sus variables, se apaga su entrada
   animada y se recorta la lista de horas: es una muestra, no se desplaza. */
.booking-sample__screen {
  --bk-line: var(--color-border-subtle);
  --bk-ease: var(--motion-easing-standard);
  --bk-spring: var(--motion-easing-standard);

  container-type: inline-size;
  padding: 12px 12px 0;
  overflow: hidden;
  color: var(--color-text-primary);
  background: var(--color-canvas);
  border-radius: var(--radius-md);
  user-select: none;
}

.booking-sample__screen :deep(.bk-days) {
  margin-bottom: var(--space-2);
  overflow: hidden;
}

.booking-sample__screen :deep(.bk-day) {
  width: 56px;
  height: 88px;
}

.booking-sample__screen :deep(.bk-days__nav) {
  display: none;
}

.booking-sample__screen :deep(.bk-day-title) {
  font-size: 15px;
}

.booking-sample__screen :deep(.bk-daytime__strip) {
  margin-bottom: var(--space-3);
}

.booking-sample__screen :deep(.bk-hours) {
  max-height: 232px;
  overflow: hidden;
  animation: none;
  mask-image: linear-gradient(180deg, #000 70%, transparent);
}

/* En un panel estrecho (la ventana por profesional en un teléfono) las cuatro
   columnas de minutos no caben con su tamaño táctil; la muestra no se toca, así
   que se encogen un poco para que se vean enteras en vez de recortarse. */
@container (max-width: 320px) {
  .booking-sample__screen :deep(.bk-hrow) {
    grid-template-columns: 2.25rem 1fr;
  }

  .booking-sample__screen :deep(.bk-hrow__mins) {
    grid-template-columns: repeat(var(--bk-cols, 4), minmax(34px, 1fr));
    gap: 4px;
  }

  .booking-sample__screen :deep(.bk-min) {
    min-height: 36px;
    font-size: 13px;
  }
}

.booking-sample__empty {
  margin: 0 0 12px;
  font-size: var(--font-size-body-sm);
  color: var(--color-text-secondary);
}

.booking-sample__note {
  margin: 0;
  font-size: var(--font-size-caption);
  line-height: 16px;
  color: var(--color-text-secondary);
}
</style>
