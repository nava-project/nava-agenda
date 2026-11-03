<script setup lang="ts">
// Primera pantalla: qué es NAVA y que trae un asistente de IA para los chats
// de la barbería. A la izquierda el mensaje (el titular entra palabra por
// palabra) y las dos acciones; a la derecha la agenda de demostración con tres
// avisos flotantes —turno llegado del chat, recordatorio enviado y reseña
// nueva—, que se inclinan con el cursor. Todo sobre una mesa de patronaje que
// se dibuja sola y un foco de latón que sigue al puntero.
//
// El foco y la inclinación solo existen con puntero fino y sin
// `prefers-reduced-motion`; escriben un par de variables CSS por cuadro.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { prefersReducedMotion } from '../composables/useInView'
import AgendaScene from './AgendaScene.vue'
import LandingBackdrop from './LandingBackdrop.vue'

const hero = ref<HTMLElement | null>(null)
let frame = 0

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch' || !hero.value) return
  const { clientX, clientY } = event
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const el = hero.value
    if (!el) return
    const box = el.getBoundingClientRect()
    const x = (clientX - box.left) / box.width
    const y = (clientY - box.top) / box.height
    el.style.setProperty('--mx', `${clientX - box.left}px`)
    el.style.setProperty('--my', `${clientY - box.top}px`)
    el.style.setProperty('--tx', String(((x - 0.5) * 2).toFixed(3)))
    el.style.setProperty('--ty', String(((y - 0.5) * 2).toFixed(3)))
  })
}

onMounted(() => {
  if (prefersReducedMotion()) return
  window.addEventListener('pointermove', onPointerMove, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  cancelAnimationFrame(frame)
})

// El titular se parte en palabras para entrar escalonado; «cortada a medida»
// va en latón. El texto sigue siendo una sola frase para quien lo lee.
const lead = ['La', 'agenda', 'de', 'tu', 'barbería,']
const accent = ['cortada', 'a medida.']
</script>

<template>
  <section id="inicio" ref="hero" class="hero" aria-labelledby="hero-title">
    <LandingBackdrop />
    <span class="hero__spot" aria-hidden="true"></span>

    <div class="ln-wrap hero__grid">
      <div class="hero__copy">
        <p class="ln-eyebrow nv-rise" style="--i: 0">Gestión para barberías y salones</p>
        <h1 id="hero-title" class="hero__title">
          <template v-for="(word, i) in lead" :key="word"
            ><span class="hero__word" :style="{ '--w': i }">{{ word }}</span
            >{{ ' ' }}</template
          >
          <em>
            <template v-for="(word, i) in accent" :key="word"
              ><span class="hero__word" :style="{ '--w': lead.length + i }">{{ word }}</span
              >{{ i < accent.length - 1 ? ' ' : '' }}</template
            >
          </em>
        </h1>
        <p class="ln-lead nv-rise" style="--i: 6">
          NAVA reúne turnos, equipo, horarios y reservas en un solo lugar. Y un asistente de IA
          atiende el chat de tu negocio mientras tú atiendes a tu gente.
        </p>

        <div class="hero__actions nv-rise" style="--i: 7">
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

        <ul class="hero__proof nv-rise" style="--i: 8">
          <li>Reservas sin crear cuenta</li>
          <li>Recordatorios por correo y WhatsApp</li>
          <li>Asistente de IA en tu chat</li>
        </ul>
      </div>

      <div class="hero__stage nv-pop" style="--i: 4">
        <div class="hero__tilt">
          <AgendaScene />
        </div>

        <div class="hero__float hero__float--a" aria-hidden="true">
          <span class="hero__mark"></span>
          <span class="hero__ft">
            <b>Nuevo turno</b>
            <small>5:30 pm · llegó desde el chat</small>
          </span>
        </div>

        <div class="hero__float hero__float--b" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 6h16v10H8l-4 4z" stroke-linejoin="round" />
            <path d="M8 10h8M8 13h5" stroke-linecap="round" />
          </svg>
          <span class="hero__ft">
            <b>Recordatorio enviado</b>
            <small>Mañana 10:30 am · WhatsApp</small>
          </span>
        </div>

        <div class="hero__float hero__float--c" aria-hidden="true">
          <span class="hero__stars">★★★★★</span>
          <span class="hero__ft">
            <b>Reseña nueva</b>
            <small>«Salí feliz con el corte»</small>
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
  padding: 140px 0 150px;
  --mx: 50%;
  --my: 40%;
  --tx: 0;
  --ty: 0;
}

