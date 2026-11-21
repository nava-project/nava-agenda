<script setup lang="ts">
// Índice de secciones de Configuración (DEC-110): en escritorio una columna
// fija sobre un riel; la sección visible lleva el rombo de latón sobre el riel y
// el hover solo enciende el tramo, sin rombo (#759); en
// pantallas angostas, una fila de pestañas que se desplaza en horizontal. Es
// navegación por anclas (enlaces reales), no pestañas que oculten contenido:
// toda la información sigue en la página. Sin numerales: las secciones son
// ajustes independientes, no una secuencia.
export interface SettingsIndexItem {
  id: string
  label: string
}

defineProps<{ items: readonly SettingsIndexItem[]; active: string }>()
const emit = defineEmits<{ select: [id: string] }>()

function onClick(event: MouseEvent, id: string) {
  event.preventDefault()
  emit('select', id)
}
</script>

<template>
  <nav class="settings-index" aria-label="Secciones de configuración">
    <ol class="settings-index__list">
      <li v-for="item in items" :key="item.id" class="settings-index__item">
        <a
          :href="`#${item.id}`"
          class="settings-index__link"
          :class="{ 'settings-index__link--active': item.id === active }"
          :aria-current="item.id === active ? 'location' : undefined"
          @click="onClick($event, item.id)"
        >
          <span class="settings-index__label">{{ item.label }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.settings-index {
  position: sticky;
  top: 24px;
  align-self: start;
}

.settings-index__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border-left: var(--border-width-normal) solid var(--color-border-subtle);
}

.settings-index__link {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-height: 40px;
  padding: 9px 12px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  text-decoration: none;
  transition:
    color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* El tramo del riel (::before) y el rombo de la sección visible (::after). El
   acento queda reservado a la acción principal: todo es latón. */
.settings-index__link::before {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: -1px;
  width: 2px;
  background: var(--color-brass-line);
  opacity: 0;
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.settings-index__link::after {
  position: absolute;
  top: 50%;
  left: -5px;
  width: 9px;
  height: 9px;
  content: '';
  background: var(--color-brass-body);
  opacity: 0;
  transform: translateY(-50%) rotate(45deg) scale(0.4);
}

.settings-index__link:hover {
  color: var(--color-text-primary);
}

.settings-index__link:hover::before {
  opacity: 0.5;
}

.settings-index__link:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface-strong, var(--color-surface)),
    0 0 0 4px var(--color-focus);
}

.settings-index__link--active {
  color: var(--color-text-primary);
  font-weight: 600;
  background: color-mix(in srgb, var(--color-brass-body) 10%, transparent);
}

.settings-index__link--active::before {
  opacity: 1;
}

.settings-index__link--active::after {
  opacity: 1;
  transform: translateY(-50%) rotate(45deg);
}

/* El rombo se posa al cambiar de sección: finito, solo transform y opacity. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .settings-index__link::after {
    transition:
      opacity 180ms ease,
      transform 240ms cubic-bezier(0.3, 1.4, 0.5, 1);
  }
}

@media (max-width: 1099px) {
  .settings-index {
    position: sticky;
    top: 0;
    z-index: var(--layer-sticky);
    margin-inline: -16px;
    padding: 8px 16px;
    background: var(--color-surface-strong);
    border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
  }

  .settings-index__list {
    flex-direction: row;
    gap: 4px;
    overflow-x: auto;
    border-left: 0;
    scrollbar-width: none;
  }

  .settings-index__list::-webkit-scrollbar {
    display: none;
  }

  .settings-index__link {
    flex: 0 0 auto;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    white-space: nowrap;
  }

  .settings-index__link::before {
    inset: auto 12px 4px 12px;
    top: auto;
    left: 12px;
    right: 12px;
    width: auto;
    height: 2px;
  }

  /* En la fila de pestañas el rombo se posa sobre el subrayado, al centro. */
  .settings-index__link::after {
    top: auto;
    bottom: 1px;
    left: 50%;
    width: 8px;
    height: 8px;
    transform: translateX(-50%) rotate(45deg) scale(0.4);
  }

  .settings-index__link--active::after {
    transform: translateX(-50%) rotate(45deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-index__link,
  .settings-index__link::before,
  .settings-index__link::after {
    transition: none;
  }
}
</style>
