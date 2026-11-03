<script setup lang="ts">
// Las cinco escenas de «Un día con NAVA». Cada una dibuja, con el lenguaje
// del producto y datos ficticios, lo que pasa en ese paso del recorrido: el
// chat, la reserva, la agenda, el recordatorio y el cierre con reseña. Son
// ilustraciones (ocultas a las tecnologías de apoyo): el texto de cada paso,
// que sí se lee, está en JourneySection. Cambiar `step` remonta la escena y
// reinicia su animación.
defineProps<{ step: number }>()

const bookingRows = [
  { k: 'Servicio', v: 'Corte y barba' },
  { k: 'Profesional', v: 'Valeria' },
  { k: 'Horario', v: 'Hoy · 5:30 pm' },
  { k: 'A nombre de', v: 'Mateo R.' },
]
const agendaBlocks = [
  { l: 4, w: 22, tone: 'completed', t: 'Laura M.' },
  { l: 30, w: 20, tone: 'completed', t: 'Felipe A.' },
  { l: 56, w: 18, tone: 'confirmed', t: 'Sergio L.' },
]
</script>

<template>
  <div class="js" aria-hidden="true">
    <!-- 1 · El cliente escribe -->
    <div v-if="step === 0" class="js__scene js__chat">
      <p class="js__msg js__msg--in" style="--d: 0">Hola, ¿tienen hueco hoy después de las 5?</p>
      <p class="js__msg js__msg--out" style="--d: 1">
        Sí. Libres con cualquier profesional:
        <span class="js__chips"><b>5:30 pm</b><b>6:15 pm</b><b>7:00 pm</b></span>
      </p>
      <p class="js__msg js__msg--in" style="--d: 2">La de las 5:30, gracias.</p>
      <p class="js__msg js__msg--out" style="--d: 3">Aquí tienes el enlace para confirmarla.</p>
      <span class="js__link" style="--d: 4">nava.app/reservar/tu-barberia</span>
    </div>

    <!-- 2 · Reserva desde el celular -->
    <div v-else-if="step === 1" class="js__scene js__book">
      <p class="js__kicker">Reservar un turno</p>
      <ul>
        <li v-for="(row, i) in bookingRows" :key="row.k" :style="{ '--d': i }">
          <i class="js__tick"></i>
          <span>{{ row.k }}</span>
          <b>{{ row.v }}</b>
        </li>
      </ul>
      <span class="js__cta" style="--d: 5">Confirmar turno</span>
    </div>

    <!-- 3 · La agenda se actualiza -->
    <div v-else-if="step === 2" class="js__scene js__agenda">
      <p class="js__kicker">
        Agenda · hoy
        <span class="js__count"
          ><span class="js__num"
            ><b class="js__count-old">10</b><b class="js__count-new">11</b></span
          >
          turnos</span
        >
      </p>
      <div class="js__lane">
        <span
          v-for="b in agendaBlocks"
          :key="b.t"
          class="js__block"
          :class="`js__block--${b.tone}`"
          :style="{ left: `${b.l}%`, width: `${b.w}%` }"
          >{{ b.t }}</span
        >
        <span class="js__block js__block--new">Mateo R.</span>
      </div>
      <p class="js__note">Un turno nuevo ocupa su hueco. Nadie más puede reservarlo.</p>
    </div>

    <!-- 4 · Recordatorio a tiempo -->
    <div v-else-if="step === 3" class="js__scene js__remind">
      <div class="js__card">
        <span class="js__card-head"><i></i>NAVA · Recordatorio</span>
        <p>Hola Mateo, hoy a las <b>5:30 pm</b> tienes turno de corte y barba con Valeria.</p>
        <span class="js__card-act">Ver o cambiar mi turno</span>
      </div>
      <span class="js__sent"><i></i>Enviado por WhatsApp y correo</span>
    </div>

    <!-- 5 · Atendido y con reseña -->
    <div v-else class="js__scene js__done">
      <p class="js__kicker">Detalle del turno</p>
      <div class="js__status">
        <span class="js__status-a">Confirmado</span>
        <span class="js__status-b">Atendido</span>
      </div>
      <div class="js__stars">
        <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :style="{ '--d': n }">
          <path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" />
        </svg>
      </div>
      <p class="js__review">«Salí feliz con el corte y la atención fue impecable.»</p>
      <span class="js__sent"><i></i>Reseña publicada</span>
    </div>
  </div>
