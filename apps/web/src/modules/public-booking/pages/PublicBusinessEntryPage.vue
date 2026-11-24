<script setup lang="ts">
// Entrada pública del negocio y catálogo de servicios (HU-090, HU-091). v2
// «La luz del día» (DEC-188): la entrada ES el catálogo, así que reservar
// empieza aquí sin un clic previo. El negocio es el protagonista: su nombre, su
// franja de hoy (las horas reales que atiende, con «ahora» en Sol) y sus
// servicios. Los datos del local (contacto, horario, plano y opiniones) van al
// lado en escritorio y debajo en móvil.
//
// Con un solo servicio no hay nada que elegir: se pasa directo a «Día y hora»
// con `replace`, para que «atrás» no devuelva a una pantalla que rebota.
//
// Perfil y catálogo se piden a la vez. El perfil se comparte con el cascarón
// (publicProfile.ts) y el catálogo con «Día y hora» (publicServices.ts).
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { arrivalKey } from '@/shared/composables/useArrival'
import { useLoaderGrace } from '@/shared/composables/useLoaderGrace'
import { isMapAvailable } from '@/shared/model/mapEmbed'
import { formatMoney } from '@/shared/model/money'
import { civilNow, clockToMinutes, formatClock } from '@/shared/model/openingHours'
import { DiamondLoader, LocationMap, PhoneDisplay } from '@/shared/ui'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import BookingStateScreen from '../components/BookingStateScreen.vue'
import DaylightStrip from '../components/DaylightStrip.vue'
import GoogleReviews from '../components/GoogleReviews.vue'
import OpeningHoursCard from '../components/OpeningHoursCard.vue'
import type { PublicBusinessProfile } from '../model/businessProfileOutcome'
import { loadPublicProfile, publicProfileFor } from '../model/publicProfile'
import type { PublicService } from '../model/publicServiceListOutcome'
import { loadPublicServices, publicServicesFor } from '../model/publicServices'
import { usePublicVocabulary } from '../model/publicVocabulary'

interface Props {
  /** Identificador del enlace público (`:slug`). No confiado: el servidor lo
   * vuelve a resolver desde cero (CA-090-03). */
  slug: string
}
const props = defineProps<Props>()
const v = usePublicVocabulary()
const router = useRouter()
// La llegada del cascarón empieza cuando hay contenido que mostrar.
const arrival = inject(arrivalKey, null)
const arriving = computed(() => arrival?.arriving.value ?? false)

type ScreenState =
  | { status: 'loading' }
  | { status: 'success'; profile: PublicBusinessProfile; services: PublicService[] }
  | { status: 'not-found' }
  | { status: 'network-error' }
  | { status: 'unexpected-error'; requestId?: string }

const screenState = ref<ScreenState>({ status: 'loading' })
// El cargador de la entrada o no asoma o se queda a la vista (#820). Un
// reintento reinicia la espera: la lectura anterior queda sin resolver.
const loaderGrace = useLoaderGrace()

async function load() {
  // Al volver desde «Día y hora» el negocio y su carta ya se leyeron: la
  // entrada se dibuja con ellos y el perfil se relee por detrás (#820). Antes
  // volvía el esqueleto 20–40 ms entre la pantalla anterior y esta.
  const known = publicProfileFor(props.slug)
  const knownServices = publicServicesFor(props.slug)
  const warm = known !== null && knownServices !== null && knownServices.length !== 1
  if (warm) {
    arrival?.begin()
    screenState.value = { status: 'success', profile: known, services: knownServices }
  } else {
    screenState.value = { status: 'loading' }
    loaderGrace.start()
  }
  const [profile, services] = await Promise.all([
    loadPublicProfile(props.slug),
    loadPublicServices(props.slug),
  ])
  if (!warm) await loaderGrace.settled()
  // Una relectura por detrás sin red no borra lo que ya se ve.
  if (warm && (profile.kind === 'network-error' || services.kind === 'network-error')) return
  // El perfil manda: si el enlace no existe, eso es lo que se dice.
  const failed =
    profile.kind !== 'success' ? profile : services.kind !== 'success' ? services : null
  if (failed) {
    screenState.value =
      failed.kind === 'unexpected-error'
        ? { status: 'unexpected-error', requestId: failed.requestId }
        : { status: failed.kind as 'not-found' | 'network-error' }
    return
  }
  if (profile.kind !== 'success' || services.kind !== 'success') return
  const only = services.services.length === 1 ? services.services[0] : undefined
  if (only) {
    void router.replace({
      name: 'reserva-publica-horario',
      params: { slug: props.slug, serviceId: only.id },
    })
    return
  }
  arrival?.begin()
  screenState.value = { status: 'success', profile: profile.profile, services: services.services }
}

