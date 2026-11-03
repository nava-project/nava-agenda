<script setup lang="ts">
// Primera pantalla: qué es NAVA y que trae un asistente de IA para los chats
// de la barbería. A la izquierda el mensaje y las dos acciones (contratar,
// iniciar sesión); a la derecha la agenda de demostración con el aviso del
// turno que acaba de apartar el asistente. Sobre una mesa de patronaje que se
// dibuja sola.
import { RouterLink } from 'vue-router'
import AgendaScene from './AgendaScene.vue'
import LandingBackdrop from './LandingBackdrop.vue'
</script>

<template>
  <section id="inicio" class="hero" aria-labelledby="hero-title">
    <LandingBackdrop />

    <div class="ln-wrap hero__grid">
      <div class="hero__copy">
        <p class="ln-eyebrow nv-rise" style="--i: 0">Gestión para barberías y salones</p>
        <h1 id="hero-title" class="hero__title nv-rise" style="--i: 1">
          La agenda de tu barbería, <em>cortada a medida.</em>
        </h1>
        <p class="ln-lead nv-rise" style="--i: 2">
          NAVA reúne turnos, equipo, horarios y reservas en un solo lugar. Y un asistente de IA
          atiende el chat de tu negocio mientras tú atiendes a tu gente.
        </p>

        <div class="hero__actions nv-rise" style="--i: 3">
          <a class="ln-btn ln-btn--solid" href="#contacto">
            Quiero NAVA en mi barbería
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <RouterLink class="ln-btn ln-btn--line" :to="{ name: 'acceso' }"
            >Iniciar sesión</RouterLink
          >
        </div>

        <ul class="hero__proof nv-rise" style="--i: 4">
          <li>Reservas sin crear cuenta</li>
          <li>Recordatorios por correo y WhatsApp</li>
          <li>Asistente de IA en tu chat</li>
        </ul>
      </div>

      <div class="hero__stage nv-pop" style="--i: 3">
        <AgendaScene />

        <div class="hero__toast" aria-hidden="true">
          <span class="hero__toast-mark"></span>
          <span class="hero__toast-text">
            <b>Nuevo turno</b>
            <small>5:30 pm · llegó desde el chat</small>
          </span>
        </div>
      </div>
    </div>

    <a class="hero__scroll" href="#asistente" aria-label="Conocer al asistente de IA">
      <span>Desliza</span>
      <i></i>
    </a>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 100svh;
  padding: 120px 0 112px;
}

.hero__grid {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 56px;
  align-items: center;
}

.hero__copy {
  display: grid;
  gap: 26px;
  justify-items: start;
}

.hero__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(46px, 7.6vw, 100px);
  line-height: 0.98;
  letter-spacing: -0.012em;
  text-wrap: balance;
}

.hero__title em {
  position: relative;
  font-style: normal;
  color: var(--ln-brass);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 6px;
}

.hero__proof {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 28px;
  margin: 10px 0 0;
  padding: 18px 0 0;
  list-style: none;
  border-top: 1px solid var(--ln-line);
  font-size: 13px;
  letter-spacing: 0.03em;
  color: var(--ln-muted);
}

.hero__proof li {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.hero__proof li::before {
  content: '';
  width: 5px;
  height: 5px;
  background: var(--ln-brass);
  transform: rotate(45deg);
}

.hero__stage {
  position: relative;
  min-width: 0;
}

.hero__toast {
  position: absolute;
  left: -14px;
  bottom: -50px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px 12px 14px;
  background: var(--ln-ink-raised);
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 50px -18px
    color-mix(in srgb, var(--color-action-primary-active) 90%, transparent);
  animation: hero-bob 6s ease-in-out infinite;
}

.hero__toast-mark {
  width: 14px;
  height: 14px;
  background: var(--ln-brass);
  transform: rotate(45deg);
  animation: hero-ping 9s ease-out infinite;
}

.hero__toast-text {
  display: grid;
}

.hero__toast-text b {
  font-size: 14px;
  line-height: 18px;
}

.hero__toast-text small {
  font-size: 12px;
  line-height: 16px;
  color: var(--ln-muted);
}

.hero__scroll {
  position: absolute;
  left: 50%;
  bottom: 22px;
  z-index: 1;
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  transform: translateX(-50%);
  font-size: 11px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--ln-muted);
}

.hero__scroll i {
  position: relative;
  width: 1px;
  height: 38px;
  overflow: hidden;
  background: var(--ln-line-strong);
}

.hero__scroll i::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--ln-brass);
  animation: hero-scroll 2.2s ease-in-out infinite;
}

@keyframes hero-bob {
  50% {
    transform: translateY(-9px);
  }
}

@keyframes hero-ping {
  0%,
  38% {
    box-shadow: 0 0 0 0 transparent;
  }

  46% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-brand-accent-surface) 70%, transparent);
  }

  70%,
  100% {
    box-shadow: 0 0 0 16px transparent;
  }
}

@keyframes hero-scroll {
  0% {
    transform: translateY(-100%);
  }

  100% {
    transform: translateY(100%);
  }
}

@media (min-width: 1020px) {
  .hero__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: 72px;
  }

  .hero__scroll {
    display: flex;
  }
}

@media (max-width: 520px) {
  .hero {
    padding-top: 104px;
  }

  .hero__toast {
    left: 8px;
    bottom: -52px;
  }

  .hero__actions .ln-btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero__toast,
  .hero__toast-mark,
  .hero__scroll i::after {
    animation: none;
  }
}
</style>
