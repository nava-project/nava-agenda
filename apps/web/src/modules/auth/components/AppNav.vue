<script setup lang="ts">
// Dock de navegación primaria del cascarón (HU-012; recompuesto a la
// identidad NAVA en la Fase 2, especificacion-frontend-nava.md §5.2-§5.3,
// §6 `DesktopDock`/`MobileDock`). Al pie en todos los anchos (issue #724:
// el propietario prefiere la barra abajo también en escritorio, en vez del
// riel lateral de la entrega 5a): icono sobre texto, 64px, con
// `env(safe-area-inset-bottom)`. "Agenda" es la única entrada propia de
// `auth`; cualquier módulo hermano con pantalla privada aporta la suya
// mediante `extraItems` (mismo mecanismo de composición app → modules →
// shared que ya usaba la navegación anterior). `RouterLink` ya marca
// `aria-current="page"` en la entrada activa sin código adicional.
//
// Fase 2 del rediseño Tailored Grid (issue #187, estandar-diseno-
// visual.md §6.5): el dock ya no listaba los seis destinos en línea plana
// (Agenda/Servicios/Profesionales/Horarios/Configuración/Servicios por
// profesional), lo que trunca las etiquetas en anchos angostos y nunca incluyó
// "Bloqueos" (ruta real sin entrada de navegación). Ahora solo los
// destinos marcados `primary` viven en el dock; el resto se expone dentro
// de "Más" (BaseDialog, reutiliza su foco atrapado/Escape/restauración),
// junto con "Cerrar sesión" para que ese cierre también sea alcanzable sin
// depender del ancho de AppHeader. Desde 1024 px caben todos: la lista de
// escritorio los muestra en línea, sin "Más".
import { computed, ref } from 'vue'
import type { NavItem } from '@/shared/navigation/navItem'
import { useVocabulary } from '@/shared/composables'
import { panelProfile } from '@/shared/model'
import { BaseDialog } from '@/shared/ui'
import { useLogout } from '../model/logout'

const props = defineProps<{ extraItems?: NavItem[] }>()
const vocabulary = useVocabulary()

/** Rótulo visible de una entrada: el de su perfil, o el del vocabulario del negocio (DEC-110). */
function labelOf(item: NavItem): string {
  const own = item.profiles?.[panelProfile.value]?.label
  if (own) return own
  return item.labelFor ? item.labelFor(vocabulary.value) : item.label
}

const baseItems: NavItem[] = [{ to: { name: 'panel' }, label: 'Agenda', primary: true }]

// Perfil del panel (DEC-115): el profesional individual no ve la gestión de equipo. Se
// resuelve aquí, una sola vez, para que dock, "Más" y escritorio coincidan siempre.
const items = computed<NavItem[]>(() =>
  [...baseItems, ...(props.extraItems ?? [])]
    .filter((item) => !item.profiles?.[panelProfile.value]?.hidden)
    .map((item) => {
      const primary = item.profiles?.[panelProfile.value]?.primary
      return primary === undefined ? item : { ...item, primary }
    }),
)
const primaryItems = computed(() => items.value.filter((item) => item.primary))
const secondaryItems = computed(() => items.value.filter((item) => !item.primary))

// Un icono por destino P0 conocido; un destino futuro sin entrada aquí cae
// al icono de Agenda en vez de romper (mismo criterio defensivo que
// `getWeekdayLabel`/`getBlockTypeLabel` de `schedules`). Decorativo:
// aria-hidden porque el nombre accesible del enlace ya lo da el texto.
//
// Rombos de la familia (#789, DEC-189): el reloj de Horarios es el rombo con
// manecillas de la nota de zona (#767), las perillas de Configuración y los
// puntos de «Más» son rombos. Las cabezas de las personas siguen redondas: en
// rombo, la persona de atrás de «Servicios por profesional» se leía como «›» a
// 24 px (comparación en el PR de #789).
const ICONS: Record<string, string> = {
  panel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="16" y1="2" x2="16" y2="6"></line></svg>`,
  'catalog-servicios': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h10l6 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"></path><path d="M14 4v6h6"></path><line x1="8" y1="13" x2="15" y2="13"></line><line x1="8" y1="17" x2="12" y2="17"></line></svg>`,
  'staff-profesionales': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"></path></svg>`,
  'schedules-horarios': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"></path><path d="M12 7.5v4.5l3 2"></path></svg>`,
  'schedules-bloqueos': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="1.5"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>`,
  'configuracion-negocio': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M19 6h1M4 12h1M9 12h11M4 18h6M14 18h6"></path><path d="M17 3.8 19.2 6 17 8.2 14.8 6Z"></path><path d="M7 9.8 9.2 12 7 14.2 4.8 12Z"></path><path d="M12 15.8 14.2 18 12 20.2 9.8 18Z"></path></svg>`,
  'configuracion-reserva-publica': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line><path d="M12 13v3l2 1.5"></path></svg>`,
  'professional-services': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3"></circle><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6"></path><path d="M16 4a3 3 0 0 1 0 6"></path><path d="M22 21c0-2.7-1.7-4.8-4-5.6"></path></svg>`,
}
const MORE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.6 6.4 12 4 14.4 1.6 12Z" fill="currentColor"></path><path d="M12 9.6 14.4 12 12 14.4 9.6 12Z" fill="currentColor"></path><path d="M20 9.6 22.4 12 20 14.4 17.6 12Z" fill="currentColor"></path></svg>`

