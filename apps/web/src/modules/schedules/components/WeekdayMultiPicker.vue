<script setup lang="ts">
/**
 * WeekdayMultiPicker - Selector de varios días de la semana como siete fichas
 * (L M X J V S D) que se marcan y desmarcan a voluntad (#495). Cada ficha es un
 * botón de alternancia (`aria-pressed`) con el día completo como nombre
 * accesible; el grupo se recorre con Tab como cualquier fila de botones.
 * Los atajos «Entre semana» y «Todos» evitan marcar de uno en uno el caso común.
 * El valor es la lista de días ISO (1 = lunes … 7 = domingo) en orden.
 */
import { useId } from 'vue'
import { ISO_WEEKDAYS, WEEKDAY_INITIALS } from '../model/workingHour'

interface Props {
  modelValue: number[]
  label: string
  disabled?: boolean
  error?: string
}

const props = withDefaults(defineProps<Props>(), { disabled: false, error: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()

const uid = useId()
const labelId = `weekday-multi-label-${uid}`
const errorId = `weekday-multi-error-${uid}`

const WEEKDAYS = [1, 2, 3, 4, 5]
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]

function set(next: number[]) {
  if (props.disabled) return
  emit(
    'update:modelValue',
    [...next].sort((a, b) => a - b),
  )
}

function toggle(value: number) {
  set(
    props.modelValue.includes(value)
      ? props.modelValue.filter((day) => day !== value)
      : [...props.modelValue, value],
  )
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((day) => b.includes(day))
}
</script>

<template>
  <div class="weekday-picker">
    <span :id="labelId" class="weekday-picker__label">{{ label }}</span>
    <div
      class="weekday-picker__group"
      role="group"
      :aria-labelledby="labelId"
      :aria-describedby="error ? errorId : undefined"
    >
      <button
        v-for="day in ISO_WEEKDAYS"
        :key="day.value"
        type="button"
        class="weekday-picker__chip"
        :class="{ 'weekday-picker__chip--on': modelValue.includes(day.value) }"
        :aria-pressed="modelValue.includes(day.value)"
        :aria-label="day.label"
        :title="day.label"
        :disabled="disabled"
        @click="toggle(day.value)"
      >
        {{ WEEKDAY_INITIALS[day.value] }}
      </button>
    </div>
    <div class="weekday-picker__quick">
      <button
        type="button"
        class="weekday-picker__quick-button"
        :disabled="disabled || sameDays(modelValue, WEEKDAYS)"
        @click="set(WEEKDAYS)"
      >
        Entre semana
      </button>
      <button
        type="button"
        class="weekday-picker__quick-button"
        :disabled="disabled || sameDays(modelValue, ALL_DAYS)"
        @click="set(ALL_DAYS)"
      >
        Todos
      </button>
      <button
        type="button"
        class="weekday-picker__quick-button"
        :disabled="disabled || modelValue.length === 0"
        @click="set([])"
      >
        Limpiar
      </button>
    </div>
    <p v-if="error" :id="errorId" class="weekday-picker__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped src="./weekday-picker.css"></style>
