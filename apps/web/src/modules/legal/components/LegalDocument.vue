<script setup lang="ts">
// Documento legal público (issue #545): cabecera con la marca, título editorial,
// índice de secciones y el texto en una columna de lectura. Identidad guiada
// (estandar-diseno-visual.md §2.1): lienzo marfil, serif para los títulos, sans
// para el texto corrido, filete de latón como firma y ningún adorno que
// compita con la lectura. Es el mismo componente para la política de
// privacidad y las condiciones: el contenido sale de `model/legalContent.ts`.
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { NavaWordmark } from '@/shared/ui'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_UPDATED,
  LEGAL_UPDATED_ISO,
  type LegalDocument,
} from '../model/legalContent'
import { LEGAL_PRIVACY_PATH, LEGAL_TERMS_PATH } from '../routes'

const props = defineProps<{ doc: LegalDocument }>()

// El título de la pestaña identifica el documento: una SPA no lo cambia sola.
let previousTitle = ''
onMounted(() => {
  previousTitle = document.title
  document.title = `${props.doc.title} · NAVA`
})
onBeforeUnmount(() => {
  document.title = previousTitle
})

const year = new Date().getFullYear()
</script>

<template>
  <div class="ld">
    <a class="ld__skip" href="#contenido">Saltar al contenido</a>

    <header class="ld__bar">
      <div class="ld__wrap ld__bar-inner">
        <RouterLink class="ld__brand" to="/" aria-label="NAVA, volver al inicio">
          <NavaWordmark variant="ink" size="sm" />
        </RouterLink>
        <RouterLink class="ld__back" to="/">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Volver al inicio
        </RouterLink>
      </div>
    </header>

    <main id="contenido" class="ld__wrap ld__main">
      <div class="ld__head">
        <p class="ld__eyebrow">Documento legal · NAVA</p>
        <h1 class="ld__title">{{ doc.title }}</h1>
        <span class="ld__rule" aria-hidden="true"></span>
        <p class="ld__lede">{{ doc.lede }}</p>
        <p class="ld__updated">
          Última actualización: <time :datetime="LEGAL_UPDATED_ISO">{{ LEGAL_UPDATED }}</time>
        </p>
      </div>

      <div class="ld__layout">
        <nav class="ld__toc" aria-label="En esta página">
          <h2>En esta página</h2>
          <ol>
            <li v-for="section in doc.sections" :key="section.id">
              <a :href="`#${section.id}`">{{ section.title }}</a>
            </li>
          </ol>
        </nav>

        <article class="ld__body">
          <section
            v-for="section in doc.sections"
            :id="section.id"
            :key="section.id"
            class="ld__section"
          >
            <h2>{{ section.title }}</h2>
            <template v-for="(block, index) in section.blocks" :key="index">
              <p v-if="block.kind === 'p'">{{ block.text }}</p>
              <ul v-else>
                <li v-for="item in block.items" :key="item">{{ item }}</li>
              </ul>
            </template>
          </section>
        </article>
      </div>
    </main>

    <footer class="ld__foot">
      <div class="ld__wrap ld__foot-inner">
        <p>
          © {{ year }} NAVA ·
          <a :href="`mailto:${LEGAL_CONTACT_EMAIL}`">{{ LEGAL_CONTACT_EMAIL }}</a>
        </p>
        <nav aria-label="Documentos legales">
          <RouterLink :to="LEGAL_PRIVACY_PATH">Privacidad</RouterLink>
          <RouterLink :to="LEGAL_TERMS_PATH">Condiciones</RouterLink>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.ld {
  min-height: 100dvh;
  background-color: var(--color-canvas);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}

.ld__wrap {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding-inline: clamp(var(--space-4), 5vw, var(--space-10));
}

.ld__skip {
  position: absolute;
  left: var(--space-4);
  top: -48px;
  z-index: 10;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-action-primary);
  color: var(--color-on-strong);
  font-weight: 600;
  text-decoration: none;
}

.ld__skip:focus {
  top: var(--space-3);
}

/* Barra superior: la marca y el regreso. Delgada, con filete fino, igual que
   la barra de regreso del acceso. */
.ld__bar {
  border-bottom: 1px solid var(--color-border-subtle);
  background-color: var(--color-canvas);
}

