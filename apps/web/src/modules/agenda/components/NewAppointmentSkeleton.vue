<script setup lang="ts">
import { SunDiamond } from '@/shared/ui'
/**
 * NewAppointmentSkeleton - Espera con la geometría del formulario por llegar
 * (issue #190, atlas nuevo-turno-eventos evento 01): mientras profesionales y zona
 * horaria siguen sin resolverse, la pantalla conserva la hoja de cuatro
 * bandas numeradas y sus campos en vez de dejar un indicador suelto sobre una
 * pantalla vacía. Desde el rediseño del issue #576 calca los pasos con su
 * cifra redonda y el boleto lateral con las dos acciones. Hermano de `AgendaSkeleton` (evento 05 del atlas de
 * `/panel`) y, como él, local al módulo `agenda`: su geometría es la de esta
 * pantalla, no se promueve a shared/ui.
 *
 * El texto de espera nunca desaparece: se sigue anunciando vía
 * role="status"/aria-live="polite" aunque la representación visual sea
 * geometría. `prefers-reduced-motion: reduce` deja los bloques en opacidad
 * fija, sin pulso.
 */
interface Props {
  /** Texto exacto ya usado por el código ("Cargando profesionales…"): este
   * componente no lo redacta. */
  label: string
}

defineProps<Props>()

// Cada banda declara cuántos campos lleva cada una de sus filas, calcado del
// esqueleto del atlas (`skeletonHtml` en tools/mockups/nuevo-turno-eventos/
// render.mjs): 1 → dos campos, 2 → dos filas de dos, 3 → dos campos,
// 4 → un campo ancho.
const BANDS: readonly (readonly number[])[] = [[2], [2, 2], [2], [1]]
</script>

<template>
  <div class="nt-skeleton" role="status" aria-live="polite">
    <p class="nt-skeleton__status">
      <SunDiamond size="sm" class="nt-skeleton__spinner" />{{ label }}
    </p>

    <div class="nt-skeleton__layout" aria-hidden="true">
      <div class="nt-skeleton__sheet">
        <div v-for="(rows, band) in BANDS" :key="band" class="nt-skeleton__band">
          <div class="nt-skeleton__head">
            <span class="nt-skeleton__bar nt-skeleton__bar--num" />
            <span class="nt-skeleton__stack">
              <span class="nt-skeleton__bar nt-skeleton__bar--title" />
              <span class="nt-skeleton__bar nt-skeleton__bar--hint" />
            </span>
          </div>
          <div class="nt-skeleton__body">
            <div v-for="(count, row) in rows" :key="row" class="nt-skeleton__row">
              <span v-for="n in count" :key="n" class="nt-skeleton__field">
                <span class="nt-skeleton__bar nt-skeleton__bar--label" />
                <span class="nt-skeleton__bar nt-skeleton__bar--control" />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="nt-skeleton__rail">
        <div class="nt-skeleton__ticket">
          <span class="nt-skeleton__bar nt-skeleton__bar--label" />
          <span class="nt-skeleton__bar nt-skeleton__bar--time" />
          <span class="nt-skeleton__bar nt-skeleton__bar--hint" />
          <span class="nt-skeleton__perforation" />
          <span v-for="n in 3" :key="n" class="nt-skeleton__field">
            <span class="nt-skeleton__bar nt-skeleton__bar--label" />
            <span class="nt-skeleton__bar nt-skeleton__bar--value" />
          </span>
        </div>
        <span class="nt-skeleton__bar nt-skeleton__bar--cta" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Móvil primero (420px del atlas); la banda de escritorio del atlas
   (1440px) entra en @media (min-width: 1024px), igual que DailyAgendaPage. */
.nt-skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.nt-skeleton__status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.14em;
  line-height: 1;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.nt-skeleton__spinner {
  font-size: 12px;
}

.nt-skeleton__layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Misma hoja que el formulario real: una sola superficie translúcida con
   los cuatro pasos, no cuatro tarjetas. */