const now = ref(new Date())
let clockTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void load()
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

const retry = () => {
  void load()
}

const profile = computed(() =>
  screenState.value.status === 'success' ? screenState.value.profile : null,
)
const services = computed(() =>
  screenState.value.status === 'success' ? screenState.value.services : [],
)

const currentTimeLabel = computed(() =>
  profile.value ? formatTimeInTimezone(now.value.toISOString(), profile.value.timezone) : '',
)

// La franja de hoy: solo con horario configurado y si el día del perfil sigue
// siendo hoy en la zona del local. Sin horario no se dibuja nada inventado.
const today = computed(() => {
  const p = profile.value
  if (!p?.today) return null
  const nowCivil = civilNow(p.timezone, now.value)
  if (nowCivil.date !== p.today.date) return null
  const open = p.today.hours.map((h) => ({
    start: clockToMinutes(h.opens) ?? 0,
    end: clockToMinutes(h.closes) ?? 0,
  }))
  const label =
    p.today.hours.length === 0
      ? 'Hoy no abre.'
      : `Hoy atiende ${p.today.hours
          .map((h) => `de ${formatClock(h.opens)} a ${formatClock(h.closes)}`)
          .join(' y ')}. Son las ${currentTimeLabel.value}.`
  return { open, now: nowCivil.minutes, label }
})

const attentionLabel = computed(() => {
  const p = profile.value
  if (!p) return ''
  const modes = [p.location ? 'En el local' : null, p.offersHomeService ? 'A domicilio' : null]
  return modes.filter(Boolean).join(' · ')
})

const failedRequestId = computed(() =>
  screenState.value.status === 'unexpected-error' ? screenState.value.requestId : undefined,
)

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
</script>

