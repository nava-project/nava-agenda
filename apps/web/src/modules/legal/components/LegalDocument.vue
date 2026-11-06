<script setup lang="ts">
// Documento legal público (issues #545 y #547). Vive en la misma familia visual
// que la landing (DEC-151): lienzo de tinta con la «mesa de patronaje»
// (rejilla fina y dos luces), cabecera fija con el wordmark y un botón de
// contorno, rótulos de latón con rombo, títulos serif y un pie con el mismo
// filete. Es una lectura larga, así que el ornamento se queda en el fondo y el
// texto manda: columna de ≤ 70 caracteres, cuerpo claro sobre tinta con
// contraste AA y un índice que sigue la lectura. El contenido sale de
// `model/legalContent.ts`; este componente no conoce ningún texto legal.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NavaWordmark, SiteFooter } from '@/shared/ui'
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_UPDATED,
  LEGAL_UPDATED_ISO,
  type LegalDocument,
} from '../model/legalContent'

const props = defineProps<{
  doc: LegalDocument
  /** Documento que se sugiere leer a continuación. */
  next: { to: string; label: string }
}>()

// El título de la pestaña identifica el documento: una SPA no lo cambia sola.
let previousTitle = ''

// Sección en lectura: alimenta `aria-current` y el rombo lleno del índice.
const active = ref(props.doc.sections[0]?.id ?? '')

// Cabecera fija: se asienta sobre tinta con un filete al desplazarse, igual
// que la de la landing.
const scrolled = ref(false)
// La última sección suele ser demasiado corta para cruzar la franja de
// lectura: al llegar al fondo del documento queda marcada igualmente.
function atBottom() {
  return (
    window.scrollY > 0 &&
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
  )
}

function onScroll() {
  scrolled.value = window.scrollY > 24
  const last = props.doc.sections[props.doc.sections.length - 1]
  if (atBottom() && last) active.value = last.id
}

let observer: IntersectionObserver | undefined

// El índice es una guía fija en escritorio y un acordeón en móvil, donde una
// lista larga empujaría el texto fuera de la pantalla. Sin `matchMedia` (por
// ejemplo en pruebas) queda abierto: el contenido nunca se oculta.
const tocOpen = ref(true)
let media: MediaQueryList | undefined
function onMedia(event: MediaQueryListEvent) {
  tocOpen.value = event.matches
}

onMounted(() => {
  previousTitle = document.title
  document.title = `${props.doc.title} · NAVA`

  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  if (typeof window.matchMedia === 'function') {
    media = window.matchMedia('(min-width: 1024px)')
    tocOpen.value = media.matches
    media.addEventListener?.('change', onMedia)
  }

  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        // La sección vigente es la última que cruzó la franja superior.
        if (atBottom()) return
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length) active.value = visible[visible.length - 1]!.target.id
      },
      { rootMargin: '-18% 0px -70% 0px' },
    )
    props.doc.sections.forEach((section) => {
      const el = document.getElementById(section.id)
      if (el) observer!.observe(el)
    })
  }
})

onBeforeUnmount(() => {
  document.title = previousTitle
  window.removeEventListener('scroll', onScroll)
  media?.removeEventListener?.('change', onMedia)
  observer?.disconnect()
})

function onToggle(event: Event) {
  tocOpen.value = (event.target as HTMLDetailsElement).open
}

const pad = (n: number) => String(n).padStart(2, '0')

// El pie ya no repite el correo del documento (muestra el de contacto comercial
// de la landing), así que el canal legal se enlaza dentro del propio texto.
function withMailLink(text: string): { text: string; mail: boolean }[] {
  return text
    .split(LEGAL_CONTACT_EMAIL)
    .flatMap((part, i) =>
      i === 0
        ? [{ text: part, mail: false }]
        : [
            { text: LEGAL_CONTACT_EMAIL, mail: true },
            { text: part, mail: false },
          ],
    )
    .filter((part) => part.text !== '')
}
</script>

