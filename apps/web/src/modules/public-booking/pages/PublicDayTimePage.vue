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
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { formatMoney } from '@/shared/model/money'
import { DAYS_OF_WEEK, clockToMinutes, segmentsByDay } from '@/shared/model/openingHours'
import { ProfessionalAvatar, StarRating } from '@/shared/ui'
import {
  civilDateChip,
  formatCivilDateFull,
  minutesSinceCivilMidnight,
} from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import BookingStateScreen from '../components/BookingStateScreen.vue'
import DaylightStrip from '../components/DaylightStrip.vue'
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
const activeSlotIndex = ref(0)
const firstLoad = ref(true)

let requestToken = 0

async function load() {
  const token = ++requestToken
  screenState.value = { status: 'loading' }
  selected.value = null
  activeDate.value = null

  const [services, professionals, availability] = await Promise.all([
    loadPublicServices(props.slug),
    listPublicProfessionals(props.slug, props.serviceId),
    listPublicServiceAvailability(props.slug, props.serviceId),
    // El horario del local pinta la franja; si falla, la franja usa las horas libres.
    publicProfileFor(props.slug) ? Promise.resolve() : loadPublicProfile(props.slug),
  ])
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

  screenState.value = {
    status: 'success',
    service: services.services.find((s) => s.id === props.serviceId) ?? null,
    professionals: professionals.professionals,
    slots: availability.availability.slots,
    durationMinutes: availability.availability.durationMinutes,
    slotGridMinutes: availability.availability.slotGridMinutes,
    timezone: availability.availability.timezone,
  }
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

const activeDay = computed(() => days.value.find((d) => d.civilDate === activeDate.value) ?? null)
const activeDayIndex = computed(() => days.value.findIndex((d) => d.civilDate === activeDate.value))

// Tramos abiertos del día activo: el horario del local si lo configuró; si
// no, de la primera a la última hora libre más la duración. Nunca se inventa.
const activeOpen = computed(() => {
  const day = activeDay.value
  if (!day) return []
  const segments = publicProfileFor(props.slug)?.openingHours ?? []
  if (segments.length > 0) {
    const [y, m, d] = day.civilDate.split('-').map(Number)
    const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
    const hours = segmentsByDay(segments)[DAYS_OF_WEEK[weekday]!]
    if (hours.length > 0)
      return hours.map((h) => ({
        start: clockToMinutes(h.opens) ?? 0,
        end: clockToMinutes(h.closes) ?? 0,
      }))
  }
  const minutes = day.slots.map((s) => minutesOf(s))
  return [
    {
      start: Math.min(...minutes),
      end: Math.max(...minutes) + (success.value?.durationMinutes ?? 0),
    },
  ]
})

// Tramos libres del día activo: cada inicio cubre un paso de rejilla y los
// contiguos se funden, así la franja dice «aquí hay sitio» sin 40 marcas.
const activeFree = computed(() => {
  const step = success.value?.slotGridMinutes || 15
  const spans: { start: number; end: number }[] = []
  for (const slot of activeDay.value?.slots ?? []) {
    const start = minutesOf(slot)
    const last = spans[spans.length - 1]
    if (last && start <= last.end) last.end = Math.max(last.end, start + step)
    else spans.push({ start, end: start + step })
  }
  return spans
})

function minutesOf(slot: DaylightSlot): number {
  return minutesSinceCivilMidnight(slot.startsAt, activeDate.value ?? '', timezone.value)
}

const selectedMinutes = computed(() =>
  selected.value && activeDay.value?.slots.some((s) => s.startsAt === selected.value!.startsAt)
    ? minutesOf(selected.value)
    : null,
)

const flatSlots = computed(() => activeDay.value?.slots ?? [])

// ── Días ──────────────────────────────────────────────────────────────────
const dayRefs = ref<HTMLElement[]>([])
function setDayRef(el: unknown, index: number) {
  if (el instanceof HTMLElement) dayRefs.value[index] = el
}

async function chooseDay(index: number, focus = false) {
  const day = days.value[index]
  if (!day) return
  activeDate.value = day.civilDate
  const preserved = day.slots.findIndex((s) => s.startsAt === selected.value?.startsAt)
  activeSlotIndex.value = preserved >= 0 ? preserved : 0
  await nextTick()
  const el = dayRefs.value[index]
  el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  if (focus) el?.focus()
}

function onDaysKeydown(event: KeyboardEvent) {
  const last = days.value.length - 1
  const at = activeDayIndex.value
  const target =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? Math.min(last, at + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? Math.max(0, at - 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (target === null) return
  event.preventDefault()
  void chooseDay(target, true)
}

function dayAria(day: DaylightDay): string {
  const n = day.slots.length
  return `${formatCivilDateFull(day.civilDate)}, ${n} ${n === 1 ? 'hora libre' : 'horas libres'}`
}

// ── Horas ─────────────────────────────────────────────────────────────────
const slotRefs = ref<Record<string, HTMLElement>>({})
function setSlotRef(el: unknown, startsAt: string) {
  if (el instanceof HTMLElement) slotRefs.value[startsAt] = el
}

function selectSlot(slot: DaylightSlot) {
  selected.value = slot
  activeSlotIndex.value = flatSlots.value.findIndex((s) => s.startsAt === slot.startsAt)
}

function onSlotsKeydown(event: KeyboardEvent) {
  const count = flatSlots.value.length
  if (count === 0) return
  let next: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
    next = (activeSlotIndex.value + 1) % count
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = (activeSlotIndex.value - 1 + count) % count
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = count - 1
  if (next === null) return
  event.preventDefault()
  activeSlotIndex.value = next
  const slot = flatSlots.value[next]!
  selectSlot(slot)
  slotRefs.value[slot.startsAt]?.focus()
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

// La llegada de esta pantalla (la franja amanece) solo la primera vez.
watch(success, (value) => {
  if (value) void nextTick(() => setTimeout(() => (firstLoad.value = false), 1500))
})
</script>

<template>
  <main v-if="screenState.status === 'loading'" class="bk-page bk-daytime" aria-busy="true">
    <h1 class="pb-sr-only">Cargando las horas libres…</h1>
    <div class="bk-daytime__grid">
      <div class="bk-daytime__main">
        <span class="bk-skel bk-skel--kicker"></span>
        <span class="bk-skel bk-skel--title"></span>
        <span class="bk-skel bk-skel--chips"></span>
        <span class="bk-skel bk-skel--days"></span>
        <span class="bk-skel bk-skel--strip"></span>
        <span class="bk-skel bk-skel--hours"></span>
      </div>
      <div class="bk-pase bk-pase--skeleton" aria-hidden="true"></div>
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

  <main v-else class="bk-page bk-daytime">
    <div class="bk-daytime__grid">
      <div class="bk-daytime__main">
        <p class="bk-kicker">
          <template v-if="service"
            >{{ service.name }} · {{ durationLabel(service.durationMinutes) }}</template
          >
          <template v-else>Tu servicio</template>
        </p>
        <h1 class="bk-title">Elige día y hora</h1>

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

          <div v-else class="bk-chips" role="radiogroup" :aria-label="`Con qué ${v.professional}`">
            <button
              type="button"
              role="radio"
              class="bk-chip"
              :aria-checked="effectiveProfessionalId === null"
              @click="chooseProfessional(null)"
            >
              <svg class="bk-chip__any" viewBox="0 0 28 28" aria-hidden="true">
                <path d="M14 6l3 3-3 3-3-3z M8 13l3 3-3 3-3-3z M20 13l3 3-3 3-3-3z" />
              </svg>
              Cualquiera
            </button>
            <button
              v-for="professional in professionals"
              :key="professional.id"
              type="button"
              role="radio"
              class="bk-chip"
              :aria-checked="effectiveProfessionalId === professional.id"
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
            <h2 class="pb-sr-only">Día</h2>
            <div
              class="bk-days"
              role="radiogroup"
              aria-label="Día"
              :class="{ 'bk-days--arrive': firstLoad }"
              @keydown="onDaysKeydown"
            >
              <button
                v-for="(day, index) in days"
                :key="day.civilDate"
                :ref="(el) => setDayRef(el, index)"
                type="button"
                role="radio"
                class="bk-day"
                :style="{ '--i': index }"
                :aria-checked="day.civilDate === activeDate"
                :aria-label="dayAria(day)"
                :tabindex="day.civilDate === activeDate ? 0 : -1"
                @click="chooseDay(index)"
              >
                <span class="bk-day__weekday">{{ civilDateChip(day.civilDate).weekday }}</span>
                <span class="bk-day__number">{{ civilDateChip(day.civilDate).day }}</span>
                <span class="bk-day__month">{{ civilDateChip(day.civilDate).month }}</span>
                <span class="bk-day__light"
                  ><span :style="{ inlineSize: `${Math.max(8, day.freeRatio * 100)}%` }"></span
                ></span>
              </button>
            </div>

            <template v-if="activeDay">
              <h2 class="bk-day-title">{{ formatCivilDateFull(activeDay.civilDate) }}</h2>
              <DaylightStrip
                class="bk-daytime__strip"
                :open="activeOpen"
                :free="activeFree"
                :selected="selectedMinutes"
                :arrive="firstLoad"
              />

              <div
                :key="activeDay.civilDate"
                class="bk-hours"
                role="radiogroup"
                aria-label="Hora"
                @keydown="onSlotsKeydown"
              >
                <section
                  v-for="group in activeDay.groups"
                  :key="group.part"
                  class="bk-hours__group"
                  :class="`bk-hours__group--${group.part}`"
                  :aria-label="group.label"
                >
                  <h3 class="bk-hours__label">
                    <span class="bk-hours__sky" aria-hidden="true"></span>{{ group.label }}
                  </h3>
                  <div class="bk-hours__pills">
                    <button
                      v-for="slot in group.slots"
                      :key="slot.startsAt"
                      :ref="(el) => setSlotRef(el, slot.startsAt)"
                      type="button"
                      role="radio"
                      class="bk-hour"
                      :aria-checked="selected?.startsAt === slot.startsAt"
                      :aria-label="slot.spokenLabel"
                      :tabindex="flatSlots[activeSlotIndex]?.startsAt === slot.startsAt ? 0 : -1"
                      @click="selectSlot(slot)"
                    >
                      {{ selected?.startsAt === slot.startsAt ? slot.label : slot.shortLabel }}
                    </button>
                  </div>
                </section>
              </div>
            </template>
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
          ><span class="bk-cta__short">Seguir</span> <span aria-hidden="true">→</span>
        </RouterLink>
        <span v-else class="bk-cta bk-cta--idle" aria-hidden="true">Elige una hora</span>
      </aside>
    </div>
  </main>
</template>
