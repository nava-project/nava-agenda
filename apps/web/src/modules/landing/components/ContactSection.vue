<script setup lang="ts">
// Segunda pantalla: cómo contratar NAVA y cómo entrar si ya se tiene cuenta.
// Los tres canales (WhatsApp, llamada, correo) salen de un único archivo de
// contenido; cada fila abre la acción nativa y ofrece «Copiar» por si la
// persona prefiere anotar el dato. El aviso «Copiado» se anuncia en una región
// viva. A la derecha, el acceso para quien ya usa NAVA.
import { onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { landingContacts, type LandingContact } from '../model/landingContent'
import { useInView } from '../composables/useInView'

const root = ref<HTMLElement | null>(null)
const { seen } = useInView(root, 0.15)

const copied = ref<string | null>(null)
let resetTimer = 0

async function copy(contact: LandingContact) {
  try {
    await navigator.clipboard.writeText(contact.copyValue)
    copied.value = contact.label
  } catch {
    // Sin permiso de portapapeles el dato sigue visible y es seleccionable.
    copied.value = null
    return
  }
  window.clearTimeout(resetTimer)
  resetTimer = window.setTimeout(() => (copied.value = null), 2200)
}

onBeforeUnmount(() => window.clearTimeout(resetTimer))
</script>

<template>
  <section id="contacto" ref="root" class="ct" aria-labelledby="ct-title">
    <div class="ln-wrap">
      <div class="ct__panel ln-reveal" :data-seen="seen">
        <span class="ct__mark ct__mark--tl" aria-hidden="true"></span>
        <span class="ct__mark ct__mark--br" aria-hidden="true"></span>

        <div class="ct__main">
          <p class="ln-eyebrow">Contrata NAVA</p>
          <h2 id="ct-title" class="ln-title">Llevemos NAVA <em>a tu barbería.</em></h2>
          <p class="ln-lead">
            Cuéntanos cuántas personas trabajan contigo y cómo agendas hoy. Armamos NAVA a tu medida
            y te acompañamos en el arranque.
          </p>

          <ul class="ct__channels">
            <li
              v-for="(contact, index) in landingContacts"
              :key="contact.label"
              class="ct__row ln-reveal"
              :data-seen="seen"
              :style="{ '--i': index + 2 }"
            >
              <div class="ct__info">
                <span class="ct__label">{{ contact.label }}</span>
                <span class="ct__value">{{ contact.display }}</span>
              </div>
              <div class="ct__tools">
                <a
                  v-for="(action, ai) in contact.actions"
                  :key="action.href"
                  class="ln-btn"
                  :class="index === 0 && ai === 0 ? 'ln-btn--solid' : 'ln-btn--line'"
                  :href="action.href"
                  :target="action.external ? '_blank' : undefined"
                  :rel="action.external ? 'noopener noreferrer' : undefined"
                  >{{ action.label }}</a
                >
                <button
                  class="ct__copy"
                  type="button"
                  :aria-label="`Copiar ${contact.display}`"
                  @click="copy(contact)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V6a2 2 0 0 1 2-2h9" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
            </li>
          </ul>
          <p class="ct__status" role="status" aria-live="polite">
            <template v-if="copied">{{ copied }} copiado al portapapeles</template>
          </p>
        </div>

        <aside
          class="ct__login ln-reveal"
          :data-seen="seen"
          style="--i: 3"
          aria-labelledby="ct-login"
        >
          <span class="ct__login-mark" aria-hidden="true"></span>
          <h3 id="ct-login">¿Ya usas NAVA?</h3>
          <p>Entra a tu panel para ver la agenda de hoy, tus turnos y tu equipo.</p>
          <RouterLink class="ln-btn ln-btn--solid" :to="{ name: 'acceso' }">
            Iniciar sesión
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </RouterLink>
          <RouterLink class="ct__forgot" :to="{ name: 'recuperar-acceso' }">
            Olvidé mi contraseña
          </RouterLink>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ct {
  padding: clamp(72px, 10vw, 140px) 0 clamp(72px, 9vw, 120px);
}

.ct__panel {
  position: relative;
  display: grid;
  gap: 48px;
  padding: clamp(28px, 5vw, 72px);
  background:
    radial-gradient(
      ellipse 60% 80% at 100% 0%,
      color-mix(in srgb, var(--color-brand-accent-surface) 16%, transparent),
      transparent 70%
    ),
    var(--ln-ink-deep);
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-lg);
}

/* Marcas de registro de la hoja de patronaje en dos esquinas. */
.ct__mark {
  position: absolute;
  width: 22px;
  height: 22px;
  border-color: var(--ln-brass);
  border-style: solid;
  border-width: 0;
}

.ct__mark--tl {
  top: -1px;
  left: -1px;
  border-top-width: 2px;
  border-left-width: 2px;
}

.ct__mark--br {
  right: -1px;
  bottom: -1px;
  border-right-width: 2px;
  border-bottom-width: 2px;
}

.ct__main {
  display: grid;
  gap: 22px;
  justify-items: start;
  min-width: 0;
}

.ct__channels {
  display: grid;
  gap: 0;
  width: 100%;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--ln-line);
}

.ct__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  padding: 20px 0;
  border-bottom: 1px solid var(--ln-line);
}

.ct__info {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.ct__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ln-brass);
}

.ct__value {
  font-family: var(--font-display);
  font-size: clamp(24px, 3.6vw, 36px);
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.ct__tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ct__copy {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--ln-line-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--ln-soft);
  cursor: pointer;
  transition:
    border-color 200ms ease,
    color 200ms ease;
}

.ct__copy svg {
  width: 20px;
  height: 20px;
}

.ct__copy:hover {
  border-color: var(--ln-brass);
  color: var(--ln-brass);
}

.ct__status {
  min-height: 20px;
  margin: -8px 0 0;
  font-size: 13px;
  color: var(--color-success-on-strong);
}

.ct__login {
  position: relative;
  display: grid;
  gap: 16px;
  align-content: start;
  justify-items: start;
  padding: 32px 28px;
  background: var(--ln-ink);
  border: 1px solid var(--ln-brass-line);
  border-radius: var(--radius-lg);
}

.ct__login-mark {
  width: 14px;
  height: 14px;
  background: var(--ln-brass);
  transform: rotate(45deg);
  margin: 4px 0 6px 4px;
}

.ct__login h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 32px;
  line-height: 1.1;
}

.ct__login p {
  margin: 0;
  font-size: 15px;
  line-height: 24px;
  color: var(--ln-muted);
}

.ct__login .ln-btn {
  margin-top: 6px;
}

.ct__forgot {
  font-size: 14px;
  color: var(--ln-soft);
  text-underline-offset: 4px;
}

.ct__forgot:hover {
  color: var(--ln-brass);
}

@media (min-width: 1020px) {
  .ct__panel {
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 0.7fr);
    gap: 64px;
    align-items: start;
  }
}

@media (max-width: 520px) {
  .ct__tools {
    flex-wrap: wrap;
    width: 100%;
  }

  .ct__tools .ln-btn {
    flex: 1 1 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ct__copy {
    transition: none;
  }
}
</style>
