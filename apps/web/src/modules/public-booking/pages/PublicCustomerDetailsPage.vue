<script setup lang="ts">
// Página de captura de datos del cliente y persona atendida (HU-096,
// CA-096-01 a CA-096-06) y confirmación pública concurrente (HU-097,
// CA-097-01 a CA-097-07). Sin mockup asignado: composición libre dentro de
// NAVA / Tailored Grid (DEC-078), alojada en el cascarón de la reserva
// pública (DEC-111): lo que se rellena vive en una hoja de papel marfil
// sobre el lienzo de tinta. Valida/normaliza en el cliente con las
// mismas reglas que el backend aplicará (identity.go), conserva los datos
// ante un error de validación o conflicto (CA-096-03, CA-097-03) y resuelve
// `attendeeName` sin pedirlo dos veces cuando el cliente reserva para sí
// mismo (CA-096-01, RN-RES-02).
import { computed, nextTick, onMounted, reactive, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ProfessionalAvatar,
  BaseAlert,
  BaseButton,
  BaseDialog,
  BaseInput,
  PhoneField,
} from '@/shared/ui'
import type { LatLng } from '@/shared/model/mapPicker'
import { isPlacesAvailable, type PlaceSelection } from '@/shared/model/placesAutocomplete'
import { clockToMinutes, DAYS_OF_WEEK, segmentsByDay } from '@/shared/model/openingHours'
import {
  formatCivilDateFull,
  getCivilDateInTimezone,
  minutesSinceCivilMidnight,
} from '@/shared/time/civilDate'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import { composeHomeAddress } from '../model/homeAddress'
import {
  buildCalendarFile,
  directionsLink,
  downloadCalendarFile,
  whatsAppLink,
} from '../model/calendarFile'
import {
  confirmedVisitKey,
  readConfirmedVisit,
  saveConfirmedVisit,
  toConfirmedVisit,
  type ConfirmedVisit,
} from '../model/confirmedVisit'
import DaylightStrip from '../components/DaylightStrip.vue'
import type { PublicBusinessProfile } from '../model/businessProfileOutcome'
import HomeLocationField from '../components/HomeLocationField.vue'
import { confirmPublicAppointment } from '../api/confirmPublicAppointmentApi'
import { listPublicProfessionals } from '../api/listPublicProfessionalsApi'
import { useBookingChrome } from '../model/bookingChrome'
import { newIdempotencyKey } from '../model/idempotencyKey'
import { loadPublicProfile } from '../model/publicProfile'
import type { PublicProfessional } from '../model/publicProfessionalListOutcome'
import { publicProfessionalPhotoUrl } from '../model/publicProfessionalPhotoUrl'
import { DEFAULT_PHONE_COUNTRY, composePhone, phoneCountry } from '@/shared/model/phoneCountries'
import { usePublicVocabulary } from '../model/publicVocabulary'
import type { PublicAppointmentAlternative } from '../model/confirmPublicAppointmentOutcome'
import {
  ATTENDEE_NAME_MAX_LENGTH,
  CUSTOMER_NOTE_MAX_LENGTH,
  validateAttendeeName,
  validateCustomerEmail,
  validateCustomerFullName,
  validateCustomerNote,
  validateCustomerPhoneParts,
} from '../validation/customerIdentityValidation'

interface Props {
  /** Identificador del enlace público, tal como llega del parámetro de ruta
   * `:slug`. */
  slug: string
  /** Servicio ya elegido (HU-091). */
  serviceId: string
  /** Profesional ya elegido (HU-092). */
  professionalId: string
  /** Franja ya elegida (HU-095), instante ISO absoluto. El servidor la
   * revalida por completo al confirmar (CA-097-02); esta página solo la
   * conserva y la envía tal cual. */
  startsAt: string
  /** El profesional lo asignó «Cualquiera» (DEC-188): al cambiar de hora se
   * vuelve a Cualquiera y no a este profesional. */
  anyProfessional?: boolean
  /** La URL lleva `?confirmado=1`: el turno ya se reservó en esta pestaña y se
   * redibuja la confirmación, nunca el formulario (evita reservar dos veces). */
  confirmed?: boolean
}
const props = withDefaults(defineProps<Props>(), { anyProfessional: false, confirmed: false })
const v = usePublicVocabulary()
const router = useRouter()
// Único por instancia: el diálogo vive en el <body> y no debe repetir ids.
const conflictAltsLabelId = `pb-conflict-alts-${useId()}`

// El cascarón dibuja el progreso: al confirmar, se completa.
const chrome = useBookingChrome()

type AttendeeChoice = 'self' | 'other'

const attendeeChoice = ref<AttendeeChoice>('self')
const fullName = ref('')
// El prefijo vive en su propia casilla; al API viaja el E.164 compuesto.
const phoneCountryIso = ref(DEFAULT_PHONE_COUNTRY)
const phoneNational = ref('')
const phone = computed(() => composePhone(phoneCountryIso.value, phoneNational.value))
const email = ref('')
const note = ref('')
const attendeeName = ref('')

// El profesional elegido, para mostrarlo en el resumen con su foto. La página puede
// abrirse directamente desde un enlace, así que se busca por id en la lista
// pública del servicio. Es solo presentación: si no llega, el resumen sigue
// siendo completo (el servidor valida el profesional al confirmar).
const professional = ref<PublicProfessional | null>(null)
onMounted(async () => {
  const outcome = await listPublicProfessionals(props.slug, props.serviceId)
  if (outcome.kind === 'success') {
    professional.value =
      outcome.professionals.find((item) => item.id === props.professionalId) ?? null
  }
})

