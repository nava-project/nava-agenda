<script setup lang="ts">
// «Día y hora» (paso 2 de la reserva v2, DEC-188). Reúne lo que en la v1 eran
// dos pantallas (profesional, HU-092, y horario, HU-095): el profesional es un
// filtro de chips con «Cualquiera» por defecto, oculto si solo hay uno.
//
// Datos: una sola lectura de disponibilidad para TODOS los profesionales del
// servicio (DEC-162). Cambiar de profesional, de día o de hora es una agrupación
// en el cliente sobre esa respuesta, nunca una consulta nueva (RN-DIS-03). La
// «luz libre» de cada día son sus horas libres reales frente al día más libre;
// no hay valor inventado ni carga tardía que mueva el diseño.
//
// Con «Cualquiera», la hora elegida la atiende el primer profesional que la
// ofrece en el orden del servidor; el pase lo dice antes de seguir, y «Tus
// datos» recibe ese profesional con `?cualquiera=1` para que «atrás» vuelva a
// Cualquiera. El servidor revalida todo al confirmar (HU-097).
//
// Una respuesta tardía de una carga ya reemplazada se descarta con un token
// monótono (CA-095-03).
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { arrivalKey } from '@/shared/composables/useArrival'
import { useLoaderGrace } from '@/shared/composables/useLoaderGrace'
import { formatMoney } from '@/shared/model/money'
import { DiamondLoader, ProfessionalAvatar, StarRating } from '@/shared/ui'
import { civilDateChip, formatCivilDateFull } from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import BookingStateScreen from '../components/BookingStateScreen.vue'
import DayTimePicker from '../components/DayTimePicker.vue'
import ProfessionalReviews from '../components/ProfessionalReviews.vue'
import { listPublicProfessionals } from '../api/listPublicProfessionalsApi'
import { listPublicServiceAvailability } from '../api/listPublicServiceAvailabilityApi'
import {
  buildDaylightDays,
  professionalForSlot,
  type DaylightDay,
  type DaylightSlot,
} from '../model/daylight'
import { loadPublicProfile, publicProfileFor } from '../model/publicProfile'
import type { PublicProfessional } from '../model/publicProfessionalListOutcome'
import { rememberPublicProfessionals } from '../model/publicProfessionals'
import { chosenStartFor, forgetChosenStart, rememberChosenStart } from '../model/chosenStart'
import { publicProfessionalPhotoUrl } from '../model/publicProfessionalPhotoUrl'
import type { PublicServiceSlot } from '../model/publicServiceAvailabilityOutcome'
import type { PublicService } from '../model/publicServiceListOutcome'
import { loadPublicServices } from '../model/publicServices'
import { usePublicVocabulary } from '../model/publicVocabulary'

interface Props {
  /** Enlace público (`:slug`). No confiado: el servidor lo vuelve a resolver. */
  slug: string
  /** Servicio elegido (`:serviceId`). No confiado: el servidor lo revalida. */
  serviceId: string
  /** Profesional preelegido (`?profesional=`), o `null` para «Cualquiera». */
  professionalId?: string | null
}
const props = withDefaults(defineProps<Props>(), { professionalId: null })
const v = usePublicVocabulary()
const router = useRouter()
// La llegada del cascarón (solo si esta es la pantalla con la que se abrió el enlace).
const arrival = inject(arrivalKey, null)
const arriving = computed(() => arrival?.arriving.value ?? false)

type ScreenState =
  | { status: 'loading' }
  | {
      status: 'success'
      service: PublicService | null
      professionals: PublicProfessional[]
      slots: PublicServiceSlot[]
      durationMinutes: number
      slotGridMinutes: number
      timezone: string
    }
  | { status: 'not-found' }
  | { status: 'network-error' }
  | { status: 'unexpected-error'; requestId?: string }

const screenState = ref<ScreenState>({ status: 'loading' })
const chosenProfessionalId = ref<string | null>(props.professionalId)
const activeDate = ref<string | null>(null)
const selected = ref<DaylightSlot | null>(null)
// La hora elegida antes de ir a «Tus datos» ya no está libre al volver (#824).
const lostChoice = ref(false)
const page = ref<HTMLElement | null>(null)

let requestToken = 0
// «Cargando las horas libres…» o no asoma o se queda a la vista (#820).
const loaderGrace = useLoaderGrace()

