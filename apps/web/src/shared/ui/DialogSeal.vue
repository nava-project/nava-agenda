<script setup lang="ts">
// Sello de la cabecera de un diálogo (#791): el retrato de latón de la familia
// (BrassMonogram, #799) con su rombo colgante. Sustituye las cajas grises
// genéricas con «+» o una inicial. Es decorativo: el diálogo se nombra por su
// título.
import BrassMonogram from './BrassMonogram.vue'

defineProps<{
  /** Inicial o número a mostrar. Sin glifo, el sello dibuja «agregar». */
  glyph?: string
  /** `danger` tiñe filete y rombo con el rojo de peligro (desactivar, retirar). */
  tone?: 'neutral' | 'danger'
}>()
</script>

<template>
  <BrassMonogram
    class="dialog-seal"
    :class="{ 'dialog-seal--danger': tone === 'danger' }"
    face="serif"
    pendant
    :tone="tone"
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
  </BrassMonogram>
</template>

<style scoped>
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
