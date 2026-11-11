<script setup lang="ts">
// Pie del sitio público (DEC-151): la marca a gran escala sobre la mesa de
// patronaje, una última invitación a contratar y cuatro columnas de enlaces
// (recorrido, contacto, cuenta y legal), con la franja de copyright. Lo
// comparten la landing y los documentos legales (issue #551): por eso vive en
// `shared/ui` y apunta a la landing por ruta (`/#seccion`), no por ancla local.
// Es autónomo: define sus propios tokens a partir de los semánticos de NAVA.
import { RouterLink } from 'vue-router'
import {
  SITE_CALL_HREF,
  SITE_EMAIL,
  SITE_MAIL_HREF,
  SITE_PHONE_DISPLAY,
} from '../model/siteContact'
import NavaWordmark from './NavaWordmark.vue'

withDefaults(
  defineProps<{
    /** Ancla del botón «Volver arriba» dentro de la página que aloja el pie. */
    topHref?: string
  }>(),
  { topHref: '#inicio' },
)

const year = new Date().getFullYear()

const tour = [
  { hash: '#para-quien', label: 'Para quién es' },
  { hash: '#asistente', label: 'Asistente de IA' },
  { hash: '#dia', label: 'Un día con NAVA' },
  { hash: '#marca', label: 'Tu marca' },
  { hash: '#plataforma', label: 'La plataforma' },
]
</script>

<template>
  <footer class="sf">
    <span class="sf__grid-bg" aria-hidden="true"></span>

    <div class="sf__wrap sf__body">
      <div class="sf__lead">
        <NavaWordmark variant="inverted" class="sf__mark" />
        <p class="sf__tag">Tu agenda, cortada a medida.</p>
        <!-- `custom`: un ancla a una sección no es «la página actual», así que
             estos enlaces no heredan `aria-current` de la ruta. -->
        <RouterLink v-slot="{ href, navigate }" :to="{ path: '/', hash: '#contacto' }" custom>
          <a class="sf__cta" :href="href" @click="navigate">
            Quiero NAVA para mi negocio
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
        </RouterLink>
      </div>

      <nav class="sf__col" aria-label="Recorrido">
        <h2>Explorar</h2>
        <RouterLink
          v-for="item in tour"
          :key="item.hash"
          v-slot="{ href, navigate }"
          :to="{ path: '/', hash: item.hash }"
          custom
        >
          <a :href="href" @click="navigate">{{ item.label }}</a>
        </RouterLink>
      </nav>

      <div class="sf__col">
        <h2>Contacto</h2>
        <a :href="SITE_CALL_HREF">{{ SITE_PHONE_DISPLAY }}</a>
        <a :href="SITE_MAIL_HREF">{{ SITE_EMAIL }}</a>
      </div>

      <div class="sf__col">
        <h2>Tu cuenta</h2>
        <RouterLink to="/acceso">Iniciar sesión</RouterLink>
        <RouterLink to="/recuperar-acceso">Olvidé mi contraseña</RouterLink>
      </div>

      <!-- Issue #545: Google exige que la página principal enlace de forma
           visible la política de privacidad y las condiciones. Issue #551: en
           su propia columna, con el documento abierto marcado. -->
      <nav class="sf__col" aria-label="Documentos legales">
        <h2>Legal</h2>
        <RouterLink to="/privacidad">Privacidad</RouterLink>
        <RouterLink to="/terminos">Condiciones</RouterLink>
      </nav>
    </div>

    <div class="sf__giant" aria-hidden="true"><span>NAVA</span></div>

    <div class="sf__wrap sf__base">
      <div class="sf__about">
        <p>© {{ year }} NAVA · Agenda de citas para independientes y equipos</p>
        <!-- Issue #569: Meta pide que el sitio muestre qué es NAVA y que Nexos es su
             asistente (nombres visibles de WhatsApp). El titular no se nombra aquí:
             figura como responsable en la política de privacidad. -->
        <p>NAVA es un servicio de gestión de agendas. Nexos es su asistente de WhatsApp.</p>
      </div>
      <a class="sf__top" :href="topHref">
        Volver arriba
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M12 19V5M6 11l6-6 6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </a>
    </div>
  </footer>
</template>

<style scoped>
.sf {
  --sf-ink: var(--color-surface-strong);
  --sf-ink-deep: var(--color-field-strong);
  --sf-text: var(--color-on-strong);
  --sf-soft: var(--color-on-strong-soft);
  --sf-muted: var(--color-on-strong-muted);
  --sf-brass: var(--color-brand-accent-surface);
  --sf-line: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  --sf-line-strong: color-mix(in srgb, var(--color-on-strong) 24%, transparent);

  position: relative;
  overflow: hidden;
  padding: clamp(72px, 9vw, 120px) 0 0;
  background: linear-gradient(to bottom, var(--sf-ink), var(--sf-ink-deep));
  border-top: 1px solid var(--sf-line-strong);
  color: var(--sf-text);
  font-family: var(--font-sans);
  font-size: 18px;
  line-height: 1.6;
}

