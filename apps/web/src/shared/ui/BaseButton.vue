<script setup lang="ts">
/**
 * BaseButton - Botón base del sistema visual.
 * Variantes: primary | secondary | soft | ghost | danger
 * (estandar-diseno-visual.md §8.1: primaria, secundaria, texto, peligro)
 * Estados: default | hover | active | focus-visible | disabled | loading
 * Tamaños: md (44px, estándar) | lg (48px, principal móvil, §6.2). No
 * existe una variante más pequeña: el estándar visual no define un tamaño
 * de botón por debajo del objetivo táctil de 44 × 44 px (CA-009-03), así
 * que este componente no inventa uno.
 * Accesibilidad: aria-pressed (toggle), aria-busy (carga), foco visible con
 * --color-focus, prefers-reduced-motion.
 */
import { computed } from 'vue'
import SunDiamond from './SunDiamond.vue'

interface Props {
  /** Variante visual del botón */
  variant?: 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger'
  /** Tamaño del botón: md (44px) o lg (48px, acción principal móvil) */
  size?: 'md' | 'lg'
  /** Si el botón está deshabilitado */
  disabled?: boolean
  /** Si muestra estado de carga. Bloquea la interacción como disabled, sin
   * sustituir la idempotencia del servidor (estandar-frontend-vue.md §6). */
  loading?: boolean
  /** Lo que se espera, en gerundio («Confirmando…»): con `loading`, va junto al
   * diamante en el sol en lugar del texto. Sin él, solo el diamante. */
  loadingLabel?: string
  /** Si es un botón toggle (mantiene estado pressed) */
  pressed?: boolean
  /** Tipo nativo del botón */
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  loadingLabel: undefined,
  pressed: false,
  type: 'button',
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const classes = computed(() => {
  const base = 'base-button'
  return [
    base,
    `${base}--${props.variant}`,
    `${base}--${props.size}`,
    props.disabled ? `${base}--disabled` : '',
    props.loading ? `${base}--loading` : '',
    props.pressed ? `${base}--pressed` : '',
  ]
    .filter(Boolean)
    .join(' ')
})

// El atributo nativo `disabled` ya impide el click y la activación por
// teclado del navegador mientras disabled o loading estén activos; este
// guardia es una defensa adicional explícita, no la única barrera real.
const handleClick = (event: MouseEvent) => {
  if (props.disabled || props.loading) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  emit('click', event)
}
</script>

<template>
  <button
    :class="classes"
    :type="type"
    :disabled="disabled || loading"
    :aria-disabled="disabled || loading"
    :aria-pressed="pressed"
    :aria-busy="loading"
    @click="handleClick"
  >
    <span class="base-button__content" :class="{ 'base-button__content--waiting': loading }">
      <slot />
    </span>
    <!-- El nombre accesible sigue siendo el texto del botón (aria-busy dice que espera). -->
    <span v-if="loading" class="base-button__spinner" aria-hidden="true">
      <SunDiamond size="sm" />
      <span v-if="loadingLabel" class="base-button__wait-label">{{ loadingLabel }}</span>
    </span>
  </button>
</template>

<style scoped>
.base-button {
  --btn-height: var(--control-height);
  --btn-height-lg: var(--control-height-primary-mobile);
  --btn-padding-x: var(--space-4);
  --btn-padding-x-lg: var(--space-5);
  --btn-gap: var(--space-2);
  --btn-font-size: var(--font-size-body);
  --btn-font-weight: 500;
  --btn-radius: var(--radius-md);
  --btn-transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-ease-out);
  --btn-focus-ring: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-focus);

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--btn-gap);
  height: var(--btn-height);
  padding: 0 var(--btn-padding-x);
  font-family: var(--font-family-base);
  font-size: var(--btn-font-size);
  font-weight: var(--btn-font-weight);
  line-height: 1;
  border: var(--border-width-normal) solid transparent;
  border-radius: var(--btn-radius);
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  transition: var(--btn-transition);
  outline: none;
}

/* Respuesta al pulsar: el botón se hunde un píxel y recupera su escala al
   soltar. Es la única señal táctil común a las cuatro variantes; el realce
   de color de cada una sigue siendo la del hover. */
.base-button:active:not(:disabled):not(.base-button--loading) {
  transform: translateY(1px) scale(0.985);
}

@media (hover: hover) {
  .base-button--primary:hover:not(:disabled):not(.base-button--loading) {
    box-shadow: 0 8px 18px -10px var(--color-brand-accent-surface);
  }
}

@media (prefers-reduced-motion: reduce) {
  .base-button {
    transition: none;
  }

  .base-button:active:not(:disabled):not(.base-button--loading) {
    transform: none;
  }
}

.base-button:focus-visible {
  box-shadow: var(--btn-focus-ring);
}

.base-button--lg {
  height: var(--btn-height-lg);
  padding: 0 var(--btn-padding-x-lg);
}

/* Variant: primary */
/* La acción principal es la única con el acento lleno, y el acento es el del
   negocio (DEC-110/DEC-188): `--color-brand-accent-surface` cae al Alba de
   tokens.css donde no hay negocio (acceso). Cada acento de la paleta pasa AA
   como relleno con `--color-brand-accent-text`. */
