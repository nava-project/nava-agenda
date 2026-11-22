<script lang="ts">
// Pila de diálogos abiertos, en un <script> de módulo (no de setup): se
// evalúa una sola vez y por eso el array se comparte entre TODAS las
// instancias de BaseDialog montadas. Escape y el atrapado de foco de un
// diálogo particular solo actúan cuando su id es el último de la pila —el
// visualmente más alto—, así dos diálogos abiertos a la vez (uno anidado
// desde el otro) no compiten por la misma tecla (auditoría HU-009:
// "evita colisiones con diálogos anidados o múltiples instancias").
export const openDialogStack: string[] = []
</script>

<script setup lang="ts">
/**
 * BaseDialog - Diálogo modal del sistema visual.
 * Con backdrop, focus trap, ESC para cerrar, click fuera para cerrar (opcional)
 * Tamaños: sm | md | lg | full (mobile)
 * Accesibilidad: role="dialog", aria-modal="true", aria-labelledby,
 * focus trap, focus restoration, focus-visible en elementos interactivos
 */
import { computed, ref, useId, onMounted, onUnmounted, watch, nextTick } from 'vue'

interface Props {
  /** Si el diálogo está abierto (v-model) */
  modelValue?: boolean
  /** Título del diálogo (para aria-labelledby) */
  title?: string
  /** Descripción adicional (para aria-describedby) */
  description?: string
  /** Tamaño del diálogo */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /**
   * Ubicación visual dentro del viewport. El foco y el backdrop no cambian.
   * `bottom` es siempre un sheet desde el borde de abajo; `sheet-mobile` es
   * sheet por debajo de 640 px y diálogo centrado desde ahí (#741).
   */
  placement?: 'center' | 'bottom' | 'sheet-mobile'
  /** Clase opcional para una superficie de diálogo con contrato visual propio. */
  contentClass?: string
  /** Si se cierra al hacer click en el backdrop */
  closeOnBackdrop?: boolean
  /** Si se cierra con ESC */
  closeOnEscape?: boolean
  /** Si mostrar botón de cerrar en header */
  showClose?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  size: 'md',
  placement: 'center',
  contentClass: undefined,
  closeOnBackdrop: true,
  closeOnEscape: true,
  showClose: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  open: []
}>()

const dialogRef = ref<HTMLDivElement | null>(null)
const overlayRef = ref<HTMLDivElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const previouslyFocusedElement = ref<HTMLElement | null>(null)
const focusableElementsRef = ref<HTMLElement[]>([])
const contentRef = ref<HTMLDivElement | null>(null)

const isOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const classes = computed(() => {
  const base = 'base-dialog'
  return [base, `${base}--${props.size}`, props.contentClass, isOpen.value ? `${base}--open` : '']
    .filter(Boolean)
    .join(' ')
})

/*
 * Duración del resorte (#741). Se pasa explícita a <Transition> porque la
 * animación larga es la de la ventana, no la del velo (el elemento raíz), y
 * Vue mediría solo esta. Con movimiento reducido es 0: abre y cierra en seco.
 */
const DIALOG_MOTION = { enter: 460, leave: 200 } as const
const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches)
// Se lee en cada render (cada apertura o cierre re-renderiza por el v-show),
// así respeta un cambio de Configuración sin recargar.
const dialogMotion = () => (prefersReducedMotion() ? 0 : DIALOG_MOTION)

const overlayClasses = computed(() => {
  const base = 'base-dialog__overlay'
  return [base, `${base}--${props.placement}`, isOpen.value ? `${base}--open` : '']
    .filter(Boolean)
    .join(' ')
})

// useId() (Vue 3.5+) genera un identificador estable y único por instancia,
// a diferencia de Math.random(): sin riesgo de colisión entre dos diálogos
// montados a la vez (auditoría HU-009).
const dialogId = `base-dialog-${useId()}`
const titleId = `${dialogId}-title`
const descriptionId = `${dialogId}-description`

// Solo el diálogo visualmente más alto (el último de openDialogStack)
// reacciona a Escape y atrapa Tab. Ningún componente inventa un z-index
// propio: todos comparten --layer-dialog y el orden lo da la pila.
const isTopmost = () => openDialogStack[openDialogStack.length - 1] === dialogId

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

