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
  color: var(--color-text-secondary);
}

/* v2 (DEC-188): una línea fina que se llena en tinta hasta la proporción
   página/total, sin rombo ni brillo. Es decorativa; la posición real la
   comunican «Página X de Y» y aria-current. */
.base-pagination__track {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 1px;
  background: var(--color-border-subtle);
  pointer-events: none;
}

.base-pagination__track::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: calc(var(--pager-progress, 0) * 100%);
  background: var(--color-text-secondary);
  transition: width 200ms ease-out;
}

.base-pagination__nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.base-pagination__ellipsis {
  padding-inline: 4px;
  color: var(--color-text-secondary);
}

/* Botones del paginador: sin caja, números tabulares; la página vigente va
   en tinta y 600 sobre un fondo suave, sin el acento (que es de la acción
   principal). Anulan los valores de BaseButton, pensados para acciones. */
.base-pagination__nav :deep(.base-button) {
  height: 32px;
  min-width: 32px;
  padding-inline: 8px;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-size: 15px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

.base-pagination__nav :deep(.base-button--secondary:hover:not(:disabled)) {
  background: color-mix(in srgb, var(--color-text-primary) 12%, transparent);
  color: var(--color-text-primary);
}

.base-pagination__nav :deep(.base-button--primary),
.base-pagination__nav :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
  border: 0;
  filter: none;
  box-shadow: none;
  color: var(--color-text-primary);
  font-weight: 600;
}

/* El `box-shadow: none` de arriba quitaba también el anillo de foco de
   BaseButton: el paginador lleva el foco de la familia como contorno (#739). */
.base-pagination__nav :deep(.base-button:focus-visible) {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Anterior/siguiente: flechas finas en vez de la caja, más grandes que los
   números para leerse como acciones y no como páginas. */
.base-pagination__nav :deep(.base-button[data-pager-arrow]) {
  font-family: var(--font-family-base);
  font-size: 1.4rem;
  line-height: 1;
  color: var(--color-text-secondary);
}

.base-pagination__nav :deep(.base-button:disabled) {
  opacity: 0.3;
}

@media (prefers-reduced-motion: reduce) {
  .base-pagination__track::before {
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
