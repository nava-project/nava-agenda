<script setup lang="ts">
// Cascarón reutilizable de toda ruta privada (HU-012). Compone cabecera,
// navegación y área de contenido solo cuando el estado es `authenticated`;
// renderiza los estados globales de carga y conexión perdida en su lugar,
// nunca una pantalla en blanco (objetivo de la historia). No construye
// agenda ni ninguna capacidad de B1-B3: `<RouterView />` es el único punto
// de extensión para las pantallas que las historias siguientes agreguen
// como hijas de esta misma ruta.
import { onBeforeUnmount } from 'vue'
import { attachWorkspaceTheme } from '@/shared/model'
import { BaseAlert, BaseButton, DiamondLoader, ToastRegion } from '@/shared/ui'
import type { NavItem } from '@/shared/navigation/navItem'
import { retryBootstrap, sessionState } from '../model/sessionStore'
import AppHeader from '../components/AppHeader.vue'
import AppNav from '../components/AppNav.vue'

// extraNavItems llega como prop estática de ruta (auth.privateShellRoute,
// HU-020): `app/router/index.ts` combina las entradas de cada módulo con
// una pantalla privada, sin que este componente ni `auth` importen esos
// módulos.
defineProps<{ extraNavItems?: NavItem[] }>()

// Modo, tamaño de texto, animaciones y acento del negocio (DEC-110) se
// pintan en <html> solo mientras el cascarón está montado; al salir se retiran,
// así el acceso y la reserva pública nunca heredan el tema del panel.
const detachWorkspaceTheme = attachWorkspaceTheme()
onBeforeUnmount(detachWorkspaceTheme)

function onRetry() {
  void retryBootstrap()
}
</script>

<template>
  <div class="private-shell">
    <template v-if="sessionState.bootstrap.status === 'authenticated'">
      <AppHeader :business-name="sessionState.bootstrap.businessName" />
      <!-- v2 (DEC-188, entrega 5): en escritorio la navegación es un riel a la
           izquierda; en el teléfono y la tableta, la barra al pie. Va antes del
           contenido en el DOM (cabecera → navegación → contenido); en la barra
           al pie solo cambia su posición visual. -->
      <div class="private-shell__body">
        <AppNav :extra-items="extraNavItems" />
        <!-- Escenario posicionado entre cabecera y navegación: ancla la región
           de avisos (DEC-095) sin depender de la altura de ninguna de las dos
           ni desplazarse con el contenido. -->
        <div class="private-shell__stage">
          <!-- Fondo del panel: dos luces suaves y quietas (v2 retira la
             cuadrícula de patronaje). Capa decorativa detrás del contenido,
             sin eventos ni lectura de pantalla; las pantallas son
             transparentes y el fondo lo pone el escenario. -->
          <div class="shell-ambient" aria-hidden="true">
            <i class="shell-ambient__glow shell-ambient__glow--brass" />
            <i class="shell-ambient__glow shell-ambient__glow--sage" />
          </div>
          <main class="private-shell__content">
            <RouterView />
          </main>
          <ToastRegion placement="host" />
        </div>
      </div>
    </template>

    <div
      v-else-if="sessionState.bootstrap.status === 'connection-lost'"
      class="private-shell__state"
    >
      <BaseAlert variant="warning" title="No pudimos conectar" role="status">
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton variant="secondary" @click="onRetry">Reintentar</BaseButton>
        </template>
      </BaseAlert>
    </div>

    <div v-else class="private-shell__state" role="status" aria-live="polite">
      <DiamondLoader label="Abriendo tu agenda…" />
    </div>
  </div>
</template>

<style scoped>
.private-shell {
  display: flex;
  flex-direction: column;
  height: var(--viewport-height);
  background-color: var(--color-chrome-surface);
}

/* min-height: 0 es necesario para que este hijo flex pueda encogerse por
   debajo de la altura de su contenido: sin esto, un contenido largo crece
   la columna entera más allá de 100dvh y arrastra el header y el dock
   fuera de pantalla en vez de quedarse fijos mientras solo el contenido
   se desplaza (reporte en vivo, issue #189). */
.private-shell__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.private-shell__body > :deep(.app-nav) {
  order: 2;
}

@media (min-width: 1024px) {
  .private-shell__body {
    flex-direction: row;
  }

  .private-shell__body > :deep(.app-nav) {
    order: 0;
  }
}

.private-shell__stage {
  position: relative;
  background-color: var(--color-surface-strong);
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.private-shell__content {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Barra de scroll fina y neutra (v2: sin latón). */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-text-primary) 28%, transparent) transparent;
}

.private-shell__content::-webkit-scrollbar {
  width: 10px;
}

.private-shell__content::-webkit-scrollbar-track {
  background: transparent;
}

.private-shell__content::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--color-text-primary) 28%, transparent);
  border: 2px solid var(--color-surface-strong);
  border-radius: var(--radius-pill);
}

.private-shell__content::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--color-text-primary) 45%, transparent);
}

.shell-ambient {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

/* Luces: manchas radiales muy tenues de latón y salvia, quietas. Hasta la v2
   se desplazaban en ciclos infinitos; en una herramienta que se abre decenas de
   veces al día eso es movimiento que nadie pidió y sin forma de pararlo (WCAG
   2.2.2). Revisión del 4a, DEC-188. */
.shell-ambient__glow {
  position: absolute;
  width: max(70vmax, 520px);
  height: max(70vmax, 520px);
  border-radius: 50%;
}

.shell-ambient__glow--brass {
  top: -34vmax;
  left: -22vmax;
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--color-brand-accent-surface) 12%, transparent),
    transparent
  );
}

.shell-ambient__glow--sage {
  right: -26vmax;
  bottom: -38vmax;
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--color-brand-sage) 14%, transparent),
    transparent
  );
}

.private-shell__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: var(--viewport-height);
  padding: var(--space-6) var(--space-4);
  gap: var(--space-4);
}
</style>
