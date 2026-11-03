<script setup lang="ts">
// Mesa de patronaje del hero: cuadrícula de trazo, dos luces que derivan y la
// pieza de un patrón de saco que se dibuja sola, con su margen de costura en
// puntada, muescas, hilo de la tela y cota. Es la misma metáfora de sastrería
// del acceso y de la reserva pública (DEC-077/DEC-111), recompuesta a gran
// escala. Puramente ornamental: sin texto que leer, oculto a las tecnologías
// de apoyo y sin capturar el puntero. Todo el movimiento es CSS sobre
// transform/opacity/stroke-dashoffset; `prefers-reduced-motion` deja la pieza
// dibujada y quieta.
</script>

<template>
  <div class="ln-bd" aria-hidden="true">
    <span class="ln-bd__glow ln-bd__glow--a"></span>
    <span class="ln-bd__glow ln-bd__glow--b"></span>
    <span class="ln-bd__grid"></span>

    <svg class="ln-bd__piece" viewBox="0 0 800 900" preserveAspectRatio="xMaxYMid meet" fill="none">
      <defs>
        <path
          id="ln-piece"
          d="M148 118 C210 92 318 100 372 150 C426 198 484 196 538 168 L668 342 C636 440 626 572 646 736 L646 846 L196 846 C176 704 182 566 166 424 C154 304 124 206 148 118 Z"
        />
      </defs>

      <!-- Pieza maestra -->
      <use href="#ln-piece" class="ln-bd__stroke ln-bd__stroke--master" pathLength="1" />
      <!-- Margen de costura: la misma pieza, encogida, en puntada -->
      <use
        href="#ln-piece"
        class="ln-bd__stroke ln-bd__stroke--stitch"
        transform="translate(404 480) scale(0.93) translate(-404 -480)"
      />
      <!-- Pliegue de la solapa y pinza -->
      <path class="ln-bd__stroke ln-bd__stroke--fold" pathLength="1" d="M372 150 L486 470" />
      <path
        class="ln-bd__stroke ln-bd__stroke--fold"
        pathLength="1"
        d="M300 560 L318 700 L336 560"
      />

      <!-- Hilo de la tela: flecha doble -->
      <g class="ln-bd__grain">
        <path d="M424 330 V790" />
        <path d="M424 330 l-8 16 M424 330 l8 16 M424 790 l-8 -16 M424 790 l8 -16" />
      </g>

      <!-- Muescas de ensamble -->
      <g class="ln-bd__notches">
        <path d="M205 560 l16 0 M205 560 l0 -2" />
        <path d="M628 520 l16 0" />
        <path d="M420 846 l0 -14" />
        <path d="M300 846 l0 -14" />
      </g>

      <!-- Cota inferior -->
      <g class="ln-bd__dim">
        <path d="M196 880 H646 M196 872 V888 M646 872 V888" />
        <text x="421" y="872" text-anchor="middle">NAVA · 01 · A MEDIDA</text>
      </g>

      <!-- Compás -->
      <circle
        class="ln-bd__stroke ln-bd__stroke--compass"
        pathLength="1"
        cx="700"
        cy="150"
        r="64"
      />
      <circle
        class="ln-bd__stroke ln-bd__stroke--compass"
        pathLength="1"
        cx="700"
        cy="150"
        r="38"
      />
      <path class="ln-bd__cross" d="M688 150 h24 M700 138 v24" />
      <circle class="ln-bd__node" cx="538" cy="168" r="4" />
      <circle class="ln-bd__node ln-bd__node--late" cx="646" cy="736" r="3" />
    </svg>
  </div>
</template>

<style scoped>
.ln-bd {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.ln-bd__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.5;
  will-change: transform;
}

.ln-bd__glow--a {
  width: 620px;
  height: 620px;
  top: -200px;
  right: -120px;
  background: color-mix(in srgb, var(--color-brand-accent-surface) 40%, transparent);
  animation: ln-drift-a 22s ease-in-out infinite alternate;
}

.ln-bd__glow--b {
  width: 520px;
  height: 520px;
  bottom: -220px;
  left: -160px;
  background: color-mix(in srgb, var(--color-info-border) 38%, transparent);
  animation: ln-drift-b 28s ease-in-out infinite alternate;
}

.ln-bd__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      to right,
      color-mix(in srgb, var(--color-on-strong) 6%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-on-strong) 6%, transparent) 1px,
      transparent 1px
    );
  background-size: 56px 56px;
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 62% 40%, #000 20%, transparent 78%);
  mask-image: radial-gradient(ellipse 80% 70% at 62% 40%, #000 20%, transparent 78%);
}

.ln-bd__piece {
  position: absolute;
  top: 50%;
  right: -4%;
  width: min(78vw, 760px);
  height: auto;
  transform: translateY(-48%);
  opacity: 0.9;
}

.ln-bd__stroke {
  stroke: var(--color-brand-accent-surface);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ln-bd__stroke--master,
.ln-bd__stroke--fold,
.ln-bd__stroke--compass {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: ln-draw 3.4s var(--motion-ease-out) 0.3s forwards;
}

.ln-bd__stroke--fold {
  animation-delay: 1.5s;
  stroke-width: 1.2;
}

.ln-bd__stroke--compass {
  stroke-width: 1;
  opacity: 0.6;
  animation-delay: 0.9s;
}

.ln-bd__stroke--stitch {
  stroke-width: 1.2;
  stroke-dasharray: 7 9;
  opacity: 0;
  animation:
    ln-fade-in 1.2s ease 2.4s forwards,
    ln-march 6s linear 2.4s infinite;
}

.ln-bd__grain path,
.ln-bd__notches path,
.ln-bd__dim path,
.ln-bd__cross {
  stroke: var(--color-on-strong-muted);
  stroke-width: 1.1;
  stroke-linecap: round;
  opacity: 0;
  animation: ln-fade-in 1s ease 2.8s forwards;
}

.ln-bd__dim text {
  fill: var(--color-on-strong-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 0.3em;
  opacity: 0;
  animation: ln-fade-in 1s ease 3.1s forwards;
}

.ln-bd__node {
  fill: var(--color-brand-accent-surface);
  opacity: 0;
  animation:
    ln-fade-in 0.6s ease 3.2s forwards,
    ln-pulse 3.2s ease-in-out 3.8s infinite;
  transform-box: fill-box;
  transform-origin: center;
}

.ln-bd__node--late {
  animation-delay: 3.6s, 4.4s;
}

@keyframes ln-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes ln-fade-in {
  to {
    opacity: 1;
  }
}

@keyframes ln-march {
  to {
    stroke-dashoffset: -64;
  }
}

@keyframes ln-pulse {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.9);
  }
}

@keyframes ln-drift-a {
  to {
    transform: translate3d(-80px, 70px, 0) scale(1.15);
  }
}

@keyframes ln-drift-b {
  to {
    transform: translate3d(110px, -60px, 0) scale(1.1);
  }
}

@media (max-width: 900px) {
  .ln-bd__piece {
    right: -30%;
    width: 130vw;
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ln-bd__glow {
    animation: none;
  }

  .ln-bd__stroke--master,
  .ln-bd__stroke--fold,
  .ln-bd__stroke--compass {
    animation: none;
    stroke-dashoffset: 0;
  }

  .ln-bd__stroke--stitch,
  .ln-bd__grain path,
  .ln-bd__notches path,
  .ln-bd__dim path,
  .ln-bd__dim text,
  .ln-bd__cross,
  .ln-bd__node {
    animation: none;
    opacity: 1;
  }
}
</style>
