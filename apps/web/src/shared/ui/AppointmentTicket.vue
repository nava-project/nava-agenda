<script setup lang="ts">
/**
 * AppointmentTicket · la tarjeta de turno (DEC-189, #730).
 *
 * Lo que el cliente se lleva del mostrador. La misma tarjeta en el resumen
 * antes de confirmar, en la confirmación, en mi turno y al cambiar la hora:
 * - cabecera: el negocio en versalitas de latón, el servicio en serif y su dato;
 * - troquel con muescas;
 * - cuerpo: hoja de calendario y la hora en serif;
 * - la regla del día con tu rombo;
 * - pie: el profesional.
 *
 * Estados:
 * - `draft`: borde punteado, «Por confirmar» en latón y el rombo vacío;
 * - `confirmed`: sello «Confirmado» a −4° en el color del estado del sistema
 *   (el mismo de la libreta: un estado, un color);
 * - `cancelled`, `completed`, `no-show`: el sello en el color de su estado.
 *
 * `ceremony`: al confirmar, la tarjeta se escribe una sola vez en ≤ 1,1 s.
 * El borde se cierra, la hora se asienta, el rombo pasa a Sol y el sello se
 * estampa. Con movimiento reducido (sistema o preferencia del panel), el
 * primer cuadro ya es el estado final.
 */
import { computed } from 'vue'
import DayRuler from './DayRuler.vue'
import ProfessionalAvatar from './ProfessionalAvatar.vue'

export type AppointmentTicketState = 'draft' | 'confirmed' | 'cancelled' | 'completed' | 'no-show'

interface Props {
  businessName: string
  serviceName: string
  /** Dato bajo el servicio: «45 min · $ 35.000». */
  meta?: string
  /** «Jueves» o «Jueves · en 7 días». */
  weekday: string
  /** Mes abreviado de la hoja de calendario: «NOV». */
  month: string
  /** Día del mes: «26». */
  day: string
  /** Hora de inicio con su sufijo: «11:00 a. m.». */
  time: string
  /** Nota bajo la hora: «Hora de Colombia» o «hasta 10:30 a. m. · Hora de Colombia». */
  timeNote?: string
  professionalName?: string
  professionalPhotoUrl?: string | null
  /** Rótulo del profesional según el vocabulario del negocio. */
  professionalLabel?: string
  state: AppointmentTicketState
  /** Texto del sello o del pendiente; por omisión, el del estado. */
  stateLabel?: string
  /** La regla del día con tu rombo; sin ella, la tarjeta no la dibuja. */
  ruler?: {
    from: number
    to: number
    at: number
    label: string
    /** «Ahora», en minutos: el Sol sobre la regla mientras el turno está en curso. */
    now?: number | null
  } | null
  ceremony?: boolean
  /** Nombre accesible de la tarjeta. */
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  meta: '',
  timeNote: '',
  professionalName: '',
  professionalPhotoUrl: null,
  professionalLabel: 'Profesional',
  stateLabel: '',
  ruler: null,
  ceremony: false,
  label: 'Tu turno',
})

const DEFAULT_LABEL: Record<AppointmentTicketState, string> = {
  draft: 'Por confirmar',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Atendido',
  'no-show': 'No asistió',
}

const seal = computed(() => props.stateLabel || DEFAULT_LABEL[props.state])

// «11:00 a. m.» → la cifra grande y el sufijo pequeño.
const timeParts = computed(() => {
  const i = props.time.indexOf(' ')
  return i < 0
    ? { clock: props.time, suffix: '' }
    : { clock: props.time.slice(0, i), suffix: props.time.slice(i + 1) }
})

const rulerMarks = computed(() =>
  props.ruler
    ? [
        {
          at: props.ruler.at,
          kind: props.state === 'draft' ? ('draft' as const) : ('mine' as const),
        },
      ]
    : [],
)
</script>