.nt-skeleton__sheet {
  padding: 6px 16px;
  background-color: color-mix(in srgb, var(--color-on-strong) 3.5%, transparent);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 10%, transparent);
  border-radius: 4px;
}

.nt-skeleton__band {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 0;
}

.nt-skeleton__band + .nt-skeleton__band {
  border-top: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 10%, transparent);
}

.nt-skeleton__head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nt-skeleton__stack {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nt-skeleton__body {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.nt-skeleton__row {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.nt-skeleton__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.nt-skeleton__bar {
  display: block;
  background-color: color-mix(in srgb, var(--color-on-strong) 14%, transparent);
  border-radius: 2px;
  animation: nt-skeleton-pulse 1400ms ease-in-out infinite;
}

.nt-skeleton__bar--num {
  flex: none;
  width: 24px;
  height: 24px;
  margin: 3px;
  border-radius: 3px;
  rotate: 45deg;
}

.nt-skeleton__bar--title {
  width: 130px;
  height: 14px;
}

.nt-skeleton__bar--hint {
  width: 170px;
  height: 10px;
  margin-top: 8px;
  background-color: color-mix(in srgb, var(--color-on-strong) 9%, transparent);
}

.nt-skeleton__bar--label {
  width: 80px;
  height: 9px;
}

/* El campo por llegar conserva su filete inferior de 2px: la espera anticipa
   la forma del control reglado, no un rectángulo neutro. */
.nt-skeleton__bar--control {
  width: 100%;
  height: 46px;
  background-color: color-mix(in srgb, var(--color-on-strong) 7%, transparent);
  border-bottom: var(--border-width-emphasis) solid
    color-mix(in srgb, var(--color-brand-accent-surface) 45%, transparent);
}

.nt-skeleton__rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Boleto por llegar: misma superficie elevada, filete superior de acento y
   perforación que el resumen real. */
.nt-skeleton__ticket {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background-color: var(--color-field-strong-raised);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-top: 3px solid color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
  border-radius: 4px;
}

.nt-skeleton__bar--time {
  width: 120px;
  height: 40px;
}

.nt-skeleton__bar--value {
  width: 150px;
  height: 14px;
}

.nt-skeleton__perforation {
  margin: 4px -16px;
  border-top: 2px dashed color-mix(in srgb, var(--color-on-strong) 16%, transparent);
}

.nt-skeleton__bar--cta {
  width: 100%;
  height: 48px;
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 35%, transparent);
}

@media (min-width: 640px) {
  .nt-skeleton__body {
    padding-left: 44px;
  }

  .nt-skeleton__row {
    flex-direction: row;
    gap: 16px;
  }
}

@keyframes nt-skeleton-pulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nt-skeleton__bar {
    animation: none;
    opacity: 0.8;
  }
}

@media (min-width: 1024px) {
  .nt-skeleton {
    gap: 18px;
  }

  .nt-skeleton__status {
    gap: 12px;
    font-size: var(--font-size-caption);
  }

  .nt-skeleton__spinner {
    font-size: 13px;
  }

  /* Misma retícula que el formulario real: hoja y boleto de 340px. */
  .nt-skeleton__layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    align-items: start;
    gap: 28px;
    max-width: 1240px;
  }

  .nt-skeleton__sheet {
    padding: 4px 28px;
  }

  .nt-skeleton__band {
    padding: 22px 0;
  }

  .nt-skeleton__head {
    gap: 18px;
  }

  .nt-skeleton__body {
    padding-left: 52px;
  }

  .nt-skeleton__ticket {
    padding: 20px;
  }

  .nt-skeleton__body {
    gap: 14px;
  }

  .nt-skeleton__row {
    gap: 20px;
  }

  .nt-skeleton__field {
    gap: 9px;
  }

  .nt-skeleton__bar--num {
    width: 34px;
    height: 34px;
  }

  .nt-skeleton__bar--title {
    width: 150px;
    height: 15px;
  }

  .nt-skeleton__bar--hint {
    width: 190px;
    height: 10px;
    margin-top: 9px;
  }

  .nt-skeleton__bar--label {
    width: 88px;
  }
}
</style>
