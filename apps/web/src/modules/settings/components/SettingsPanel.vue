<script setup lang="ts">
// Sección de Configuración (DEC-110) con la esencia de la familia (#759): papel
// con filete de latón, título en Instrument Serif, el alcance como rótulo de
// latón con su rombo (lleno para el negocio, hueco para este dispositivo) y el
// troquel punteado bajo el encabezado, como en la tarjeta de turno. Sin número: las
// secciones son ajustes independientes, no pasos de un orden. El encabezado deja
// claro DÓNDE vale lo que se cambia (este dispositivo o todo el negocio) y si
// aplica al instante o necesita guardarse.
defineProps<{
  id: string
  title: string
  description?: string
  /** `device`: vale en este aparato y se aplica al instante. `shop`: vale para todo el negocio y se guarda. */
  scope?: 'device' | 'shop'
  scopeLabel?: string
}>()
</script>

<template>
  <section :id="id" class="settings-panel" :aria-labelledby="`${id}-title`">
    <header class="settings-panel__header">
      <div class="settings-panel__heading">
        <h2 :id="`${id}-title`" class="settings-panel__title">{{ title }}</h2>
        <p v-if="description" class="settings-panel__description">{{ description }}</p>
      </div>
      <span
        v-if="scope && scopeLabel"
        class="settings-panel__scope"
        :class="`settings-panel__scope--${scope}`"
      >
        {{ scopeLabel }}
      </span>
    </header>
    <div class="settings-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  /* `position` + `z-index` en el foco: el desplegable de la zona horaria debe
     quedar por encima del panel siguiente mientras se usa. */
  position: relative;
  scroll-margin-top: 72px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-brass-line) 32%, var(--color-border-subtle));
  border-radius: 4px;
}

.settings-panel:focus-within {
  z-index: 2;
}

.settings-panel__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 24px 16px;
  border-bottom: var(--border-width-normal) dashed
    color-mix(in srgb, var(--color-brass-line) 60%, transparent);
}

.settings-panel__heading {
  min-width: 0;
  flex: 1;
}

.settings-panel__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 27px;
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

.settings-panel__description {
  margin: 4px 0 0;
  max-width: 56ch;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  color: var(--color-text-secondary);
}

/* Alcance como rótulo de latón: la palabra lo dice y el rombo lo marca (lleno,
   para el negocio; hueco, solo este dispositivo). */
.settings-panel__scope {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
  color: var(--color-brass-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}

.settings-panel__scope::before {
  width: 7px;
  height: 7px;
  content: '';
  background: var(--color-brass-body);
  transform: rotate(45deg);
}

.settings-panel__scope--device::before {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--color-brass-body);
}

.settings-panel__body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 22px 24px 26px;
}

@media (max-width: 640px) {
  .settings-panel__header {
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 16px 16px 14px;
  }

  .settings-panel__title {
    font-size: 23px;
  }

  .settings-panel__scope {
    flex-basis: 100%;
    margin-top: 0;
    white-space: normal;
  }

  .settings-panel__body {
    gap: 20px;
    padding: 18px 16px 20px;
  }
}
</style>