</template>

<style scoped>
.js {
  position: relative;
  display: grid;
  min-height: 440px;
  padding: 32px;
  background: var(--ln-ink-deep);
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 40px 80px -36px
    color-mix(in srgb, var(--color-action-primary-active) 90%, transparent);
  overflow: hidden;
}

.js::before,
.js::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  border: 0 solid var(--ln-brass);
}

.js::before {
  top: -1px;
  left: -1px;
  border-top-width: 2px;
  border-left-width: 2px;
}

.js::after {
  right: -1px;
  bottom: -1px;
  border-right-width: 2px;
  border-bottom-width: 2px;
}

.js__scene {
  display: grid;
  align-content: center;
  gap: 16px;
  animation: js-in 520ms var(--motion-ease-out) backwards;
}

.js__kicker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ln-brass);
}

/* Chat */
.js__msg {
  max-width: 84%;
  margin: 0;
  padding: 14px 18px;
  border-radius: 16px;
  font-size: 18px;
  line-height: 1.45;
  animation: js-pop 520ms var(--motion-ease-spring) backwards;
  animation-delay: calc(var(--d, 0) * 700ms + 200ms);
}

.js__msg--in {
  justify-self: end;
  border-bottom-right-radius: 4px;
  background: var(--ln-brass);
  color: var(--color-brand-accent-text);
}

.js__msg--out {
  justify-self: start;
  border-bottom-left-radius: 4px;
  background: var(--ln-ink-raised);
  border: 1px solid var(--ln-line);
}

.js__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.js__chips b {
  padding: 5px 12px;
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-pill);
  font-size: 15px;
  color: var(--ln-brass);
}

.js__link {
  justify-self: start;
  padding: 10px 16px;
  border: 1px dashed var(--ln-brass);
  border-radius: var(--radius-md);
  font-size: 16px;
  color: var(--ln-brass);
  animation: js-pop 520ms var(--motion-ease-spring) backwards;
  animation-delay: calc(var(--d, 0) * 700ms + 200ms);
}

/* Reserva */
.js__book ul {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--ln-line);
}

.js__book li {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ln-line);
  font-size: 18px;
  animation: js-slide 520ms var(--motion-ease-out) backwards;
  animation-delay: calc(var(--d, 0) * 420ms + 200ms);
}

.js__book li span {
  color: var(--ln-muted);
}

.js__book li b {
  font-weight: 600;
}

.js__tick {
  width: 10px;
  height: 10px;
  background: var(--ln-brass);
  transform: rotate(45deg);
}

.js__cta {
  display: grid;
  place-items: center;
  min-height: 54px;
  margin-top: 8px;
  border-radius: var(--radius-md);
  background: var(--ln-brass);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-brand-accent-text);
  animation: js-pop 520ms var(--motion-ease-spring) backwards;
  animation-delay: 2.3s;
}

/* Agenda */
.js__count {
  display: inline-flex;
  gap: 6px;
  color: var(--ln-soft);
  letter-spacing: 0.04em;
  text-transform: none;
  font-weight: 500;
}

.js__num {
  display: inline-grid;
}

.js__num b {
  grid-area: 1 / 1;
  font-weight: 700;
  text-align: right;
}

.js__count-old {
  animation: js-out 400ms ease 1.5s forwards;
}

.js__count-new {
  color: var(--ln-brass);
  animation: js-pop 500ms var(--motion-ease-spring) 1.6s backwards;
}

.js__lane {
  position: relative;
  height: 86px;
  border-block: 1px solid var(--ln-line);
  background-image: repeating-linear-gradient(
    to right,
    var(--ln-line) 0,
    var(--ln-line) 1px,
    transparent 1px,
    transparent 12.5%
  );
}