async function load() {
  const token = ++requestToken
  screenState.value = { status: 'loading' }
  loaderGrace.start()
  selected.value = null
  activeDate.value = null
  lostChoice.value = false

  const [services, professionals, availability] = await Promise.all([
    loadPublicServices(props.slug),
    listPublicProfessionals(props.slug, props.serviceId),
    listPublicServiceAvailability(props.slug, props.serviceId),
    // El horario del local pinta la franja; si falla, la franja usa las horas libres.
    publicProfileFor(props.slug) ? Promise.resolve() : loadPublicProfile(props.slug),
  ])
  if (token !== requestToken) return
  await loaderGrace.settled()
  if (token !== requestToken) return

  const failed = [availability, professionals, services].find((o) => o.kind !== 'success')
  if (failed) {
    screenState.value =
      failed.kind === 'unexpected-error'
        ? { status: 'unexpected-error', requestId: failed.requestId }
        : { status: failed.kind as 'not-found' | 'network-error' }
    return
  }
  if (
    availability.kind !== 'success' ||
    professionals.kind !== 'success' ||
    services.kind !== 'success'
  )
    return

  rememberPublicProfessionals(props.slug, props.serviceId, professionals.professionals)
  arrival?.begin()
  screenState.value = {
    status: 'success',
    service: services.services.find((s) => s.id === props.serviceId) ?? null,
    professionals: professionals.professionals,
    slots: availability.availability.slots,
    durationMinutes: availability.availability.durationMinutes,
    slotGridMinutes: availability.availability.slotGridMinutes,
    timezone: availability.availability.timezone,
  }
  restoreChosen()
}

// Al volver de «Tus datos», la hora elegida vuelve marcada, en su día, si sigue
// libre; si no, se olvida y se avisa sin diálogo (#824).
function restoreChosen() {
  const startsAt = chosenStartFor(props.slug, props.serviceId)
  if (!startsAt) return
  const day = days.value.find((d) => d.slots.some((s) => s.startsAt === startsAt))
  const slot = day?.slots.find((s) => s.startsAt === startsAt)
  if (!day || !slot) {
    forgetChosenStart(props.slug, props.serviceId)
    lostChoice.value = true
    // La posición de antes ya no lleva a nada: el aviso queda a la vista.
    void nextTick(() => bringIntoView('.bk-daytime__lost'))
    return
  }
  activeDate.value = day.civilDate
  selected.value = slot
  void nextTick(() => bringIntoView('.bk-min[aria-checked="true"]'))
}

// Lo que se recupera al volver queda a la vista: la hora elegida o el aviso de
// que ya no está libre. Con «atrás» del navegador la hora ya lo está, porque la
// posición restaurada la deja ahí (restoreWhenStepReady). Con el enlace «Día y
// hora» la pantalla empieza arriba y la hora puede quedar bajo el pliegue, o bajo
// la barra fija del pase en el teléfono.
function bringIntoView(selector: string) {
  const target = page.value?.querySelector<HTMLElement>(selector)
  if (!target) return
  const pase = page.value?.querySelector<HTMLElement>('.bk-pase')
  // La barra fija puede estar entrando (desplazada hacia abajo): cuenta su alto
  // de maqueta, no su posición de ese instante.
  const bottom =
    pase && getComputedStyle(pase).position === 'fixed'
      ? window.innerHeight - pase.offsetHeight
      : window.innerHeight
  const box = target.getBoundingClientRect()
  if (box.top >= 0 && box.bottom <= bottom) return
  window.scrollTo({
    top: window.scrollY + box.top - (bottom - box.height) / 2,
    behavior: 'instant',
  })
}

watch(() => [props.slug, props.serviceId], load, { immediate: true })

const retry = () => {
  void load()
}

const success = computed(() => (screenState.value.status === 'success' ? screenState.value : null))
const professionals = computed(() => success.value?.professionals ?? [])
const timezone = computed(() => success.value?.timezone ?? 'America/Bogota')
const service = computed(() => success.value?.service ?? null)

// Un profesional de la URL que ya no atiende este servicio vale «Cualquiera».
const effectiveProfessionalId = computed(() => {
  if (professionals.value.length === 1) return professionals.value[0]!.id
  const id = chosenProfessionalId.value
  return id && professionals.value.some((p) => p.id === id) ? id : null
})