<template>
  <main v-if="screenState.status === 'loading'" class="bk-page bk-entry" aria-busy="true">
    <h1 class="pb-sr-only">Abriendo la reserva…</h1>
    <!-- La espera a la vista (#735): el diamante dentro del sol sobre las siluetas,
         que guardan el alto de lo que viene para que nada salte. -->
    <div class="bk-hero">
      <span class="bk-skel bk-skel--kicker"></span>
      <span class="bk-skel bk-skel--name"></span>
      <span class="bk-skel bk-skel--line"></span>
      <span class="bk-skel bk-skel--strip"></span>
    </div>
    <div class="bk-entry__grid">
      <div class="bk-services bk-wait-col">
        <!-- La espera a la vista (#735), centrada en la columna de los servicios. -->
        <DiamondLoader layout="column" label="Abriendo la reserva…" announce />
        <span class="bk-skel bk-skel--title"></span>
        <span v-for="n in 4" :key="n" class="bk-skel bk-skel--service"></span>
      </div>
    </div>
  </main>

  <BookingStateScreen
    v-else-if="screenState.status !== 'success'"
    :status="screenState.status"
    :request-id="failedRequestId"
    title="Reserva en línea"
    loading-headline="Abriendo la reserva…"
    @retry="retry"
  />

  <main v-else-if="profile" class="bk-page bk-entry">
    <div class="bk-entry__grid">
      <!-- El negocio va en la grilla (#745): en escritorio los datos del local
           suben junto a él y no quedan vacíos a la derecha ni bajo la carta. -->
      <section class="bk-hero" aria-labelledby="bk-business-name">
        <p class="bk-kicker">Reserva en línea</p>
        <h1 id="bk-business-name" class="bk-hero__name">{{ profile.name }}</h1>
        <!-- La hora del negocio con peso (#745): en serif, junto a dónde atiende. -->
        <p class="bk-hero__meta">
          <span class="bk-hero__clock"
            >Hora del negocio <time class="bk-hero__time">{{ currentTimeLabel }}</time></span
          >
          <span v-if="attentionLabel">{{ attentionLabel }}</span>
        </p>
        <DaylightStrip
          v-if="today"
          class="bk-hero__strip"
          :open="today.open"
          :now="today.now"
          :label="today.label"
          :arrive="arriving"
          variant="band"
        />
      </section>

      <section class="bk-services" aria-labelledby="bk-services-title">
        <h2 id="bk-services-title" class="bk-section-title">Elige un servicio</h2>

        <p v-if="services.length === 0" class="bk-empty">
          {{ v.ThisBusiness }} aún no tiene servicios para reservar en línea.
        </p>

        <ul v-else class="bk-services__list">
          <li v-for="(service, index) in services" :key="service.id" :style="{ '--i': index }">
            <RouterLink
              class="bk-service"
              :to="{
                name: 'reserva-publica-horario',
                params: { slug: props.slug, serviceId: service.id },
              }"
            >
              <!-- Un renglón de carta (#745): el nombre, los puntos guía y el
                   precio en la misma línea; debajo, qué es y cuánto dura. -->
              <span class="bk-service__line">
                <span class="bk-service__name">{{ service.name }}</span>
                <span class="bk-service__leader" aria-hidden="true"></span>
                <span class="bk-service__price">{{
                  formatMoney(service.price, service.currency)
                }}</span>
              </span>
              <span v-if="service.description" class="bk-service__desc">{{
                service.description
              }}</span>
              <span class="bk-service__meta">{{ durationLabel(service.durationMinutes) }}</span>
            </RouterLink>
          </li>
        </ul>

        <!-- Quien ya reservó entra a cambiar la hora con un código (HU-105). -->
        <p class="bk-manage">
          ¿Ya tienes un turno?
          <RouterLink :to="{ name: 'mi-turno-acceso', params: { slug: props.slug } }"
            >Cámbialo aquí</RouterLink
          >
        </p>
      </section>

      <aside class="bk-local pb-plate" aria-label="Datos del local">
        <dl v-if="profile.contactEmail || profile.contactPhone" class="pb-contact">
          <div v-if="profile.contactPhone" class="pb-contact__row">
            <dt>Teléfono</dt>
            <dd><PhoneDisplay :value="profile.contactPhone" /></dd>
          </div>
          <div v-if="profile.contactEmail" class="pb-contact__row">
            <dt>Correo</dt>
            <dd>{{ profile.contactEmail }}</dd>
          </div>
        </dl>

        <!-- DEC-182: solo con horario configurado. -->
        <OpeningHoursCard
          :opening-hours="profile.openingHours"
          :today="profile.today"
          :closed-on-holidays="profile.closedOnHolidays"
          :time-zone="profile.timezone"
          :at="now"
        />

        <!-- DEC-130: solo con interruptor activo y coordenadas reales. -->
        <section
          v-if="profile.location && isMapAvailable()"
          class="pb-location"
          aria-labelledby="pb-location-title"
        >
          <h2 id="pb-location-title" class="pb-location__title">Dónde estamos</h2>
          <div class="pb-plano">
            <LocationMap
              :latitude="profile.location.latitude"
              :longitude="profile.location.longitude"
              :address="profile.location.address"
            />
          </div>
        </section>

        <!-- DEC-129: solo con ficha de Google y datos. -->
        <GoogleReviews :slug="props.slug" />
      </aside>
    </div>
  </main>
</template>
