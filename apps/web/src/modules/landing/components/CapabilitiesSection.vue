<script setup lang="ts">
// Lo que NAVA ordena, como un índice editorial: un número en serif, el título
// y el párrafo de cada función, separados por filetes. No son seis tarjetas:
// la lista respira, cada fila se enciende al pasar el cursor o enfocarla y un
// filete de latón se dibuja a su paso. Solo describe funciones del alcance
// confirmado (model/landingContent.ts).
import { ref } from 'vue'
import { landingCapabilities } from '../model/landingContent'
import { useInView } from '../composables/useInView'

const root = ref<HTMLElement | null>(null)
const { seen } = useInView(root, 0.1)
</script>

<template>
  <section id="plataforma" ref="root" class="cap" aria-labelledby="cap-title">
    <div class="ln-wrap cap__grid">
      <header class="cap__head">
        <p class="ln-eyebrow ln-reveal" :data-seen="seen">La plataforma</p>
        <h2 id="cap-title" class="ln-title ln-reveal" :data-seen="seen" style="--i: 1">
          Todo el negocio, <em>en el mismo patrón.</em>
        </h2>
        <p class="ln-lead ln-reveal" :data-seen="seen" style="--i: 2">
          Pensada para quien atiende citas todo el día: pocas pantallas, claras, que se entienden a
          la primera.
        </p>
      </header>

      <ol class="cap__list">
        <li
          v-for="(item, index) in landingCapabilities"
          :key="item.id"
          class="cap__item ln-reveal"
          :data-seen="seen"
          :style="{ '--i': index }"
        >
          <span class="cap__num">{{ String(index + 1).padStart(2, '0') }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.body }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.cap {
  padding: clamp(88px, 12vw, 160px) 0;
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--color-field-strong) 60%, transparent) 30%,
    color-mix(in srgb, var(--color-field-strong) 60%, transparent) 70%,
    transparent
  );
}

.cap__grid {
  display: grid;
  gap: 56px;
  align-items: start;
}

.cap__head {
  display: grid;
  gap: 24px;
  justify-items: start;
}

.cap__list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--ln-line-strong);
}

.cap__item {
  position: relative;
  display: grid;
  grid-template-columns: 70px 1fr;
  column-gap: 12px;
  row-gap: 8px;
  padding: 28px 0 28px 4px;
  border-bottom: 1px solid var(--ln-line);
  transition: padding-left 360ms var(--motion-ease-out);
}

.cap__item::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--ln-brass);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 520ms var(--motion-ease-out);
}

.cap__item:hover,
.cap__item:focus-within {
  padding-left: 16px;
}

.cap__item:hover::before,
.cap__item:focus-within::before {
  transform: scaleX(1);
}

.cap__num {
  grid-row: span 2;
  font-family: var(--font-display);
  font-size: 44px;
  line-height: 1;
  color: var(--ln-brass);
}

.cap__item h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(28px, 3vw, 38px);
  line-height: 1.15;
}

.cap__item p {
  margin: 0;
  max-width: 60ch;
  font-size: 18px;
  line-height: 28px;
  color: var(--ln-soft);
}

@media (min-width: 1020px) {
  .cap__grid {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 96px;
  }

  .cap__head {
    position: sticky;
    top: 120px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cap__item,
  .cap__item::before {
    transition: none;
  }
}
</style>
