<script setup lang="ts">
// Índice de secciones de Configuración (DEC-110): en escritorio una columna
// fija sobre un riel; la sección visible lleva el rombo de latón sobre el riel y
// el hover solo enciende el tramo, sin rombo (#759); en
// pantallas angostas, una fila de pestañas que se desplaza en horizontal. Es
// navegación por anclas (enlaces reales), no pestañas que oculten contenido:
// toda la información sigue en la página. Sin numerales: las secciones son
// ajustes independientes, no una secuencia.
//
// En la fila de pestañas, los bordes se desvanecen donde quedan secciones fuera
// de la vista (y una flecha de latón lo dice a la derecha), y la pestaña de la
// sección visible se trae a la vista al cambiar (#759).
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface SettingsIndexItem {
  id: string
  label: string
}

const props = defineProps<{ items: readonly SettingsIndexItem[]; active: string }>()
const emit = defineEmits<{ select: [id: string] }>()

const listEl = ref<HTMLOListElement | null>(null)
const moreStart = ref(false)
const moreEnd = ref(false)

function onClick(event: MouseEvent, id: string) {
  event.preventDefault()
  emit('select', id)
}

function measure() {
  const list = listEl.value
  if (!list) return
  const max = list.scrollWidth - list.clientWidth
  moreStart.value = max > 1 && list.scrollLeft > 1
  moreEnd.value = max > 1 && list.scrollLeft < max - 1
}

function revealActive() {
  const list = listEl.value
  if (!list || list.scrollWidth <= list.clientWidth) return
  const link = list.querySelector<HTMLElement>('.settings-index__link--active')
  if (!link) return
  const item = link.parentElement ?? link
  const left = item.offsetLeft
  const right = left + item.offsetWidth
  const margin = 32
  let target: number | null = null
  if (left < list.scrollLeft + margin) target = left - margin
  else if (right > list.scrollLeft + list.clientWidth - margin)
    target = right - list.clientWidth + margin
  if (target === null) return
  const calm =
    document.documentElement.dataset.motion === 'reduced' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  list.scrollTo?.({ left: Math.max(0, target), behavior: calm ? 'auto' : 'smooth' })
}

watch(
  () => props.active,
  async () => {
    await nextTick()
    revealActive()
  },
)

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
</script>

<template>
  <nav
    class="settings-index"
    :class="{
      'settings-index--more-start': moreStart,
      'settings-index--more-end': moreEnd,
    }"
    aria-label="Secciones de configuración"
  >
    <ol ref="listEl" class="settings-index__list" @scroll.passive="measure">
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
    <span class="settings-index__more" aria-hidden="true" />
  </nav>
</template>

<style scoped>
.settings-index {
  position: sticky;
  top: 24px;
  align-self: start;
}

.settings-index__more {
  display: none;
}

.settings-index__list {
  position: relative;
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

  /* Bordes desvanecidos donde siguen pestañas: la fila no parece terminar en
     «Cont». La máscara solo atenúa; nada queda inaccesible. */
  .settings-index--more-end .settings-index__list {
    mask-image: linear-gradient(to right, #000 calc(100% - 56px), transparent);
  }

  .settings-index--more-start .settings-index__list {
    mask-image: linear-gradient(to right, transparent, #000 40px);
  }

  .settings-index--more-start.settings-index--more-end .settings-index__list {
    mask-image: linear-gradient(
      to right,
      transparent,
      #000 40px,
      #000 calc(100% - 56px),
      transparent
    );
  }

  /* La flecha de latón: un rombo abierto que apunta a la derecha. */
  .settings-index__more {
    position: absolute;
    top: 50%;
    right: 18px;
    display: block;
    width: 9px;
    height: 9px;
    border-top: 2px solid var(--color-brass-text);
    border-right: 2px solid var(--color-brass-text);
    opacity: 0;
    pointer-events: none;
    rotate: 45deg;
    translate: 0 -50%;
  }

  .settings-index--more-end .settings-index__more {
    opacity: 1;
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

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .settings-index__more {
    transition: opacity 200ms ease;
  }

  :root:not([data-motion='reduced']) .settings-index--more-end .settings-index__more {
    animation: settings-index-nudge 900ms cubic-bezier(0.3, 1.3, 0.5, 1) 600ms 2 both;
  }
}

@keyframes settings-index-nudge {
  50% {
    translate: 4px -50%;
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
