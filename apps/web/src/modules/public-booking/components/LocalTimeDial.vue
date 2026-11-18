<script setup lang="ts">
// Reloj de línea con la hora local del negocio (entrada pública, HU-090).
// Es decorativo: la hora ya se dice en texto junto a él, así que va `aria-hidden`
// y no añade nada que un lector de pantalla deba repetir. Dibuja la misma
// construcción regla-rombo del divisor NAVA: aro de latón que se traza al entrar,
// rombos en las cuatro horas cardinales y un rombo fijo en el eje de las agujas.
// Las agujas arrancan en las 12 y se asientan en la hora real al montar; con
// movimiento reducido (CSS) aparecen ya en su sitio.
import { computed, onMounted, ref } from 'vue'
import { dialAngles } from '../model/clockDial'

interface Props {
  /** Instante a dibujar; la hora civil la decide `timeZone`. */
  at: Date
  timeZone: string
}
const props = defineProps<Props>()

const angles = computed(() => dialAngles(props.at, props.timeZone))

const settled = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    settled.value = true
  })
})

const hourRotation = computed(() => (settled.value ? (angles.value?.hour ?? 0) : 0))
const minuteRotation = computed(() => (settled.value ? (angles.value?.minute ?? 0) : 0))

// Marcas de minuto: las de hora más largas; las cuatro cardinales las ocupa un rombo.
const ticks = Array.from({ length: 60 }, (_, index) => ({
  angle: index * 6,
  hour: index % 5 === 0,
  cardinal: index % 15 === 0,
}))
</script>

<template>
  <svg v-if="angles" class="pb-dial" viewBox="-60 -60 120 120" aria-hidden="true" focusable="false">
    <circle class="pb-dial__ring" r="56" pathLength="1" />
    <g class="pb-dial__ticks">
      <template v-for="tick in ticks" :key="tick.angle">
        <line
          v-if="!tick.cardinal"
          :class="tick.hour ? 'pb-dial__tick pb-dial__tick--hour' : 'pb-dial__tick'"
          x1="0"
          :y1="tick.hour ? -47 : -51"
          x2="0"
          y2="-53"
          :transform="`rotate(${tick.angle})`"
        />
        <rect
          v-else
          class="pb-dial__lozenge"
          x="-2.4"
          y="-52.4"
          width="4.8"
          height="4.8"
          :transform="`rotate(${tick.angle}) rotate(45 0 -50)`"
        />
      </template>
    </g>
    <line
      class="pb-dial__hand pb-dial__hand--hour"
      x1="0"
      y1="4"
      x2="0"
      y2="-28"
      :style="{ transform: `rotate(${hourRotation}deg)` }"
    />
    <line
      class="pb-dial__hand pb-dial__hand--minute"
      x1="0"
      y1="6"
      x2="0"
      y2="-41"
      :style="{ transform: `rotate(${minuteRotation}deg)` }"
    />
    <rect class="pb-dial__hub" x="-3.2" y="-3.2" width="6.4" height="6.4" transform="rotate(45)" />
  </svg>
</template>
