<script setup lang="ts">
// Pantalla de estado de página de la reserva pública: carga, enlace no
// encontrado, error de red y error inesperado (DEC-111). Las pantallas de la
// reserva comparten este bloque; cada una solo aporta su título oculto y el
// texto de carga.
//
// v2 (DEC-188): al cliente se le orienta, no se le alarma. Nada de rótulos
// «Error» en rojo ni filetes: un horizonte tranquilo, una frase que dice qué
// pasa y, solo si sirve de algo, «Reintentar». La pantalla reserva el alto de
// la página para que el pie no salte cuando llega el estado (CLS).
import { computed } from 'vue'
import { DiamondLoader, SunDiamond } from '@/shared/ui'

interface Props {
  status: 'loading' | 'not-found' | 'network-error' | 'unexpected-error'
  /** Título `<h1>` accesible pero oculto: estas pantallas no tienen otro `<h1>`
   * (page-has-heading-one, axe). */
  title: string
  loadingHeadline: string
  requestId?: string
  /** Texto propio para «no encontrado»: «Mi turno» no habla de agendas, sino de
   * un enlace de turno que venció o se escribió incompleto. */
  notFound?: { headline: string; body: string }
}

const props = defineProps<Props>()
const emit = defineEmits<{ retry: [] }>()

// «Volver» solo tiene sentido si hay una página anterior en esta pestaña: quien
// abre el enlace directo desde WhatsApp no tiene a dónde volver.
function canGoBack(): boolean {
  return typeof window !== 'undefined' && window.history.length > 1
}

function goBack() {
  window.history.back()
}

const content = computed(() => {
  switch (props.status) {
    case 'not-found':
      // Reintentar no cambiaría nada: el enlace no existe o ya no se publica.
      return {
        ...(props.notFound ?? {
          headline: 'Este enlace no lleva a ninguna agenda',
          body: 'Pide al negocio el enlace de nuevo y ábrelo tal como te llegue.',
        }),
        retry: false,
        // Un camino para seguir (#809): qué hacer si ya tenía turno y, si llegó
        // desde otra página, volver a ella.
        hint: props.notFound
          ? null
          : '¿Ya tenías un turno? Ábrelo desde el enlace que te llegó por correo o WhatsApp.',
        back: canGoBack(),
      }
    case 'network-error':
      return {
        headline: 'No pudimos conectar',
        body: 'Revisa tu conexión e inténtalo de nuevo.',
        retry: true,
      }
    case 'unexpected-error':
      return {
        headline: 'Algo no salió bien',
        body: props.requestId
          ? `Inténtalo de nuevo. Si continúa, comparte este código con soporte: ${props.requestId}.`
          : 'Inténtalo de nuevo en unos segundos.',
        retry: true,
      }
    default:
      return null
  }
})
</script>

<template>
  <main class="bk-page bk-state">
    <h1 class="pb-sr-only">{{ title }}</h1>
    <DiamondLoader v-if="status === 'loading'" :label="loadingHeadline" announce />
    <div v-else-if="content" class="bk-state__box" role="alert">
      <!-- El rombo en el sol de la familia, quieto sobre su horizonte: un estado,
           no una espera (#809). -->
      <div class="bk-state__mark" aria-hidden="true">
        <SunDiamond still />
        <span class="bk-state__line" />
      </div>
      <h2 class="bk-state__headline">{{ content.headline }}</h2>
      <p class="bk-state__body">{{ content.body }}</p>
      <p v-if="'hint' in content && content.hint" class="bk-state__hint">{{ content.hint }}</p>
      <button
        v-if="content.retry"
        type="button"
        class="bk-cta bk-state__retry"
        @click="emit('retry')"
      >
        Reintentar
      </button>
      <button
        v-else-if="'back' in content && content.back"
        type="button"
        class="bk-cta bk-cta--secondary bk-state__retry"
        @click="goBack"
      >
        Volver
      </button>
    </div>
  </main>
</template>

<style scoped>
/* El bloque queda centrado en el alto que la página reserva para el pie (CLS),
   un poco por encima del centro óptico: sin ~500 px de vacío debajo (#809). */
.bk-state {
  display: grid;
  align-content: center;
  justify-items: center;
  padding-bottom: clamp(64px, 14vh, 160px);
}

.bk-state__box {
  display: grid;
  gap: var(--space-3);
  justify-items: center;
  max-width: 30rem;
  text-align: center;
}

.bk-state__mark {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

/* El horizonte en latón bajo la marca, como la regla de la familia. */
.bk-state__line {
  width: 96px;
  height: 1px;
  background-color: var(--color-brass-line);
}

.bk-state__headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(28px, 4.6vw, 34px);
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.bk-state__body {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  color: var(--color-text-secondary);
  text-wrap: pretty;
}

.bk-state__hint {
  margin: var(--space-2) 0 0;
  padding-top: var(--space-4);
  font-size: 15px;
  line-height: 22px;
  color: var(--color-text-secondary);
  text-wrap: pretty;
  border-top: 1px dashed color-mix(in srgb, var(--color-brass-line) 60%, transparent);
}

.bk-state__retry {
  margin-top: var(--space-3);
  min-width: 160px;
}
</style>
