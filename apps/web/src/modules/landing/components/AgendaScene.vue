<script setup lang="ts">
// Agenda de demostración del hero: tres carriles de profesionales sobre una
// regla de horas, turnos con el color de su estado, la línea «ahora» que
// avanza y, al final, un turno nuevo que cae en un hueco (el que el asistente
// de IA acaba de apartar). Es una ilustración del producto con datos
// ficticios y por eso va oculta a las tecnologías de apoyo; la información
// equivalente está en el texto de la sección. Se construye con el mismo
// lenguaje del panel real (carriles, filetes de estado, tinta levantada) sin
// importar nada del módulo `agenda`.

interface DemoTurn {
  lane: number
  start: number // hora decimal
  end: number
  who: string
  what: string
  status: 'confirmed' | 'pending' | 'completed' | 'noshow'
}

const FIRST_HOUR = 9
const LAST_HOUR = 19
const SPAN = LAST_HOUR - FIRST_HOUR
const hours = Array.from({ length: SPAN + 1 }, (_, i) => FIRST_HOUR + i)

const lanes = [
  { name: 'Andrés', initials: 'A' },
  { name: 'Valeria', initials: 'V' },
  { name: 'Marta', initials: 'M' },
]

const turns: readonly DemoTurn[] = [
  { lane: 0, start: 9, end: 10, who: 'Mateo R.', what: 'Corte', status: 'completed' },
  { lane: 0, start: 10.5, end: 12, who: 'Santiago P.', what: 'Corte y barba', status: 'completed' },
  { lane: 0, start: 14, end: 15, who: 'Camilo V.', what: 'Barba', status: 'confirmed' },
  { lane: 0, start: 16, end: 17.5, who: 'Daniel O.', what: 'Corte y barba', status: 'pending' },
  { lane: 1, start: 9.5, end: 11, who: 'Laura M.', what: 'Color', status: 'completed' },
  { lane: 1, start: 12, end: 13, who: 'Esteban G.', what: 'Manicure', status: 'noshow' },
  { lane: 1, start: 15, end: 16.5, who: 'Nicolás T.', what: 'Corte y color', status: 'confirmed' },
  { lane: 2, start: 10, end: 11, who: 'Felipe A.', what: 'Masaje', status: 'completed' },
  { lane: 2, start: 13.5, end: 14.5, who: 'Sergio L.', what: 'Facial', status: 'confirmed' },
  { lane: 2, start: 16.5, end: 17.5, who: 'Tomás H.', what: 'Masaje', status: 'pending' },
]

// Turno que «aterriza» desde el chat: 5:30 pm con Valeria.
const landed = { lane: 1, start: 17.5, end: 18.75, who: 'Nuevo', what: 'Del chat' }