.sf::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 50%;
  width: min(560px, 60%);
  height: 2px;
  background: linear-gradient(to right, transparent, var(--sf-brass), transparent);
  transform: translateX(-50%);
}

.sf :focus-visible {
  outline: 2px solid var(--sf-brass);
  outline-offset: 3px;
  border-radius: var(--radius-md);
}

.sf__wrap {
  width: 100%;
  max-width: 1400px;
  margin-inline: auto;
  padding-inline: clamp(20px, 5vw, 72px);
}

.sf__grid-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
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
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 60%);
  mask-image: linear-gradient(to bottom, transparent, #000 60%);
}

/* La marca a gran escala: una franja propia, recortada por abajo, con el
   contorno fino de latón. No se superpone a ningún texto. */
.sf__giant {
  position: relative;
  height: clamp(90px, 17.5vw, 270px);
  overflow: hidden;
  text-align: center;
  pointer-events: none;
  user-select: none;
  -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent);
  mask-image: linear-gradient(to bottom, #000 40%, transparent);
}

.sf__giant span {
  display: block;
  font-family: var(--font-display);
  font-size: clamp(150px, 31vw, 480px);
  line-height: 0.82;
  letter-spacing: 0.06em;
  white-space: nowrap;
  color: transparent;
  -webkit-text-stroke: 1px color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
}

.sf__body {
  position: relative;
  display: grid;
  gap: 48px 40px;
  padding-bottom: clamp(48px, 6vw, 80px);
}

.sf__lead {
  display: grid;
  gap: 20px;
  justify-items: start;
}

.sf__lead :deep(.nava-wordmark) {
  font-size: 40px;
  letter-spacing: 0.14em;
}

.sf__tag {
  margin: 0;
  max-width: 18ch;
  font-family: var(--font-display);
  font-size: clamp(30px, 3.4vw, 44px);
  line-height: 1.08;
  color: var(--sf-soft);
}

.sf__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 52px;
  margin-top: 6px;
  padding: 0 28px;
  border-radius: var(--radius-md);
  background: var(--sf-brass);
  color: var(--color-brand-accent-text);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-decoration: none;
  transition:
    transform 220ms var(--motion-ease-out),
    box-shadow 220ms var(--motion-ease-out);
}

.sf__cta svg {
  width: 20px;
  height: 20px;
  flex: none;
}

.sf__cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px -10px var(--sf-brass);
}

.sf__cta:active {
  transform: translateY(0);
}

.sf__col {
  display: grid;
  gap: 4px;
  align-content: start;
}

.sf__col h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--sf-brass);
}

.sf__col a {
  position: relative;
  justify-self: start;
  padding: 8px 0;
  font-size: 18px;
  line-height: 26px;
  color: var(--sf-soft);
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: color 200ms ease;
}

.sf__col a::after {
  content: '';
  position: absolute;
  inset: auto 0 4px 0;
  height: 1px;
  background: var(--sf-brass);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 320ms var(--motion-ease-out);
}

.sf__col a:hover,
.sf__col a[aria-current='page'] {
  color: var(--sf-text);
}

.sf__col a:hover::after,
.sf__col a[aria-current='page']::after {
  transform: scaleX(1);
}

.sf__base {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  padding-block: 26px 30px;
  border-top: 1px solid var(--sf-line);
}

.sf__about {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sf__base p {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.02em;
  color: var(--sf-muted);
}

.sf__top {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--sf-line-strong);
  border-radius: var(--radius-pill);
  background: var(--sf-ink);
  font-size: 15px;
  font-weight: 600;
  color: var(--sf-soft);
  text-decoration: none;
  transition:
    border-color 200ms ease,
    color 200ms ease;
}

.sf__top svg {
  width: 18px;
  height: 18px;
}

.sf__top:hover {
  border-color: var(--sf-brass);
  color: var(--sf-brass);
}

/* Cuatro columnas de enlaces: una sola en móvil, dos por fila en tablet, las
   cuatro bajo la invitación en ancho medio y junto a ella en escritorio, donde
   cada columna mide lo que su enlace más largo para no partir el correo. */
@media (min-width: 560px) {
  .sf__body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sf__lead {
    grid-column: 1 / -1;
  }
}

@media (min-width: 1024px) {
  .sf__body {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .sf__body {
    grid-template-columns: minmax(0, 1fr) repeat(4, auto);
    column-gap: clamp(40px, 4vw, 72px);
  }

  .sf__lead {
    grid-column: auto;
  }

  .sf__cta {
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sf__cta,
  .sf__col a,
  .sf__col a::after,
  .sf__top {
    transition: none;
  }

  .sf__cta:hover {
    transform: none;
  }
}
</style>