<template>
  <div id="inicio" class="ld">
    <a class="ld__skip" href="#contenido">Saltar al contenido</a>

    <!-- Mesa de patronaje: rejilla fina y dos luces. Puramente ornamental. -->
    <div class="ld__bg" aria-hidden="true">
      <span class="ld__glow ld__glow--brass"></span>
      <span class="ld__glow ld__glow--blue"></span>
      <span class="ld__grid"></span>
    </div>

    <header class="ld__head" :class="{ 'ld__head--scrolled': scrolled }">
      <div class="ld__wrap ld__head-row">
        <RouterLink class="ld__brand" to="/" aria-label="NAVA, volver al inicio">
          <NavaWordmark variant="inverted" />
        </RouterLink>
        <RouterLink class="ld__btn" to="/">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Volver al inicio
        </RouterLink>
      </div>
    </header>

    <main id="contenido" class="ld__wrap ld__main">
      <div class="ld__hero">
        <p class="ld__eyebrow">Documento legal</p>
        <h1 class="ld__title">{{ doc.title }}</h1>
        <span class="ld__rule" aria-hidden="true"></span>
        <p class="ld__lede">{{ doc.lede }}</p>
        <p class="ld__updated">
          Última actualización · <time :datetime="LEGAL_UPDATED_ISO">{{ LEGAL_UPDATED }}</time>
        </p>
        <span class="ld__tape" aria-hidden="true"></span>
      </div>

      <div class="ld__layout">
        <nav class="ld__toc" aria-label="En esta página">
          <details :open="tocOpen" @toggle="onToggle">
            <summary>
              <span>En esta página</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </summary>
            <ol>
              <li v-for="section in doc.sections" :key="section.id">
                <a
                  :href="`#${section.id}`"
                  :aria-current="active === section.id ? 'location' : undefined"
                  :class="{ 'ld__toc-link--active': active === section.id }"
                  >{{ section.title }}</a
                >
              </li>
            </ol>
          </details>
        </nav>

        <article class="ld__body">
          <section
            v-for="(section, index) in doc.sections"
            :id="section.id"
            :key="section.id"
            class="ld__section"
          >
            <h2>
              <span class="ld__num" aria-hidden="true">{{ pad(index + 1) }}</span>
              {{ section.title }}
            </h2>
            <template v-for="(block, i) in section.blocks" :key="i">
              <p v-if="block.kind === 'p'">
                <template v-for="(part, j) in withMailLink(block.text)" :key="j"
                  ><a v-if="part.mail" :href="`mailto:${LEGAL_CONTACT_EMAIL}`">{{ part.text }}</a
                  ><template v-else>{{ part.text }}</template></template
                >
              </p>
              <ul v-else-if="block.kind === 'ul'">
                <li v-for="item in block.items" :key="item">{{ item }}</li>
              </ul>
              <p v-else class="ld__note" :lang="block.lang">{{ block.text }}</p>
            </template>
          </section>

          <RouterLink class="ld__next" :to="next.to">
            <span class="ld__next-label">Sigue leyendo</span>
            <span class="ld__next-title">
              {{ next.label }}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </RouterLink>
        </article>
      </div>
    </main>

    <!-- Issue #551: el mismo pie de la landing cierra cada documento; sus
         enlaces de recorrido llevan a la landing y «Volver arriba» sube a la
         cabecera del documento. -->
    <SiteFooter class="ld__foot" top-href="#inicio" />
  </div>
</template>

<style scoped>
/* Mismos tokens semánticos que la landing: ningún hexadecimal suelto. */
.ld {
  --ld-ink: var(--color-surface-strong);
  --ld-ink-raised: var(--color-field-strong-raised);
  --ld-ink-deep: var(--color-field-strong);
  --ld-text: var(--color-on-strong);
  --ld-soft: var(--color-on-strong-soft);
  --ld-muted: var(--color-on-strong-muted);
  --ld-brass: var(--color-brand-accent-surface);
  --ld-line: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  --ld-line-strong: color-mix(in srgb, var(--color-on-strong) 24%, transparent);
  --ld-gutter: clamp(20px, 5vw, 72px);

  position: relative;
  min-height: 100dvh;
  overflow-x: clip;
  background: var(--ld-ink);
  color: var(--ld-text);
  font-family: var(--font-sans);
}

.ld__wrap {
  width: 100%;
  max-width: 1240px;
  margin-inline: auto;
  padding-inline: var(--ld-gutter);
}

.ld :focus-visible {
  outline: 2px solid var(--ld-brass);
  outline-offset: 3px;
  border-radius: var(--radius-md);
}

.ld__skip {
  position: absolute;
  left: 16px;
  top: -64px;
  z-index: 40;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  background: var(--ld-brass);
  color: var(--color-brand-accent-text);
  font-weight: 600;
  text-decoration: none;
}

.ld__skip:focus {
  top: 12px;
}

/* ── Fondo ──────────────────────────────────────────────────────────────── */

.ld__bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.ld__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.4;
}

.ld__glow--brass {
  top: -220px;
  right: -140px;
  width: 560px;
  height: 560px;
  background: color-mix(in srgb, var(--color-brand-accent-surface) 40%, transparent);
}

