<script setup lang="ts">
// Sello de la cabecera de un diálogo (#791): la ficha de latón de la familia,
// con su filete y el rombo colgante, la misma que llevan las fichas de detalle
// (#757, #762). Sustituye las cajas grises genéricas con «+» o una inicial.
// Es decorativo: el diálogo se nombra por su título.
defineProps<{
  /** Inicial o número a mostrar. Sin glifo, el sello dibuja «agregar». */
  glyph?: string
  /** `danger` tiñe filete y rombo con el rojo de peligro (desactivar, retirar). */
  tone?: 'neutral' | 'danger'
}>()
</script>

<template>
  <span
    class="dialog-seal"
    :class="{ 'dialog-seal--danger': tone === 'danger' }"
    aria-hidden="true"
  >
    <span v-if="glyph" class="dialog-seal__glyph">{{ glyph }}</span>
    <svg
      v-else
      class="dialog-seal__add"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="square"
    >
      <path d="M10 3.5v13M3.5 10h13" />
    </svg>
  </span>
</template>

<style scoped>
.dialog-seal {
  --seal-line: var(--color-brass-line);
  --seal-body: var(--color-brass-body);
  --seal-ink: var(--color-brass-text);

  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: var(--seal-ink);
  background-color: color-mix(in srgb, var(--seal-body) 10%, var(--color-surface));
  border: 1px solid var(--seal-line);
  border-radius: 3px;
  box-shadow: inset 0 -2px 0 var(--seal-body);
}

.dialog-seal--danger {
  --seal-line: color-mix(in srgb, var(--color-danger-on-strong) 55%, transparent);
  --seal-body: var(--color-danger-on-strong);
  --seal-ink: var(--color-danger-on-strong);
}

/* El rombo colgante del filete inferior, como en la ficha de detalle. */
.dialog-seal::after {
  position: absolute;
  bottom: -5px;
  left: 50%;
  width: 8px;
  height: 8px;
  content: '';
  background-color: var(--seal-body);
  border: 2px solid var(--color-surface);
  transform: translateX(-50%) rotate(45deg);
}

/* Serif a 24 px, el tamaño en que no se ensucia (#726). */
.dialog-seal__glyph {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 400;
  line-height: 1;
}

.dialog-seal__add {
  width: 18px;
  height: 18px;
}
</style>
