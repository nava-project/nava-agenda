<script setup lang="ts">
// Retrato de latón de la familia (#799): la ficha cuadrada con filete de latón,
// la base marcada y, si se pide, el rombo colgante asomando bajo el borde, como
// un sello. Es la única fuente de ese dibujo: lo usan los retratos de
// profesional (ProfessionalAvatar), los monogramas de servicio, el detalle del
// turno y los sellos de diálogo (DialogSeal). Siempre decorativo: el nombre
// visible al lado es la identidad accesible.
//
// El tamaño lo fija quien lo usa con `--monogram-size` (y el glifo con
// `--monogram-glyph-size`), porque cada pantalla tiene su propia escala por
// ancho. El rombo recorta su contorno con `--monogram-cutout`, que debe ser el
// color del fondo sobre el que cuelga.
withDefaults(
  defineProps<{
    /** Inicial o iniciales. Si hay contenido en el slot (foto, trazo), manda el slot. */
    glyph?: string
    /** Serif solo a 20 px o más; por debajo se ensucia y va la sans 600 (#726). */
    face?: 'serif' | 'sans'
    /** Rombo colgante del filete inferior. */
    pendant?: boolean
    /** `danger` tiñe filete, base, glifo y rombo con el rojo de peligro. */
    tone?: 'neutral' | 'danger'
  }>(),
  { glyph: '', face: 'sans', pendant: false, tone: 'neutral' },
)
</script>

<template>
  <span
    class="brass-monogram"
    :class="[
      `brass-monogram--${face}`,
      { 'brass-monogram--pendant': pendant, 'brass-monogram--danger': tone === 'danger' },
    ]"
    aria-hidden="true"
  >
    <slot>
      <span class="brass-monogram__glyph">{{ glyph }}</span>
    </slot>
  </span>
</template>

<style scoped>
.brass-monogram {
  --monogram-line: var(--color-brass-line);
  --monogram-body: var(--color-brass-body);
  --monogram-ink: var(--color-brass-text);

  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--monogram-size, 40px);
  height: var(--monogram-size, 40px);
  padding: var(--monogram-mat, 0);
  color: var(--monogram-ink);
  background-color: color-mix(in srgb, var(--monogram-body) 10%, var(--color-surface));
  border: 1px solid var(--monogram-line);
  border-radius: var(--monogram-radius, 3px);
  box-shadow: inset 0 -2px 0 var(--monogram-body);
}

.brass-monogram--danger {
  --monogram-line: color-mix(in srgb, var(--color-danger-on-strong) 55%, transparent);
  --monogram-body: var(--color-danger-on-strong);
  --monogram-ink: var(--color-danger-on-strong);
}

/* El rombo colgante: un cuadrado girado, nunca un círculo. Quien lo apaga o
   lo enciende desde fuera (un disparador de selector) usa
   `--monogram-pendant-display`. */
.brass-monogram::after {
  position: absolute;
  bottom: calc(var(--monogram-pendant, 8px) / -2 - 1px);
  left: 50%;
  z-index: 1;
  display: var(--monogram-pendant-display, none);
  width: var(--monogram-pendant, 8px);
  height: var(--monogram-pendant, 8px);
  content: '';
  background-color: var(--monogram-body);
  border: 2px solid var(--monogram-cutout, var(--color-surface));
  transform: translateX(-50%) rotate(45deg);
}

.brass-monogram--pendant::after {
  display: var(--monogram-pendant-display, block);
}

.brass-monogram__glyph {
  font-size: var(--monogram-glyph-size, calc(var(--monogram-size, 40px) * 0.4));
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* La letra va en la ficha, no en el glifo, para que la herede también el
   contenido del slot. */
.brass-monogram--serif {
  font-family: var(--font-display);
  font-weight: 400;
}

.brass-monogram--sans {
  font-family: var(--font-sans);
  font-weight: 600;
}

.brass-monogram--sans .brass-monogram__glyph {
  letter-spacing: 0;
}
</style>
