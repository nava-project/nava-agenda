<script setup lang="ts">
// Horario de atención del local en la entrada de la reserva (HU-107, DEC-182):
// primero el estado de ahora («Abierto · cierra a las 7:00 p. m.»), luego la
// semana con el día de hoy marcado. Solo se pinta con horario configurado; sin
// él la entrada no muestra nada, ni un «cerrado» que no sabemos.
//
// El estado de ahora sale de `today` (que ya trae el festivo aplicado) y de la
// hora civil del negocio, nunca de la del dispositivo (RN-DIS-07).
import { computed } from 'vue'
import {
  DAY_LABELS,
  DAYS_OF_WEEK,
  formatClock,
  formatInterval,
  openingStatus,
  segmentsByDay,
  type OpeningSegment,
  type OpeningToday,
} from '@/shared/model/openingHours'

const props = defineProps<{
  openingHours: OpeningSegment[]
  today: OpeningToday | null
  closedOnHolidays: boolean
  timeZone: string
  /** Reloj de la página: el estado se recalcula cuando avanza. */
  at: Date
}>()

const week = computed(() => {
  const byDay = segmentsByDay(props.openingHours)
  return DAYS_OF_WEEK.map((day) => ({
    day,
    label: DAY_LABELS[day],
    hours: byDay[day].map(formatInterval),
    isToday: props.today?.dayOfWeek === day,
  }))
})

const status = computed(() =>
  props.today ? openingStatus(props.today, props.timeZone, props.at) : null,
)

const statusText = computed(() => {
  const s = status.value
  if (!s) return ''
  switch (s.state) {
    case 'open':
      return s.closes === '24:00'
        ? 'Abierto · hasta la medianoche'
        : `Abierto · cierra a las ${formatClock(s.closes)}`
    case 'opens-later':
      return `Cerrado · abre hoy a las ${formatClock(s.opens)}`
    case 'closed-now':
      return 'Cerrado por hoy'
    case 'closed-today':
      return props.today?.holiday ? `Hoy cerrado · ${props.today.holiday}` : 'Hoy cerrado'
  }
  return ''
})
</script>

<template>
  <section v-if="openingHours.length > 0" class="pb-hours" aria-labelledby="pb-hours-title">
    <h2 id="pb-hours-title" class="pb-hours__title">Horario</h2>

    <p
      v-if="status"
      class="pb-hours__now"
      :class="{ 'pb-hours__now--open': status.state === 'open' }"
    >
      <span class="pb-hours__mark" aria-hidden="true"></span>
      {{ statusText }}
    </p>

    <dl class="pb-hours__week">
      <div
        v-for="d in week"
        :key="d.day"
        class="pb-hours__row"
        :class="{ 'pb-hours__row--today': d.isToday }"
      >
        <dt>{{ d.label }}<span v-if="d.isToday" class="pb-hours__today"> · hoy</span></dt>
        <dd>
          <template v-if="d.hours.length === 0">Cerrado</template>
          <template v-else>
            <span v-for="h in d.hours" :key="h" class="pb-hours__interval">{{ h }}</span>
          </template>
        </dd>
      </div>
    </dl>

    <p v-if="closedOnHolidays" class="pb-hours__note">Cerramos los festivos.</p>
  </section>
</template>
