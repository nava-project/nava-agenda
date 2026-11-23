<script setup lang="ts">
/**
 * ToastRegion - Región única que muestra la cola de avisos emergentes
 * (DEC-095). Se monta una sola vez por pantalla:
 * - `viewport`: anclada a la ventana (acceso, recuperación, reserva pública).
 * - `host`: anclada a su contenedor posicionado, que en el shell privado es
 *   el espacio entre la cabecera y la navegación; así nunca tapa ninguna de
 *   las dos ni depende de su altura.
 * La región es persistente para que los lectores de pantalla anuncien cada
 * aviso al insertarse. Un aviso nunca roba el foco de la tarea en curso; pero
 * si el foco ya está dentro de la región y se descarta un aviso (Descartar,
 * Escape, su acción o «Descartar todos»), no se pierde en el `body`
 * (WCAG 2.4.3): pasa al encabezado del aviso siguiente, o al anterior, y si
 * la región queda vacía vuelve a donde estaba antes de entrar en ella o, si
 * ese elemento ya no existe, al `main`.
 * Mientras el foco está en la región, toda la cola deja de caducar (2.2.1):
 * la pila no se encoge bajo el teclado y «Descartar todos» no desaparece con
 * el foco dentro. Si aun así el elemento enfocado sale del DOM (otro módulo
 * descarta su aviso), el foco va al primer aviso que quede o fuera.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  dismissAllToasts,
  dismissToast,
  setToastHeld,
  setToastQueueHeld,
  toastState,
  toggleToast,
} from '@/shared/model/toastStore'
import BaseToast from './BaseToast.vue'

withDefaults(defineProps<{ placement?: 'viewport' | 'host' }>(), { placement: 'viewport' })

const region = ref<HTMLElement | null>(null)
// Último elemento con foco fuera de la región antes de entrar en ella.
let returnTarget: HTMLElement | null = null
// El foco está (o estaba, si su elemento acaba de salir del DOM) en la región.
let focusInRegion = false
// Un descarte propio ya decide adónde va el foco; la red de seguridad espera.
let managingFocus = false

function onFocusIn(event: FocusEvent) {
  const from = event.relatedTarget
  // Ni el `body` (el foco venía de un control que salió del DOM) ni un control
  // ya desconectado son un origen al que volver.
  if (
    from instanceof HTMLElement &&
    from !== document.body &&
    from.isConnected &&
    !region.value?.contains(from)
  ) {
    returnTarget = from
  }
  focusInRegion = true
  setToastQueueHeld(true)
}

function leaveRegion() {
  if (focusIsInside()) return
  focusInRegion = false
  setToastQueueHeld(false)
}

function onFocusOut(event: FocusEvent) {
  const to = event.relatedTarget
  if (to instanceof Node && region.value?.contains(to)) return
  const from = event.target
  // Sin destino: el elemento salió del DOM (algunos navegadores avisan) o se
  // hizo clic en una zona sin foco. Se decide cuando el DOM ya se asentó.
  if (to === null && from instanceof HTMLElement) {
    setTimeout(() => (from.isConnected ? leaveRegion() : recoverLostFocus()), 0)
    return
  }
  leaveRegion()
}

// Red de seguridad: el elemento enfocado de la región desapareció sin que un
// descarte propio moviera el foco, que quedó en el `body`.
function recoverLostFocus() {
  if (!focusInRegion || managingFocus || focusIsInside()) return
  const active = document.activeElement
  if (active && active !== document.body) {
    leaveRegion()
    return
  }
  const first = toastState.items[0]
  if (first) focusToast(first.id)
  else focusOutside()
}

watch(
  () => toastState.items.length,
  () => recoverLostFocus(),
  { flush: 'post' },
)

onBeforeUnmount(() => setToastQueueHeld(false))

function focusIsInside(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && !!region.value?.contains(active)
}

// Tras descartar, el foco quedó en el `body` (el botón ya no existe) o sigue
// en la región. Si otra cosa lo tomó (la acción del aviso), se respeta.
function focusWasLost(): boolean {
  const active = document.activeElement
  return !active || active === document.body || focusIsInside()
}

function focusOutside() {
  if (returnTarget?.isConnected && !region.value?.contains(returnTarget)) {
    returnTarget.focus({ focusVisible: true })
    leaveRegion()
    return
  }
  const main = document.querySelector<HTMLElement>('main')
  if (main) {
    // `main` no es enfocable por sí mismo; -1 lo permite sin meterlo en el orden de Tab.
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
    main.focus()
  }
  // No todos los navegadores emiten `focusout` cuando el elemento enfocado sale
  // del DOM: la retención de la cola se libera aquí de forma explícita.
  leaveRegion()
}

function focusToast(id: number) {
  const head = region.value?.querySelector<HTMLElement>(
    `.toast-region__item[data-toast-id="${id}"] .base-toast__head`,
  )
  head?.focus({ focusVisible: true })
}

async function dismissKeepingFocus(id: number) {
  const hadFocus = focusIsInside()
  const items = toastState.items
  const index = items.findIndex((item) => item.id === id)
  const neighbour = items[index + 1] ?? items[index - 1] ?? null
  managingFocus = hadFocus
  dismissToast(id)
  if (!hadFocus) return
  await nextTick()
  managingFocus = false
  if (!focusWasLost()) {
    leaveRegion()
    return
  }
  if (neighbour && toastState.items.some((item) => item.id === neighbour.id)) {
    focusToast(neighbour.id)
  } else {
    focusOutside()
  }
}

async function dismissAllKeepingFocus() {
  const hadFocus = focusIsInside()
  managingFocus = hadFocus
  dismissAllToasts()
  if (!hadFocus) return
  await nextTick()
  managingFocus = false
  if (focusWasLost()) focusOutside()
  else leaveRegion()
}

function onAction(id: number, run: (() => void) | undefined) {
  // Se descarta primero para que un aviso emitido por la acción no compita
  // con el que la originó por el cupo máximo de la cola. Si la acción mueve
  // el foco a otro sitio, ese movimiento prevalece.
  void dismissKeepingFocus(id)
  run?.()
}
</script>

<template>
  <div
    ref="region"
    :class="['toast-region', `toast-region--${placement}`]"
    role="region"
    aria-label="Avisos"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <!-- Movimiento (#743): cada aviso cae con resorte, se va hacia el lado y
         los que quedan se reacomodan deslizando (FLIP con transform). -->
    <!-- Un aviso que sale sigue en el DOM durante su salida: si tenía el foco,
         se recupera al terminar (`after-leave`), no al cambiar la cola. -->
    <TransitionGroup name="toast-motion" @after-leave="recoverLostFocus">
      <div
        v-for="toast in toastState.items"
        :key="toast.id"
        class="toast-region__item"
        :data-toast-id="toast.id"
        @keydown.esc="dismissKeepingFocus(toast.id)"
      >
        <BaseToast
          :variant="toast.variant"
          :title="toast.title"
          :detail="toast.detail"
          :reference="toast.reference"
          :action-label="toast.action?.label"
          :action-icon="toast.action?.icon"
          :expanded="toast.expanded"
          :held="toast.expanded || toast.hovered || toast.focused"
          :duration-ms="toast.durationMs"
          @toggle="toggleToast(toast.id)"
          @dismiss="dismissKeepingFocus(toast.id)"
          @action="onAction(toast.id, toast.action?.run)"
          @hover="setToastHeld(toast.id, 'hovered', $event)"
          @focus="setToastHeld(toast.id, 'focused', $event)"
        />
      </div>
    </TransitionGroup>

    <button
      v-if="toastState.items.length > 1"
      type="button"
      class="toast-region__clear"
      @click="dismissAllKeepingFocus()"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      <span>Descartar todos</span>
      <span class="toast-region__count">{{ toastState.items.length }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Móvil: ancho completo con margen de 12px, bajo la cabecera. Escritorio:
   columna de 380px a la derecha. La región no captura el puntero: solo los
   avisos y el botón de descarte lo hacen, para no bloquear la pantalla. */
