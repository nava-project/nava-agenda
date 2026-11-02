<script setup lang="ts">
// Página coordinadora de la entrada pública de reservas (HU-090, CA-090-01
// a CA-090-05). Sin mockup asignado: composición libre dentro de NAVA /
// Tailored Grid (DEC-078), alojada en el cascarón de la reserva pública
// (`layouts/PublicBookingLayout.vue`, DEC-111). Posee estado y reintento; no
// conoce la forma RFC 9457 del contrato (eso queda dentro de
// `api/resolveBarbershopApi.ts`).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isMapAvailable } from '@/shared/model/mapEmbed'
import { LocationMap } from '@/shared/ui'
import { formatFullDateInTimezone, formatTimeInTimezone } from '@/shared/time/formatInstant'
import BookingStateScreen from '../components/BookingStateScreen.vue'
import GoogleReviews from '../components/GoogleReviews.vue'
import LocalTimeDial from '../components/LocalTimeDial.vue'
import { formatCoordinates } from '../model/clockDial'
import { loadPublicProfile } from '../model/publicProfile'
import type { PublicBarbershopProfile } from '../model/barbershopProfileOutcome'
import { usePublicVocabulary } from '../model/publicVocabulary'

interface Props {
  /** Identificador del enlace público, tal como llega del parámetro de
   * ruta `:slug` (app/router, `props: true`). No confiado: el servidor lo
   * vuelve a resolver desde cero (CA-090-03). */
  slug: string
}
const props = defineProps<Props>()
const v = usePublicVocabulary()

type ScreenState =
  | { status: 'loading' }
  | { status: 'success'; profile: PublicBarbershopProfile }
  | { status: 'not-found' }
  | { status: 'network-error' }
  | { status: 'unexpected-error'; requestId?: string }

const screenState = ref<ScreenState>({ status: 'loading' })

async function load() {
  screenState.value = { status: 'loading' }
  const outcome = await loadPublicProfile(props.slug)
  switch (outcome.kind) {
    case 'success':
      screenState.value = { status: 'success', profile: outcome.profile }
      return
    case 'not-found':
      screenState.value = { status: 'not-found' }
      return
    case 'network-error':
      screenState.value = { status: 'network-error' }
      return
    case 'unexpected-error':
      screenState.value = { status: 'unexpected-error', requestId: outcome.requestId }
  }
}

// El reloj avanza solo: la hora de la barbería es lo que la persona compara
// con su propia hora antes de elegir, y una hora congelada engaña.
const now = ref(new Date())
let clockTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void load()
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

const retry = () => {
  void load()
}

// CA-090-01: "presenta la hora en su zona". El reloj del dispositivo solo
// construye el instante a formatear; el día/hora civil resultante lo
// decide `timezone` (la de la barbería), nunca la zona del dispositivo
// (mismo criterio que formatFullDateInTimezone, HU-062).
const currentTimeLabel = computed(() => {
  if (screenState.value.status !== 'success') return ''
  return formatTimeInTimezone(now.value.toISOString(), screenState.value.profile.timezone)
})
const currentDateLabel = computed(() => {
  if (screenState.value.status !== 'success') return ''
  return formatFullDateInTimezone(screenState.value.profile.timezone, now.value)
})

// Modalidades de atención: solo lo que el perfil ya declara (DEC-130, DEC-131).
const attentionLabel = computed(() => {
  if (screenState.value.status !== 'success') return ''
  const { location, offersHomeService } = screenState.value.profile
  const modes = [location ? 'En el local' : null, offersHomeService ? 'A domicilio' : null]
  return modes.filter(Boolean).join(' · ')
})

const failedRequestId = computed(() =>
  screenState.value.status === 'unexpected-error' ? screenState.value.requestId : undefined,
)
</script>

<template>
  <BookingStateScreen
    v-if="screenState.status !== 'success'"
    :status="screenState.status"
    :request-id="failedRequestId"
    title="Entrada pública de reservas"
    loading-headline="Abriendo tu reserva…"
    @retry="retry"
  />

  <main v-else class="pb-page pb-hero">
    <div class="pb-hero__grid">
      <div class="pb-hero__copy">
        <p class="pb-eyebrow">Reserva en línea</p>
        <h1 class="pb-hero__name">{{ screenState.profile.name }}</h1>
        <div class="pb-rule" aria-hidden="true"></div>

        <!-- La acción principal va justo bajo el nombre: en móvil no queda tras el mapa. -->
        <RouterLink
          :to="{ name: 'reserva-publica-servicios', params: { slug: props.slug } }"
          class="pb-cta pb-cta--wide"
        >
          <span>Reservar un turno</span>
          <span class="pb-cta__arrow" aria-hidden="true">→</span>
        </RouterLink>

        <!-- Los cuatro pasos del recorrido (los mismos del progreso), para saber qué sigue. -->
        <ol class="pb-steps" aria-label="Pasos de la reserva">
          <li>Servicio</li>
          <li>{{ v.Professional }}</li>
          <li>Horario</li>
          <li>Tus datos</li>
        </ol>
      </div>

      <!-- Ficha del local: hora, contacto, modalidad y plano. Solo lo que el perfil trae. -->
      <aside class="pb-plate" aria-label="Datos del local">
        <div class="pb-clock">
          <LocalTimeDial :at="now" :time-zone="screenState.profile.timezone" />
          <div class="pb-clock__text">
            <p class="pb-clock__label">Hora local {{ v.ofTheBusiness }}</p>
            <p class="pb-clock__time">{{ currentTimeLabel }}</p>
            <p class="pb-clock__date">{{ currentDateLabel }}</p>
          </div>
        </div>

        <dl
          v-if="
            screenState.profile.contactEmail || screenState.profile.contactPhone || attentionLabel
          "
          class="pb-contact"
        >
          <div v-if="screenState.profile.contactPhone" class="pb-contact__row">
            <dt>Teléfono</dt>
            <dd>{{ screenState.profile.contactPhone }}</dd>
          </div>
          <div v-if="screenState.profile.contactEmail" class="pb-contact__row">
            <dt>Correo</dt>
            <dd>{{ screenState.profile.contactEmail }}</dd>
          </div>
          <div v-if="attentionLabel" class="pb-contact__row">
            <dt>Atención</dt>
            <dd>{{ attentionLabel }}</dd>
          </div>
        </dl>

        <!-- DEC-130: solo con interruptor activo y coordenadas reales; si no, nada, sin error. -->
        <section
          v-if="screenState.profile.location && isMapAvailable()"
          class="pb-location"
          aria-labelledby="pb-location-title"
        >
          <h2 id="pb-location-title" class="pb-location__title">Dónde estamos</h2>
          <div class="pb-plano">
            <LocationMap
              :latitude="screenState.profile.location.latitude"
              :longitude="screenState.profile.location.longitude"
              :address="screenState.profile.location.address"
            />
            <p class="pb-plano__coords" aria-hidden="true">
              {{
                formatCoordinates(
                  screenState.profile.location.latitude,
                  screenState.profile.location.longitude,
                )
              }}
            </p>
          </div>
        </section>

        <!-- DEC-129: solo con ficha de Google y datos; si no, nada, sin error. -->
        <GoogleReviews :slug="props.slug" />
      </aside>
    </div>
  </main>
</template>