const updateFocusableElements = () => {
  if (!dialogRef.value) return
  const elements = dialogRef.value.querySelectorAll<HTMLElement>(FOCUSABLE)
  focusableElementsRef.value = Array.from(elements).filter(
    (el) => !el.hasAttribute('disabled') && !el.hidden && el.offsetParent !== null,
  )
  // Firefox da parada de Tab a todo contenedor desplazable; Chromium, solo si no
  // tiene nada enfocable dentro (#776). Con controles, el cuerpo no es una parada
  // propia: se desplaza al enfocarlos. Sin ellos, sigue siendo enfocable para
  // leerlo con las flechas.
  const content = contentRef.value
  if (content) {
    if (content.querySelector(FOCUSABLE)) content.setAttribute('tabindex', '-1')
    else content.removeAttribute('tabindex')
  }
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.defaultPrevented || !isOpen.value || !isTopmost()) return

  if (event.key === 'Escape' && props.closeOnEscape) {
    // Un mismo Escape no debe alcanzar al diálogo inferior cuando Vue
    // actualiza la pila entre listeners nativos (bloqueos, issue #286).
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }

  if (event.key === 'Tab') {
    // Recalculado en cada Tab (no solo al abrir, HU-068): un campo
    // deshabilitado al momento de abrir (p. ej. un botón "Confirmar"
    // condicionado a que el formulario esté completo) puede habilitarse
    // mientras el diálogo sigue abierto; una lista cacheada del primer
    // cálculo seguiría excluyéndolo y el atrapamiento de foco envolvería
    // antes de llegar a él.
    updateFocusableElements()
    if (focusableElementsRef.value.length === 0) return
    const first = focusableElementsRef.value[0]
    const last = focusableElementsRef.value[focusableElementsRef.value.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

const handleBackdropClick = (event: MouseEvent) => {
  if (props.closeOnBackdrop && event.target === overlayRef.value) {
    close()
  }
}

const handleCloseClick = () => {
  close()
}

const close = () => {
  isOpen.value = false
  emit('close')
}

/** Abre el diálogo (exponido para uso imperativo) */
const open = () => {
  isOpen.value = true
  emit('open')
}

// Exponer métodos para uso imperativo y tests
defineExpose({
  close,
  open,
})

const trapFocus = () => {
  // Todo el cuerpo, incluida updateFocusableElements(), debe esperar a
  // nextTick: watch(isOpen, ...) corre en flush "pre" (ANTES de que Vue
  // aplique el v-show que quita display:none del diálogo), así que una
  // consulta síncrona aquí encuentra 0 elementos con offsetParent !== null
  // (todos siguen ocultos) y el bloque completo -incluido el enfoque
  // inicial- nunca se ejecuta. Reproducido contra Chromium real (Playwright,
  // HU-021: el foco nunca entraba al diálogo pese a que las pruebas con
  // jsdom, menos estrictas con offsetParent/reflow, no lo detectaban).
  nextTick(() => {
    updateFocusableElements()
    if (focusableElementsRef.value.length > 0) {
      // Focus en el primer elemento enfocable, o en el botón de cerrar si existe
      const firstFocusable = closeButtonRef.value || focusableElementsRef.value[0]
      firstFocusable?.focus()
    }
  })
}

const restoreFocus = () => {
  if (previouslyFocusedElement.value) {
    ;(previouslyFocusedElement.value as HTMLElement).focus()
    previouslyFocusedElement.value = null
  }
}

// El bloqueo de scroll del body se cuenta por diálogos abiertos (largo de
// la pila), no por este único diálogo: si un segundo diálogo se cierra
// mientras el primero sigue abierto, el body debe seguir bloqueado.
const lockBodyScroll = () => {
  document.body.style.overflow = 'hidden'
}
const unlockBodyScrollIfNoneOpen = () => {
  if (openDialogStack.length === 0) {
    document.body.style.overflow = ''
  }
}

const pushToDialogStack = () => {
  if (!openDialogStack.includes(dialogId)) {
    openDialogStack.push(dialogId)
  }
}
const removeFromDialogStack = () => {
  const index = openDialogStack.indexOf(dialogId)
  if (index !== -1) {
    openDialogStack.splice(index, 1)
  }
}

watch(isOpen, (newValue) => {
  if (newValue) {
    // Guardar elemento enfocado anteriormente
    previouslyFocusedElement.value = document.activeElement as HTMLElement
    pushToDialogStack()
    lockBodyScroll()
    // Focus trap
    trapFocus()
  } else {
    removeFromDialogStack()
    unlockBodyScrollIfNoneOpen()
    // Restaurar focus
    restoreFocus()
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
  if (isOpen.value) {
    pushToDialogStack()
    trapFocus()
    lockBodyScroll()
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  if (isOpen.value) {
    removeFromDialogStack()
    unlockBodyScrollIfNoneOpen()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="base-dialog-motion" :duration="dialogMotion()">
      <div
        v-show="isOpen"
        ref="overlayRef"
        :class="overlayClasses"
        @click="handleBackdropClick"
        @keydown="handleKeyDown"
      >
        <div
          ref="dialogRef"
          :class="classes"
          :id="dialogId"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? titleId : undefined"
          :aria-describedby="description ? descriptionId : undefined"
        >
          <div class="base-dialog__container">
            <!-- div, no <header>: dentro de [role="dialog"] un <header> sigue
               resolviendo como landmark "banner" (el hueco de la lista de
               excepciones de la spec HTML no incluye role="dialog"), y con
               AppHeader ya presente en la página produce dos landmarks
               "banner" sin nombre único (axe-core landmark-unique). El
               diálogo ya se identifica por su propio role="dialog" +
               aria-labelledby; este contenedor no necesita ser landmark. -->
            <div v-if="title || showClose || $slots.header" class="base-dialog__header">
              <slot name="header">
                <!-- #icon es opcional y vacío por defecto (ningún consumidor
                   actual lo usa): un diálogo que quiera una ficha/monograma
                   junto al título -por ejemplo el alta de un registro- la
                   pasa aquí sin tocar este componente compartido. El título
                   conserva su :id de siempre, así aria-labelledby nunca
                   apunta a un elemento que el slot personalizado no
                   renderizó. -->
                <div class="base-dialog__heading">
                  <slot name="icon" />
                  <h2 v-if="title" :id="titleId" class="base-dialog__title">{{ title }}</h2>
                </div>
                <button
                  v-if="showClose"
                  ref="closeButtonRef"
                  type="button"
                  class="base-dialog__close"
                  @click="handleCloseClick"
                  aria-label="Cerrar diálogo"
                >
                  <svg
                    class="base-dialog__close-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </slot>
            </div>

            <div v-if="description" :id="descriptionId" class="base-dialog__description">
              {{ description }}
            </div>

            <div ref="contentRef" class="base-dialog__content">
              <slot />
            </div>

            <footer v-if="$slots.footer" class="base-dialog__footer">
              <slot name="footer" />
            </footer>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.base-dialog__overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background-color: var(--color-overlay-scrim);
  /* Velo desenfocado (pulido, punto 3; el orquestador lo confirmó en #742).
     Es leve, para que el contexto siga reconocible (estandar-diseno-visual.md
     §6.4: el overlay no lo vuelve incomprensible).
     Sin `-webkit-backdrop-filter` escrito a mano: el minificador (Lightning CSS)
     ya pone el prefijo para Safari, y con los dos declarados se quedaba solo con
     el prefijado, que Firefox no entiende: el velo salía plano (#791).
     scripts/check-built-css.mjs lo vigila sobre el CSS construido. */
  backdrop-filter: blur(6px);
  z-index: var(--layer-dialog);
}

.base-dialog__overlay--bottom {
  align-items: flex-end;
}

/*
 * Sheet (#741): pegado al borde de abajo, a todo el ancho, con las esquinas
 * de arriba redondeadas, un asa y el inset del área segura. `sheet-mobile`
 * repite estas reglas solo por debajo de 640 px.
 */
.base-dialog__overlay--bottom {
  padding: 0;
}

.base-dialog__overlay--bottom .base-dialog {
  width: 100%;
  max-height: calc(100vh / var(--ui-zoom, 1) - var(--space-8));
  padding-bottom: env(safe-area-inset-bottom, 0);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.base-dialog__overlay--bottom .base-dialog .base-dialog__container {
  max-width: none;
}

/* Tela bajo el borde: el resorte de --motion-ease-spring sube el sheet por
   encima del borde de abajo, en torno al 10 % de su alto (47 px medidos en
   «Más»). Esta extensión del mismo fondo, del 24 % y nunca menos de 96 px,
   hace que asome tela y no un hueco por el que se vea la barra (#741,
   revisión de nava). El velo la recorta en el borde del viewport. */
.base-dialog__overlay--bottom {
  /* clip y no hidden: hidden lo vuelve contenedor de scroll y, al enfocar
     dentro del sheet, el navegador lo desplazaba hacia la tela y dejaba un
     hueco abajo en reposo. */
  overflow: clip;
}

.base-dialog__overlay--bottom .base-dialog {
  position: relative;
}

.base-dialog__overlay--bottom .base-dialog::after {
  position: absolute;
  top: calc(100% - 1px);
  right: 0;
  left: 0;
  height: max(96px, 24%);
  content: '';
  /* Hereda el fondo de la ventana, también si una contentClass lo cambia. */
  background-color: inherit;
}

.base-dialog__overlay--bottom .base-dialog::before {
  flex: none;
  width: 36px;
  height: 4px;
  margin: var(--space-2) auto 0;
  content: '';
  background-color: color-mix(in srgb, var(--color-text-primary) 28%, transparent);
  border-radius: 2px;
}

@media (max-width: 639.98px) {
  .base-dialog__overlay--sheet-mobile {
    align-items: flex-end;
    padding: 0;
  }

  .base-dialog__overlay--sheet-mobile .base-dialog {
    width: 100%;
    max-height: calc(100vh / var(--ui-zoom, 1) - var(--space-8));
    padding-bottom: env(safe-area-inset-bottom, 0);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .base-dialog__overlay--sheet-mobile .base-dialog .base-dialog__container {
    max-width: none;
  }

  .base-dialog__overlay--sheet-mobile {
    overflow: clip;
  }

  .base-dialog__overlay--sheet-mobile .base-dialog {
    position: relative;
  }

  .base-dialog__overlay--sheet-mobile .base-dialog::after {
    position: absolute;
    top: calc(100% - 1px);
    right: 0;
    left: 0;
    height: max(96px, 24%);
    content: '';
    background-color: inherit;
  }

  .base-dialog__overlay--sheet-mobile .base-dialog::before {
    flex: none;
    width: 36px;
    height: 4px;
    margin: var(--space-2) auto 0;
    content: '';
    background-color: color-mix(in srgb, var(--color-text-primary) 28%, transparent);
    border-radius: 2px;
  }

  .base-dialog-motion-enter-active.base-dialog__overlay--sheet-mobile .base-dialog {
    animation-name: base-dialog-sheet-in;
  }

  .base-dialog-motion-leave-active.base-dialog__overlay--sheet-mobile .base-dialog {
    animation-name: base-dialog-sheet-out;
  }
}

.base-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh / var(--ui-zoom, 1) - var(--space-4) * 2);
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-dialog);
  z-index: var(--layer-dialog);
}

/*
 * Movimiento (#741): el velo entra en fundido y la ventana con resorte — la
 * centrada crece desde 0,92 y sube; la de abajo (sheet) sube desde el borde.
 * Al cerrar se van rápido y sin rebote. Solo transform y opacity, finito.
 */
.base-dialog-motion-enter-active {
  animation: base-dialog-veil-in 240ms var(--motion-ease-out, ease-out) both;
}

.base-dialog-motion-leave-active {
  animation: base-dialog-veil-out 200ms ease-in both;
}

.base-dialog-motion-enter-active .base-dialog {
  animation: base-dialog-pop-in 460ms var(--motion-ease-spring, ease-out) both;
}

.base-dialog-motion-leave-active .base-dialog {
  animation: base-dialog-pop-out 200ms ease-in both;
}

.base-dialog-motion-enter-active.base-dialog__overlay--bottom .base-dialog {
  animation-name: base-dialog-sheet-in;
}

.base-dialog-motion-leave-active.base-dialog__overlay--bottom .base-dialog {
  animation-name: base-dialog-sheet-out;
}

@keyframes base-dialog-veil-in {
  from {
    opacity: 0;
  }
}

@keyframes base-dialog-veil-out {
  to {
    opacity: 0;
  }
}

@keyframes base-dialog-pop-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.92);
  }
}

@keyframes base-dialog-pop-out {
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
}

@keyframes base-dialog-sheet-in {
  from {
    opacity: 0.4;
    transform: translateY(100%);
  }
}

@keyframes base-dialog-sheet-out {
  to {
    opacity: 0.4;
    transform: translateY(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .base-dialog-motion-enter-active,
  .base-dialog-motion-leave-active,
  .base-dialog-motion-enter-active .base-dialog,
  .base-dialog-motion-leave-active .base-dialog {
    animation: none;
  }
}

:root[data-motion='reduced'] .base-dialog-motion-enter-active,
:root[data-motion='reduced'] .base-dialog-motion-leave-active,
:root[data-motion='reduced'] .base-dialog-motion-enter-active .base-dialog,
:root[data-motion='reduced'] .base-dialog-motion-leave-active .base-dialog {
  animation: none;
}

/* Tamaños */
.base-dialog--sm .base-dialog__container {
  width: 100%;
  max-width: 360px;
}

.base-dialog--md .base-dialog__container {
  width: 100%;
  max-width: 520px;
}

.base-dialog--lg .base-dialog__container {
  width: 100%;
  max-width: 720px;
}

.base-dialog--xl .base-dialog__container {
  width: min(100%, 1092px);
}

.base-dialog--xl {
  width: min(100%, 1092px);
}

.base-dialog--full .base-dialog__container {
  width: 100%;
  max-width: 100%;
  max-height: calc(100vh / var(--ui-zoom, 1));
  border-radius: 0;
  height: calc(100vh / var(--ui-zoom, 1));
}

@media (min-width: 768px) {
  .base-dialog--full .base-dialog__container {
    max-width: 720px;
    max-height: calc(100vh / var(--ui-zoom, 1) - var(--space-4) * 2);
    border-radius: var(--radius-lg);
    height: auto;
  }
}

.base-dialog__container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: inherit;
  overflow: hidden;
}

.base-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
  flex-shrink: 0;
}

/* Envuelve #icon (opcional) + título para que ambos se alineen en fila
   sin afectar el layout cuando ningún consumidor pasa #icon (el div queda
   con un único hijo, igual que antes de este slot). */
.base-dialog__heading {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-3);
}