.js__block {
  position: absolute;
  top: 10px;
  bottom: 10px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-left: 3px solid var(--tone, var(--ln-brass));
  border-radius: 2px;
  background: color-mix(in srgb, var(--tone, var(--ln-brass)) 18%, var(--ln-ink-deep));
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  animation: js-pop 480ms var(--motion-ease-spring) backwards;
}

.js__block--completed {
  --tone: var(--color-success-on-strong);
}

.js__block--confirmed {
  --tone: var(--color-info-on-strong);
}

.js__block--new {
  --tone: var(--ln-brass);
  left: 80%;
  width: 18%;
  box-shadow:
    0 0 0 1px var(--ln-brass-line),
    0 0 24px color-mix(in srgb, var(--ln-brass) 50%, transparent);
  animation: js-drop 900ms var(--motion-ease-spring) 1.1s backwards;
}

.js__note {
  margin: 0;
  font-size: 17px;
  color: var(--ln-muted);
}

/* Recordatorio */
.js__remind {
  justify-items: start;
}

.js__card {
  display: grid;
  gap: 14px;
  width: min(100%, 420px);
  padding: 20px 22px;
  background: var(--ln-ink-raised);
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-lg);
  animation: js-drop 800ms var(--motion-ease-spring) 0.2s backwards;
}

.js__card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ln-brass);
}

.js__card-head i,
.js__sent i {
  width: 9px;
  height: 9px;
  background: var(--ln-brass);
  transform: rotate(45deg);
}

.js__card p {
  margin: 0;
  font-size: 19px;
  line-height: 1.5;
}

.js__card-act {
  justify-self: start;
  padding: 9px 16px;
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-pill);
  font-size: 16px;
  font-weight: 600;
  color: var(--ln-brass);
}

.js__sent {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  color: var(--color-success-on-strong);
  animation: js-fade 600ms ease 1.2s backwards;
}

.js__sent i {
  background: var(--color-success-on-strong);
}

/* Cierre */
.js__status {
  position: relative;
  display: grid;
  height: 54px;
}

.js__status span {
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  align-self: center;
  justify-self: start;
  padding: 10px 20px;
  border: 1px solid var(--tone);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
  font-size: 17px;
  font-weight: 600;
  color: var(--tone);
}

.js__status-a {
  --tone: var(--color-info-on-strong);
  animation: js-out 420ms ease 1s forwards;
}

.js__status-b {
  --tone: var(--color-success-on-strong);
  animation: js-pop 520ms var(--motion-ease-spring) 1.2s backwards;
}

.js__stars {
  display: flex;
  gap: 8px;
}

.js__stars svg {
  width: 38px;
  height: 38px;
  fill: transparent;
  stroke: var(--ln-brass);
  stroke-width: 1.4;
  animation: js-star 500ms var(--motion-ease-spring) forwards;
  animation-delay: calc(1.9s + var(--d) * 160ms);
}

.js__review {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.25;
  animation: js-fade 700ms ease 2.8s backwards;
}

@keyframes js-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes js-pop {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.92);
  }
}

@keyframes js-slide {
  from {
    opacity: 0;
    transform: translateX(-16px);
  }
}

@keyframes js-drop {
  from {
    opacity: 0;
    transform: translateY(-48px) scale(0.9);
  }
}

@keyframes js-fade {
  from {
    opacity: 0;
  }
}

@keyframes js-out {
  to {
    opacity: 0;
    transform: translateY(-8px);
  }
}

@keyframes js-star {
  to {
    fill: var(--ln-brass);
  }
}

@media (max-width: 520px) {
  .js {
    min-height: 0;
    padding: 22px 18px;
  }

  .js__msg,
  .js__book li {
    font-size: 16px;
  }

  .js__review {
    font-size: 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .js__scene,
  .js__msg,
  .js__link,
  .js__book li,
  .js__cta,
  .js__block,
  .js__card,
  .js__sent,
  .js__review,
  .js__stars svg {
    animation: none;
  }

  .js__status-a {
    display: none;
  }

  .js__count-old {
    animation: none;
    opacity: 0;
  }

  .js__count-new {
    animation: none;
    opacity: 1;
  }

  .js__status-b {
    animation: none;
  }

  .js__stars svg {
    fill: var(--ln-brass);
  }
}
</style>