const chosenProfessional = computed(
  () => professionals.value.find((p) => p.id === effectiveProfessionalId.value) ?? null,
)

watch(
  () => props.professionalId,
  (id) => {
    chosenProfessionalId.value = id
  },
)

// Los chips son un grupo de radio: una sola parada de Tab y las flechas eligen.
const chipRefs = ref<HTMLElement[]>([])
// Los chips de profesional se deslizan en el teléfono (#745): el borde que
// sigue se desvanece para avisar que hay más nombres hacia ese lado.
const chipsEl = ref<HTMLElement | null>(null)
const chipsMoreBefore = ref(false)
const chipsMoreAfter = ref(false)
function measureChips() {
  const el = chipsEl.value
  if (!el) return
  chipsMoreBefore.value = el.scrollLeft > 4
  chipsMoreAfter.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}
watch(professionals, () => void nextTick(measureChips))
onMounted(() => window.addEventListener('resize', measureChips))
onBeforeUnmount(() => window.removeEventListener('resize', measureChips))

function setChipRef(el: unknown, index: number) {
  if (el instanceof HTMLElement) chipRefs.value[index] = el
}
const chipOptions = computed(() => [null, ...professionals.value.map((p) => p.id)])

function onChipsKeydown(event: KeyboardEvent) {
  const options = chipOptions.value
  const at = Math.max(0, options.indexOf(effectiveProfessionalId.value))
  const last = options.length - 1
  const target =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? (at + 1) % options.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? (at - 1 + options.length) % options.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (target === null) return
  event.preventDefault()
  chooseProfessional(options[target] ?? null)
  const el = chipRefs.value[target]
  el?.focus()
  el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
}

function chooseProfessional(id: string | null) {
  if (id === effectiveProfessionalId.value) return
  chosenProfessionalId.value = id
  // La URL refleja el filtro para que «atrás» y compartir lo conserven, sin
  // apilar una entrada de historial por cada chip.
  void router.replace({
    name: 'reserva-publica-horario',
    params: { slug: props.slug, serviceId: props.serviceId },
    query: id ? { profesional: id } : {},
  })
}

const days = computed<DaylightDay[]>(() =>
  success.value
    ? buildDaylightDays(success.value.slots, timezone.value, effectiveProfessionalId.value)
    : [],
)

// El día activo sobrevive al cambio de profesional si sigue teniendo horas; la
// hora elegida también, si el nuevo filtro la sigue ofreciendo.
watch(days, (next) => {
  if (!next.some((d) => d.civilDate === activeDate.value))
    activeDate.value = next[0]?.civilDate ?? null
  if (selected.value) {
    const still = next.flatMap((d) => d.slots).find((s) => s.startsAt === selected.value!.startsAt)
    selected.value = still ?? null
  }
})

// Elegir una hora; el selector ya ignora lo que no se puede elegir.
function selectSlot(slot: DaylightSlot) {
  selected.value = slot
  lostChoice.value = false
  rememberChosenStart(props.slug, props.serviceId, slot.startsAt)
}

// ── Pase ──────────────────────────────────────────────────────────────────
const attendingProfessional = computed(() => {
  if (chosenProfessional.value) return chosenProfessional.value
  if (!selected.value) return null
  const id = professionalForSlot(selected.value)
  return professionals.value.find((p) => p.id === id) ?? null
})

const pase = computed(() => {
  const slot = selected.value
  if (!slot || !success.value) return null
  const end = new Date(new Date(slot.startsAt).getTime() + success.value.durationMinutes * 60_000)
  const civilDate =
    days.value.find((d) => d.slots.some((s) => s.startsAt === slot.startsAt))?.civilDate ??
    activeDate.value ??
    ''
  const chip = civilDateChip(civilDate)
  return {
    dayLong: formatCivilDateFull(civilDate),
    dayShort: `${chip.weekday} ${chip.day}`,
    time: slot.label,
    range: `${slot.label} – ${formatTimeInTimezone(end.toISOString(), timezone.value)}`,
  }
})