<template>
  <article
    class="appointment-ticket"
    :class="[`appointment-ticket--${state}`, { 'appointment-ticket--ceremony': ceremony }]"
    :aria-label="label"
  >
    <header class="appointment-ticket__head">
      <p class="appointment-ticket__business">{{ businessName }}</p>
      <p class="appointment-ticket__service">{{ serviceName }}</p>
      <p v-if="meta" class="appointment-ticket__meta">{{ meta }}</p>
      <p v-if="state === 'draft'" class="appointment-ticket__pending">
        <span class="appointment-ticket__pending-mark" aria-hidden="true" />{{ seal }}
      </p>
      <p v-else class="appointment-ticket__seal">
        <span class="appointment-ticket__seal-mark" aria-hidden="true" />{{ seal }}
      </p>
    </header>

    <div class="appointment-ticket__perforation" aria-hidden="true" />

    <div class="appointment-ticket__body">
      <p class="appointment-ticket__leaf" aria-hidden="true">
        <span class="appointment-ticket__leaf-month">{{ month }}</span>
        <span class="appointment-ticket__leaf-day">{{ day }}</span>
      </p>
      <div class="appointment-ticket__when">
        <p class="appointment-ticket__weekday">{{ weekday }}</p>
        <p class="appointment-ticket__time">
          {{ timeParts.clock }}<small v-if="timeParts.suffix">&nbsp;{{ timeParts.suffix }}</small>
        </p>
        <p v-if="timeNote" class="appointment-ticket__note">{{ timeNote }}</p>
      </div>
    </div>

    <DayRuler
      v-if="ruler"
      class="appointment-ticket__ruler"
      size="card"
      :from="ruler.from"
      :to="ruler.to"
      :marks="rulerMarks"
      :now="ruler.now ?? null"
      :label="ruler.label"
    />

    <slot />

    <footer v-if="professionalName" class="appointment-ticket__foot">
      <ProfessionalAvatar
        size="row"
        :full-name="professionalName"
        :photo-url="professionalPhotoUrl ?? undefined"
      />
      <p class="appointment-ticket__who">
        <span class="appointment-ticket__who-label">{{ professionalLabel }}</span>
        {{ professionalName }}
      </p>
    </footer>
  </article>
</template>

<style scoped>
/* --ticket-backdrop: el color de lo que hay detrás de la tarjeta, para calar las
   muescas del troquel. Por omisión, el lienzo; dentro de una hoja, su superficie. */
.appointment-ticket {
  --ticket-seal: var(--color-info-text);

  position: relative;
  color: var(--color-text-primary);
  background-color: var(--color-surface);
  border: 1px solid var(--color-brass-line);
  border-radius: 4px;
  box-shadow: var(--shadow-raised);
}

.appointment-ticket--draft {
  border-style: dashed;
  box-shadow: none;
}

.appointment-ticket--cancelled {
  --ticket-seal: var(--color-inactive-text);
}

.appointment-ticket--completed {
  --ticket-seal: var(--color-success-text);
}

.appointment-ticket--no-show {
  --ticket-seal: var(--color-status-no-show-text);
}

.appointment-ticket__head {
  position: relative;
  padding: 18px 22px 14px;
}

.appointment-ticket__head p {
  margin: 0;
}

