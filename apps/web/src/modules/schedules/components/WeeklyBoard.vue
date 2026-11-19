<script setup lang="ts">
/**
 * WeeklyBoard - La jornada semanal como un tablero: siete días, cada uno con
 * su pista horaria (barras en tinta suave sobre una regla común) y, debajo, la lista
 * real de tramos con sus acciones. Los siete días siempre aparecen, con o sin
 * tramos (CA-040-01). El tablero no conoce la API: quien lo monta recibe los
 * eventos `add`/`edit`/`remove` y decide qué hacer (mismo contrato de estado
 * que la lista de antes: solo una respuesta exitosa cambia una fila).
 */
import { computed, ref } from 'vue'
import { BaseButton } from '@/shared/ui'
import { endLabel, formatHours, scaleTicks, type BoardScale } from '../model/weekBoard'
import type { WorkingHour } from '../model/workingHour'
import DayTrack from './DayTrack.vue'

interface BoardDay {
  value: number
  label: string
  items: WorkingHour[]
}

interface Props {
  days: readonly BoardDay[]
  scale: BoardScale
  /** Día ISO vigente en el negocio, o null si su zona no se conoce. */
  todayIsoWeekday: number | null
  /** Minuto del día vigente en el negocio, para el marcador "ahora". */
  nowMinute: number | null
  pendingDeleteIds: ReadonlySet<string>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  add: [isoWeekday: number]
  edit: [workingHour: WorkingHour]
  remove: [workingHour: WorkingHour]
}>()

const ticks = computed(() => scaleTicks(props.scale))
const activeId = ref<string | null>(null)

function dayMinutes(day: BoardDay): number {
  return day.items.reduce((sum, item) => sum + item.durationMinutes, 0)
}

function countLabel(day: BoardDay): string {
  return day.items.length === 1 ? '1 tramo' : `${day.items.length} tramos`
}
</script>

<template>
  <div class="week-board">
    <div class="week-board__axis" aria-hidden="true">
      <div class="week-board__axis-scale">
        <span
          v-for="tick in ticks"
          :key="tick.minute"
          class="week-board__tick"
          :style="{ left: `${tick.percent}%` }"
          >{{ tick.label }}</span
        >
      </div>
    </div>

    <section
      v-for="day in days"
      :key="day.value"
      class="week-board__day"
      :class="{
        'week-board__day--today': day.value === todayIsoWeekday,
        'week-board__day--free': day.items.length === 0,
      }"
      :aria-labelledby="`schedules-day-${day.value}-title`"
    >
      <header class="week-board__day-header">
        <h2 :id="`schedules-day-${day.value}-title`" class="week-board__day-title">
          {{ day.label }}
        </h2>
        <span v-if="day.value === todayIsoWeekday" class="week-board__today">Hoy</span>
        <span class="week-board__day-count">
          <template v-if="day.items.length === 0">Día libre</template>
          <template v-else>
            {{ countLabel(day)
            }}<span class="week-board__day-hours">{{ formatHours(dayMinutes(day)) }}</span>
          </template>
        </span>
      </header>

      <div class="week-board__body">
        <DayTrack
          :segments="day.items"
          :scale="scale"
          :active-id="activeId"
          :now-minute="day.value === todayIsoWeekday ? nowMinute : null"
        />

        <div class="week-board__line">
          <p v-if="day.items.length === 0" class="week-board__empty">Sin tramos.</p>

          <ul v-else class="week-board__list" :aria-label="`Tramos del ${day.label}`">
            <li
              v-for="wh in day.items"
              :key="wh.id"
              class="week-board__chip"
              @mouseenter="activeId = wh.id"
              @mouseleave="activeId = null"
              @focusin="activeId = wh.id"
              @focusout="activeId = null"
            >
              <span class="week-board__chip-text">
                <span class="week-board__chip-time">
                  {{ wh.startsTime }} · {{ wh.durationMinutes }} min
                </span>
                <span class="week-board__chip-until">
                  hasta {{ endLabel(wh.startsTime, wh.durationMinutes) }}
                </span>
              </span>
              <div class="week-board__chip-actions">
                <BaseButton
                  type="button"
                  variant="secondary"
                  :aria-label="`Editar tramo de ${day.label} a las ${wh.startsTime}`"
                  @click="emit('edit', wh)"
                >
                  Editar
                </BaseButton>
                <BaseButton
                  type="button"
                  variant="secondary"
                  class="week-board__remove"
                  :loading="pendingDeleteIds.has(wh.id)"
                  :disabled="pendingDeleteIds.has(wh.id)"
                  :aria-label="`Retirar tramo de ${day.label} a las ${wh.startsTime}`"
                  @click="emit('remove', wh)"
                >
                  Retirar
                </BaseButton>
              </div>
            </li>
          </ul>

          <button
            type="button"
            class="week-board__add"
            :aria-label="`Agregar un tramo el ${day.label}`"
            :title="`Agregar un tramo el ${day.label}`"
            @click="emit('add', day.value)"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Tablero v2 (DEC-188): tarjeta sobre la superficie con borde sutil. El acento
   del negocio no aparece aquí; «hoy» y «ahora» van en Sol, como en la agenda. */
