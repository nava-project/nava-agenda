<script setup lang="ts">
// Cascarón de la reserva pública. Aloja las pantallas del recorrido y conserva
// entre ellas lo que no debe reiniciarse: la cabecera con el negocio, el enlace
// de retorno, los pasos y la firma. Cada pantalla conserva su propio `<main>`, su
// estado y su `<h1>`; el cascarón solo aporta el marco (el `<header>` es el
// único landmark de banner) y la transición de entrada/salida entre pasos.
//
// v2 «La luz del día» (DEC-188): sigue al modo del sistema (Día/Noche), lleva el
// color de SU negocio (DEC-171, «que mande el negocio») y el nombre del negocio
// es la jerarquía principal; NAVA solo firma al pie (estandar-diseno-visual.md
// §3.2). Tres pasos: Servicio → Día y hora → Tus datos, y la confirmación.
import { computed, onBeforeUnmount, provide, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, type RouteLocationRaw } from 'vue-router'
import { buildVocabularyFromTerms } from '@/shared/model'
import { NAVA_PRIVACY_URL, NAVA_TERMS_URL } from '@/shared/model/navaSite'
import { arrivalKey, useArrival } from '@/shared/composables/useArrival'
import { DiamondLoader, NavaWordmark } from '@/shared/ui'
import { bookingChromeKey } from '../model/bookingChrome'
import { paintPublicAccent } from '../model/publicAccent'
import {
  loadPublicProfile,
  publicAccentFor,
  publicProfileFor,
  publicTermsFor,
} from '../model/publicProfile'
import { publicVocabularyKey } from '../model/publicVocabulary'
import '../styles/publicBooking.css'
import '../styles/bookingV2.css'

const route = useRoute()

const completed = ref(false)
provide(bookingChromeKey, { completed })

// Vocabulario del negocio (DEC-119): se lee una vez del perfil público del enlace
// y se ofrece a todas las pantallas, que pueden abrirse directamente desde un enlace.
// Sin respuesta (enlace desconocido, red caída) valen los valores iniciales: cada
// pantalla muestra su propio estado de error. Las pantallas no se montan hasta que la
// lectura termina, para que nadie vea un instante «profesional» antes de «manicurista».
const currentSlug = computed(() => String(route.params.slug ?? ''))
const vocabularySettled = ref(false)
const v = computed(() => buildVocabularyFromTerms(publicTermsFor(currentSlug.value)))
provide(publicVocabularyKey, v)

// La entrada no espera: ella misma lee el perfil (comparte la petición) y solo dice
// la palabra del negocio cuando ya la tiene; su texto de carga es neutro.
const showScreens = computed(
  () => vocabularySettled.value || route.name === 'reserva-publica-entrada',
)

watch(
  currentSlug,
  async (current) => {
    if (!current) {
      vocabularySettled.value = true
      return
    }
    vocabularySettled.value = false
    await loadPublicProfile(current)
    if (currentSlug.value !== current) return
    vocabularySettled.value = true
  },
  { immediate: true },
)

// Color de marca del enlace (DEC-171): cambia con el enlace y se retira al
// salir de la reserva.
let clearAccent: (() => void) | null = null
watch(
  () => publicAccentFor(currentSlug.value),
  (key) => {
    clearAccent?.()
    clearAccent = paintPublicAccent(document.documentElement, key)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearAccent?.()
  clearAccent = null
})

const STEPS = ['Servicio', 'Día y hora', 'Tus datos'] as const

const step = computed<number | null>(() => {
  const value = route.meta.bookingStep
  return typeof value === 'number' ? value : null
})

const businessName = computed(() => publicProfileFor(currentSlug.value)?.name ?? '')

// Un paso atrás deshace exactamente el anterior. «Día y hora» vuelve a la
// entrada (que es el catálogo); «Tus datos» vuelve a la hora, con el
// profesional solo si se eligió uno (con «Cualquiera» vuelve a Cualquiera).
const back = computed<{ to: RouteLocationRaw; label: string } | null>(() => {
  if (completed.value) return null
  const slug = String(route.params.slug ?? '')
  const serviceId = String(route.params.serviceId ?? '')
  const professionalId = String(route.params.professionalId ?? '')
  switch (route.name) {
    case 'reserva-publica-horario':
      return { to: { name: 'reserva-publica-entrada', params: { slug } }, label: 'Servicios' }
    case 'reserva-publica-cliente':
      return {
        to: {
          name: 'reserva-publica-horario',
          params: { slug, serviceId },
          query: route.query.cualquiera === '1' ? {} : { profesional: professionalId },
        },
        label: 'Día y hora',
      }
    default:
      return null
  }
})

