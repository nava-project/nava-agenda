<script setup lang="ts">
// Segunda parte de la presentación: el asistente de IA para los chats. El
// teléfono conversa solo; a su lado, lo que hace y el camino que recorre una
// pregunta (chat → asistente → agenda de NAVA). Solo se afirma lo que el
// asistente hace hoy: leer la disponibilidad real y llevar al cliente al
// enlace de reserva; no confirma turnos por su cuenta.
import { ref } from 'vue'
import { assistantPoints } from '../model/landingContent'
import { useInView } from '../composables/useInView'
import AssistantPhone from './AssistantPhone.vue'

const root = ref<HTMLElement | null>(null)
const { seen } = useInView(root, 0.15)
</script>

<template>
  <section id="asistente" ref="root" class="as" aria-labelledby="as-title" :data-seen="seen">
    <span class="as__halo" aria-hidden="true"></span>
    <div class="ln-wrap as__grid">
      <div class="as__phone ln-reveal" :data-seen="seen">
        <AssistantPhone />
      </div>

      <div class="as__copy">
        <p class="ln-eyebrow ln-reveal" :data-seen="seen">Asistente de IA</p>
        <h2 id="as-title" class="ln-title ln-reveal" :data-seen="seen" style="--i: 1">
          Tu chat nunca se queda <em>sin respuesta.</em>
        </h2>
        <p class="ln-lead ln-reveal" :data-seen="seen" style="--i: 2">
          <b>NAVA Nexos</b>, el asistente de inteligencia artificial, atiende las conversaciones de
          tu negocio, conoce tu agenda y le da a cada cliente una respuesta clara y a tiempo.
        </p>

        <ol class="as__points">
          <li
            v-for="(point, index) in assistantPoints"
            :key="point.title"
            class="ln-reveal"
            :data-seen="seen"
            :style="{ '--i': index + 3 }"
          >
            <span class="as__num">0{{ index + 1 }}</span>
            <span>
              <b>{{ point.title }}</b>
              <small>{{ point.body }}</small>
            </span>
          </li>
        </ol>

        <div class="as__flow ln-reveal" :data-seen="seen" style="--i: 6" aria-hidden="true">
          <span class="as__node">Chat del cliente</span>
          <span class="as__wire"><i></i></span>
          <span class="as__node as__node--accent">Asistente de IA</span>
          <span class="as__wire"><i></i></span>
          <span class="as__node">Agenda de NAVA</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.as {
  position: relative;
  padding: clamp(88px, 12vw, 168px) 0;
  overflow: hidden;
}

.as__halo {
  position: absolute;
  left: -10%;
  top: 18%;
  width: 640px;
  height: 640px;
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--color-brand-accent-surface) 26%, transparent),
    transparent
  );
  filter: blur(20px);
  pointer-events: none;
}

.as__grid {
  position: relative;
  display: grid;
  gap: 64px;
  align-items: center;
}

.as__phone {
  display: grid;
  justify-items: center;
}

.as__copy {
  display: grid;
  gap: 24px;
  justify-items: start;
}

.as__points {
  display: grid;
  gap: 0;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  width: 100%;
  border-top: 1px solid var(--ln-line);
}

.as__points li {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 8px;
  padding: 22px 0;
  border-bottom: 1px solid var(--ln-line);
}

.as__num {
  font-family: var(--font-display);
  font-size: 38px;
  line-height: 1;
  color: var(--ln-brass);
}

.as__points b {
  display: block;
  margin-bottom: 4px;
  font-size: 21px;
  line-height: 28px;
  font-weight: 600;
}

.as__points small {
  display: block;
  font-size: 17px;
  line-height: 27px;
  color: var(--ln-soft);
}

.as__flow {
  display: flex;
  align-items: center;
  width: 100%;
  margin-top: 10px;
}

.as__node {
  flex: none;
  padding: 10px 14px;
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
  color: var(--ln-soft);
}

.as__node--accent {
  border-color: var(--ln-brass);
  color: var(--ln-brass);
  background: color-mix(in srgb, var(--ln-brass) 12%, transparent);
}

.as__wire {
  position: relative;
  flex: 1;
  min-width: 14px;
  height: 1px;
  background: var(--ln-line-strong);
}

.as__wire i {
  position: absolute;
  top: -2px;
  left: 0;
  width: 5px;
  height: 5px;
  background: var(--ln-brass);
  transform: rotate(45deg);
  animation: as-run 2.6s ease-in-out infinite;
}

.as__wire:nth-of-type(2) i {
  animation-delay: 1.3s;
}

@keyframes as-run {
  from {
    left: 0;
    opacity: 0;
  }

  15%,
  85% {
    opacity: 1;
  }

  to {
    left: calc(100% - 5px);
    opacity: 0;
  }
}

@media (min-width: 1020px) {
  .as__grid {
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr);
    gap: 96px;
  }
}

@media (max-width: 520px) {
  .as__flow {
    flex-wrap: wrap;
    gap: 8px;
  }

  .as__wire {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .as__wire i {
    animation: none;
    left: 50%;
    opacity: 1;
  }
}
</style>