.week-board {
  --track-height: 14px;

  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

/* Regla horaria: sus etiquetas quedan sobre la columna de pistas, alineadas
   con las líneas de hora de cada día. */
.week-board__axis {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  flex: none;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 18px;
  height: 30px;
  padding: 0 18px;
  align-items: end;
  background-color: var(--color-surface);
}

.week-board__axis::before {
  content: '';
}

.week-board__axis-scale {
  position: relative;
  height: 20px;
}

.week-board__tick {
  position: absolute;
  bottom: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  transform: translateX(-50%);
}

.week-board__tick::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  width: 1px;
  height: 4px;
  background-color: var(--color-border-control);
}

.week-board__day {
  position: relative;
  display: grid;
  flex: 1 0 auto;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 18px;
  padding: 7px 18px;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Hoy: filete de Sol a la izquierda, el mismo color que «Ahora» en la agenda. */
.week-board__day--today::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background-color: var(--color-sun);
}

@media (hover: hover) {
  .week-board__day:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  }
}

.week-board__day-header {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: baseline;
  gap: 2px 8px;
  min-width: 0;
}

.week-board__day-title {
  margin: 0;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: var(--font-size-title-item);
  font-weight: 600;
  line-height: 26px;
}

/* «Hoy»: la misma pastilla de Sol que la etiqueta «Ahora» de la agenda. */
.week-board__today {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--color-on-sun);
  background-color: var(--color-sun);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  border-radius: var(--radius-pill);
}

.week-board__day-count {
  flex-basis: 100%;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: var(--font-size-caption-line);
}

.week-board__day-hours {
  margin-left: 6px;
  padding-left: 6px;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  border-left: var(--border-width-normal) solid var(--color-border-subtle);
}

.week-board__day--free .week-board__day-title {
  color: var(--color-text-secondary);
}

.week-board__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
}

.week-board__line {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.week-board__list {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* Tramo: ficha v2 con borde sutil; al señalarla el borde pasa a control. */
.week-board__chip {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 3px 4px 3px 14px;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (hover: hover) {
  .week-board__chip:hover {
    border-color: var(--color-border-control);
  }
}

.week-board__chip:focus-within {
  border-color: var(--color-border-control);
}

/* Hora y fin apilados: el tramo ocupa poco ancho y caben varios por día. */
.week-board__chip-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.15;
}

.week-board__chip-time {
  color: var(--color-text-primary);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.week-board__chip-until {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.week-board__chip-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}

/* Acciones de fila: BaseButton secundario neutro (v2), solo más compacto. */
.week-board__chip-actions :deep(.base-button) {
  height: 32px;
  padding-inline: 12px;
  font-size: var(--font-size-body-sm);
}

/* Retirar es la acción destructiva: se tiñe de peligro solo al señalarla. */
.week-board__chip-actions
  :deep(
    .week-board__remove.base-button--secondary:hover:not(:disabled):not(.base-button--loading)
  ) {
  color: var(--color-danger-on-strong);
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-danger-on-strong) 55%, transparent);
}

.week-board__empty {
  display: flex;
  align-items: center;
  min-height: 42px;
  padding: 0 14px;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  background-color: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  border-radius: var(--radius-md);
}

/* "+" por día: botón neutro de contorno, como el secundario v2. */
.week-board__add {
  display: inline-grid;
  place-items: center;
  width: 42px;
  height: 42px;
  padding: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-title-item);
  line-height: 1;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (hover: hover) {
  .week-board__add:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
    border-color: var(--color-text-primary);
  }
}

.week-board__add:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

@media (max-width: 760px) {
  .week-board__axis {
    position: static;
    grid-template-columns: minmax(0, 1fr);
    padding: 0 12px;
  }

  .week-board__axis::before {
    display: none;
  }

  .week-board__day {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 14px 12px;
  }

  .week-board__day-header {
    flex-wrap: nowrap;
    justify-content: flex-start;
  }

  .week-board__day-title {
    font-size: var(--font-size-title-item);
  }

  .week-board__day-count {
    flex: 1;
    flex-basis: auto;
    text-align: right;
  }

  .week-board__chip {
    flex: 1 1 100%;
    flex-wrap: wrap;
    row-gap: 4px;
  }

  .week-board__chip-actions {
    margin-left: auto;
  }

  .week-board__line {
    gap: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .week-board__day,
  .week-board__chip,
  .week-board__add {
    transition: none;
  }
}
</style>
