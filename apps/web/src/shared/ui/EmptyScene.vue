<script setup lang="ts">
/**
 * EmptyScene - Estado vacío del panel (DEC-113; v2, DEC-188 entrega 5).
 * Sustituye al párrafo suelto de cada pantalla por una escena: una
 * ilustración de línea quieta (la agenda sin turnos es una regla de horas con
 * huecos, el catálogo una pila de fichas, el equipo tres marcos de retrato),
 * un titular, una ayuda y la acción real, que el consumidor entrega por slot.
 * En v2 la línea es neutra; solo el «ahora» de la agenda lleva Sol, y la
 * acción del slot es la principal de la pantalla (el acento lleno). Ningún motivo de negocio
 * (tijeras, navajas, postes): las ilustraciones son del mismo lenguaje de
 * regla, rombo y marco que el resto del panel.
 *
 * Es decorativo salvo por el texto: el SVG va `aria-hidden` y el titular, la
 * ayuda y la acción son contenido normal. Sin entradas ni movimiento
 * infinito: aparece quieta (revisión del PR 4a, WCAG 2.2.2).
 */
withDefaults(
  defineProps<{
    /** Qué ilustra: huecos de agenda, fichas de catálogo, marcos de equipo,
     * un vínculo entre dos marcos o una búsqueda sin resultado. */
    scene: 'agenda' | 'services' | 'team' | 'assignments' | 'search'
  }>(),
  {},
)
</script>

<template>
  <div class="empty-scene" :class="`empty-scene--${scene}`">
    <div class="empty-scene__art" aria-hidden="true">
      <svg viewBox="0 0 240 150" fill="none" stroke="currentColor" stroke-width="1.5">
        <!-- Agenda: regla de horas, tres huecos libres y el «ahora» -->
        <g v-if="scene === 'agenda'">
          <path d="M16 108H224" />
          <path
            class="es-soft"
            d="M16 108v8M50 108v8M84 108v8M118 108v8M152 108v8M186 108v8M220 108v8"
          />
          <rect class="es-slot" x="26" y="56" width="50" height="40" rx="2" />
          <rect class="es-slot es-slot--lead" x="96" y="44" width="60" height="52" rx="2" />
          <rect class="es-slot" x="174" y="62" width="42" height="34" rx="2" />
          <path class="es-plus" d="M126 64v18M117 73h18" />
          <path class="es-now-line" d="M84 28V108" />
          <circle class="es-ring" cx="84" cy="108" r="6" />
          <rect
            class="es-diamond"
            x="78"
            y="102"
            width="12"
            height="12"
            transform="rotate(45 84 108)"
          />
        </g>

        <!-- Servicios: pila de fichas que sube y una acción por añadir -->
        <g v-else-if="scene === 'services'">
          <rect class="es-card es-soft" x="64" y="26" width="112" height="46" rx="2" />
          <rect class="es-card" style="opacity: 0.6" x="52" y="42" width="136" height="46" rx="2" />
          <rect class="es-card es-front" x="40" y="58" width="160" height="56" rx="2" />
          <path d="M58 78h64M58 94h38" />
          <circle class="es-plus-ring" cx="174" cy="86" r="14" />
          <path class="es-plus" d="M174 79v14M167 86h14" />
        </g>

        <!-- Equipo: tres marcos de retrato, el central por llenar -->
        <g v-else-if="scene === 'team'">
          <g class="es-soft">
            <rect x="24" y="48" width="54" height="66" rx="2" />
            <circle cx="51" cy="74" r="9" />
            <path d="M34 108c1-12 8-18 17-18s16 6 17 18" />
          </g>
          <g class="es-soft">
            <rect x="162" y="48" width="54" height="66" rx="2" />
            <circle cx="189" cy="74" r="9" />
            <path d="M172 108c1-12 8-18 17-18s16 6 17 18" />
          </g>
          <rect class="es-slot es-slot--lead" x="91" y="30" width="58" height="84" rx="2" />
          <path class="es-corner" d="M87 46V26h20M153 98v20h-20" />
          <path class="es-plus" d="M120 62v22M109 73h22" />
        </g>

        <!-- Servicios por profesional: dos marcos y un vínculo que late -->
        <g v-else-if="scene === 'assignments'">
          <g>
            <rect x="24" y="44" width="58" height="68" rx="2" />
            <circle cx="53" cy="72" r="10" />
            <path d="M34 106c1-13 9-20 19-20s18 7 19 20" />
          </g>
          <g>
            <rect class="es-card es-front" x="158" y="44" width="58" height="68" rx="2" />
            <path d="M172 66h30M172 80h30M172 94h18" />
          </g>
          <path class="es-link" d="M88 78H152" />
          <rect
            class="es-diamond"
            x="115"
            y="72"
            width="12"
            height="12"
            transform="rotate(45 121 78)"
          />
        </g>

        <!-- Búsqueda sin resultado -->
        <g v-else>
          <circle cx="108" cy="68" r="32" />
          <path d="M132 92L164 124" stroke-width="3" />
          <path class="es-soft" d="M92 68h32" />
          <rect
            class="es-diamond"
            x="102"
            y="82"
            width="10"
            height="10"
            transform="rotate(45 107 87)"
          />
        </g>
      </svg>
    </div>

    <p class="empty-scene__title"><slot name="title" /></p>
    <p v-if="$slots.hint" class="empty-scene__hint"><slot name="hint" /></p>
    <div v-if="$slots.action" class="empty-scene__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.empty-scene {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-secondary);
  text-align: center;
}

.empty-scene__art {
  width: min(220px, 70%);
  margin-bottom: var(--space-2);
  color: var(--color-border-control);
}

.empty-scene__art svg {
  display: block;
  width: 100%;
  height: auto;
}

.empty-scene__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  color: var(--color-text-primary);
}

.empty-scene__hint {
  max-width: 44ch;
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  color: var(--color-text-secondary);
}

.empty-scene__hint :slotted(a) {
  color: var(--color-text-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.empty-scene__action {
  margin-top: var(--space-3);
}

/* Ilustración: línea neutra; los huecos, apenas tintados; el «ahora» en Sol. */
.es-soft {
  opacity: 0.55;
}

.es-slot,
.es-card {
  fill: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  stroke-dasharray: 4 4;
}

.es-slot--lead,
.es-front {
  fill: var(--color-surface);
  stroke: var(--color-text-secondary);
  stroke-dasharray: none;
}

.es-plus,
.es-plus-ring,
.es-corner,
.es-link {
  stroke: var(--color-text-secondary);
}

.es-link {
  stroke-dasharray: 4 4;
}

.es-now-line,
.es-ring {
  stroke: var(--color-sun);
}

.es-diamond {
  fill: var(--color-sun);
  stroke: none;
}

.empty-scene--search .es-diamond,
.empty-scene--assignments .es-diamond {
  fill: var(--color-text-secondary);
}
</style>
