<script setup lang="ts">
// «Un día con NAVA»: el recorrido de un turno de principio a fin, contado en
// cinco pasos. En pantallas anchas la escena queda fija a la derecha y cambia
// a medida que cada paso cruza el centro de la ventana (el paso activo se
// calcula con IntersectionObserver); en pantallas estrechas cada paso lleva
// su escena debajo y se lee de corrido. Los pasos son texto real; las escenas
// son ilustración.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { journeySteps } from '../model/landingContent'
import { useInView } from '../composables/useInView'
import JourneyScene from './JourneyScene.vue'

const root = ref<HTMLElement | null>(null)
const { seen } = useInView(root, 0.1)

const active = ref(0)
const items = ref<HTMLElement[]>([])
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) active.value = Number((entry.target as HTMLElement).dataset.step)
      }
    },
    // Una franja fina en el centro de la ventana: el paso que la cruza manda.
    { rootMargin: '-45% 0px -45% 0px' },
  )
  items.value.forEach((el) => observer?.observe(el))
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section id="dia" ref="root" class="jr" aria-labelledby="jr-title">
    <div class="ln-wrap">
      <header class="jr__head">
        <p class="ln-eyebrow ln-reveal" :data-seen="seen">Un día con NAVA</p>
        <h2 id="jr-title" class="ln-title ln-reveal" :data-seen="seen" style="--i: 1">
          De un mensaje a una reseña, <em>sin que lo persigas.</em>
        </h2>
      </header>

      <div class="jr__grid">
        <ol class="jr__steps">
          <li
            v-for="(step, index) in journeySteps"
            :key="step.title"
            :ref="
              (el) => {
                if (el) items[index] = el as HTMLElement
              }
            "
            class="jr__step"
            :class="{ 'jr__step--on': active === index }"
            :data-step="index"
          >
            <span class="jr__time">{{ step.time }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.body }}</p>
            <div class="jr__inline">
              <JourneyScene :step="index" />
            </div>
          </li>
        </ol>

        <div class="jr__stage">
          <JourneyScene :key="active" :step="active" />
          <ul class="jr__dots" aria-hidden="true">
            <li v-for="(_, i) in journeySteps" :key="i" :class="{ on: i === active }"></li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.jr {
  padding: clamp(88px, 12vw, 168px) 0;
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--color-field-strong) 55%, transparent) 20%,
    color-mix(in srgb, var(--color-field-strong) 55%, transparent) 80%,
    transparent
  );
}

.jr__head {
  display: grid;
  gap: 22px;
  justify-items: start;
  max-width: 880px;
  margin-bottom: clamp(48px, 7vw, 96px);
}

.jr__grid {
  display: grid;
  gap: 0;
}

.jr__steps {
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.jr__step {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 34px 0 34px 28px;
  border-left: 1px solid var(--ln-line-strong);
  opacity: 0.55;
  transition: opacity 500ms var(--motion-ease-out);
}

.jr__step::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 50%;
  width: 9px;
  height: 9px;
  margin-top: -5px;
  background: var(--ln-ink);
  border: 1px solid var(--ln-brass);
  transform: rotate(45deg);
  transition:
    background-color 400ms ease,
    transform 500ms var(--motion-ease-spring);
}

.jr__step--on {
  opacity: 1;
}

.jr__step--on::before {
  background: var(--ln-brass);
  transform: rotate(45deg) scale(1.5);
}

.jr__time {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ln-brass);
}

.jr__step h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(28px, 3.2vw, 40px);
  line-height: 1.1;
}

.jr__step p {
  margin: 0;
  max-width: 48ch;
  font-size: 18px;
  line-height: 1.6;
  color: var(--ln-soft);
}

.jr__inline {
  margin-top: 16px;
}

.jr__stage {
  display: none;
}

@media (min-width: 1020px) {
  .jr__grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: 80px;
    align-items: start;
  }

  .jr__step {
    min-height: 56vh;
    align-content: center;
  }

  .jr__inline {
    display: none;
  }

  .jr__stage {
    position: sticky;
    top: 16vh;
    display: block;
  }

  .jr__dots {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin: 26px 0 0;
    padding: 0;
    list-style: none;
  }

  .jr__dots li {
    width: 9px;
    height: 9px;
    border: 1px solid var(--ln-brass);
    transform: rotate(45deg);
    transition: background-color 300ms ease;
  }

  .jr__dots li.on {
    background: var(--ln-brass);
  }
}

@media (prefers-reduced-motion: reduce) {
  .jr__step,
  .jr__step::before,
  .jr__dots li {
    transition: none;
  }

  .jr__step {
    opacity: 1;
  }
}
</style>