.appointment-ticket__business {
  padding-right: 132px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 16px;
  color: var(--color-brass-text);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.appointment-ticket__service {
  margin-top: 6px !important;
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 400;
  line-height: 34px;
  overflow-wrap: anywhere;
}

.appointment-ticket__meta {
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

/* Sello: timbre de consultorio a −4°, en el color del estado. */
.appointment-ticket__seal {
  position: absolute;
  top: 20px;
  right: 18px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  color: var(--ticket-seal);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: 2px solid currentColor;
  border-radius: 3px;
  outline: 1px solid currentColor;
  outline-offset: 2px;
  transform: rotate(-4deg);
}

.appointment-ticket__seal-mark {
  width: 7px;
  height: 7px;
  background-color: currentColor;
  transform: rotate(45deg);
}

/* «Por confirmar»: texto en latón con el rombo vacío, sin caja (no es un botón). */
.appointment-ticket__pending {
  position: absolute;
  top: 20px;
  right: 22px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  color: var(--color-brass-text);
}

.appointment-ticket__pending-mark {
  width: 9px;
  height: 9px;
  border: 1.5px solid currentColor;
  transform: rotate(45deg);
}

/* Troquel: línea punteada de latón con las muescas a los lados. */
.appointment-ticket__perforation {
  position: relative;
  height: 0;
  margin: 0 14px;
  border-top: 1.5px dashed color-mix(in srgb, var(--color-brass-line) 75%, transparent);
}

.appointment-ticket__perforation::before,
.appointment-ticket__perforation::after {
  position: absolute;
  top: -9px;
  width: 16px;
  height: 16px;
  content: '';
  background-color: var(--ticket-backdrop, var(--color-canvas));
  border: 1px solid var(--color-brass-line);
  border-radius: 50%;
}

.appointment-ticket__perforation::before {
  left: -23px;
  clip-path: inset(0 0 0 50%);
}

.appointment-ticket__perforation::after {
  right: -23px;
  clip-path: inset(0 50% 0 0);
}

.appointment-ticket__body {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  padding: 16px 22px 4px;
}

.appointment-ticket__body p {
  margin: 0;
}

.appointment-ticket__leaf {
  overflow: hidden;
  text-align: center;
  background-color: var(--color-surface);
  border: 1px solid var(--color-brass-line);
  border-radius: 3px;
}

.appointment-ticket__leaf-month {
  display: block;
  font-size: 11px;
  font-weight: 700;
  line-height: 22px;
  color: #101b2b;
  letter-spacing: 0.14em;
  background-color: var(--color-brass-body);
}

.appointment-ticket__leaf-day {
  display: block;
  font-family: var(--font-display);
  font-size: 38px;
  line-height: 50px;
}

.appointment-ticket__weekday {
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

.appointment-ticket__time {
  margin: 2px 0 6px !important;
  font-family: var(--font-display);
  font-size: 42px;
  line-height: 44px;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

.appointment-ticket__time small {
  font-size: 20px;
}

.appointment-ticket__note {
  font-size: 12.5px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.appointment-ticket__ruler {
  margin: 4px 22px 0;
}

.appointment-ticket__foot {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 22px 16px;
  margin-top: 6px;
  border-top: 1px solid var(--color-border-subtle);
}

.appointment-ticket__who {
  margin: 0;
  font-size: 15px;
  line-height: 20px;
}

.appointment-ticket__who-label {
  display: block;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
}

@media (max-width: 479px) {
  .appointment-ticket__business {
    padding-right: 0;
  }

  .appointment-ticket__head {
    padding-bottom: 54px;
  }

  .appointment-ticket__seal,
  .appointment-ticket__pending {
    top: auto;
    bottom: 16px;
    left: 22px;
    right: auto;
  }

  .appointment-ticket__time {
    font-size: 36px;
    line-height: 40px;
  }
}

/* ── Ceremonia: una sola vez, ≤ 1,1 s ──────────────────────────────────────
   Solo existe con movimiento permitido; si no, el primer cuadro ya es el
   estado final. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .appointment-ticket--ceremony {
    animation: ticket-close 320ms ease-out both;
  }

  :root:not([data-motion='reduced']) .appointment-ticket--ceremony::after {
    position: absolute;
    inset: -1px;
    pointer-events: none;
    content: '';
    border: 1px dashed var(--color-brass-line);
    border-radius: inherit;
    animation: ticket-dash 320ms ease-out both;
  }

  :root:not([data-motion='reduced']) .appointment-ticket--ceremony .appointment-ticket__time {
    animation: ticket-settle 450ms 150ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced']) .appointment-ticket--ceremony :deep(.day-ruler__mark--mine) {
    animation: ticket-mark 420ms 380ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced']) .appointment-ticket--ceremony .appointment-ticket__seal {
    animation: ticket-stamp 380ms 720ms cubic-bezier(0.3, 1.4, 0.5, 1) both;
  }
}

@keyframes ticket-close {
  from {
    border-color: transparent;
    box-shadow: none;
  }
}

@keyframes ticket-dash {
  to {
    opacity: 0;
  }
}

@keyframes ticket-settle {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

@keyframes ticket-mark {
  from {
    background: #fffdf8;
    border-style: dashed;
    box-shadow: 0 0 0 1.5px #fffdf8;
    transform: translate(-50%, -50%) rotate(45deg) scale(0.6);
  }

  60% {
    box-shadow:
      0 0 0 1.5px #fffdf8,
      0 0 0 12px color-mix(in srgb, var(--color-sun) 45%, transparent);
  }
}

@keyframes ticket-stamp {
  from {
    opacity: 0;
    transform: rotate(-4deg) scale(1.6);
  }

  60% {
    opacity: 1;
    transform: rotate(-4deg) scale(0.94);
  }
}
</style>
