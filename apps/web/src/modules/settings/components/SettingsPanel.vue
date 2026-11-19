<script setup lang="ts">
// Sección numerada de Configuración (DEC-110) en el lenguaje v2 (DEC-188):
// tarjeta sobre la superficie con borde sutil, título en tipo oración y el
// número como orientación en texto secundario (sin acento). El encabezado deja
// claro DÓNDE vale lo que se cambia (este dispositivo o todo el negocio) y si
// aplica al instante o necesita guardarse.
defineProps<{
  id: string
  number: string
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
      <span class="settings-panel__number" aria-hidden="true">{{ number }}</span>
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
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.settings-panel:focus-within {
  z-index: 2;
}

.settings-panel__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 24px 16px;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

.settings-panel__number {
  flex: 0 0 auto;
  min-width: 2ch;
  font-size: 13px;
  font-weight: 500;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

.settings-panel__heading {
  min-width: 0;
  flex: 1;
}

.settings-panel__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  color: var(--color-text-primary);
}

.settings-panel__description {
  margin: 4px 0 0;
  max-width: 56ch;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  color: var(--color-text-secondary);
}

/* Alcance en tipo oración y texto secundario: la palabra lo dice, sin marca. */
.settings-panel__scope {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
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
    font-size: 18px;
    line-height: 26px;
  }

  .settings-panel__number {
    line-height: 26px;
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