// Servicio a domicilio (DEC-131, HU-103): el paso solo existe si el negocio lo ofrece Y hay
// forma de marcar un punto en este entorno (mapa con clave, o el simulado en desarrollo). Se lee fresco al
// abrir la página; el servidor lo revalida al confirmar (CA-103-05), así que un valor viejo
// aquí solo produciría un 422 explicado, nunca un turno equivocado.
type ServiceMode = 'local' | 'home'
const offersHomeService = ref(false)
const serviceMode = ref<ServiceMode>('local')
const homePlace = ref<PlaceSelection | null>(null)
// Torre, apartamento o referencia que escribe el cliente (DEC-155); opcional.
const homeDetails = ref('')
// Dónde abre el mapa de «a domicilio»: el negocio, si publicó su ubicación (DEC-138).
const homeMapStart = ref<LatLng | null>(null)
const businessProfile = ref<PublicBusinessProfile | null>(null)
onMounted(async () => {
  const outcome = await loadPublicProfile(props.slug)
  if (outcome.kind === 'success') {
    businessProfile.value = outcome.profile
    offersHomeService.value = outcome.profile.offersHomeService && isPlacesAvailable()
    const where = outcome.profile.location
    homeMapStart.value = where ? { latitude: where.latitude, longitude: where.longitude } : null
  }
})
// Sin la opción visible, el turno siempre es en el local aunque el estado local diga otra cosa.
const isHomeService = computed(() => offersHomeService.value && serviceMode.value === 'home')

const attempted = ref(false)
const reviewing = ref(false)

// selectedStartsAt permite reintentar con una alternativa (RN-CON-05,
// DEC-090) sin recargar la página ni perder el resto del formulario.
const selectedStartsAt = ref(props.startsAt)

type ConfirmState = 'idle' | 'submitting' | 'confirmed' | 'schedule-conflict' | 'error'
const confirmState = ref<ConfirmState>('idle')
// Sin la credencial del turno (DEC-089): solo lo que la confirmación dibuja.
const confirmedAppointment = ref<ConfirmedVisit | null>(null)
const alternatives = ref<PublicAppointmentAlternative[]>([])
const errorMessage = ref('')
// El servidor las entrega por cercanía; al cliente le sirven en orden de reloj.
const sortedAlternatives = computed(() =>
  [...alternatives.value].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
)
// idempotencyKey se conserva mientras el reintento es la MISMA solicitud
// (red/error inesperado, RN-IDE-01): un contenido distinto (editar, elegir
// otra alternativa) siempre pide una clave nueva.
const idempotencyKey = ref<string | null>(null)

// Recarga de la confirmación: se redibuja con lo guardado en esta pestaña. Si no
// quedó nada (otra pestaña, almacenamiento bloqueado), igual se dice que el turno
// ya está reservado y no se ofrece el formulario.
if (props.confirmed) {
  confirmedAppointment.value = readConfirmedVisit(
    confirmedVisitKey(props.slug, props.serviceId, props.professionalId, props.startsAt),
  )
  reviewing.value = true
  confirmState.value = 'confirmed'
  chrome.completed.value = true
}

const formRef = ref<HTMLElement | null>(null)
const summaryRef = ref<HTMLElement | null>(null)
const actionsRef = ref<HTMLElement | null>(null)
const confirmedRef = ref<HTMLElement | null>(null)

const fieldErrors = computed(() => ({
  fullName: validateCustomerFullName(fullName.value),
  phone: validateCustomerPhoneParts(phoneCountry(phoneCountryIso.value).dial, phoneNational.value),
  email: validateCustomerEmail(email.value),
  note: validateCustomerNote(note.value),
  attendeeName:
    attendeeChoice.value === 'other' ? validateAttendeeName(attendeeName.value) : undefined,
  // DEC-155: marcar el punto es obligatorio (mapa o «Usar mi ubicación»); los detalles de la
  // dirección son opcionales y no lo reemplazan.
  home:
    isHomeService.value && !homePlace.value
      ? 'Marca tu ubicación en el mapa o usa el botón «Usar mi ubicación» para continuar.'
      : undefined,
}))

// Validación al salir del campo (DEC-188): un campo con algo escrito se revisa
// cuando el cliente lo deja, y su mensaje va debajo. Un campo vacío no regaña
// solo por pasar por él con Tab: eso lo dice «Ver resumen». Lo escrito nunca se
// borra. Una vez visible, el mensaje sigue la escritura y se va al corregir.
type FieldKey = keyof typeof fieldErrors.value
const touched = reactive<Partial<Record<FieldKey, boolean>>>({})
function leave(field: FieldKey, value: string) {
  if (value.trim() !== '') touched[field] = true
}
function shown(field: FieldKey): string | undefined {
  return attempted.value || touched[field] ? fieldErrors.value[field] : undefined
}

const hasErrors = computed(() => Object.values(fieldErrors.value).some((message) => !!message))

// CA-096-01: para sí mismo, el nombre atendido se deriva del cliente sin
// pedirlo dos veces.
const resolvedAttendeeName = computed(() =>
  attendeeChoice.value === 'self' ? fullName.value.trim() : attendeeName.value.trim(),
)

async function handleSubmit() {
  attempted.value = true
  if (hasErrors.value) {
    await nextTick()
    const firstErrorField = document.querySelector<HTMLElement>('[aria-invalid="true"]')
    firstErrorField?.focus()
    return
  }
  reviewing.value = true
  await nextTick()
  summaryRef.value?.focus()
}

// Tras un fallo el botón se había deshabilitado y el foco cayó al <body>; además, en móvil el
// aviso entra bajo el borde de la ventana y empuja los botones fuera de ella. Se devuelve el
// foco a «Confirmar turno» (reintento por teclado) y se lleva a la vista aviso y botones.
watch(confirmState, async (state) => {
  if (state !== 'error') return
  await nextTick()
  actionsRef.value
    ?.querySelector<HTMLElement>('button:last-of-type')
    ?.focus({ preventScroll: true })
  actionsRef.value?.scrollIntoView?.({ block: 'end' })
})

async function editAgain() {
  reviewing.value = false
  confirmState.value = 'idle'
  alternatives.value = []
  errorMessage.value = ''
  idempotencyKey.value = null
  await nextTick()
  formRef.value?.querySelector<HTMLElement>('input, textarea')?.focus()
}

