<script setup lang="ts">
/**
 * BasePagination - Paginador numerado del sistema visual (issue #531).
 *
 * Nació en el panel de Servicios (issue 2026-09-28, «colócalos en una tabla
 * con paginador») y se compartió con Profesionales y Servicios por profesional a
 * petición del propietario, para que todas las tablas paginen igual: conteo
 * con «Página X de Y», una cinta métrica con rombo que avanza con la página y
 * números en tipografía de display con la página vigente marcada por un rombo.
 *
 * Es controlado: no guarda la página, emite `change` y el padre decide (los
 * paneles piden la página al API o recortan una lista local). Con una sola
 * página solo queda el conteo, como confirmación silenciosa.
 */
import { computed, nextTick, ref } from 'vue'
import BaseButton from './BaseButton.vue'

interface Props {
  /** Página vigente, desde 1. */
  currentPage: number
  /** Total de páginas; se trata como mínimo 1. */
  totalPages: number
  /** Conteo real, p. ej. «34 servicios»; acompaña al paginador. */
  countLabel: string
  /** Nombre accesible de la navegación, p. ej. «Paginación de servicios». */
  navLabel: string
  /** Bloquea la navegación mientras una página carga. */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), { disabled: false })

const emit = defineEmits<{
  change: [page: number]
}>()

type PageToken = number | 'ellipsis'

const total = computed(() => Math.max(props.totalPages, 1))
const hasPages = computed(() => total.value > 1)
const progress = computed(() => Math.min(props.currentPage / total.value, 1))
const navRef = ref<HTMLElement | null>(null)

// Con pocas páginas muestra todas; con muchas ancla la primera y la última y
// una vecindad de 1 alrededor de la vigente, con «…» en los huecos, para que
// 30+ páginas no desborden la fila de botones.
const tokens = computed<PageToken[]>(() => {
  const last = total.value
  const current = props.currentPage
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const result: PageToken[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(last - 1, current + 1)
  if (start > 2) result.push('ellipsis')
  for (let p = start; p <= end; p++) result.push(p)
  if (end < last - 1) result.push('ellipsis')
  result.push(last)
  return result
})

function goTo(page: number) {
  if (props.disabled || page < 1 || page > total.value || page === props.currentPage) return
  const hadFocusInNav = navRef.value?.contains(document.activeElement) ?? false
  emit('change', page)
  if (!hadFocusInNav) return
  // Si el botón enfocado queda deshabilitado (primera/última página), el foco
  // vuelve a la página vigente en vez de perderse en el <body>.
  void nextTick(() => {
    const active = document.activeElement
    const lostFocus =
      active === document.body ||
      active === null ||
      (active instanceof HTMLButtonElement && active.disabled)
    if (lostFocus) {
      navRef.value?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
    }
  })
}
</script>

<template>
  <div class="base-pagination" :style="{ '--pager-progress': String(progress) }">
    <span class="base-pagination__count" role="status">
      {{ countLabel }}
      <span v-if="hasPages" class="base-pagination__where">
        · Página {{ currentPage }} de {{ total }}
      </span>
    </span>
    <span v-if="hasPages" class="base-pagination__track" aria-hidden="true" />
    <nav v-if="hasPages" ref="navRef" class="base-pagination__nav" :aria-label="navLabel">
      <BaseButton
        type="button"
        variant="secondary"
        data-pager-arrow
        :disabled="currentPage === 1 || disabled"
        aria-label="Página anterior"
        @click="goTo(currentPage - 1)"
      >
        ‹
      </BaseButton>
      <template v-for="(token, index) in tokens" :key="`${token}-${index}`">
        <span v-if="token === 'ellipsis'" class="base-pagination__ellipsis" aria-hidden="true">
          …
        </span>
        <BaseButton
          v-else
          type="button"
          :variant="token === currentPage ? 'primary' : 'secondary'"
          :aria-label="`Página ${token}`"
          :aria-current="token === currentPage ? 'page' : undefined"
          :disabled="disabled"
          @click="goTo(token)"
        >
          {{ token }}
        </BaseButton>
      </template>
      <BaseButton
        type="button"
        variant="secondary"
        data-pager-arrow
        :disabled="currentPage === total || disabled"
        aria-label="Página siguiente"
        @click="goTo(currentPage + 1)"
      >
        ›
      </BaseButton>
    </nav>
  </div>
</template>

<style scoped>
.base-pagination {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  box-sizing: border-box;
  /* Alto fijo de 38px: con una sola página la barra solo tiene el texto del
     total, y computeFittingPageSize mediría un paginador más bajo que el que
     aparece al reducir las filas (desborde de 14px y scroll). Los botones
     miden 32px y los 6px restantes alojan la cinta de progreso. */
  min-height: 38px;
  padding-bottom: 6px;
}

.base-pagination__count {
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong-muted);
}

