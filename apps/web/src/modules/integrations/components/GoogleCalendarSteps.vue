<script setup lang="ts">
// Recorrido de tres pasos hasta tener Google Calendar conectado (issue #331). Solo
// presenta el avance: no navega ni decide nada; la pantalla le dice en qué paso va.
// v2 (DEC-188): los pasos no entran animados al cargar; el hecho y el actual se
// marcan en tinta (no en el acento). El filete entre pasos cambia con una
// transición corta cuando avanza el estado, y se queda quieto con
// `prefers-reduced-motion` o `data-motion="reduced"`.
interface Step {
  title: string
  detail: string
}

defineProps<{
  steps: readonly Step[]
  /** Paso en curso, de 1 a `steps.length`; los anteriores se marcan como hechos. */
  current: number
  label: string
}>()
</script>

<template>
  <ol class="gcal-steps" :aria-label="label">
    <li
      v-for="(step, index) in steps"
      :key="step.title"
      class="gcal-step"
      :class="{
        'gcal-step--done': index + 1 < current,
        'gcal-step--current': index + 1 === current,
      }"
      :aria-current="index + 1 === current ? 'step' : undefined"
    >
      <span class="gcal-step__head" aria-hidden="true">
        <span class="gcal-step__mark">
          <svg v-if="index + 1 < current" viewBox="0 0 16 16" width="14" height="14">
            <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" />
          </svg>
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span v-if="index < steps.length - 1" class="gcal-step__link">
          <span class="gcal-step__fill" />
        </span>
      </span>
      <span class="gcal-step__copy">
        <span class="gcal-step__title">{{ step.title }}</span>
        <span class="gcal-step__detail">{{ step.detail }}</span>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.gcal-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.gcal-step {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-right: 12px;
  color: var(--color-text-secondary);
  transition: color var(--motion-duration-base) var(--motion-easing-standard);
}

.gcal-step:last-child {
  padding-right: 0;
}

.gcal-step--current,
.gcal-step--done {
  color: var(--color-text-primary);
}

.gcal-step__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gcal-step__mark {
  position: relative;
  z-index: 1;
  display: grid;
  flex: 0 0 auto;
  place-content: center;
  width: 30px;
  height: 30px;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: inherit;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: 50%;
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard),
    color var(--motion-duration-base) var(--motion-easing-standard);
}

.gcal-step__mark svg path {
  stroke: currentcolor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Paso actual: contorno de tinta de 2px; hecho: lleno de tinta. */
.gcal-step--current .gcal-step__mark {
  border-color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px var(--color-text-primary);
  color: var(--color-text-primary);
}

.gcal-step--done .gcal-step__mark {
  background: var(--color-text-primary);
  border-color: var(--color-text-primary);
  color: var(--color-surface);
}

.gcal-step__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gcal-step__title {
  font-weight: 600;
  line-height: 1.25;
}

.gcal-step__detail {
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

/* Filete entre pasos: parte de la marca y se rellena al completar el paso. */
.gcal-step__link {
  flex: 1;
  height: 2px;
  overflow: hidden;
  background: var(--color-border-subtle);
}

.gcal-step__fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--color-text-primary);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

.gcal-step--done .gcal-step__fill {
  transform: scaleX(1);
}

/* En pantallas angostas los pasos se apilan: la marca a la izquierda y el filete vertical. */
@media (max-width: 640px) {
  .gcal-steps {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .gcal-step {
    position: relative;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    column-gap: 12px;
    padding: 0;
  }

  .gcal-step__head {
    flex-direction: column;
    align-items: center;
    align-self: stretch;
  }

  .gcal-step__link {
    flex: 1;
    width: 2px;
    height: auto;
    margin-block: 4px;
  }

  .gcal-step__fill {
    transform: scaleY(0);
    transform-origin: top;
  }

  .gcal-step--done .gcal-step__fill {
    transform: scaleY(1);
  }

  /* El relleno inferior alarga la fila y, con ella, el filete vertical entre marcas. */
  .gcal-step__copy {
    padding: 4px 0 20px;
  }

  .gcal-step:last-child .gcal-step__copy {
    padding-bottom: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gcal-step,
  .gcal-step__mark,
  .gcal-step__fill {
    transition: none;
  }
}
</style>

<style>
:root[data-motion='reduced'] .gcal-step,
:root[data-motion='reduced'] .gcal-step__mark,
:root[data-motion='reduced'] .gcal-step__fill {
  transition: none;
}
</style>
