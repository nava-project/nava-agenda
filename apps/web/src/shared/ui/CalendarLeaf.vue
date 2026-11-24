<script setup lang="ts">
/**
 * CalendarLeaf · la hoja de calendario de la familia (DEC-189): el mes en una
 * franja de latón y el día en serif, sobre la superficie y con un filete de
 * latón. Es la misma hoja de la tarjeta de turno y del emblema de Google
 * Calendar (#838): una sola fuente para que no se dibujen copias que se
 * separen con el tiempo.
 *
 * Decorativa: quien la usa dice la fecha o el estado en texto; la hoja va
 * `aria-hidden`. El slot `day` sustituye el número cuando todavía no hay fecha
 * (la silueta de la tarjeta en borrador), sin cambiar la medida de la hoja.
 */
interface Props {
  /** Mes abreviado en mayúsculas («NOV»). */
  month?: string
  /** Día del mes. */
  day?: string | number
}

defineProps<Props>()
</script>

<template>
  <span class="calendar-leaf" aria-hidden="true">
    <span class="calendar-leaf__month">{{ month || '\u00a0' }}</span>
    <span class="calendar-leaf__day"
      ><slot name="day">{{ day }}</slot></span
    >
  </span>
</template>

<style scoped>
.calendar-leaf {
  display: block;
  overflow: hidden;
  text-align: center;
  background-color: var(--color-surface);
  border: 1px solid var(--color-brass-line);
  border-radius: 3px;
}

/* La franja va en latón lleno con texto tinta oscura en los dos temas: el latón
   es claro también en Noche, así que el contraste se fija aquí. */
.calendar-leaf__month {
  display: block;
  font-size: 11px;
  font-weight: 700;
  line-height: 22px;
  color: #101b2b;
  letter-spacing: 0.14em;
  background-color: var(--color-brass-body);
}

.calendar-leaf__day {
  display: block;
  font-family: var(--font-display);
  font-size: 38px;
  line-height: 50px;
  color: var(--color-text-primary);
}
</style>
