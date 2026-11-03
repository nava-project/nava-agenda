<script setup lang="ts">
// Cabecera fija de la landing: marca, tres anclas y «Iniciar sesión». Se
// asienta sobre tinta con un filete al desplazarse; no usa vidrio ni
// transparencia decorativa (estandar-diseno-visual.md §3.1). En móvil las
// anclas se ocultan y quedan la marca y el acceso, que es lo que importa.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NavaWordmark } from '@/shared/ui'

const scrolled = ref(false)
function onScroll() {
  scrolled.value = window.scrollY > 24
}
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header class="ln-head" :class="{ 'ln-head--scrolled': scrolled }">
    <div class="ln-wrap ln-head__row">
      <a class="ln-head__brand" href="#inicio" aria-label="NAVA, ir al inicio">
        <NavaWordmark variant="inverted" />
      </a>

      <nav class="ln-head__nav" aria-label="Secciones">
        <a href="#plataforma">Plataforma</a>
        <a href="#asistente">Asistente de IA</a>
        <a href="#contacto">Contacto</a>
      </nav>

      <RouterLink class="ln-btn ln-btn--line ln-head__login" :to="{ name: 'acceso' }">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <path
            d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h11"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Iniciar sesión
      </RouterLink>
    </div>
  </header>
</template>

<style scoped>
.ln-head {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 20;
  border-bottom: 1px solid transparent;
  transition:
    background-color 300ms var(--motion-ease-out),
    border-color 300ms var(--motion-ease-out);
}

.ln-head--scrolled {
  background: var(--ln-ink);
  border-bottom-color: var(--ln-line);
}

.ln-head__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 72px;
}

.ln-head__brand {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  text-decoration: none;
}

.ln-head__brand :deep(.nava-wordmark) {
  font-size: 26px;
  letter-spacing: 0.14em;
}

.ln-head__nav {
  display: none;
  gap: 36px;
  margin-inline: auto;
}

.ln-head__nav a {
  position: relative;
  padding: 10px 0;
  color: var(--ln-soft);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: color 200ms ease;
}

.ln-head__nav a::after {
  content: '';
  position: absolute;
  inset: auto 0 4px 0;
  height: 1px;
  background: var(--ln-brass);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 320ms var(--motion-ease-out);
}

.ln-head__nav a:hover {
  color: var(--ln-text);
}

.ln-head__nav a:hover::after {
  transform: scaleX(1);
}

.ln-head__login {
  min-height: 44px;
  padding: 0 18px;
}

@media (min-width: 860px) {
  .ln-head__nav {
    display: flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ln-head,
  .ln-head__nav a,
  .ln-head__nav a::after {
    transition: none;
  }
}
</style>
