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
    <p v-if="status === 'loading'" class="bk-state__loading" role="status">
      {{ loadingHeadline }}
    </p>
    <div v-else-if="content" class="bk-state__box" role="alert">
      <!-- Un horizonte con el sol a medio salir: tranquilo, sin alarma. -->
      <svg class="bk-state__horizon" viewBox="0 0 64 32" aria-hidden="true">
        <path class="bk-state__sun" d="M18 30a14 14 0 0 1 28 0z" />
        <path class="bk-state__line" d="M4 30h56" />
      </svg>
      <h2 class="bk-state__headline">{{ content.headline }}</h2>
      <p class="bk-state__body">{{ content.body }}</p>
      <button
        v-if="content.retry"
        type="button"
        class="bk-cta bk-state__retry"
        @click="emit('retry')"
      >
        Reintentar
      </button>
    </div>
  </main>
</template>

<style scoped>
.bk-state {
  display: grid;
  align-content: start;
  justify-items: center;
  padding-top: clamp(48px, 14vh, 128px);
}

.bk-state__loading {
  font-size: 15px;
  color: var(--color-text-secondary);
}

.bk-state__box {
  display: grid;
  gap: var(--space-3);
  justify-items: center;
  max-width: 30rem;
  text-align: center;
}

.bk-state__horizon {
  width: 80px;
  height: 40px;
  margin-bottom: var(--space-2);
  overflow: visible;
}

.bk-state__sun {
  fill: var(--color-sun);
}

.bk-state__line {
  stroke: var(--color-text-secondary);
  stroke-width: 1.5;
  stroke-linecap: round;
}

.bk-state__headline {
  margin: 0;
  font-size: clamp(22px, 4vw, 28px);
  font-weight: 600;
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

.bk-state__retry {
  margin-top: var(--space-3);
  min-width: 160px;
}
</style>
