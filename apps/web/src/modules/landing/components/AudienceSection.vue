<script setup lang="ts">
// «Para quién es»: NAVA sirve a quien trabaja por su cuenta y a quien dirige un
// equipo (los dos perfiles de panel del producto, DEC-115/DEC-134) y a
// cualquier negocio que agende citas, no solo a barberías. Dos perfiles como
// columnas editoriales con su ilustración de línea (una persona / un equipo) y
// debajo la cinta de nichos de ejemplo. Los textos salen de landingContent.
import { ref } from 'vue'
import { landingAudiences, landingNiches } from '../model/landingContent'
import { useInView } from '../composables/useInView'

const root = ref<HTMLElement | null>(null)
const { seen } = useInView(root, 0.15)
</script>

<template>
  <section id="para-quien" ref="root" class="aud" aria-labelledby="aud-title">
    <div class="ln-wrap">
      <header class="aud__head">
        <p class="ln-eyebrow ln-reveal" :data-seen="seen">Para quién es</p>
        <h2 id="aud-title" class="ln-title ln-reveal" :data-seen="seen" style="--i: 1">
          Para ti, para tu equipo, <em>para tu nicho.</em>
        </h2>
        <p class="ln-lead ln-reveal" :data-seen="seen" style="--i: 2">
          NAVA no es solo para barberías. Es para cualquier profesional o negocio que viva de las
          citas: se adapta a cómo trabajas y a cómo llamas a lo tuyo.
        </p>
      </header>

      <div class="aud__grid">
        <article
          v-for="(audience, index) in landingAudiences"
          :key="audience.id"
          class="aud__col ln-reveal"
          :data-seen="seen"
          :style="{ '--i': index + 3 }"
        >
          <svg class="aud__art" viewBox="0 0 160 96" fill="none" aria-hidden="true">
            <template v-if="audience.id === 'independiente'">
              <circle class="aud__stroke" cx="80" cy="34" r="16" pathLength="1" />
              <path class="aud__stroke" pathLength="1" d="M48 86c0-17 14-28 32-28s32 11 32 28" />
              <path class="aud__soft" d="M20 90h120" />
            </template>
            <template v-else>
              <circle class="aud__stroke" cx="80" cy="30" r="13" pathLength="1" />
              <path class="aud__stroke" pathLength="1" d="M56 80c0-14 11-23 24-23s24 9 24 23" />
              <circle class="aud__stroke aud__stroke--b" cx="34" cy="40" r="10" pathLength="1" />
              <path class="aud__stroke aud__stroke--b" pathLength="1" d="M16 82c0-11 8-18 18-18" />
              <circle class="aud__stroke aud__stroke--b" cx="126" cy="40" r="10" pathLength="1" />
              <path class="aud__stroke aud__stroke--b" pathLength="1" d="M144 82c0-11-8-18-18-18" />
              <path class="aud__soft" d="M8 90h144" />
            </template>
          </svg>

          <h3>{{ audience.title }}</h3>
          <p class="aud__lead">{{ audience.lead }}</p>
          <ul>
            <li v-for="point in audience.points" :key="point">{{ point }}</li>
          </ul>
        </article>
      </div>

      <ul
        class="aud__niches ln-reveal"
        :data-seen="seen"
        style="--i: 6"
        aria-label="Ejemplos de negocios"
      >
        <li v-for="niche in landingNiches" :key="niche">{{ niche }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.aud {
  padding: clamp(88px, 12vw, 160px) 0 clamp(56px, 8vw, 100px);
}

.aud__head {
  display: grid;
  gap: 22px;
  justify-items: start;
  max-width: 900px;
  margin-bottom: clamp(44px, 6vw, 80px);
}

.aud__grid {
  display: grid;
  gap: 0;
  border-top: 1px solid var(--ln-line-strong);
}

.aud__col {
  display: grid;
  gap: 14px;
  align-content: start;
  padding: 36px 0;
  border-bottom: 1px solid var(--ln-line);
}

.aud__art {
  width: 160px;
  height: 96px;
  margin-bottom: 6px;
}

.aud__stroke {
  stroke: var(--ln-brass);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
}

.aud__stroke--b {
  opacity: 0.55;
}

.aud__soft {
  stroke: var(--ln-line-strong);
  stroke-width: 1;
}

.aud__col[data-seen='true'] .aud__stroke {
  animation: aud-draw 1.8s var(--motion-ease-out) 0.3s forwards;
}

.aud__col h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(32px, 3.6vw, 46px);
  line-height: 1.08;
}

.aud__lead {
  margin: 0;
  max-width: 44ch;
  font-size: 19px;
  line-height: 1.6;
  color: var(--ln-soft);
}

.aud__col ul {
  display: grid;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.aud__col li {
  position: relative;
  padding: 6px 0 6px 26px;
  font-size: 17px;
  line-height: 26px;
  color: var(--ln-muted);
}

.aud__col li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 16px;
  width: 7px;
  height: 7px;
  background: var(--ln-brass);
  transform: rotate(45deg);
}

.aud__niches {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
}

.aud__niches li {
  padding: 12px 22px;
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-pill);
  font-size: 17px;
  font-weight: 500;
  color: var(--ln-soft);
  transition:
    border-color 220ms ease,
    color 220ms ease,
    transform 300ms var(--motion-ease-spring);
}

.aud__niches li:hover {
  border-color: var(--ln-brass);
  color: var(--ln-brass);
  transform: translateY(-3px);
}

.aud__niches li:last-child {
  border-color: var(--ln-brass-line);
  background: color-mix(in srgb, var(--ln-brass) 10%, transparent);
  color: var(--ln-brass);
}

@keyframes aud-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@media (min-width: 900px) {
  .aud__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .aud__col {
    padding: 44px 48px 44px 0;
    border-bottom: 0;
  }

  .aud__col + .aud__col {
    padding-left: 48px;
    border-left: 1px solid var(--ln-line);
  }
}

@media (prefers-reduced-motion: reduce) {
  .aud__stroke {
    animation: none !important;
    stroke-dashoffset: 0;
  }

  .aud__niches li {
    transition: none;
  }
}
</style>