.ld__bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 64px;
}

.ld__brand {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  border-radius: var(--radius-md);
  text-decoration: none;
}

.ld__brand :deep(.nava-wordmark) {
  font-size: 26px;
  letter-spacing: 0.1em;
}

.ld__back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-text-secondary);
  text-decoration: none;
}

.ld__back svg {
  width: 18px;
  height: 18px;
  color: var(--color-accent-brass);
}

.ld__back:hover {
  color: var(--color-text-primary);
}

.ld__brand:focus-visible,
.ld__back:focus-visible,
.ld__toc a:focus-visible,
.ld__foot a:focus-visible,
.ld__body a:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.ld__main {
  padding-block: clamp(var(--space-8), 7vw, var(--space-16))
    clamp(var(--space-10), 8vw, var(--space-16));
}

.ld__head {
  max-width: 760px;
}

.ld__eyebrow {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-brass);
}

.ld__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: var(--font-size-h1);
  line-height: var(--font-size-h1-line);
  color: var(--color-action-primary);
}

.ld__rule {
  display: block;
  width: 88px;
  height: 2px;
  margin: var(--space-5) 0;
  background-color: var(--color-brand-accent-surface);
}

.ld__lede {
  margin: 0;
  font-size: var(--font-size-body-lg);
  line-height: var(--font-size-body-lg-line);
  color: var(--color-text-secondary);
}

.ld__updated {
  margin: var(--space-4) 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
}

.ld__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-8);
  margin-top: clamp(var(--space-8), 6vw, var(--space-12));
}

/* El índice es ayuda de navegación: en móvil se omite para que el texto
   empiece sin una lista larga encima; el contenido completo sigue en la
   página, en orden de lectura. */
.ld__toc {
  display: none;
}

.ld__toc h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-brass);
}

.ld__toc ol {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  border-left: 1px solid var(--color-border-subtle);
}

.ld__toc a {
  display: block;
  padding: 6px var(--space-3);
  margin-left: -1px;
  border-left: 2px solid transparent;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
  text-decoration: none;
}

.ld__toc a:hover {
  border-left-color: var(--color-brand-accent-surface);
  color: var(--color-text-primary);
}

.ld__body {
  max-width: 70ch;
}

.ld__section {
  padding-top: var(--space-8);
  margin-top: var(--space-8);
  border-top: 1px solid var(--color-border-subtle);
  /* El ancla no queda tapada por nada fijo y deja aire al saltar. */
  scroll-margin-top: var(--space-6);
}

.ld__section:first-child {
  padding-top: 0;
  margin-top: 0;
  border-top: 0;
}

.ld__section h2 {
  margin: 0 0 var(--space-4);
  font-family: var(--font-display);
  font-weight: 400;
  font-size: var(--font-size-h2);
  line-height: var(--font-size-h2-line);
  color: var(--color-action-primary);
}

.ld__section p,
.ld__section li {
  font-size: var(--font-size-body-lg);
  line-height: var(--font-size-body-lg-line);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.ld__section p {
  margin: 0 0 var(--space-4);
}

.ld__section ul {
  display: grid;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding-left: var(--space-5);
}

.ld__section li::marker {
  color: var(--color-accent-brass);
}

.ld__foot {
  border-top: 1px solid var(--color-border-subtle);
  background-color: var(--color-surface-muted);
}

.ld__foot-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-6);
  padding-block: var(--space-6);
  font-size: var(--font-size-body-sm);
  color: var(--color-text-secondary);
}

.ld__foot p {
  margin: 0;
}

.ld__foot nav {
  display: flex;
  gap: var(--space-5);
}

.ld__foot a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--color-text-secondary);
  text-underline-offset: 3px;
}

.ld__foot a:hover {
  color: var(--color-text-primary);
}

@media (min-width: 1024px) {
  .ld__layout {
    grid-template-columns: 240px minmax(0, 1fr);
    gap: var(--space-12);
    align-items: start;
  }

  .ld__toc {
    display: block;
    position: sticky;
    top: var(--space-8);
  }

  .ld__title {
    font-size: var(--font-size-title-page);
    line-height: var(--font-size-title-page-line);
  }
}
</style>
