<script setup lang="ts">
/**
 * WeekdayPicker - Selector del día de la semana como siete fichas (L M X J V
 * S D). Patrón ARIA "radiogroup": un solo tope de tabulación (la ficha
 * elegida) y flechas para moverse; Inicio/Fin saltan a lunes/domingo. El
 * nombre accesible de cada ficha es el día completo, no la inicial.
 */
import { ref, useId } from 'vue'
import { ISO_WEEKDAYS } from '../model/workingHour'

interface Props {
  modelValue: number
  label: string
  disabled?: boolean
  error?: string
}

const props = withDefaults(defineProps<Props>(), { disabled: false, error: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const uid = useId()
const labelId = `weekday-label-${uid}`
const errorId = `weekday-error-${uid}`
const buttons = ref<HTMLButtonElement[]>([])

// X para miércoles: M ya es martes y la inicial repetida confundiría.
const SHORT: Record<number, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' }

function choose(value: number) {
  if (props.disabled) return
  emit('update:modelValue', value)
}

function onKeydown(event: KeyboardEvent, index: number) {
  const last = ISO_WEEKDAYS.length - 1
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = index === 0 ? last : index - 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = last
  else return
  event.preventDefault()
  choose(ISO_WEEKDAYS[next]!.value)
  buttons.value[next]?.focus()
}
</script>

<template>
  <div class="weekday-picker">
    <span :id="labelId" class="weekday-picker__label">{{ label }}</span>
    <div
      class="weekday-picker__group"
      role="radiogroup"
      :aria-labelledby="labelId"
      :aria-describedby="error ? errorId : undefined"
    >
      <button
        v-for="(day, index) in ISO_WEEKDAYS"
        :key="day.value"
        :ref="(el) => (buttons[index] = el as HTMLButtonElement)"
        type="button"
        role="radio"
        class="weekday-picker__chip"
        :class="{ 'weekday-picker__chip--on': day.value === modelValue }"
        :aria-checked="day.value === modelValue"
        :aria-label="day.label"
        :title="day.label"
        :tabindex="day.value === modelValue ? 0 : -1"
        :disabled="disabled"
        @click="choose(day.value)"
        @keydown="onKeydown($event, index)"
      >
        {{ SHORT[day.value] }}
      </button>
    </div>
    <p v-if="error" :id="errorId" class="weekday-picker__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped src="./weekday-picker.css"></style>