.ld__glow--blue {
  bottom: -240px;
  left: -180px;
  width: 520px;
  height: 520px;
  background: color-mix(in srgb, var(--color-info-border) 38%, transparent);
}

.ld__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      to right,
      color-mix(in srgb, var(--color-on-strong) 5%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-on-strong) 5%, transparent) 1px,
      transparent 1px
    );
  background-size: 56px 56px;
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 70% 8%, #000 10%, transparent 75%);
  mask-image: radial-gradient(ellipse 90% 70% at 70% 8%, #000 10%, transparent 75%);
}

/* ── Cabecera ───────────────────────────────────────────────────────────── */

.ld__head {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 20;
  border-bottom: 1px solid transparent;
  transition:
    background-color 300ms var(--motion-ease-out),
    border-color 300ms var(--motion-ease-out);
}

.ld__head--scrolled {
  background: var(--ld-ink);
  border-bottom-color: var(--ld-line);
}

.ld__head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 80px;
}

.ld__brand {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  text-decoration: none;
}

.ld__brand :deep(.nava-wordmark) {
  font-size: 30px;
  letter-spacing: 0.14em;
}

.ld__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--ld-text);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-decoration: none;
  transition:
    border-color 220ms var(--motion-ease-out),
    background-color 220ms var(--motion-ease-out);
}

.ld__btn svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--ld-brass);
}

.ld__btn:hover {
  border-color: var(--ld-brass);
  background: color-mix(in srgb, var(--color-on-strong) 5%, transparent);
}

/* ── Portada del documento ──────────────────────────────────────────────── */

.ld__main {
  position: relative;
  z-index: 1;
  padding-top: clamp(112px, 14vw, 168px);
  padding-bottom: clamp(56px, 8vw, 112px);
}

.ld__hero {
  max-width: 820px;
}

.ld__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ld-brass);
}

.ld__eyebrow::before {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  background: var(--ld-brass);
  transform: rotate(45deg);
}

.ld__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(40px, 6.2vw, 72px);
  line-height: 1.04;
  letter-spacing: -0.005em;
  text-wrap: balance;
}

/* Filete de latón con rombo: la misma firma de la marca del acceso. */
.ld__rule {
  position: relative;
  display: block;
  width: min(220px, 50%);
  height: 2px;
  margin: 28px 0;
  background: var(--ld-brass);
}

.ld__rule::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 100%;
  width: 9px;
  height: 9px;
  background: var(--ld-brass);
  transform: translate(-50%, -50%) rotate(45deg);
}

.ld__lede {
  margin: 0;
  max-width: 60ch;
  font-size: clamp(18px, 1.7vw, 21px);
  line-height: 1.6;
  color: var(--ld-soft);
  text-wrap: pretty;
}

.ld__updated {
  margin: 20px 0 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ld-muted);
}

/* Cinta métrica de latón, como la del acceso: separa la portada del texto. */
.ld__tape {
  display: block;
  height: 14px;
  margin-top: clamp(36px, 5vw, 56px);
  background-image:
    linear-gradient(to right, var(--ld-brass) 1px, transparent 1px),
    linear-gradient(to right, var(--ld-brass) 1px, transparent 1px);
  background-size:
    12px 7px,
    60px 14px;
  background-repeat: repeat-x;
  background-position: left bottom;
  opacity: 0.32;
  -webkit-mask-image: linear-gradient(to right, #000 55%, transparent);
  mask-image: linear-gradient(to right, #000 55%, transparent);
}

/* ── Índice ─────────────────────────────────────────────────────────────── */

.ld__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 32px;
  margin-top: clamp(32px, 5vw, 56px);
}

.ld__toc details {
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--ld-ink-raised) 60%, transparent);
}

.ld__toc summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 0 18px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ld-brass);
  cursor: pointer;
  list-style: none;
}

.ld__toc summary::-webkit-details-marker {
  display: none;
}

.ld__toc summary svg {
  width: 20px;
  height: 20px;
  transition: transform 220ms var(--motion-ease-out);
}

.ld__toc details[open] summary svg {
  transform: rotate(180deg);
}

.ld__toc ol {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 4px 18px 16px;
  list-style: none;
}

.ld__toc a {
  position: relative;
  display: block;
  padding: 9px 0 9px 22px;
  font-size: 16px;
  line-height: 22px;
  color: var(--ld-soft);
  text-decoration: none;
  transition: color 200ms ease;
}

/* Rombo de la guía: vacío en reposo, lleno en la sección que se lee. */
.ld__toc a::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  width: 7px;
  height: 7px;
  border: 1px solid var(--ld-brass);
  transform: translateY(-50%) rotate(45deg);
  transition: background-color 200ms ease;
}