/* El título va en la serif de la familia (#791), como las fichas y el sheet
   «Más»: 26 px, el tamaño en que la serif no se ensucia (#726). Un título
   largo parte la palabra antes que desbordar a 320 px. */
.base-dialog__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
  line-height: 30px;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.base-dialog__close {
  /* Botón de icono independiente (estandar-diseno-visual.md §6.2): 44×44,
   * no los 36×36 anteriores. CA-009-03. */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-icon);
  height: var(--control-height-icon);
  padding: 0;
  margin: calc(-1 * var(--space-2));
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (prefers-reduced-motion: reduce) {
  .base-dialog__close {
    transition: none;
  }
}

/* Tinte translúcido del propio color del icono, no un relleno de superficie:
   sobre tinta, el relleno claro dejaba un cuadro blanco ajeno a la paleta
   (issue #575). Así la X se ve igual en papel, tinta y marfil. */
.base-dialog__close:hover {
  background-color: color-mix(in srgb, currentColor 12%, transparent);
}

.base-dialog__close:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.base-dialog__close-icon {
  width: 20px;
  height: 20px;
}

.base-dialog__description {
  padding: var(--space-2) var(--space-5) 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.base-dialog__content {
  flex: 1;
  overflow: auto;
  padding: var(--space-5);
  min-height: 0;
}

/* Fuera del orden de Tab (con controles dentro): un clic en su fondo no pinta
   anillo, porque el teclado nunca llega a él. */
.base-dialog__content[tabindex='-1']:focus {
  outline: none;
}

.base-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* Scrollbar styling */
.base-dialog__content::-webkit-scrollbar {
  width: 8px;
}

.base-dialog__content::-webkit-scrollbar-track {
  background: transparent;
}

.base-dialog__content::-webkit-scrollbar-thumb {
  background-color: var(--color-border-subtle);
  border-radius: 4px;
}

.base-dialog__content::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-border-control);
}
</style>
