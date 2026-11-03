<script setup lang="ts">
// Guía de lectura propia de la landing: un hilo fino de latón en el borde
// derecho con un rombo por sección, el progreso rellenando el hilo y, arriba,
// una línea de progreso a todo el ancho. Sustituye a «ver dónde voy» con la
// barra gris del navegador. Cada rombo es un enlace a su sección y muestra su
// nombre al pasar el cursor o enfocarlo. En pantallas estrechas solo queda la
// línea superior.

defineProps<{
  progress: number
  active: string
  sections: readonly { id: string; label: string }[]
}>()
</script>

<template>
  <div class="rail">
    <div class="rail__top" aria-hidden="true">
      <i :style="{ transform: `scaleX(${progress})` }"></i>
    </div>

    <nav class="rail__nav" aria-label="Recorrido de la página">
      <span class="rail__thread" aria-hidden="true">
        <i :style="{ transform: `scaleY(${progress})` }"></i>
      </span>
      <a
        v-for="section in sections"
        :key="section.id"
        class="rail__stop"
        :class="{ 'rail__stop--on': active === section.id }"
        :href="`#${section.id}`"
        :aria-current="active === section.id ? 'location' : undefined"
      >
        <span class="rail__label">{{ section.label }}</span>
        <i class="rail__dot" aria-hidden="true"></i>
      </a>
    </nav>
  </div>
</template>

<style scoped>
.rail__top {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 40;
  height: 3px;
  pointer-events: none;
}

.rail__top i {
  display: block;
  height: 100%;
  background: linear-gradient(
    to right,
    var(--ln-brass),
    color-mix(in srgb, var(--ln-brass) 60%, var(--color-on-strong))
  );
  transform-origin: left;
  box-shadow: 0 0 12px var(--ln-brass);
}

.rail__nav {
  position: fixed;
  top: 50%;
  right: 28px;
  z-index: 15;
  display: none;
  flex-direction: column;
  gap: 26px;
  transform: translateY(-50%);
}

.rail__thread {
  position: absolute;
  top: 8px;
  bottom: 8px;
  right: 7px;
  width: 1px;
  background: var(--ln-line-strong);
}

.rail__thread i {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--ln-brass);
  transform-origin: top;
}

.rail__stop {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  min-height: 16px;
  text-decoration: none;
}

.rail__dot {
  position: relative;
  width: 9px;
  height: 9px;
  margin-right: 3px;
  background: var(--ln-ink);
  border: 1px solid var(--ln-brass);
  transform: rotate(45deg);
  transition:
    background-color 300ms ease,
    transform 400ms var(--motion-ease-spring);
}

.rail__stop--on .rail__dot {
  background: var(--ln-brass);
  transform: rotate(45deg) scale(1.5);
}

.rail__label {
  padding: 5px 12px;
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-pill);
  background: var(--ln-ink);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
  color: var(--ln-soft);
  opacity: 0;
  transform: translateX(8px);
  transition:
    opacity 220ms ease,
    transform 260ms var(--motion-ease-out);
  pointer-events: none;
}

.rail__stop:hover .rail__label,
.rail__stop:focus-visible .rail__label,
.rail__stop--on .rail__label {
  opacity: 1;
  transform: none;
}

.rail__stop--on .rail__label {
  border-color: var(--ln-brass-line);
  color: var(--ln-brass);
}

@media (min-width: 1180px) {
  .rail__nav {
    display: flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rail__dot,
  .rail__label {
    transition: none;
  }
}
</style>