const entry = computed<RouteLocationRaw>(() => ({
  name: 'reserva-publica-entrada',
  params: { slug: currentSlug.value },
}))

// La página sale hacia el lado contrario al volver atrás. Se decide con
// `flush: 'sync'` para que el nombre de la transición ya sea el correcto
// cuando Vue pinta la pantalla que sale.
const direction = ref<'forward' | 'back'>('forward')
watch(
  step,
  (next, previous) => {
    direction.value = (next ?? 0) < (previous ?? 0) ? 'back' : 'forward'
  },
  { flush: 'sync' },
)

// Llegada (DEC-188): un solo momento al abrir el enlace. La pantalla que se
// abre la empieza cuando ya tiene su contenido (no durante la carga); un clic
// o una tecla la terminan y con movimiento reducido no existe.
const arrival = useArrival({ deferred: true })
provide(arrivalKey, arrival)
const arriving = arrival.arriving
</script>

<template>
  <div class="pb-layout bk" :class="{ 'bk--arrive': arriving }">
    <header class="bk-top">
      <div class="bk-top__inner">
        <div v-if="back" class="bk-top__lead">
          <RouterLink :to="back.to" class="bk-back">
            <span class="bk-back__arrow" aria-hidden="true">←</span>
            <span>{{ back.label }}</span>
          </RouterLink>
          <!-- En los pasos interiores, el negocio sigue a la vista. -->
          <RouterLink v-if="businessName" :to="entry" class="bk-top__name">{{
            businessName
          }}</RouterLink>
        </div>
        <RouterLink
          v-else-if="route.name !== 'reserva-publica-entrada'"
          :to="entry"
          class="bk-top__business"
        >
          {{ businessName }}
        </RouterLink>
        <span v-else class="bk-top__spacer" aria-hidden="true"></span>

        <!-- Sin negocio (enlace inexistente) no hay recorrido que mostrar; mientras
             el perfil se lee, sí (#747): la cabecera no queda vacía con red lenta. -->
        <ol
          v-if="(step !== null || completed) && (businessName || !vocabularySettled)"
          class="bk-steps"
          aria-label="Pasos de la reserva"
        >
          <li
            v-for="(label, index) in STEPS"
            :key="label"
            class="bk-steps__item"
            :class="{
              'bk-steps__item--done': completed || index + 1 < (step ?? 0),
              'bk-steps__item--current': !completed && index + 1 === step,
            }"
            :aria-current="!completed && index + 1 === step ? 'step' : undefined"
          >
            <span class="bk-steps__mark" aria-hidden="true"></span>
            <span class="bk-steps__label">{{ label }}</span>
            <span v-if="completed || index + 1 < (step ?? 0)" class="pb-sr-only">
              (completado)</span
            >
          </li>
        </ol>
      </div>
    </header>

    <!-- Mientras se lee el vocabulario, un hueco del alto de una pantalla con la
         espera a la vista (#735): antes era un lienzo vacío bajo la cabecera. -->
    <main v-if="!showScreens" class="bk-page" aria-busy="true">
      <h1 class="pb-sr-only">Abriendo la reserva…</h1>
      <DiamondLoader layout="overlay" label="Abriendo la reserva…" announce />
    </main>
    <RouterView v-else v-slot="{ Component, route: current }">
      <Transition :name="`pb-step-${direction}`" mode="out-in">
        <component :is="Component" :key="String(current.name)" />
      </Transition>
    </RouterView>

    <!-- El negocio lleva la jerarquía; NAVA solo firma al pie y lleva a su
         banda en nava.wtf, para que nadie crea que reserva en «NAVA». -->
    <footer class="bk-foot">
      <a
        class="bk-foot__firm"
        href="https://nava.wtf/#agenda"
        aria-label="Reservas con Nava Agenda, en nava.wtf"
      >
        <span>Reservas con</span>
        <NavaWordmark size="sm" />
      </a>
      <nav class="bk-foot__legal" aria-label="Documentos legales">
        <a :href="NAVA_PRIVACY_URL">Privacidad</a>
        <a :href="NAVA_TERMS_URL">Condiciones</a>
      </nav>
    </footer>
  </div>
</template>
