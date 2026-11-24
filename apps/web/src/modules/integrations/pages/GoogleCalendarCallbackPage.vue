<script setup lang="ts">
// Pantalla de retorno de Google (issue #325, DEC-102): es el `redirect_uri`
// registrado en Google Cloud. Google redirige aquí con `state` y `code` (o
// `error` si el profesional rechazó); la pantalla los reenvía una sola vez al API,
// que valida el `state` (de un solo uso, ligado a esta sesión), canjea el código
// con PKCE y guarda el token cifrado. El código nunca se guarda ni se registra
// y la URL se limpia en cuanto se lee.
//
// En la familia (#838, DEC-189): cada desenlace es el sol-rombo quieto sobre su
// filete de latón (un estado, no una espera), con el foco en el h1. Los textos
// son los de siempre: dicen qué pasó y qué hacer después.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useToast } from '@/shared/composables'
import { DiamondLoader, SunDiamond } from '@/shared/ui'
import { completeCallback } from '../api/googleCalendarApi'

type Phase = 'working' | 'invalid' | 'denied' | 'failed' | 'error'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const phase = ref<Phase>('working')
const title = ref<HTMLElement | null>(null)

const outcome = computed(() => {
  switch (phase.value) {
    case 'working':
      return null
    case 'denied':
      return {
        headline: 'No diste el permiso.',
        body: 'Sin el permiso de calendario Nava Agenda no puede publicar tu agenda. Puedes intentarlo de nuevo cuando quieras.',
      }
    case 'invalid':
      return {
        headline: 'La autorización venció.',
        body: 'El enlace de Google ya se usó o venció. Inicia la conexión de nuevo desde Nava Agenda.',
      }
    case 'failed':
      return {
        headline: 'No pudimos conectar.',
        body: 'Google no completó la conexión. Inténtalo de nuevo; tus turnos no se tocaron.',
      }
    default:
      return {
        headline: 'No pudimos conectar.',
        body: 'Hubo un problema al hablar con Nava Agenda. Revisa tu conexión e inténtalo de nuevo.',
      }
  }
})

// Al llegar un desenlace, el foco va al h1: el lector empieza por arriba y el
// aviso (role="alert") se anuncia una vez.
watch(phase, async (next) => {
  if (next === 'working') return
  await nextTick()
  title.value?.focus({ preventScroll: true })
})

function first(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

async function finish() {
  const state = first(route.query.state)
  const code = first(route.query.code)
  const error = first(route.query.error)

  // El código y el state no deben quedarse en la URL ni en el historial.
  await router.replace({ name: 'integraciones-google-calendar-retorno', query: {} })

  if (!state) {
    phase.value = 'invalid'
    return
  }
  const outcome = await completeCallback({ state, code, error })
  if (outcome.kind === 'success') {
    if (outcome.result === 'connected') {
      toast.success('Google Calendar conectado', {
        detail: 'Tus turnos y bloqueos aparecerán en tu calendario.',
      })
      await router.replace({ name: 'integraciones-google-calendar' })
      return
    }
    phase.value = outcome.result === 'denied' ? 'denied' : 'failed'
    return
  }
  phase.value = outcome.kind === 'invalid' ? 'invalid' : 'error'
}

// Una sola vez: el state solo sirve una vez y un segundo envío lo reportaría inválido.
let started = false
onMounted(() => {
  if (started) return
  started = true
  void finish()
})
</script>

<template>
  <section class="gcal-return" aria-labelledby="gcal-return-title">
    <h1 id="gcal-return-title" ref="title" class="gcal-return__title" tabindex="-1">
      Google Calendar
    </h1>

    <div v-if="phase === 'working'" class="gcal-return__state" role="status" aria-live="polite">
      <DiamondLoader label="Conectando con Google…" />
    </div>

    <div v-else-if="outcome" class="gcal-return__box" role="alert">
      <div class="gcal-return__mark" aria-hidden="true">
        <SunDiamond still />
        <span class="gcal-return__line" />
      </div>
      <h2 class="gcal-return__headline">{{ outcome.headline }}</h2>
      <p class="gcal-return__body">{{ outcome.body }}</p>
      <RouterLink :to="{ name: 'integraciones-google-calendar' }" class="gcal-return__back">
        Volver a Google Calendar
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.gcal-return {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(100%, 640px);
  margin: 0 auto;
  padding: 48px 16px;
  color: var(--color-text-primary);
  box-sizing: border-box;
}

/* Mismo h1 que la Agenda del día (v2, DEC-188). */
.gcal-return__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-page-title);
  font-weight: 400;
  line-height: var(--font-size-page-title-line);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

.gcal-return__title:focus {
  outline: none;
}

.gcal-return__title:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 4px;
}

.gcal-return__state {
  color: var(--color-text-secondary);
}

/* El desenlace, como los estados de la reserva (#809): el sol-rombo quieto sobre
   su filete de latón, el titular en serif y el texto de siempre. */
.gcal-return__box {
  display: grid;
  gap: var(--space-3);
  justify-items: center;
  padding: var(--space-6) 0 var(--space-4);
  text-align: center;
}

.gcal-return__mark {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.gcal-return__line {
  width: 96px;
  height: 1px;
  background-color: var(--color-brass-line);
}

.gcal-return__headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(26px, 4.4vw, 32px);
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.gcal-return__body {
  max-width: 30rem;
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  color: var(--color-text-secondary);
  text-wrap: pretty;
}

/* Un enlace con aspecto de botón secundario (antes era un <button> dentro de un
   <a>: dos controles anidados). */
.gcal-return__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin-top: var(--space-3);
  padding: 0 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  text-decoration: none;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-return__back:hover {
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, var(--color-surface));
  border-color: var(--color-text-primary);
}

.gcal-return__back:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .gcal-return__back {
    transition: none;
  }
}
</style>