const next = computed(() => {
  const slot = selected.value
  const professional = attendingProfessional.value
  if (!slot || !professional) return null
  return {
    name: 'reserva-publica-cliente',
    params: {
      slug: props.slug,
      serviceId: props.serviceId,
      professionalId: professional.id,
      startsAt: slot.startsAt,
    },
    query: effectiveProfessionalId.value === null ? { cualquiera: '1' } : {},
  }
})

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

const failedRequestId = computed(() =>
  screenState.value.status === 'unexpected-error' ? screenState.value.requestId : undefined,
)
</script>

<template>
  <main v-if="screenState.status === 'loading'" class="bk-page bk-daytime" aria-busy="true">
    <h1 class="pb-sr-only">Cargando las horas libres…</h1>
    <!-- La espera a la vista (#735): el diamante dentro del sol sobre las siluetas,
         que guardan el alto de lo que viene para que nada salte. -->
    <div class="bk-daytime__grid">
      <div class="bk-daytime__main bk-wait-col">
        <!-- La espera a la vista (#735), centrada en la columna de las horas. -->
        <DiamondLoader layout="column" label="Cargando las horas libres…" announce />
        <span class="bk-skel bk-skel--kicker"></span>
        <span class="bk-skel bk-skel--title"></span>
        <span class="bk-skel bk-skel--chips"></span>
        <span class="bk-skel bk-skel--days"></span>
        <span class="bk-skel bk-skel--strip"></span>
        <span class="bk-skel bk-skel--hours"></span>
      </div>
      <!-- El pase mientras carga (#747): su rótulo, una silueta y el botón
           deshabilitado, como cuando ya cargó. Nunca una barra en blanco. -->
      <div class="bk-pase bk-pase--skeleton" aria-hidden="true">
        <p class="bk-pase__label">Tu cita</p>
        <span class="bk-skel bk-skel--pase"></span>
        <span class="bk-cta bk-cta--idle">Elige una hora</span>
      </div>
    </div>
  </main>

  <BookingStateScreen
    v-else-if="screenState.status !== 'success'"
    :status="screenState.status"
    :request-id="failedRequestId"
    title="Elige día y hora"
    loading-headline="Cargando las horas libres…"
    @retry="retry"
  />

  <main v-else ref="page" class="bk-page bk-daytime">
    <div class="bk-daytime__grid">
      <div class="bk-daytime__main">
        <p class="bk-kicker">
          <template v-if="service"
            >{{ service.name }} · {{ durationLabel(service.durationMinutes) }}</template
          >
          <template v-else>Tu servicio</template>
        </p>
        <h1 class="bk-title">Elige día y hora</h1>
        <p v-if="lostChoice" class="bk-daytime__lost" role="status">
          La hora que habías elegido ya no está libre. Elige otra.
        </p>

        <!-- Sin profesionales no hay nada que elegir. -->
        <div v-if="professionals.length === 0" class="bk-empty">
          <p>Este servicio no tiene {{ v.professionals }} disponibles en este momento.</p>
          <RouterLink
            class="bk-link"
            :to="{ name: 'reserva-publica-entrada', params: { slug: props.slug } }"
            >Ver otros servicios</RouterLink
          >
        </div>

        <template v-else>
          <!-- Un único profesional se informa, no se ofrece como elección. -->
          <p v-if="professionals.length === 1" class="bk-attends">
            <ProfessionalAvatar
              :full-name="professionals[0]!.fullName"
              :photo-url="publicProfessionalPhotoUrl(props.slug, professionals[0]!)"
              size="closed"
            />
            <span
              >Te atiende <strong>{{ professionals[0]!.fullName }}</strong></span
            >
          </p>

          <div
            v-else
            ref="chipsEl"
            class="bk-chips"
            :class="{
              'bk-chips--before': chipsMoreBefore,
              'bk-chips--after': chipsMoreAfter,
            }"
            role="radiogroup"
            :aria-label="`Con qué ${v.professional}`"
            @keydown="onChipsKeydown"
            @scroll.passive="measureChips"
          >
            <button
              :ref="(el) => setChipRef(el, 0)"
              type="button"
              role="radio"
              class="bk-chip"
              :aria-checked="effectiveProfessionalId === null"
              :tabindex="effectiveProfessionalId === null ? 0 : -1"
              @click="chooseProfessional(null)"
            >
              <svg class="bk-chip__any" viewBox="0 0 28 28" aria-hidden="true">
                <path d="M14 6l3 3-3 3-3-3z M8 13l3 3-3 3-3-3z M20 13l3 3-3 3-3-3z" />
              </svg>
              Cualquiera
            </button>
            <button
              v-for="(professional, index) in professionals"
              :key="professional.id"
              :ref="(el) => setChipRef(el, index + 1)"
              type="button"
              role="radio"
              class="bk-chip"
              :aria-checked="effectiveProfessionalId === professional.id"
              :tabindex="effectiveProfessionalId === professional.id ? 0 : -1"
              @click="chooseProfessional(professional.id)"
            >
              <ProfessionalAvatar
                :full-name="professional.fullName"
                :photo-url="publicProfessionalPhotoUrl(props.slug, professional)"
                size="closed"
              />
              {{ professional.fullName }}
            </button>
          </div>

          <!-- Ficha corta del profesional elegido: descripción y opiniones. -->
          <div
            v-if="
              chosenProfessional &&
              (chosenProfessional.description || chosenProfessional.ratingCount > 0)
            "
            class="bk-pro"
          >
            <StarRating
              v-if="chosenProfessional.ratingCount > 0"
              :rating="chosenProfessional.rating"
              :count="chosenProfessional.ratingCount"
              size="sm"
            />
            <p v-if="chosenProfessional.description" class="bk-pro__desc">
              {{ chosenProfessional.description }}
            </p>
            <ProfessionalReviews
              v-if="chosenProfessional.ratingCount > 0"
              :key="chosenProfessional.id"
              :slug="props.slug"
              :professional-id="chosenProfessional.id"
              :professional-name="chosenProfessional.fullName"
              :rating-count="chosenProfessional.ratingCount"
            />
          </div>

          <div v-if="days.length === 0" class="bk-empty">
            <p v-if="chosenProfessional && professionals.length > 1">
              {{ chosenProfessional.fullName }} no tiene horas libres en los próximos días.
            </p>
            <p v-else>No quedan horas libres en los próximos días. Vuelve a mirar más tarde.</p>
            <button
              v-if="chosenProfessional && professionals.length > 1"
              type="button"
              class="bk-link"
              @click="chooseProfessional(null)"
            >
              Ver con cualquiera
            </button>
          </div>

          <template v-else>
            <DayTimePicker
              v-model:active-date="activeDate"
              :days="days"
              :selected-start="selected?.startsAt ?? null"
              :slot-grid-minutes="success?.slotGridMinutes ?? 15"
              :duration-minutes="success?.durationMinutes ?? 0"
              :opening-hours="publicProfileFor(props.slug)?.openingHours ?? []"
              :timezone="timezone"
              :arrive="arriving"
              @select="selectSlot"
            />
          </template>
        </template>
      </div>

      <!-- El pase de la cita: se arma mientras eliges. Riel fijo en escritorio,
           barra al pie en móvil. Siempre ocupa su sitio: aparecer no mueve nada. -->
      <aside class="bk-pase" aria-label="Tu cita" aria-live="polite">
        <p class="bk-pase__label">Tu cita</p>
        <div class="bk-pase__body">
          <p v-if="service" class="bk-pase__service">
            {{ service.name }}
            <span class="bk-pase__price">{{ formatMoney(service.price, service.currency) }}</span>
          </p>
          <p class="bk-pase__who">
            <template v-if="attendingProfessional"
              >Con {{ attendingProfessional.fullName }}</template
            >
            <template v-else>Con cualquier {{ v.professional }} libre</template>
          </p>
          <p v-if="pase" class="bk-pase__when">
            <span class="bk-pase__day">{{ pase.dayLong }}</span>
            <span class="bk-pase__time">{{ pase.range }}</span>
          </p>
          <p v-else class="bk-pase__hint">Elige una hora para seguir.</p>
        </div>
        <p v-if="pase" class="bk-pase__compact">
          <span>{{ pase.dayShort }}</span> · <strong>{{ pase.time }}</strong>
        </p>
        <RouterLink v-if="next" :to="next" class="bk-cta">
          <span class="bk-cta__long">Seguir con tus datos</span
          ><span class="bk-cta__short">Seguir</span>
        </RouterLink>
        <span v-else class="bk-cta bk-cta--idle" aria-hidden="true">Elige una hora</span>
      </aside>
    </div>
  </main>
</template>