const pct = (hour: number) => `${((hour - FIRST_HOUR) / SPAN) * 100}%`
const width = (a: number, b: number) => `${((b - a) / SPAN) * 100}%`
const hourLabel = (h: number) => (h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`)
</script>

<template>
  <div class="ag" aria-hidden="true">
    <div class="ag__top">
      <span class="ag__title"><i class="ag__live"></i>Agenda · hoy</span>
      <span class="ag__count">10 turnos</span>
    </div>

    <div class="ag__board">
      <div class="ag__ruler">
        <span v-for="h in hours" :key="h" :style="{ left: pct(h) }">{{ hourLabel(h) }}</span>
      </div>

      <div v-for="(lane, li) in lanes" :key="lane.name" class="ag__lane" :style="{ '--l': li }">
        <span class="ag__who"
          ><b>{{ lane.initials }}</b></span
        >
        <div class="ag__track">
          <span v-for="h in hours" :key="h" class="ag__tick" :style="{ left: pct(h) }"></span>
          <span
            v-for="(t, ti) in turns.filter((x) => x.lane === li)"
            :key="`${t.lane}-${t.start}`"
            class="ag__turn"
            :class="`ag__turn--${t.status}`"
            :style="{
              left: pct(t.start),
              width: width(t.start, t.end),
              '--i': li * 3 + ti,
            }"
          >
            <b>{{ t.who }}</b>
            <small>{{ t.what }}</small>
          </span>
          <span
            v-if="li === landed.lane"
            class="ag__turn ag__turn--landed"
            :style="{ left: pct(landed.start), width: width(landed.start, landed.end) }"
          >
            <b>{{ landed.who }}</b>
            <small>{{ landed.what }}</small>
          </span>
        </div>
      </div>

      <span class="ag__now"><i></i></span>
    </div>

    <div class="ag__legend">
      <span><i class="ag__dot ag__dot--completed"></i>Atendido</span>
      <span><i class="ag__dot ag__dot--confirmed"></i>Confirmado</span>
      <span><i class="ag__dot ag__dot--pending"></i>Pendiente</span>
      <span><i class="ag__dot ag__dot--noshow"></i>No asistió</span>
    </div>
  </div>
</template>

<style scoped>
.ag {
  --ag-label: 42px;
  position: relative;
  padding: 18px 18px 14px;
  background: var(--ln-ink-deep);
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-lg);
  box-shadow:
    0 40px 80px -30px color-mix(in srgb, var(--color-action-primary-active) 85%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--color-on-strong) 8%, transparent);
  color: var(--ln-text);
}

.ag__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  font-size: 14px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.ag__title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ln-brass);
  font-weight: 600;
}

.ag__count {
  color: var(--ln-muted);
}

.ag__live {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success-on-strong);
  animation: ag-blink 2s ease-in-out infinite;
}

.ag__board {
  position: relative;
  display: grid;
  gap: 10px;
}

.ag__ruler {
  position: relative;
  height: 18px;
  margin-left: var(--ag-label);
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--ln-muted);
}

.ag__ruler span {
  position: absolute;
  transform: translateX(-50%);
}

.ag__lane {
  display: flex;
  align-items: stretch;
  gap: 0;
  height: 64px;
}

.ag__who {
  flex: none;
  width: var(--ag-label);
  display: flex;
  align-items: center;
}

.ag__who b {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ln-brass-line);
  border-radius: 50%;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 400;
  color: var(--ln-brass);
}

.ag__track {
  position: relative;
  flex: 1;
  min-width: 0;
  border-top: 1px solid var(--ln-line);
  border-bottom: 1px solid var(--ln-line);
}

.ag__tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--ln-line);
}

.ag__turn {
  position: absolute;
  top: 5px;
  bottom: 5px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: 0 7px;
  overflow: hidden;
  border-left: 3px solid var(--tone);
  border-radius: 2px;
  background: color-mix(in srgb, var(--tone) 16%, var(--ln-ink-deep));
  animation: ag-in 560ms var(--motion-ease-spring) backwards;
  animation-delay: calc(900ms + var(--i, 0) * 110ms);
}

.ag__turn b,
.ag__turn small {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ag__turn b {
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.ag__turn small {
  font-size: 12px;
  line-height: 15px;
  color: var(--ln-muted);
}

.ag__turn--completed {
  --tone: var(--color-success-on-strong);
}

.ag__turn--confirmed {
  --tone: var(--color-info-on-strong);
}

.ag__turn--pending {
  --tone: var(--color-pending-on-strong);
}

.ag__turn--noshow {
  --tone: var(--color-no-show-on-strong);
}

/* El turno que cae del chat: latón, con halo, tras un respiro. */
.ag__turn--landed {
  --tone: var(--ln-brass);
  z-index: 2;
  background: color-mix(in srgb, var(--ln-brass) 28%, var(--ln-ink-deep));
  box-shadow: 0 0 0 1px var(--ln-brass-line);
  animation: ag-land 9s var(--motion-ease-spring) infinite;
}

.ag__now {
  position: absolute;
  top: 18px;
  bottom: 0;
  left: var(--ag-label);
  right: 0;
  pointer-events: none;
}

.ag__now i {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  border-right: 1.5px solid var(--color-danger-on-strong);
  transform: translateX(-100%);
  animation: ag-now 5.5s var(--motion-ease-out) 1.4s forwards;
}

.ag__now i::before {
  content: '';
  position: absolute;
  top: -3px;
  right: -5px;
  width: 7px;
  height: 7px;
  background: var(--color-danger-on-strong);
  transform: rotate(45deg);
}

.ag__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--ln-line);
  font-size: 13px;
  color: var(--ln-muted);
}

.ag__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ag__dot {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  background: var(--tone);
}

.ag__dot--completed {
  --tone: var(--color-success-on-strong);
}

.ag__dot--confirmed {
  --tone: var(--color-info-on-strong);
}

.ag__dot--pending {
  --tone: var(--color-pending-on-strong);
}

.ag__dot--noshow {
  --tone: var(--color-no-show-on-strong);
}

@keyframes ag-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.94);
  }
}

/* La línea es tan ancha como la pista: el porcentaje del translate es el
   avance real. Termina al 43 % de la jornada (hacia la 1:20 pm). */
@keyframes ag-now {
  to {
    transform: translateX(-57%);
  }
}

@keyframes ag-land {
  0%,
  38% {
    opacity: 0;
    transform: translateY(-46px) scale(0.9);
  }

  46%,
  92% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  100% {
    opacity: 0;
    transform: translateY(0) scale(1);
  }
}

@keyframes ag-blink {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 520px) {
  .ag {
    --ag-label: 30px;
    padding: 14px 12px 12px;
  }

  .ag__lane {
    height: 52px;
  }

  .ag__turn small {
    display: none;
  }

  .ag__turn b {
    font-size: 12px;
  }

  .ag__ruler span:nth-child(even) {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ag__turn,
  .ag__live {
    animation: none;
  }

  .ag__turn--landed {
    animation: none;
    opacity: 1;
  }

  .ag__now i {
    animation: none;
    transform: translateX(-57%);
  }
}
</style>