.base-button--primary {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

/* `:where()` deja los estados hover/active con la especificidad de la variante
   misma: las pantallas sobre tinta repintan el primario con el acento de marca
   (`.pagina .base-button--primary`) y solo añaden `filter` al hover; con la
   especificidad plena de `:hover:not():not()` este fondo volvía a ganar y
   dejaba el texto del acento sobre `--color-action-primary-hover` (1.16:1,
   campaña #301, HALL-CAT-04). Sin sobrescritura de la página, el hover y el
   active se ven igual que antes: esta regla va después de la base. */
.base-button--primary:where(:hover:not(:disabled):not(.base-button--loading)) {
  background-color: var(--color-action-primary-hover);
  border-color: var(--color-action-primary-hover);
}

.base-button--primary:where(:active:not(:disabled):not(.base-button--loading)) {
  background-color: var(--color-action-primary-active);
  border-color: var(--color-action-primary-active);
}

/* Variant: secondary — v2 (DEC-188): contorno neutro de 1px; el acento
   lleno queda solo para la acción principal. */
.base-button--secondary {
  background-color: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border-control);
}

.base-button--secondary:hover:not(:disabled):not(.base-button--loading) {
  /* 8 %: al 4 % el hover casi no se distinguía del reposo (#739). */
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, var(--color-surface));
  border-color: var(--color-text-primary);
}

.base-button--secondary:active:not(:disabled):not(.base-button--loading) {
  background-color: color-mix(in srgb, var(--color-text-primary) 13%, var(--color-surface));
}

/* Variant: soft */
.base-button--soft {
  background-color: var(--color-action-soft);
  color: var(--color-action-primary);
  border-color: transparent;
}

.base-button--soft:hover:not(:disabled):not(.base-button--loading) {
  background-color: var(--color-action-soft);
  border-color: var(--color-action-soft-border);
}

.base-button--soft:active:not(:disabled):not(.base-button--loading) {
  background-color: var(--color-action-soft-active);
}

/* Variant: ghost — v2: solo la palabra en tinta, sin borde; el fondo
   aparece al pasar el cursor. */
.base-button--ghost {
  background-color: transparent;
  color: var(--color-text-primary);
}

.base-button--ghost:hover:not(:disabled):not(.base-button--loading) {
  background-color: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
}

.base-button--ghost:active:not(:disabled):not(.base-button--loading) {
  background-color: color-mix(in srgb, var(--color-text-primary) 11%, transparent);
}

/* Variant: danger */
.base-button--danger {
  background-color: var(--color-danger-action);
  color: var(--color-on-ink);
  border-color: var(--color-danger-action);
}

/* El estándar visual no define un tono más oscuro de peligro para
   hover/active (solo el único "Peligro" de la tabla de contraste, §4.2):
   en vez de inventar un hexadecimal nuevo sin decisión del propietario,
   estos estados oscurecen el mismo token con un multiplicador numérico,
   igual que el resto del archivo ya usa opacity para disabled/secundario. */
.base-button--danger:hover:not(:disabled):not(.base-button--loading) {
  filter: brightness(90%);
}

.base-button--danger:active:not(:disabled):not(.base-button--loading) {
  filter: brightness(80%);
}

/* Disabled */
.base-button--disabled,
.base-button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
  pointer-events: none;
}

/* Botón con icono (#511): el contenido era un bloque y el icono, una caja en línea sobre la
   línea base, así que quedaba más alto que la letra. Con un icono dentro (svg o un elemento
   aria-hidden que no sea el spinner, que va en absoluto) el contenido pasa a fila centrada:
   icono y texto comparten el mismo eje vertical. Un botón solo de texto no cambia. */
.base-button__content:has(> svg, > [aria-hidden='true']:not(.base-button__spinner)) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--btn-gap);
}

/* Loading (#735): el botón conserva su ancho (el texto queda, invisible) y
   encima, centrado, va el diamante dentro del sol en el color del texto, con
   el gerundio si lo hay. Antes el spinner iba en absoluto sin centrar y el
   texto, en color transparente que las pantallas pisaban: se leía
   «C◌onfirmar turno». Esperar no es estar deshabilitado: sin la opacidad de
   disabled. */
.base-button--loading {
  position: relative;
}

.base-button--loading:disabled {
  opacity: 1;
  cursor: progress;
}

.base-button__content--waiting {
  opacity: 0;
}

.base-button__spinner {
  position: absolute;
  inset: 0;
  display: flex;
  gap: var(--btn-gap);
  align-items: center;
  justify-content: center;
}

.base-button__wait-label {
  white-space: nowrap;
}

/* Pressed (para toggle) */
.base-button--pressed {
  box-shadow: inset 0 2px 4px var(--color-overlay-hover);
}

/* Icon-only (cuando solo hay icono) */
.base-button:has(> .base-button__content > :only-child:not(:has(+ *))) {
  padding-left: calc(var(--btn-padding-x) - 2px);
  padding-right: calc(var(--btn-padding-x) - 2px);
}

.base-button--lg:has(> .base-button__content > :only-child:not(:has(+ *))) {
  padding-left: calc(var(--btn-padding-x-lg) - 2px);
  padding-right: calc(var(--btn-padding-x-lg) - 2px);
}
</style>
