<script setup lang="ts">
/**
 * HomeLocationField - Dónde atiende el profesional en un turno a domicilio (DEC-138, DEC-155,
 * HU-103). Marcar el punto es obligatorio y hay dos formas equivalentes: el dispositivo lo
 * detecta (se intenta al abrir y el botón «Usar mi ubicación» lo repite) o la persona mueve el
 * mapa hasta que el pin queda sobre su puerta. Aparte, un campo opcional para lo que el mapa
 * no sabe: torre, apartamento, casa o una referencia. El valor sigue siendo un punto con su
 * texto (`PlaceSelection`), que el servidor guarda tal cual (`appointment_home_service_ck`);
 * los detalles se anteponen a ese texto al enviar (ver `composeHomeAddress`).
 */
import { BaseInput, LocationPicker } from '@/shared/ui'
import type { LatLng } from '@/shared/model/mapPicker'
import type { PlaceSelection } from '@/shared/model/placesAutocomplete'
import { HOME_DETAILS_MAX_LENGTH } from '../model/homeAddress'

defineProps<{
  modelValue: PlaceSelection | null
  /** Detalles que escribe la persona (torre, apartamento, referencia). */
  details: string
  /** Dónde abrir el mapa si no se puede detectar la posición (la del negocio, si la tiene). */
  start?: LatLng | null
  error?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: PlaceSelection | null]
  'update:details': [value: string]
}>()
</script>

<template>
  <div class="home-location">
    <LocationPicker
      :model-value="modelValue"
      :start="start"
      label="Tu ubicación"
      auto-locate
      :error="error"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <BaseInput
      :model-value="details"
      type="text"
      label="Detalles de la dirección (opcional)"
      hint="Torre, apartamento, casa o una referencia para encontrarte."
      autocomplete="off"
      :maxlength="HOME_DETAILS_MAX_LENGTH"
      @update:model-value="emit('update:details', String($event))"
    />
  </div>
</template>

<style scoped>
.home-location {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
