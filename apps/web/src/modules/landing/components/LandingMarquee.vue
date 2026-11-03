<script setup lang="ts">
// Cinta de palabras entre el hero y el asistente: lo que NAVA ordena, en la
// serif editorial y a contraluz. Es ornamento (la información está en el
// texto de las secciones), así que va oculta a las tecnologías de apoyo y se
// detiene con `prefers-reduced-motion`.
const words = [
  'Agenda',
  'Reservas',
  'Equipo',
  'Horarios',
  'Recordatorios',
  'Reseñas',
  'Asistente de IA',
]
</script>

<template>
  <div class="mq" aria-hidden="true">
    <div class="mq__track">
      <span v-for="n in 4" :key="n" class="mq__group">
        <span v-for="w in words" :key="`${n}-${w}`" class="mq__word">{{ w }}<i></i></span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.mq {
  overflow: hidden;
  padding: 26px 0;
  border-block: 1px solid var(--ln-line);
  background: color-mix(in srgb, var(--color-field-strong) 55%, transparent);
}

.mq__track {
  display: flex;
  width: max-content;
  animation: mq-run 48s linear infinite;
}

.mq__group {
  display: flex;
  flex: none;
}

.mq__word {
  display: inline-flex;
  align-items: center;
  gap: 34px;
  padding-right: 34px;
  font-family: var(--font-display);
  font-size: clamp(40px, 6vw, 80px);
  line-height: 1;
  color: transparent;
  -webkit-text-stroke: 1px var(--ln-line-strong);
  white-space: nowrap;
}

.mq__word:nth-child(3n + 1) {
  color: var(--ln-soft);
  -webkit-text-stroke: 0;
}

.mq__word i {
  width: 9px;
  height: 9px;
  background: var(--ln-brass);
  transform: rotate(45deg);
}

@keyframes mq-run {
  to {
    transform: translateX(-25%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mq__track {
    animation: none;
  }
}
</style>