.ld__toc a:hover,
.ld__toc a.ld__toc-link--active {
  color: var(--ld-text);
}

.ld__toc a.ld__toc-link--active::before {
  background: var(--ld-brass);
}

/* ── Texto ──────────────────────────────────────────────────────────────── */

.ld__body {
  min-width: 0;
  max-width: 70ch;
}

.ld__section {
  padding-top: 40px;
  margin-top: 40px;
  border-top: 1px solid var(--ld-line);
  scroll-margin-top: 96px;
}

.ld__section:first-child {
  padding-top: 0;
  margin-top: 0;
  border-top: 0;
}

.ld__section h2 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 20px;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(28px, 3.2vw, 38px);
  line-height: 1.12;
  text-wrap: balance;
  color: var(--ld-text);
}

.ld__num {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0.2em;
  color: var(--ld-brass);
}

.ld__section p,
.ld__section li {
  font-size: 18px;
  line-height: 1.75;
  color: var(--ld-soft);
  overflow-wrap: anywhere;
}

.ld__section p {
  margin: 0 0 18px;
}

.ld__section ul {
  display: grid;
  gap: 10px;
  margin: 0 0 22px;
  padding: 0;
  list-style: none;
}

.ld__section li {
  position: relative;
  padding-left: 26px;
}

.ld__section li::before {
  content: '';
  position: absolute;
  top: 0.72em;
  left: 4px;
  width: 6px;
  height: 6px;
  background: var(--ld-brass);
  transform: rotate(45deg);
}

.ld__section p a {
  color: var(--ld-text);
  text-decoration-color: var(--ld-brass);
  text-underline-offset: 4px;
}

.ld__section p a:hover {
  color: var(--ld-brass);
}

/* Declaración destacada (Uso limitado de Google): panel levantado con el
   filete de latón a la izquierda. Dos declaraciones seguidas forman un solo
   panel. */
.ld__section p.ld__note {
  margin: 8px 0 0;
  padding: 18px 20px 18px 22px;
  border: 1px solid var(--ld-line);
  border-left: 3px solid var(--ld-brass);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--ld-ink-raised) 70%, transparent);
  color: var(--ld-text);
  font-size: 17px;
  line-height: 1.65;
}

.ld__section p.ld__note + p.ld__note {
  margin-top: -1px;
  border-top-color: transparent;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.ld__section p.ld__note:has(+ p.ld__note) {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  margin-bottom: 0;
}

/* Invitación al otro documento. */
.ld__next {
  display: grid;
  gap: 8px;
  margin-top: 56px;
  padding: 24px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition:
    border-color 220ms var(--motion-ease-out),
    background-color 220ms var(--motion-ease-out);
}

.ld__next:hover {
  border-color: var(--ld-brass);
  background: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
}

.ld__next-label {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ld-brass);
}

.ld__next-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-family: var(--font-display);
  font-size: clamp(24px, 3vw, 30px);
  line-height: 1.15;
  color: var(--ld-text);
}

.ld__next-title svg {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--ld-brass);
}

/* ── Pie ────────────────────────────────────────────────────────────────── */

/* Por encima del fondo fijo del documento. */
.ld__foot {
  z-index: 1;
}

/* ── Anchos ─────────────────────────────────────────────────────────────── */

@media (max-width: 479px) {
  .ld__head-row {
    gap: 12px;
  }

  .ld__brand :deep(.nava-wordmark) {
    font-size: 26px;
  }

  .ld__btn {
    padding: 0 14px;
  }
}

@media (min-width: 1024px) {
  .ld__layout {
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 72px;
    align-items: start;
  }

  .ld__toc {
    position: sticky;
    top: 112px;
  }

  /* En escritorio el índice es una guía siempre abierta: sin recuadro, sin
     cabecera de acordeón, con un hilo vertical que une los rombos. */
  .ld__toc details {
    border: 0;
    background: transparent;
  }

  .ld__toc summary {
    pointer-events: none;
    min-height: 0;
    padding: 0 0 16px;
    cursor: default;
  }

  .ld__toc summary svg {
    display: none;
  }

  .ld__toc ol {
    position: relative;
    padding: 0;
  }

  .ld__toc ol::before {
    content: '';
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 3px;
    width: 1px;
    background: var(--ld-line-strong);
  }

  .ld__toc a {
    font-size: 15px;
    padding-block: 7px;
  }

  .ld__toc a::before {
    background: var(--ld-ink);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ld__head,
  .ld__btn,
  .ld__next,
  .ld__toc a,
  .ld__toc a::before,
  .ld__toc summary svg {
    transition: none;
  }
}
</style>