function iconFor(routeName: string): string {
  return ICONS[routeName] ?? ICONS.panel
}

const moreOpen = ref(false)
const { loggingOut, logout } = useLogout()

function closeMore() {
  moreOpen.value = false
}

async function onLogoutFromMore() {
  await logout()
  closeMore()
}
</script>

<template>
  <nav class="app-nav" aria-label="Navegación principal">
    <!-- `exact-active-class` (no `active-class`): "Agenda" es la hija de
         `/panel` con `path: ''` (agenda/routes.ts, HU-062), así que su ruta
         resuelve al MISMO path que el cascarón padre. El matching NO exacto
         de vue-router (`useLink`, activeRecordIndex) trata eso como "sigo
         dentro de /panel" y marca "Agenda" activa en cualquier hija
         (Servicios, Profesionales...), dejando la marca de activo pegada
         ahí sin importar el destino elegido (hoy la píldora y el rombo de lo
         elegido). Exacto evita ese falso
         positivo; ningún destino del dock necesita quedar "activo" mientras
         se navega a un descendiente propio (todos son hijas planas de
         `/panel`, no anidan más pantallas del dock debajo). -->
    <!-- Configuración es de otra naturaleza (el negocio, no el día a día):
         en escritorio la separa un filete fino. -->
    <ul class="app-nav__list app-nav__list--desktop">
      <li
        v-for="item in items"
        :key="item.label"
        :class="[
          'app-nav__item',
          { 'app-nav__item--apart': item.to.name === 'configuracion-negocio' },
        ]"
      >
        <RouterLink :to="item.to" class="app-nav__link" exact-active-class="app-nav__link--active">
          <span class="app-nav__icon" aria-hidden="true" v-html="iconFor(item.to.name)" />
          <span class="app-nav__label">{{ labelOf(item) }}</span>
        </RouterLink>
      </li>
    </ul>
    <ul class="app-nav__list app-nav__list--mobile">
      <li v-for="item in primaryItems" :key="item.label" class="app-nav__item">
        <RouterLink :to="item.to" class="app-nav__link" exact-active-class="app-nav__link--active">
          <span class="app-nav__icon" aria-hidden="true" v-html="iconFor(item.to.name)" />
          <span class="app-nav__label">{{ labelOf(item) }}</span>
        </RouterLink>
      </li>
      <li v-if="secondaryItems.length" class="app-nav__item">
        <button
          type="button"
          class="app-nav__link app-nav__link--button"
          aria-haspopup="dialog"
          :aria-expanded="moreOpen"
          @click="moreOpen = true"
        >
          <span class="app-nav__icon" aria-hidden="true" v-html="MORE_ICON" />
          <span class="app-nav__label">Más</span>
        </button>
      </li>
    </ul>

    <!-- «Más» con la esencia de Agenda (#743): filas tipo carta con su rombo
         de latón (lleno en el destino actual), filetes de latón y «Cerrar
         sesión» aparte con su rombo de peligro. Las filas entran escalonadas
         cada vez que se abre: el sheet usa v-show y la animación CSS se
         reinicia al volver a mostrarse. -->
    <BaseDialog
      v-model="moreOpen"
      title="Más"
      size="sm"
      placement="sheet-mobile"
      content-class="app-nav__more-sheet"
    >
      <ul class="app-nav__more-list" aria-label="Más destinos y cierre de sesión">
        <li
          v-for="(item, index) in secondaryItems"
          :key="item.label"
          class="app-nav__more-item"
          :style="{ '--i': index }"
        >
          <RouterLink
            :to="item.to"
            class="app-nav__more-link"
            active-class="app-nav__more-link--active"
            @click="closeMore"
          >
            <span class="app-nav__more-mark" aria-hidden="true" />
            <span class="app-nav__icon" aria-hidden="true" v-html="iconFor(item.to.name)" />
            <span class="app-nav__more-label">{{ labelOf(item) }}</span>
            <span class="app-nav__more-go" aria-hidden="true">→</span>
          </RouterLink>
        </li>
        <li
          class="app-nav__more-item app-nav__more-item--logout"
          :style="{ '--i': secondaryItems.length }"
        >
          <button
            type="button"
            class="app-nav__more-link app-nav__more-logout"
            :disabled="loggingOut"
            :aria-busy="loggingOut"
            @click="onLogoutFromMore"
          >
            <span class="app-nav__more-mark" aria-hidden="true" />
            Cerrar sesión
          </button>
        </li>
      </ul>
    </BaseDialog>
  </nav>
</template>

<style scoped>
/* Barra inferior en todos los anchos (issue #724, pedido del propietario):
   sustituye al riel lateral de escritorio de la entrega 5a. En el teléfono va
   pegada al pie, a todo el ancho; desde la tableta es una isla centrada que
   mide lo que sus destinos (nunca una barra de móvil estirada). Ocupa su propia
   fila bajo el contenido, no flota encima: nada queda tapado y el scroll del
   contenido termina justo sobre ella. */
.app-nav {
  position: relative;
  z-index: 2;
  flex: none;
  background-color: var(--color-chrome-surface);
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.app-nav__list {
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  height: 64px;
  margin: 0;
  padding: 0 var(--space-1);
  list-style: none;
}

.app-nav__list--desktop {
  display: none;
}

.app-nav__item {
  flex: 1;
  min-width: 0;
}

.app-nav__link {
  display: flex;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 44px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 4px;
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

.app-nav__link--button {
  font-family: inherit;
}

/* El icono vive en una píldora: el destino activo la rellena de tinta suave.
   v2 (DEC-188): lo elegido va en tinta y a 600, nunca en el acento, que es solo
   de la acción principal («Nuevo turno»). */
.app-nav__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 28px;
  border-radius: var(--radius-pill);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.app-nav__icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.app-nav__label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* El rombo NAVA marca lo elegido: se posa sobre el filete superior de la barra,
   como el rombo del logo sobre su horizonte. Decorativo (el destino activo ya
   lo dicen `aria-current`, el peso y la píldora). */
.app-nav__link::before {
  content: '';
  position: absolute;
  top: -4px;
  left: 50%;
  width: 7px;
  height: 7px;
  background-color: var(--color-text-primary);
  transform: translateX(-50%) rotate(45deg) scale(0);
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

.app-nav__link:hover {
  color: var(--color-text-primary);
}

.app-nav__link:hover .app-nav__icon {
  background-color: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
}

.app-nav__link:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
  color: var(--color-text-primary);
}

.app-nav__link--active,
.app-nav__link[aria-expanded='true'] {
  color: var(--color-text-primary);
  font-weight: 600;
}

.app-nav__link--active .app-nav__icon,
.app-nav__link[aria-expanded='true'] .app-nav__icon {
  background-color: color-mix(in srgb, var(--color-text-primary) 11%, transparent);
}

.app-nav__link--active::before {
  transform: translateX(-50%) rotate(45deg) scale(1);
}

/* Con el cursor encima, lo elegido se afirma; antes la regla de hover (6 %)
   pisaba la del activo (11 %) y lo apagaba (#739). */
.app-nav__link--active:hover .app-nav__icon,
.app-nav__link[aria-expanded='true']:hover .app-nav__icon {
  background-color: color-mix(in srgb, var(--color-text-primary) 15%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .app-nav__link,
  .app-nav__link::before,
  .app-nav__icon {
    transition: none;
  }
}

:root[data-motion='reduced'] .app-nav__link,
:root[data-motion='reduced'] .app-nav__link::before,
:root[data-motion='reduced'] .app-nav__icon {
  transition: none;
}

/* Tableta y escritorio: una isla centrada que mide lo que sus destinos. Deja
   ver el escenario a los lados, así que la fila de la barra es transparente. */
@media (min-width: 768px) {
  .app-nav {
    display: flex;
    justify-content: center;
    padding: var(--space-2) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
    background-color: transparent;
    border-top: 0;
  }

  .app-nav__list {
    gap: 2px;
    max-width: 100%;
    padding: 0 6px;
    background-color: var(--color-chrome-surface);
    border: var(--border-width-normal) solid var(--color-border-subtle);
    border-radius: 20px;
    box-shadow: var(--shadow-raised);
  }

  .app-nav__item {
    flex: none;
  }

  .app-nav__link {
    min-width: 84px;
    padding: 6px 12px;
    font-size: 13px;
  }
}

/* Desde 1024 px caben todos los destinos y la isla habla el idioma del
   escritorio (revisión de nava en #725): icono y palabra en línea, a 14 px, en
   una isla de 52 px. Lo elegido es una píldora que abraza icono y palabra, con
   el rombo posado en el filete. «Configuración» va aparte, tras un filete. */
@media (min-width: 1024px) {
  .app-nav__list--mobile {
    display: none;
  }

  .app-nav__list--desktop {
    display: flex;
    align-items: center;
    height: 52px;
    gap: 2px;
    padding: 0 5px;
    border-radius: 16px;
  }

  .app-nav__link {
    flex-direction: row;
    gap: 8px;
    min-width: 0;
    height: 44px;
    padding: 0 12px;
    font-size: 14px;
    line-height: 20px;
    border-radius: 12px;
    transition:
      color var(--motion-duration-fast) var(--motion-easing-standard),
      background-color var(--motion-duration-fast) var(--motion-easing-standard);
  }

  /* La píldora ya no vive detrás del icono: es el enlace entero. */
  .app-nav__icon,
  .app-nav__link:hover .app-nav__icon,
  .app-nav__link--active .app-nav__icon,
  .app-nav__link--active:hover .app-nav__icon,
  .app-nav__link[aria-expanded='true']:hover .app-nav__icon {
    width: auto;
    height: auto;
    background-color: transparent;
  }

  .app-nav__link:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  }

  .app-nav__link--active {
    background-color: color-mix(in srgb, var(--color-text-primary) 11%, transparent);
  }

  .app-nav__link--active:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 15%, transparent);
  }

  /* El enlace (44 px) va centrado en la isla (52 px con su borde de 1 px), así
     que empieza 4 px bajo el filete: con top -7 px, el centro del rombo de 7 px
     cae a 0,5 px del borde exterior, en medio del filete. */
  .app-nav__link::before {
    top: -7px;
  }

  .app-nav__item--apart {
    display: flex;
    align-items: center;
    margin-left: 4px;
    padding-left: 6px;
    border-left: var(--border-width-normal) solid var(--color-border-subtle);
  }
}

/* Entre 1024 y 1279 px la isla a 14 px pedía 1008 px y solo hay 992: se aprieta
   el aire de cada destino, sin achicar la palabra ni cortarla. */
@media (min-width: 1024px) and (max-width: 1279px) {
  .app-nav__link {
    gap: 6px;
    padding: 0 9px;
  }
}

.app-nav__more-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Filas tipo carta (#743): filete de latón fino entre filas, sin grises. */
.app-nav__more-item {
  border-bottom: 1px solid color-mix(in srgb, var(--color-brass-line) 38%, transparent);
  /* 40 ms por fila y 140 ms cada una: con las 5 filas de hoy termina en
     280 ms (pedido de revisión: menos de 300 ms en total). */
  animation: app-nav-more-in 140ms var(--motion-ease-out, ease-out) both;
  animation-delay: calc(min(var(--i, 0), 6) * 40ms);
}

/* «Cerrar sesión» aparte: un hueco y un filete doble de latón encima. */
.app-nav__more-item--logout {
  margin-top: var(--space-3);
  border-top: 3px double color-mix(in srgb, var(--color-brass-line) 45%, transparent);
  border-bottom: 0;
}

@keyframes app-nav-more-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-nav__more-item {
    animation: none;
  }
}

:root[data-motion='reduced'] .app-nav__more-item {
  animation: none;
}

.app-nav__more-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 52px;
  padding: var(--space-2) var(--space-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.app-nav__more-link .app-nav__icon {
  width: auto;
  height: auto;
  color: var(--color-text-secondary);
}

.app-nav__more-label {
  flex: 1;
  min-width: 0;
}

/* El rombo de la fila: hueco en latón; lleno en el destino actual. */
.app-nav__more-mark {
  flex: none;
  width: 7px;
  height: 7px;
  margin-inline: 2px;
  border: 1.5px solid var(--color-brass-line);
  rotate: 45deg;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-base) var(--motion-ease-spring, ease-out);
}

.app-nav__more-go {
  color: var(--color-brass-text);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-ease-out);
}

@media (hover: hover) {
  .app-nav__more-link:hover {
    background-color: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  }

  .app-nav__more-link:hover .app-nav__more-mark {
    transform: scale(1.25);
  }

  .app-nav__more-link:hover .app-nav__more-go {
    opacity: 1;
    transform: translateX(0);
  }
}

.app-nav__more-link:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.app-nav__more-link--active {
  font-weight: 600;
}

.app-nav__more-link--active .app-nav__more-mark {
  background-color: var(--color-brass-line);
}

.app-nav__more-link--active .app-nav__icon {
  color: var(--color-text-primary);
}

.app-nav__more-logout {
  color: var(--color-danger-text);
}

.app-nav__more-logout .app-nav__more-mark {
  border-color: currentColor;
}

.app-nav__more-logout:disabled {
  opacity: 0.64;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .app-nav__more-mark,
  .app-nav__more-go {
    transition: none;
  }
}
</style>

<!-- Sin scoped: el título del diálogo vive dentro de BaseDialog (teletransportado),
     fuera del alcance del CSS con ámbito; la clase de contenido lo acota a «Más». -->
<style>
.app-nav__more-sheet .base-dialog__title {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
  line-height: 30px;
}
</style>