.base-pagination__where {
  color: color-mix(in srgb, var(--color-brand-accent-surface) 85%, var(--color-on-strong-muted));
  letter-spacing: 0.02em;
}

/* Cinta métrica de sastre: un filete que recorre toda la barra, relleno en
   dorado hasta la proporción página/total, con un rombo en la punta (el mismo
   rombo del estado y del interruptor "Lo ofrezco"). Es decorativa; la
   posición real la comunica "Página X de Y" y aria-current. */
.base-pagination__track {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--color-brand-accent-surface) 22%, transparent);
  pointer-events: none;
}

.base-pagination__track::before {
  content: '';
  position: absolute;
  inset-block: -1px;
  inset-inline-start: 0;
  width: calc(var(--pager-progress, 0) * 100%);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent) 40%,
    var(--color-brand-accent-surface)
  );
  transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.base-pagination__track::after {
  content: '';
  position: absolute;
  top: 50%;
  inset-inline-start: calc(var(--pager-progress, 0) * 100%);
  width: 7px;
  height: 7px;
  background: var(--color-brand-accent-surface);
  box-shadow: 0 0 10px color-mix(in srgb, var(--color-brand-accent-surface) 70%, transparent);
  transform: translate(-50%, -50%) rotate(45deg);
  transition: inset-inline-start 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.base-pagination__nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.base-pagination__ellipsis {
  padding-inline: 4px;
  color: var(--color-on-strong-muted);
  font-family: var(--font-display);
  font-size: 1.2rem;
  letter-spacing: 0.1em;
}

/* Botones del paginador: sin caja. Números en la tipografía de display sobre
   la tinta de la barra; la página vigente se marca con un rombo dorado
   (cuadrado girado 45°) y un halo; el hover levanta el número a dorado y
   dibuja una marca de la cinta bajo él. Anulan los valores de BaseButton,
   calibrados para botones de acción con texto. */
.base-pagination__nav :deep(.base-button) {
  position: relative;
  isolation: isolate;
  height: 32px;
  min-width: 32px;
  padding-inline: 8px;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-strong-soft);
  --btn-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);
}

.base-pagination__nav :deep(.base-button::before) {
  content: '';
  position: absolute;
  z-index: -1;
  top: 50%;
  left: 50%;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  background: transparent;
  transform: translate(-50%, -50%) rotate(45deg) scale(0.6);
  opacity: 0;
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 200ms ease,
    background-color 200ms ease;
}

.base-pagination__nav :deep(.base-button--secondary:hover:not(:disabled)) {
  background: transparent;
  color: var(--color-brand-accent-surface);
}

.base-pagination__nav :deep(.base-button--secondary:hover:not(:disabled)::before) {
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 45%, transparent);
  transform: translate(-50%, -50%) rotate(45deg) scale(0.85);
  opacity: 1;
}

.base-pagination__nav :deep(.base-button--primary),
.base-pagination__nav :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  background: transparent;
  border: 0;
  filter: none;
  box-shadow: none;
  color: var(--color-brand-accent-surface);
  font-weight: 600;
}

.base-pagination__nav :deep(.base-button--primary::before) {
  border-color: var(--color-brand-accent-surface);
  background: color-mix(in srgb, var(--color-brand-accent-surface) 16%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--color-brand-accent-surface) 35%, transparent);
  transform: translate(-50%, -50%) rotate(45deg) scale(1);
  opacity: 1;
}

/* Anterior/siguiente: flechas finas en vez de la caja, más grandes que los
   números para leerse como acciones y no como páginas. */
.base-pagination__nav :deep(.base-button[data-pager-arrow]) {
  font-family: var(--font-family-base);
  font-size: 1.4rem;
  line-height: 1;
  color: var(--color-brand-accent-surface);
}

.base-pagination__nav :deep(.base-button:disabled) {
  opacity: 0.3;
}

@media (prefers-reduced-motion: reduce) {
  .base-pagination__track::before,
  .base-pagination__track::after,
  .base-pagination__nav :deep(.base-button::before) {
    transition: none;
  }
}

@media (max-width: 640px) {
  .base-pagination {
    justify-content: center;
    text-align: center;
  }

  .base-pagination__nav {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