.toast-region {
  position: fixed;
  top: var(--space-4);
  right: 12px;
  left: 12px;
  z-index: var(--layer-toast);
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

/* En el panel los avisos van abajo, sobre la barra, en todos los anchos
   (#743). Arriba tapaban la acción de la cabecera de cada pantalla
   («Agregar servicio», «Nuevo turno»), justo la que se quiere repetir tras
   guardar. El visor del cascarón ya excluye la barra, así que nunca la
   tapan. El más nuevo queda junto al borde y entra subiendo. */
.toast-region--host {
  position: absolute;
  top: auto;
  bottom: var(--space-3);
  flex-direction: column-reverse;
}

.toast-region--host .toast-motion-enter-active {
  animation-name: toast-motion-in-up;
}

@keyframes toast-motion-in-up {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.96);
  }
}

.toast-region__item {
  pointer-events: auto;
}

.toast-motion-enter-active {
  animation: toast-motion-in 420ms var(--motion-ease-spring, ease-out) both;
}

/* Sale del flujo para que los demás suban mientras se va. */
.toast-motion-leave-active {
  position: absolute;
  right: 0;
  left: 0;
  animation: toast-motion-out 200ms ease-in both;
}

.toast-motion-move {
  transition: transform 260ms var(--motion-ease-out, ease-out);
}

@keyframes toast-motion-in {
  from {
    opacity: 0;
    transform: translateY(-18px) scale(0.96);
  }
}

@keyframes toast-motion-out {
  to {
    opacity: 0;
    transform: translateX(28px) scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-motion-enter-active,
  .toast-motion-leave-active {
    animation: none;
  }

  .toast-motion-move {
    transition: none;
  }
}

:root[data-motion='reduced'] .toast-motion-enter-active,
:root[data-motion='reduced'] .toast-motion-leave-active {
  animation: none;
}

:root[data-motion='reduced'] .toast-motion-move {
  transition: none;
}

@media (min-width: 1024px) {
  .toast-region {
    right: var(--space-10);
    left: auto;
    width: 380px;
  }

  .toast-region--host {
    bottom: var(--space-4);
  }
}

.toast-region__clear {
  position: relative;
  display: inline-flex;
  align-items: center;
  align-self: flex-end;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-3);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 20px -8px rgb(16 27 43 / 50%);
  color: var(--color-on-strong);
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

/* Botón de 36px con zona activa de 44px (estandar-diseno-visual.md §8). */
.toast-region__clear::after {
  position: absolute;
  top: -4px;
  right: 0;
  bottom: -4px;
  left: 0;
  content: '';
}

.toast-region__clear:hover {
  background-color: var(--color-action-primary-hover);
  border-color: color-mix(in srgb, var(--color-on-strong) 32%, transparent);
}

.toast-region__clear svg {
  flex: none;
  color: var(--color-text-secondary);
}

.toast-region__clear:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.toast-region__count {
  padding-left: var(--space-2);
  border-left: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 20%, transparent);
  color: var(--color-text-secondary);
}

/* En angosto o táctil el botón mide 44 px de alto, no solo su zona activa (#794). */
@media (max-width: 767px), (pointer: coarse) {
  .toast-region__clear {
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-region__clear {
    transition: none;
  }
}
</style>
