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
  civilNow,
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

const status = computed(() =>
  props.today ? openingStatus(props.today, props.timeZone, props.at) : null,
)

// «· hoy» es el día de la fecha civil del negocio en el reloj de la página, no el
// `today` del servidor: pasada la medianoche con la página abierta, la marca pasa
// al día nuevo (#850). El 12:00 UTC de la fecha civil cae en ese mismo día.
const currentDay = computed(() => {
  const { date } = civilNow(props.timeZone, props.at)
  return DAYS_OF_WEEK[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]
})

// La fila de hoy dice el horario de hoy, no el de la semana: en un festivo con el
// local cerrado dice «Cerrado», como el estado de arriba (#811). Si `today` ya no
// es hoy (la página quedó abierta), la fila vuelve al horario de la semana.
const week = computed(() => {
  const byDay = segmentsByDay(props.openingHours)
  const todayHours = status.value && props.today ? props.today.hours : null
  return DAYS_OF_WEEK.map((day) => {
    const isToday = currentDay.value === day
    const segments = isToday && todayHours ? todayHours : byDay[day]
    return { day, label: DAY_LABELS[day], hours: segments.map(formatInterval), isToday }
  })
})

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
