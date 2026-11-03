<script setup lang="ts">
// Cierre de la landing: la marca a gran escala sobre la mesa de patronaje, una
// última invitación a contratar, tres columnas de enlaces (recorrido, contacto
// y cuenta) y la franja legal con el regreso al inicio. Los datos de contacto
// salen del mismo archivo de contenido que la sección de contacto.
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { NavaWordmark } from '@/shared/ui'
import { landingContacts } from '../model/landingContent'

const year = new Date().getFullYear()

const phone = computed(() => landingContacts[0]!)
const mail = computed(() => landingContacts[1]!)
const callHref = computed(
  () =>
    phone.value.actions.find((a) => a.href.startsWith('tel:'))?.href ??
    phone.value.actions[0]!.href,
)
const mailHref = computed(() => mail.value.actions[0]!.href)

const tour = [
  { href: '#asistente', label: 'Asistente de IA' },
  { href: '#dia', label: 'Un día con NAVA' },
  { href: '#marca', label: 'Tu marca' },
  { href: '#plataforma', label: 'La plataforma' },
]
</script>

<template>
  <footer class="ft">
    <span class="ft__grid-bg" aria-hidden="true"></span>

    <div class="ln-wrap ft__body">
      <div class="ft__lead">
        <NavaWordmark variant="inverted" class="ft__mark" />
        <p class="ft__tag">Tu agenda, cortada a medida.</p>
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
      </div>

      <nav class="ft__col" aria-label="Recorrido">
        <h2>Explorar</h2>
        <a v-for="item in tour" :key="item.href" :href="item.href">{{ item.label }}</a>
      </nav>

      <div class="ft__col">
        <h2>Contacto</h2>
        <a :href="callHref">{{ phone.display }}</a>
        <a :href="mailHref">{{ mail.display }}</a>
      </div>

      <div class="ft__col">
        <h2>Tu cuenta</h2>
        <RouterLink :to="{ name: 'acceso' }">Iniciar sesión</RouterLink>
        <RouterLink :to="{ name: 'recuperar-acceso' }">Olvidé mi contraseña</RouterLink>
      </div>
    </div>

    <div class="ft__giant" aria-hidden="true"><span>NAVA</span></div>

    <div class="ln-wrap ft__base">
      <p>© {{ year }} NAVA · Gestión para barberías y salones</p>
      <a class="ft__top" href="#inicio">
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
.ft {
  position: relative;
  overflow: hidden;
  padding: clamp(72px, 9vw, 120px) 0 0;
  background: linear-gradient(to bottom, var(--ln-ink), var(--ln-ink-deep));
  border-top: 1px solid var(--ln-line-strong);
}

.ft::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 50%;
  width: min(560px, 60%);
  height: 2px;
  background: linear-gradient(to right, transparent, var(--ln-brass), transparent);
  transform: translateX(-50%);
}

.ft__grid-bg {
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
.ft__giant {
  position: relative;
  height: clamp(90px, 17.5vw, 270px);
  overflow: hidden;
  text-align: center;
  pointer-events: none;
  user-select: none;
  -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent);
  mask-image: linear-gradient(to bottom, #000 40%, transparent);
}

.ft__giant span {
  display: block;
  font-family: var(--font-display);
  font-size: clamp(150px, 31vw, 480px);
  line-height: 0.82;
  letter-spacing: 0.06em;
  white-space: nowrap;
  color: transparent;
  -webkit-text-stroke: 1px color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
}

.ft__body {
  position: relative;
  display: grid;
  gap: 48px 40px;
  padding-bottom: clamp(48px, 6vw, 80px);
}

.ft__lead {
  display: grid;
  gap: 20px;
  justify-items: start;
}

.ft__lead :deep(.nava-wordmark) {
  font-size: 40px;
  letter-spacing: 0.14em;
}

.ft__tag {
  margin: 0;
  max-width: 18ch;
  font-family: var(--font-display);
  font-size: clamp(30px, 3.4vw, 44px);
  line-height: 1.08;
  color: var(--ln-soft);
}

.ft__lead .ln-btn {
  margin-top: 6px;
}

.ft__col {
  display: grid;
  gap: 4px;
  align-content: start;
}

.ft__col h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ln-brass);
}

.ft__col a {
  position: relative;
  justify-self: start;
  padding: 8px 0;
  font-size: 18px;
  line-height: 26px;
  color: var(--ln-soft);
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: color 200ms ease;
}

.ft__col a::after {
  content: '';
  position: absolute;
  inset: auto 0 4px 0;
  height: 1px;
  background: var(--ln-brass);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 320ms var(--motion-ease-out);
}

.ft__col a:hover {
  color: var(--ln-text);
}

.ft__col a:hover::after {
  transform: scaleX(1);
}

.ft__base {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  padding-block: 26px 30px;
  border-top: 1px solid var(--ln-line);
}

.ft__base p {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.02em;
  color: var(--ln-muted);
}

.ft__top {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-pill);
  background: var(--ln-ink);
  font-size: 15px;
  font-weight: 600;
  color: var(--ln-soft);
  text-decoration: none;
  transition:
    border-color 200ms ease,
    color 200ms ease;
}

.ft__top svg {
  width: 18px;
  height: 18px;
}

.ft__top:hover {
  border-color: var(--ln-brass);
  color: var(--ln-brass);
}

@media (min-width: 760px) {
  .ft__body {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ft__lead {
    grid-column: 1 / -1;
  }
}

@media (min-width: 1100px) {
  .ft__body {
    grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr));
  }

  .ft__lead {
    grid-column: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ft__col a,
  .ft__col a::after,
  .ft__top {
    transition: none;
  }
}
</style>
