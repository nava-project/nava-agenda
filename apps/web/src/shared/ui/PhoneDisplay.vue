<script setup lang="ts">
// Teléfono de solo lectura con las mismas tres partes que el campo de captura
// (PhoneField): bandera, prefijo y número, cada una separada. El valor llega en
// E.164 (`+573001234567`) tal como lo guarda el API. Si el prefijo no es de la
// lista se muestra el valor tal cual. La bandera es decorativa: el país ya lo
// dice el prefijo, y un lector de pantalla lee «+57 300 123 4567».
import { computed } from 'vue'
import { phoneParts } from '../model/phoneCountries'

const props = defineProps<{ value: string }>()

const parts = computed(() => phoneParts(props.value))
</script>

<template>
  <span v-if="parts" class="phone-display" :data-country="parts.iso">
    <span class="phone-display__flag" aria-hidden="true">{{ parts.flag }}</span>
    <span class="phone-display__dial">{{ parts.dial }}</span>
    <span class="phone-display__number">{{ parts.national }}</span>
  </span>
  <span v-else class="phone-display">{{ value }}</span>
</template>

<style scoped>
.phone-display {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}

.phone-display__flag {
  font-size: 1.15em;
  line-height: 1;
  /* La bandera se alinea con la línea base del número sin subirlo. */
  align-self: center;
}

/* El prefijo es una pieza aparte: un trazo tenue lo separa del número. */
.phone-display__dial {
  padding-right: var(--space-2);
  font-weight: 500;
  border-right: 1px solid color-mix(in srgb, currentcolor 35%, transparent);
}
</style>