/* Foco de latón que sigue al cursor (solo con puntero fino). */
.hero__spot {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    520px circle at var(--mx) var(--my),
    color-mix(in srgb, var(--color-brand-accent-surface) 14%, transparent),
    transparent 70%
  );
  opacity: 0;
  transition: opacity 600ms ease;
}

@media (hover: hover) and (pointer: fine) {
  .hero:hover .hero__spot {
    opacity: 1;
  }
}

.hero__grid {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 72px;
  align-items: center;
}

.hero__copy {
  display: grid;
  gap: 28px;
  justify-items: start;
}

.hero__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(50px, 8vw, 108px);
  line-height: 0.98;
  letter-spacing: -0.012em;
  text-wrap: balance;
}

.hero__title em {
  font-style: normal;
  color: var(--ln-brass);
}

.hero__word {
  display: inline-block;
  animation: hero-word 800ms var(--motion-ease-out) backwards;
  animation-delay: calc(160ms + var(--w) * 90ms);
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
  gap: 12px 30px;
  margin: 10px 0 0;
  padding: 20px 0 0;
  list-style: none;
  border-top: 1px solid var(--ln-line);
  font-size: 16px;
  letter-spacing: 0.01em;
  color: var(--ln-soft);
}

.hero__proof li {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.hero__proof li::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--ln-brass);
  transform: rotate(45deg);
}

.hero__stage {
  position: relative;
  min-width: 0;
}

.hero__tilt {
  transform: perspective(1400px) rotateY(calc(var(--tx) * -4deg)) rotateX(calc(var(--ty) * 3deg));
  transition: transform 500ms var(--motion-ease-out);
  will-change: transform;
}

.hero__float {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px 14px 16px;
  background: var(--ln-ink-raised);
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-lg);
  box-shadow: 0 26px 54px -20px
    color-mix(in srgb, var(--color-action-primary-active) 90%, transparent);
  transform: translate3d(calc(var(--tx) * var(--k, 10px)), calc(var(--ty) * var(--k, 10px)), 0);
  transition: transform 500ms var(--motion-ease-out);
}

.hero__float svg {
  width: 26px;
  height: 26px;
  flex: none;
  color: var(--ln-brass);
}

.hero__float--a {
  --k: 18px;
  left: -22px;
  bottom: -84px;
  animation: hero-bob 6s ease-in-out infinite;
}

.hero__float--b {
  --k: -14px;
  right: -18px;
  top: -68px;
  animation: hero-bob 7s ease-in-out 0.8s infinite;
}

.hero__float--c {
  --k: 22px;
  right: 4%;
  bottom: -104px;
  animation: hero-bob 8s ease-in-out 1.6s infinite;
}

.hero__mark {
  width: 15px;
  height: 15px;
  background: var(--ln-brass);
  transform: rotate(45deg);
  animation: hero-ping 9s ease-out infinite;
}

.hero__stars {
  font-size: 16px;
  letter-spacing: 2px;
  color: var(--ln-brass);
}

.hero__ft {
  display: grid;
}

.hero__ft b {
  font-size: 16px;
  line-height: 22px;
}

.hero__ft small {
  font-size: 14px;
  line-height: 20px;
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
  font-size: 13px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--ln-muted);
}

.hero__scroll i {
  position: relative;
  width: 1px;
  height: 40px;
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

@keyframes hero-word {
  from {
    opacity: 0;
    transform: translateY(0.45em) rotate(2deg);
    filter: blur(6px);
  }
}

@keyframes hero-bob {
  50% {
    translate: 0 -9px;
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

@media (max-width: 1019px) {
  .hero__float--b {
    right: 8px;
    top: -42px;
  }
}

@media (max-width: 560px) {
  .hero {
    padding: 108px 0 150px;
  }

  .hero__float {
    padding: 11px 16px 11px 13px;
  }

  .hero__float--a {
    left: 6px;
    bottom: -48px;
  }

  .hero__float--b {
    display: none;
  }

  .hero__float--c {
    right: 6px;
    bottom: -112px;
  }

  .hero__actions .ln-btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero__word,
  .hero__float,
  .hero__mark,
  .hero__scroll i::after {
    animation: none;
  }

  .hero__tilt,
  .hero__float {
    transform: none;
    transition: none;
  }

  .hero__spot {
    display: none;
  }
}
</style>