// Fecha larga y hora por separado: el resumen da a la hora el protagonismo.
// Se dicen en la zona del NEGOCIO (RN-DIS-07), como en «Día y hora»; mientras
// el perfil no llega, en la del navegador.
const zone = computed(() => businessProfile.value?.timezone)

function formatLocalDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CO', { dateStyle: 'full', timeZone: zone.value })
  } catch {
    return iso
  }
}

function formatLocalDayShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: zone.value,
    })
  } catch {
    return iso
  }
}

function formatLocalTime(iso: string): string {
  if (zone.value) return formatTimeInTimezone(iso, zone.value)
  try {
    return new Date(iso).toLocaleTimeString('es-CO', { timeStyle: 'short' })
  } catch {
    return ''
  }
}

function formatMoney(amount: string, currency: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${amount} ${currency}`
  }
}

// ── Confirmado: el pase se agenda (DEC-188) ───────────────────────────────
// Fechas y horas en la zona del NEGOCIO (RN-DIS-07), como en «Día y hora».
const done = computed(() => {
  const a = confirmedAppointment.value
  if (!a) return null
  const civilDate = getCivilDateInTimezone(a.timezone, new Date(a.startsAt))
  const start = formatTimeInTimezone(a.startsAt, a.timezone)
  const end = formatTimeInTimezone(a.endsAt, a.timezone)
  const minutes = minutesSinceCivilMidnight(a.startsAt, civilDate, a.timezone)
  // La franja del día del turno, con el horario que el local publicó.
  const [y, m, d] = civilDate.split('-').map(Number)
  const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
  const hours = segmentsByDay(businessProfile.value?.openingHours ?? [])[DAYS_OF_WEEK[weekday]!]
  // Sin horario publicado no se dibuja franja: no se inventa un horario.
  const open =
    hours && hours.length > 0
      ? hours.map((h) => ({
          start: clockToMinutes(h.opens) ?? 0,
          end: clockToMinutes(h.closes) ?? 0,
        }))
      : null
  return {
    day: formatCivilDateFull(civilDate),
    range: `${start} – ${end}`,
    start,
    minutes,
    open,
  }
})

const whatsApp = computed(() => {
  const a = confirmedAppointment.value
  if (!a || !done.value) return null
  return whatsAppLink(
    businessProfile.value?.contactPhone,
    // La frase no termina en la hora: «9:15 a. m.» ya trae su punto.
    `Hola, reservé ${a.serviceName} a las ${done.value.start} del ${done.value.day}.`,
  )
})

// Dónde es el turno, bajo la hora: el domicilio o la dirección del local con «Cómo llegar».
const place = computed<{ text: string; href: string | null } | null>(() => {
  const a = confirmedAppointment.value
  if (!a) return null
  if (a.homeAddress) return { text: a.homeAddress, href: null }
  const where = businessProfile.value?.location
  return where
    ? { text: where.address, href: directionsLink(where.latitude, where.longitude) }
    : null
})

const calendarSaved = ref(false)
function addToCalendar() {
  const a = confirmedAppointment.value
  if (!a) return
  const where = place.value?.text ?? null
  const who = professional.value ? ` con ${professional.value.fullName}` : ''
  downloadCalendarFile(
    buildCalendarFile({
      uid: `${a.startsAt}-${props.serviceId}-${props.professionalId}@agenda.nava.wtf`,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      summary: `${a.serviceName}, ${a.businessName}`,
      location: where,
      description: `${a.serviceName}${who}. El enlace para consultar o cambiar tu turno está en tu correo.`,
    }),
  )
  calendarSaved.value = true
}

// CA-097-07: bloquea doble toque (confirmState guarda 'submitting' hasta
// que el intento termina) y conserva los datos del formulario en
// cualquier desenlace (nunca se limpian fuera de 'confirmed').
async function handleConfirm() {
  if (confirmState.value === 'submitting') return

  if (!idempotencyKey.value) {
    idempotencyKey.value = newIdempotencyKey()
  }

  confirmState.value = 'submitting'
  errorMessage.value = ''

  const outcome = await confirmPublicAppointment(
    props.slug,
    props.serviceId,
    props.professionalId,
    {
      startsAt: selectedStartsAt.value,
      fullName: fullName.value.trim(),
      phone: phone.value,
      email: email.value.trim(),
      note: note.value.trim() || null,
      forSomeoneElse: attendeeChoice.value === 'other',
      attendeeName: attendeeChoice.value === 'other' ? attendeeName.value.trim() : null,
      homeService:
        isHomeService.value && homePlace.value
          ? {
              address: composeHomeAddress(homePlace.value.address, homeDetails.value),
              latitude: homePlace.value.latitude,
              longitude: homePlace.value.longitude,
            }
          : null,
    },
    idempotencyKey.value,
  )

  switch (outcome.kind) {
    case 'success': {
      const visit = toConfirmedVisit(
        outcome.appointment,
        attendeeChoice.value === 'other',
        isHomeService.value && homePlace.value
          ? composeHomeAddress(homePlace.value.address, homeDetails.value)
          : null,
      )
      confirmedAppointment.value = visit
      confirmState.value = 'confirmed'
      chrome.completed.value = true
      idempotencyKey.value = null
      // La URL pasa a ser la de la confirmación (replace: «Atrás» sigue llevando a
      // «Día y hora»). Recargar ya no ofrece el formulario de una hora reservada.
      saveConfirmedVisit(
        confirmedVisitKey(
          props.slug,
          props.serviceId,
          props.professionalId,
          selectedStartsAt.value,
        ),
        visit,
      )
      void router.replace({
        name: 'reserva-publica-cliente',
        params: {
          slug: props.slug,
          serviceId: props.serviceId,
          professionalId: props.professionalId,
          startsAt: selectedStartsAt.value,
        },
        query: { ...(props.anyProfessional ? { cualquiera: '1' } : {}), confirmado: '1' },
      })
      await nextTick()
      confirmedRef.value?.focus()
      return
    }
    case 'schedule-conflict':
      alternatives.value = outcome.alternatives
      confirmState.value = 'schedule-conflict'
      idempotencyKey.value = null
      return
    case 'not-found':
      errorMessage.value =
        'Este enlace de reserva ya no está disponible. Vuelve a intentarlo desde el inicio.'
      confirmState.value = 'error'
      idempotencyKey.value = null
      return
    case 'validation-error':
      errorMessage.value = outcome.detail
      confirmState.value = 'error'
      idempotencyKey.value = null
      return
    case 'idempotency-conflict':
      errorMessage.value = 'Hubo un problema al procesar tu confirmación. Intenta de nuevo.'
      confirmState.value = 'error'
      idempotencyKey.value = null
      return
    case 'network-error':
      errorMessage.value =
        'No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.'
      confirmState.value = 'error'
      return
    case 'unexpected-error':
      errorMessage.value = 'Ocurrió un error inesperado. Intenta de nuevo.'
      confirmState.value = 'error'
      return
  }
}

// El conflicto obliga a editar el turno: o se elige una de las horas libres
// cercanas (el resumen se actualiza y hay que volver a confirmar) o se vuelve
// al calendario. Los datos del formulario siguen en esta página mientras tanto.
function pickAnotherSlot() {
  // Con «Cualquiera» se vuelve a Cualquiera; si no, al profesional elegido.
  void router.push({
    name: 'reserva-publica-horario',
    params: { slug: props.slug, serviceId: props.serviceId },
    query: props.anyProfessional ? {} : { profesional: props.professionalId },
  })
}

function chooseAlternative(startsAt: string) {
  selectedStartsAt.value = startsAt
  alternatives.value = []
  confirmState.value = 'idle'
  idempotencyKey.value = null
}
</script>

<template>
  <main class="bk-page bk-details" :class="{ 'bk-details--done': confirmState === 'confirmed' }">
    <!-- v2 (DEC-188): página de documento, sin región con desplazamiento propio:
         los campos caben enteros y el navegador desplaza. Este comentario va
         dentro de <main>: un solo elemento raíz, que el cascarón anima con
         <Transition mode="out-in">. -->
    <p class="bk-kicker">
      {{
        confirmState === 'confirmed'
          ? 'Reserva confirmada'
          : reviewing
            ? 'Última revisión'
            : 'Paso 3 de 3'
      }}
    </p>
    <h1 class="bk-title">
      {{ confirmState === 'confirmed' ? 'Tu turno quedó agendado' : 'Tus datos' }}
    </h1>

    <section
      class="bk-sheet customer-details"
      :class="{ 'customer-details--ticket': confirmState === 'confirmed' }"
    >
      <form
        v-if="!reviewing"
        ref="formRef"
        class="bk-sheet__form customer-details__rise"
        novalidate
        @submit.prevent="handleSubmit"
      >
        <!-- Los campos viven en su propia región: con poco alto es lo único que
             se desplaza y el botón de enviar queda siempre a la vista. -->
        <div class="customer-details__fields">
          <fieldset class="customer-details__fieldset customer-details__span">
            <legend class="customer-details__legend">¿Para quién es el turno?</legend>
            <div
              class="customer-details__radio-group"
              role="radiogroup"
              aria-label="¿Para quién es el turno?"
            >
              <label class="customer-details__radio">
                <input v-model="attendeeChoice" type="radio" name="attendee-choice" value="self" />
                <span>Para mí</span>
              </label>
              <label class="customer-details__radio">
                <input v-model="attendeeChoice" type="radio" name="attendee-choice" value="other" />
                <span>Para otra persona</span>
              </label>
            </div>
          </fieldset>

          <fieldset
            v-if="offersHomeService"
            class="customer-details__fieldset customer-details__span"
          >
            <legend class="customer-details__legend">¿Dónde te atendemos?</legend>
            <div
              class="customer-details__radio-group"
              role="radiogroup"
              aria-label="¿Dónde te atendemos?"
            >
              <label class="customer-details__radio">
                <input v-model="serviceMode" type="radio" name="service-mode" value="local" />
                <span>En el local</span>
              </label>
              <label class="customer-details__radio">
                <input v-model="serviceMode" type="radio" name="service-mode" value="home" />
                <span>A domicilio</span>
              </label>
            </div>
            <HomeLocationField
              v-if="serviceMode === 'home'"
              v-model="homePlace"
              v-model:details="homeDetails"
              class="customer-details__address customer-details__rise"
              :start="homeMapStart"
              :error="shown('home')"
            />
          </fieldset>

          <BaseInput
            v-model="fullName"
            :class="{ 'customer-details__span': attendeeChoice === 'self' }"
            type="text"
            label="Tu nombre"
            autocomplete="name"
            required
            :error="shown('fullName')"
            @blur="leave('fullName', fullName)"
          />

          <BaseInput
            v-if="attendeeChoice === 'other'"
            v-model="attendeeName"
            class="customer-details__rise"
            type="text"
            label="Nombre de la persona atendida"
            autocomplete="off"
            required
            :maxlength="ATTENDEE_NAME_MAX_LENGTH"
            :error="shown('attendeeName')"
            @blur="leave('attendeeName', attendeeName)"
          />

          <PhoneField
            v-model:country="phoneCountryIso"
            v-model:national="phoneNational"
            required
            :error="shown('phone')"
            @blur="leave('phone', phoneNational)"
          />

          <BaseInput
            v-model="email"
            type="email"
            label="Correo"
            autocomplete="email"
            required
            :error="shown('email')"
            @blur="leave('email', email)"
          />

          <div class="customer-details__field customer-details__span">
            <label for="customer-details-note" class="customer-details__label"
              >Nota (opcional)</label
            >
            <textarea
              id="customer-details-note"
              v-model="note"
              class="customer-details__textarea"
              rows="3"
              :aria-invalid="!!shown('note')"
              :aria-describedby="
                shown('note') ? 'customer-details-note-error' : 'customer-details-note-counter'
              "
              @blur="leave('note', note)"
            />
            <div class="customer-details__field-foot">
              <span
                v-if="shown('note')"
                id="customer-details-note-error"
                class="customer-details__error"
                role="alert"
              >
                {{ shown('note') }}
              </span>
              <span v-else />
              <span id="customer-details-note-counter" class="customer-details__counter">
                {{ note.length }}/{{ CUSTOMER_NOTE_MAX_LENGTH }}
              </span>
            </div>
          </div>
        </div>

        <BaseButton type="submit" variant="primary" size="lg" class="customer-details__submit"
          >Ver resumen</BaseButton
        >
      </form>

      <!-- Resumen y confirmación real (HU-096/HU-097, CA-097-07): exige
           confirmación explícita antes de reservar (RN-DIS-03), nunca
           insinúa que el turno ya quedó reservado hasta que el servidor lo
           confirme. -->
      <div
        v-else-if="confirmState !== 'confirmed'"
        ref="summaryRef"
        class="customer-details__summary customer-details__rise"
        role="status"
        tabindex="-1"
      >
        <h2 class="bk-section-title">Revisa tus datos</h2>

        <!-- La cita es lo que el cliente viene a comprobar: va arriba, grande,
             como el talón de un turno. -->
        <div class="customer-details__when">
          <span class="customer-details__when-label">Tu turno</span>
          <span class="customer-details__when-time">{{ formatLocalTime(selectedStartsAt) }}</span>
          <span class="customer-details__when-day">{{ formatLocalDay(selectedStartsAt) }}</span>
          <span v-if="professional" class="customer-details__who">
            <ProfessionalAvatar
              size="row"
              :full-name="professional.fullName"
              :photo-url="publicProfessionalPhotoUrl(slug, professional)"
            />
            <span class="customer-details__who-text">
              <span class="customer-details__when-label">{{ v.Professional }}</span>
              <span class="customer-details__who-name">{{ professional.fullName }}</span>
            </span>
          </span>
        </div>

        <!-- Región desplazable: con poco alto es lo único que se mueve y los
             botones quedan siempre a la vista. -->
        <!-- Foco y nombre: con la dirección a domicilio la región puede desbordar y, sin
             contenido enfocable dentro, el teclado no podría desplazarla. -->
        <div
          class="customer-details__summary-body"
          tabindex="0"
          role="region"
          aria-label="Resumen del turno"
        >
          <dl class="customer-details__summary-list">
            <div class="customer-details__summary-row">
              <dt>Cliente</dt>
              <dd>{{ fullName }}</dd>
            </div>
            <!-- Solo cuando el turno es de otra persona: para uno mismo repetiría
               el nombre del cliente. -->
            <div v-if="attendeeChoice === 'other'" class="customer-details__summary-row">
              <dt>Turno para</dt>
              <dd>{{ resolvedAttendeeName }}</dd>
            </div>
            <div class="customer-details__summary-row">
              <dt>Teléfono</dt>
              <dd>{{ phoneCountry(phoneCountryIso).dial }} {{ phoneNational }}</dd>
            </div>
            <div class="customer-details__summary-row">
              <dt>Correo</dt>
              <dd>{{ email }}</dd>
            </div>
            <div v-if="isHomeService && homePlace" class="customer-details__summary-row">
              <dt>Te atendemos en</dt>
              <dd>{{ composeHomeAddress(homePlace.address, homeDetails) }}</dd>
            </div>
            <div v-if="note.trim()" class="customer-details__summary-row">
              <dt>Nota</dt>
              <dd>{{ note }}</dd>
            </div>
          </dl>

          <!-- DEC-122: si el negocio publica su agenda en Google Calendar, Google invita al
             cliente al turno en el correo que dio. El aviso es condicional porque esta
             pantalla no sabe si el negocio lo usa; nunca promete una invitación. -->
          <p class="customer-details__invite-note">
            Si el negocio usa Google Calendar, recibirás una invitación a este turno en
            <strong>{{ email }}</strong
            >.
          </p>
        </div>

        <!-- Fuera de la región desplazable: dentro, el aviso quedaba bajo su borde
             visible y quien confirmó solo veía el botón activo de nuevo (F-RQ-01, #429). -->
        <BaseAlert v-if="confirmState === 'error'" variant="danger" role="alert">
          {{ errorMessage }}
        </BaseAlert>

        <div ref="actionsRef" class="customer-details__actions">
          <BaseButton
            type="button"
            variant="secondary"
            size="lg"
            :disabled="confirmState === 'submitting'"
            @click="editAgain"
          >
            Editar
          </BaseButton>
          <BaseButton
            type="button"
            variant="primary"
            size="lg"
            :loading="confirmState === 'submitting'"
            @click="handleConfirm"
          >
            Confirmar turno
          </BaseButton>
        </div>
      </div>

      <!-- Confirmación real del servidor (CA-097-01, CA-097-07): el correo
           con el enlace de acceso ya se envió; el token en claro solo
           existe en esta respuesta (DEC-089), nunca se vuelve a mostrar ni
           se dibuja aquí. Se presenta como un boleto de turno. -->
      <div
        v-else
        ref="confirmedRef"
        class="customer-details__confirmed bk-done"
        role="status"
        tabindex="-1"
      >
        <template v-if="confirmedAppointment && done">
          <!-- El pase de la cita, el mismo que se armó en «Día y hora»: ahora
               se agenda y cae en su franja del día (destello Sol). -->
          <article class="bk-done__pase">
            <p class="bk-done__business">{{ confirmedAppointment.businessName }}</p>
            <p class="bk-done__service">
              {{ confirmedAppointment.serviceName }}
              <span class="bk-done__price">{{
                formatMoney(confirmedAppointment.priceAmount, confirmedAppointment.currency)
              }}</span>
            </p>
            <p v-if="professional" class="bk-done__who">Con {{ professional.fullName }}</p>
            <p v-if="confirmedAppointment.forSomeoneElse" class="bk-done__who">
              Turno para {{ confirmedAppointment.attendeeName }}
            </p>
            <p class="bk-done__when">
              <span class="bk-done__day">{{ done.day }}</span>
              <span class="bk-done__time">{{ done.range }}</span>
            </p>
            <p v-if="place" class="bk-done__place">
              {{ place.text }}
              <template v-if="place.href">
                ·
                <a :href="place.href" target="_blank" rel="noopener noreferrer"
                  >Cómo llegar<span class="pb-sr-only"> (se abre en otra pestaña)</span></a
                >
              </template>
            </p>
          </article>

          <DaylightStrip
            v-if="done.open"
            class="bk-done__strip"
            :open="done.open"
            :selected="done.minutes"
            land
          />

          <div class="bk-done__actions">
            <button type="button" class="bk-cta bk-done__calendar" @click="addToCalendar">
              {{ calendarSaved ? 'Descargado: ábrelo para añadirlo' : 'Añadir a mi calendario' }}
            </button>
            <a
              v-if="whatsApp"
              class="bk-done__whatsapp"
              :href="whatsApp"
              target="_blank"
              rel="noopener noreferrer"
              >Abrir en WhatsApp<span class="pb-sr-only"> (se abre en otra pestaña)</span></a
            >
          </div>
        </template>

        <p v-else class="bk-done__again">
          Este turno ya quedó reservado: no hace falta reservarlo otra vez.
        </p>

        <p class="customer-details__note">
          <template v-if="email">
            Te enviamos un correo a <strong>{{ email }}</strong> con el enlace para consultar o
            cambiar tu turno cuando quieras.
          </template>
          <template v-else>
            En tu correo está el enlace para consultar o cambiar tu turno cuando quieras.
          </template>
        </p>
      </div>
    </section>

    <!-- Horario ocupado: un diálogo modal y sin salida lateral (ni Escape ni
         clic fuera), para que el cliente no confirme sin haber revisado el
         nuevo turno. -->
    <BaseDialog
      :model-value="confirmState === 'schedule-conflict'"
      title="Ese horario se acaba de ocupar"
      size="sm"
      content-class="pb-conflict-dialog"
      :close-on-backdrop="false"
      :close-on-escape="false"
      :show-close="false"
    >
      <template #icon>
        <span class="pb-conflict__mark" aria-hidden="true">!</span>
      </template>

      <p class="pb-conflict__lead">
        Las <strong>{{ formatLocalTime(selectedStartsAt) }}</strong> del
        <strong>{{ formatLocalDay(selectedStartsAt) }}</strong> ya no están disponibles. Elige otra
        hora para seguir con tu turno.
      </p>

      <template v-if="alternatives.length > 0">
        <p :id="conflictAltsLabelId" class="pb-conflict__label">Estas horas siguen libres</p>
        <ul class="pb-conflict__alts" :aria-labelledby="conflictAltsLabelId">
          <li v-for="alt in sortedAlternatives" :key="alt.startsAt">
            <button type="button" class="pb-conflict__alt" @click="chooseAlternative(alt.startsAt)">
              <span class="pb-conflict__alt-time">{{ formatLocalTime(alt.startsAt) }}</span>
              <span class="pb-conflict__alt-day">{{ formatLocalDayShort(alt.startsAt) }}</span>
            </button>
          </li>
        </ul>
      </template>
      <p v-else class="pb-conflict__lead">
        No quedan horarios libres cerca de ese. Elige otro día en el calendario.
      </p>

      <template #footer>
        <BaseButton
          type="button"
          :variant="alternatives.length > 0 ? 'secondary' : 'primary'"
          @click="pickAnotherSlot"
        >
          Elegir otro horario
        </BaseButton>
      </template>
    </BaseDialog>
  </main>
</template>

<style scoped>
/* Todo lo que sigue vive sobre el panel de tinta levantada (`.pb-sheet`), el
   mismo lienzo de las demás pantallas de la reserva: los campos, el resumen
   y la confirmación se recomponen con los tokens de tinta y latón. `BaseInput`
   y `BaseButton` se pensaron para superficies claras, así que aquí se les
   ajustan sus variables y colores sin tocar el componente compartido. */
/* v2 (DEC-188): sin entrada escalonada. Los campos son usables desde el primer
   cuadro; la hoja solo aparece con un fundido corto (opacidad, 180 ms). */
.customer-details__rise {
  animation: bk-fundido 180ms ease-out both;
}

@keyframes bk-fundido {
  from {
    opacity: 0;
  }
}

.customer-details__fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5) var(--space-4);
}

@media (min-width: 560px) {
  .customer-details__fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .customer-details__span {
    grid-column: 1 / -1;
  }
}

.customer-details__fieldset {
  min-width: 0;
  padding: 0;
  margin: 0;
  border: none;
}

/* Rótulo reglado: versalitas de latón, el mismo de BaseInput. */
.customer-details__legend,
.customer-details__label {
  padding: 0;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0;
  color: var(--pb-brass);
}

.customer-details__legend {
  margin: 0 0 var(--space-2);
}

/* ── Campos de BaseInput sobre tinta ───────────────────────────────────── */

.customer-details :deep(.base-input) {
  --input-bg: var(--color-surface);
  --input-border-color: var(--pb-line-strong);
  --input-border-base-color: color-mix(in srgb, var(--pb-brass) 75%, transparent);
  /* La reserva conserva su línea base de 2 px del color del negocio; el
     campo compartido v2 la tiene de 1 px y neutra (DEC-188, entrega 5). */
  border-bottom-width: var(--border-width-emphasis);
  --input-focus-ring:
    0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--pb-brass),
    0 0 22px color-mix(in srgb, var(--pb-brass) 35%, transparent);

  color: var(--pb-text);
}

.customer-details :deep(.base-input::placeholder) {
  color: var(--pb-muted);
  opacity: 1;
}

.customer-details :deep(.base-input:hover:not(:disabled):not(.base-input--invalid)) {
  background-color: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  border-color: color-mix(in srgb, var(--pb-brass) 60%, transparent);
  border-bottom-color: var(--pb-brass);
}

.customer-details :deep(.base-input:focus-visible) {
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, var(--color-surface));
  border-color: var(--pb-brass);
  border-bottom-color: var(--pb-brass);
}

.customer-details :deep(.base-input:-webkit-autofill),
.customer-details :deep(.base-input:-webkit-autofill:hover),
.customer-details :deep(.base-input:-webkit-autofill:focus) {
  -webkit-text-fill-color: var(--pb-text);
  caret-color: var(--pb-text);
}

.customer-details :deep(.base-input__label) {
  letter-spacing: 0;
  color: var(--pb-brass);
}

.customer-details :deep(.base-input__required) {
  color: var(--color-danger-on-strong);
}

.customer-details :deep(.base-input--invalid),
.customer-details :deep(.base-input--invalid:hover) {
  border-color: var(--color-danger-on-strong);
  border-bottom-color: var(--color-danger-on-strong);
}

.customer-details :deep(.base-input--invalid:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-danger-on-strong);
}

.customer-details :deep(.base-input__hint) {
  color: var(--pb-muted);
}

.customer-details :deep(.base-input__error),
.customer-details__error {
  color: var(--color-danger-on-strong);
}

/* «Para mí / Para otra persona» como control segmentado. El `<input>` nativo
   sigue siendo el control (foco, flechas, formulario); solo se oculta su
   caja y la etiqueta hace de segmento. */
.customer-details__radio-group {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: var(--space-2);
}

.customer-details__radio {
  position: relative;
  display: flex;
  min-height: var(--control-height);
  cursor: pointer;
}

.customer-details__radio input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  opacity: 0;
}

.customer-details__radio span {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-4);
  font-size: var(--font-size-body);
  font-weight: 500;
  color: var(--pb-text);
  text-align: center;
  background-color: transparent;
  border: var(--border-width-normal) solid var(--pb-line-strong);
  border-bottom: var(--border-width-emphasis) solid var(--pb-line-strong);
  border-radius: 2px;
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard),
    color var(--motion-duration-base) var(--motion-easing-standard),
    transform var(--motion-duration-base) var(--pb-ease, ease);
}

.customer-details__radio:hover input:not(:checked) + span {
  background-color: var(--pb-wash);
  border-color: var(--pb-brass);
  transform: translateY(-1px);
}

.customer-details__radio input:checked + span {
  font-weight: 600;
  color: var(--pb-on-brass);
  background-color: var(--pb-brass);
  border-color: var(--pb-brass);
  border-bottom-color: color-mix(in srgb, var(--pb-brass) 70%, #000);
}

/* El segmento elegido también lleva un rombo: no depende solo del relleno. */
.customer-details__radio input:checked + span::before {
  content: '';
  width: 7px;
  height: 7px;
  margin-right: var(--space-2);
  background-color: var(--pb-on-brass);
  transform: rotate(45deg);
}

.customer-details__radio input:focus-visible + span {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--pb-brass);
}

.customer-details__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Área de nota: el mismo campo reglado que BaseInput (recuesto oscuro, filete
   perimetral y línea base de latón de 2px). */
.customer-details__textarea {
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: var(--font-size-body-line);
  color: var(--pb-text);
  height: calc(var(--font-size-body-line) * 3 + var(--space-3) * 2);
  resize: none;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--pb-line-strong);
  border-bottom: var(--border-width-emphasis) solid
    color-mix(in srgb, var(--pb-brass) 75%, transparent);
  border-radius: var(--radius-md);
  outline: none;
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.customer-details__textarea:hover {
  background-color: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  border-color: color-mix(in srgb, var(--pb-brass) 60%, transparent);
  border-bottom-color: var(--pb-brass);
}

.customer-details__textarea:focus-visible {
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, var(--color-surface));
  border-color: var(--pb-brass);
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--pb-brass),
    0 0 22px color-mix(in srgb, var(--pb-brass) 35%, transparent);
}

.customer-details__textarea[aria-invalid='true'] {
  border-color: var(--color-danger-on-strong);
  border-bottom-color: var(--color-danger-on-strong);
}

.customer-details__field-foot {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
}

.customer-details__counter {
  color: var(--pb-muted);
}

/* ── Botones de BaseButton en latón sobre tinta ────────────────────────── */

.customer-details :deep(.base-button) {
  font-weight: 600;
}

.customer-details :deep(.base-button--primary) {
  color: var(--pb-on-brass);
  background-color: var(--pb-brass);
  border-color: var(--pb-brass);
  border-bottom-width: var(--border-width-emphasis);
  border-bottom-color: color-mix(in srgb, var(--pb-brass) 70%, #000);
}

.customer-details :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--pb-brass) 86%, #fff);
  border-color: color-mix(in srgb, var(--pb-brass) 86%, #fff);
  border-bottom-color: color-mix(in srgb, var(--pb-brass) 70%, #000);
  box-shadow: 0 10px 24px -12px color-mix(in srgb, var(--pb-brass) 70%, transparent);
}

.customer-details :deep(.base-button--primary:active:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--pb-brass) 88%, #000);
  border-color: color-mix(in srgb, var(--pb-brass) 88%, #000);
}

.customer-details :deep(.base-button--secondary),
.customer-details :deep(.base-button--soft) {
  color: var(--pb-brass);
  background-color: transparent;
  border-color: var(--pb-brass);
  border-bottom-width: var(--border-width-emphasis);
}

.customer-details :deep(.base-button--secondary:hover:not(:disabled):not(.base-button--loading)),
.customer-details :deep(.base-button--soft:hover:not(:disabled):not(.base-button--loading)) {
  background-color: var(--pb-wash-strong);
  border-color: var(--pb-brass);
}

.customer-details :deep(.base-button--secondary:active:not(:disabled):not(.base-button--loading)),
.customer-details :deep(.base-button--soft:active:not(:disabled):not(.base-button--loading)) {
  background-color: var(--pb-wash-strong);
}

.customer-details :deep(.base-button:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-on-strong);
}

.customer-details__submit {
  flex: none;
  width: 100%;
  margin-top: var(--space-2);
}

.customer-details__summary,
.customer-details__confirmed {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  outline: none;
}

.customer-details__summary-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.customer-details__summary .bk-section-title {
  margin-bottom: 0;
}

/* Talón del turno: hora en grande sobre la fecha, con filete de latón. */
.customer-details__when {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-5);
  background-image: linear-gradient(
    to right,
    color-mix(in srgb, var(--pb-brass) 12%, transparent),
    transparent 80%
  );
  border: 1px solid var(--pb-line);
  border-left: 3px solid var(--pb-brass);
  border-radius: 2px;
}

.customer-details__when-label {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0;
  color: var(--pb-brass);
}

/* Cifras en la sans: la serif de títulos dibuja el 1 como una «l». */
.customer-details__when-time {
  font-family: var(--font-sans);
  font-size: 36px;
  font-weight: 500;
  line-height: 44px;
  font-variant-numeric: tabular-nums;
  color: var(--pb-text);
}

.customer-details__when-day {
  color: var(--pb-soft);
}

/* El día llega en minúscula («viernes, 30 de octubre…»): solo la inicial. */
.customer-details__when-day::first-letter {
}

/* Profesional elegido: retrato y nombre al pie del talón, separados por un filete. */
.customer-details__who {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding-top: var(--space-3);
  margin-top: var(--space-2);
  border-top: 1px solid var(--pb-line);
}

/* En ancho, el profesional pasa a la derecha del talón: la hora y él se leen a la
   vez y la hoja gana alto para los datos. */
@media (min-width: 560px) {
  .customer-details__when {
    grid-template-columns: 1fr auto;
    column-gap: var(--space-6);
  }

  .customer-details__when > :not(.customer-details__who) {
    grid-column: 1;
  }

  .customer-details__who {
    grid-row: 1 / span 3;
    grid-column: 2;
    align-self: center;
    padding: 0 0 0 var(--space-6);
    margin: 0;
    border-top: 0;
    border-left: 1px solid var(--pb-line);
  }
}

.customer-details__who-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.customer-details__who-name {
  overflow-wrap: anywhere;
  font-weight: 500;
  color: var(--pb-text);
}

.customer-details__summary-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  border-top: 1px solid var(--pb-line-strong);
}

.customer-details__invite-note {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--pb-muted);
  overflow-wrap: anywhere;
}

.customer-details__summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-6);
  justify-content: space-between;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--pb-line);
}

.customer-details__summary-row dt {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: 0;
  color: var(--pb-brass);
}

.customer-details__summary-row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--pb-text);
  text-align: right;
}

/* Avisos (error y conflicto): los pinta BaseAlert con su lienzo de tinta
   (DEC-149); aquí no se redefine ningún color. */

.customer-details__actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-3);
}

.customer-details__actions :deep(.base-button) {
  width: 100%;
}

@media (min-width: 480px) {
  .customer-details__actions {
    grid-template-columns: 1fr 1.6fr;
  }
}

.customer-details__note {
  max-width: 46ch;
  margin: 0;
  color: var(--pb-soft);
  text-align: center;
  overflow-wrap: anywhere;
}

.customer-details__note strong {
  font-weight: 600;
  color: var(--pb-text);
}

/* ── Confirmado: el pase se agenda (DEC-188) ────────────────────────────── */

.bk-sheet.customer-details--ticket {
  padding: 0;
  background: none;
  border: 0;
  box-shadow: none;
}

.customer-details--ticket::before {
  display: none;
}

.bk-done {
  gap: var(--space-5);
}

/* El mismo pase de «Día y hora», ahora con su hora fija. */
.bk-done__pase {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-5);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  animation: bk-se-agenda 620ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.bk-done__pase p {
  margin: 0;
}

.bk-done__business {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.bk-done__service {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  font-size: 18px;
  font-weight: 600;
}

.bk-done__price {
  font-variant-numeric: tabular-nums;
}

.bk-done__who {
  font-size: 15px;
  color: var(--color-text-secondary);
}

.bk-done__when {
  display: grid;
  gap: 2px;
  padding-top: var(--space-3);
  margin-top: var(--space-1);
  border-top: 1px solid var(--color-border-subtle);
}

.bk-done__day {
  font-size: 15px;
}

.bk-done__day::first-letter {
  text-transform: uppercase;
}

.bk-done__time {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

.bk-done__place {
  font-size: 15px;
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
}

/* Como los demás enlaces de la reserva: texto principal, subrayado en el acento. */
.bk-done__place a {
  font-weight: 500;
  color: var(--color-text-primary);
  text-decoration-color: var(--bk-accent, var(--color-brand-accent-surface));
  text-underline-offset: 3px;
}

.bk-done__again {
  font-size: 17px;
  font-weight: 500;
}

.bk-done__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.bk-done__calendar {
  flex: 1 1 220px;
}

.bk-done__whatsapp {
  display: inline-flex;
  flex: 1 1 180px;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 var(--space-5);
  font-weight: 600;
  color: var(--color-text-primary);
  text-decoration: none;
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-pill);
}

.bk-done__whatsapp:hover {
  border-color: var(--color-text-primary);
}

/* El pase baja a su sitio: transform y opacidad, nada más. */
@keyframes bk-se-agenda {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .customer-details__rise,
  .customer-details__fields > *,
  .customer-details__submit,
  .customer-details__summary-row,
  .bk-done__pase,
  .customer-details__radio input:checked + span::before {
    animation: none;
  }

  .customer-details__radio span,
  .customer-details__textarea {
    transition: none;
  }

  .customer-details__radio:hover input:not(:checked) + span {
    transform: none;
  }
}
</style>
