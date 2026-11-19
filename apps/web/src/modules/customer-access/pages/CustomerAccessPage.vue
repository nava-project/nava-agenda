<script setup lang="ts">
// Acceso al turno con un código de un solo uso (HU-105, DEC-178): para quien no
// tiene el enlace del correo de confirmación. Tres pasos —contacto, código, turno—
// con el lenguaje v2 de la reserva (DEC-188, 2c): los pasos en la cabecera, el
// formulario en una hoja y la acción principal como la única con el acento.
//
// La página posee el flujo y los intentos locales. Qué contactos existen, cuántos
// códigos se pueden pedir y si un código sirve lo decide solo el servidor, y nunca
// lo revela: la interfaz no distingue «no existe» de «se envió» (CA-105-01) ni
// «incorrecto» de «vencido» (CA-105-02). El contacto, el código y las credenciales
// viven solo en memoria: nada se guarda en el navegador ni viaja en la URL salvo la
// credencial de 60 minutos de «Cambiar la hora», igual que el enlace del correo.
//
// Issue #647: el código no saca a la persona del flujo. El paso 03 «Tu turno» muestra el
// turno y las dos acciones a las que vino (cambiar la hora o cancelar) aquí mismo; la
// pantalla completa de «Mi turno» queda como enlace secundario.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BaseAlert, BaseInput, OtpInput } from '@/shared/ui'
import { BookingStateScreen, PublicFrame } from '@/modules/public-booking'
import AppointmentActions from '../components/AppointmentActions.vue'
import { requestAccessCode } from '../api/requestAccessCodeApi'
import { verifyAccessCode } from '../api/verifyAccessCodeApi'
import { formatCountdown, maskContact, waitMinutes, isEmailContact } from '../model/accessContact'
import { calendarLeaf, timezoneCity } from '../model/appointmentMoment'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import type { AccessGrant } from '../model/customerAccessOutcome'
import '../styles/myTurnV2.css'

interface Props {
  /** Slug público del negocio (`:slug`). No confiado: el servidor lo resuelve. */
  slug: string
}
const props = defineProps<Props>()

type Step = 'contact' | 'code' | 'choose' | 'manage' | 'business-not-found'

/** Códigos incorrectos que admite el servidor por código (DEC-178): al llegar aquí la
 * pantalla ofrece pedir uno nuevo en vez de seguir probando. */
const MAX_WRONG_CODES = 5

const step = ref<Step>('contact')
const contact = ref('')
const code = ref('')
const contactError = ref('')
const codeError = ref('')
const alert = ref<{ variant: 'warning' | 'danger'; text: string } | null>(null)
const notice = ref('')
const submitting = ref(false)
const wrongCodes = ref(0)
const grant = ref<AccessGrant | null>(null)
/** Credencial del turno abierto en el paso 03. */
const selectedToken = ref('')
/** El turno abierto en el paso 03 se acaba de cancelar. */
const cancelledHere = ref(false)
const nowMs = ref(Date.now())
/** Instante a partir del cual se ofrece «pedir otro código». */
const resendAt = ref(0)

const heading = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)

let ticker: ReturnType<typeof setInterval> | undefined
function startTicker() {
  stopTicker()
  nowMs.value = Date.now()
  ticker = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
}
function stopTicker() {
  if (ticker !== undefined) clearInterval(ticker)
  ticker = undefined
}
onBeforeUnmount(stopTicker)

const isLocked = computed(() => wrongCodes.value >= MAX_WRONG_CODES)
const secondsToResend = computed(() =>
  Math.max(0, Math.ceil((resendAt.value - nowMs.value) / 1000)),
)
const canResend = computed(() => isLocked.value || secondsToResend.value === 0)
const channelWord = computed(() => (isEmailContact(contact.value) ? 'correo' : 'WhatsApp'))
const maskedContact = computed(() => maskContact(contact.value))
/** Canal que se deduce de lo escrito, para anticipar por dónde llegará el código (#649). */
const channelPreview = computed<'correo' | 'WhatsApp' | ''>(() => {
  const value = contact.value.trim()
  if (!value) return ''
  return isEmailContact(value) ? 'correo' : 'WhatsApp'
})
const stepNumber = computed(() => (step.value === 'contact' ? 1 : step.value === 'code' ? 2 : 3))

const STEPS = [
  { id: 1, label: 'Contacto' },
  { id: 2, label: 'Código' },
  { id: 3, label: 'Tu turno' },
]

const title = computed(() => {
  switch (step.value) {
    case 'contact':
      return 'Encuentra tu turno'
    case 'code':
      return 'Escribe tu código'
    case 'manage':
      return cancelledHere.value ? 'Turno cancelado' : '¿Qué quieres hacer?'
    default:
      return 'Elige tu turno'
  }
})

/** Mueve el foco al paso nuevo: el título (o la primera casilla del código). */
async function focusStep() {
  await nextTick()
  if (step.value === 'code') {
    root.value?.querySelector<HTMLInputElement>('.otp-input__slots input')?.focus()
    return
  }
  heading.value?.focus()
}

// Al llegar desde el enlace de la entrada pública el título recibe el foco, como en cada paso.
onMounted(() => void focusStep())

watch(step, () => {
  void focusStep()
  if (step.value === 'code') startTicker()
  else stopTicker()
})

async function submitContact() {
  if (submitting.value) return
  contactError.value = ''
  alert.value = null
  if (!contact.value.trim()) {
    contactError.value = 'Escribe tu correo o tu celular.'
    return
  }
  submitting.value = true
  const outcome = await requestAccessCode(props.slug, contact.value.trim())
  submitting.value = false
  switch (outcome.kind) {
    case 'sent':
      resetCodeEntry()
      resendAt.value = Date.now() + outcome.resendAfterSeconds * 1000
      step.value = 'code'
      return
    case 'invalid-contact':
      contactError.value = 'Escribe un correo o un celular válido.'
      return
    case 'rate-limited':
      alert.value = {
        variant: 'warning',
        text: `Pediste demasiados códigos. Vuelve a intentarlo en ${waitMinutes(outcome.retryAfterSeconds)} min.`,
      }
      return
    case 'business-not-found':
      step.value = 'business-not-found'
      return
    case 'network-error':
      alert.value = {
        variant: 'warning',
        text: 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
      }
      return
    default:
      alert.value = {
        variant: 'danger',
        text: outcome.requestId
          ? `Ocurrió un error inesperado. Código de soporte: ${outcome.requestId}`
          : 'Ocurrió un error inesperado. Inténtalo de nuevo.',
      }
  }
}

function resetCodeEntry() {
  code.value = ''
  codeError.value = ''
  wrongCodes.value = 0
}

async function submitCode() {
  if (submitting.value || isLocked.value) return
  alert.value = null
  notice.value = ''
  if (code.value.length !== 6) {
    codeError.value = 'El código tiene 6 dígitos.'
    return
  }
  codeError.value = ''
  submitting.value = true
  const outcome = await verifyAccessCode(props.slug, contact.value.trim(), code.value)
  submitting.value = false
  switch (outcome.kind) {
    case 'granted':
      grant.value = outcome.grant
      enter(outcome.grant)
      return
    case 'invalid-code':
    case 'invalid-contact':
      wrongCodes.value += 1
      code.value = ''
      codeError.value = isLocked.value
        ? 'Ese código ya no sirve. Pide uno nuevo para seguir.'
        : 'Ese código no es válido o ya venció. Revísalo o pide uno nuevo.'
      if (!isLocked.value) void focusStep()
      return
    case 'business-not-found':
      step.value = 'business-not-found'
      return
    case 'network-error':
      alert.value = {
        variant: 'warning',
        text: 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
      }
      return
    default:
      alert.value = {
        variant: 'danger',
        text: outcome.requestId
          ? `Ocurrió un error inesperado. Código de soporte: ${outcome.requestId}`
          : 'Ocurrió un error inesperado. Inténtalo de nuevo.',
      }
  }
}

/** Un solo turno abre directo sus acciones en el paso 03; varios se eligen antes en una
 * lista, también dentro del paso 03. */
function enter(access: AccessGrant) {
  const only = access.appointments[0]
  if (access.appointments.length === 1 && only) {
    openAppointment(only.accessToken)
    return
  }
  step.value = 'choose'
}

function openAppointment(token: string) {
  selectedToken.value = token
  cancelledHere.value = false
  step.value = 'manage'
}

const hasSeveral = computed(() => (grant.value?.appointments.length ?? 0) > 1)

async function resend() {
  if (submitting.value || !canResend.value) return
  alert.value = null
  submitting.value = true
  const outcome = await requestAccessCode(props.slug, contact.value.trim())
  submitting.value = false
  switch (outcome.kind) {
    case 'sent':
      resetCodeEntry()
      resendAt.value = Date.now() + outcome.resendAfterSeconds * 1000
      nowMs.value = Date.now()
      notice.value = `Te enviamos otro código por ${channelWord.value}.`
      void focusStep()
      return
    case 'rate-limited':
      resendAt.value = Date.now() + outcome.retryAfterSeconds * 1000
      nowMs.value = Date.now()
      alert.value = {
        variant: 'warning',
        text: `Pediste demasiados códigos. Vuelve a intentarlo en ${waitMinutes(outcome.retryAfterSeconds)} min.`,
      }
      return
    case 'business-not-found':
      step.value = 'business-not-found'
      return
    case 'network-error':
      alert.value = {
        variant: 'warning',
        text: 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
      }
      return
    default:
      alert.value = { variant: 'danger', text: 'Ocurrió un error inesperado. Inténtalo de nuevo.' }
  }
}

function changeContact() {
  resetCodeEntry()
  alert.value = null
  notice.value = ''
  step.value = 'contact'
}

/** Hoja de calendario y hora de cada turno, en la zona del negocio (RN-DIS-07). */
const choices = computed(() => {
  const access = grant.value
  if (!access) return []
  return access.appointments.map((a) => ({
    ...a,
    leaf: calendarLeaf(a.startsAt, access.timezone),
    time: formatTimeInTimezone(a.startsAt, access.timezone),
  }))
})
const zoneCity = computed(() => (grant.value ? timezoneCity(grant.value.timezone) : ''))
</script>

<template>
  <PublicFrame caption="Mi turno">
    <template v-if="step !== 'business-not-found'" #aside>
      <ol class="bk-steps" aria-label="Pasos para entrar a tu turno">
        <li
          v-for="s in STEPS"
          :key="s.id"
          class="bk-steps__item access__step"
          :class="{
            'bk-steps__item--done': s.id < stepNumber,
            'bk-steps__item--current': s.id === stepNumber,
          }"
          :aria-current="s.id === stepNumber ? 'step' : undefined"
        >
          <span class="bk-steps__mark" aria-hidden="true"></span>
          <span class="bk-steps__label">{{ s.label }}</span>
          <span v-if="s.id < stepNumber" class="visually-hidden"> (completado)</span>
        </li>
      </ol>
    </template>

    <BookingStateScreen
      v-if="step === 'business-not-found'"
      status="not-found"
      title="Tu turno"
      loading-headline=""
      :not-found="{
        headline: 'No encontramos este enlace',
        body: 'Puede estar incompleto o ya no recibir reservas en línea. Revisa el enlace que te compartieron.',
      }"
    />

    <main v-else ref="root" class="bk-page mt mt-access">
      <p class="bk-kicker">Tu turno</p>
      <h1 ref="heading" class="bk-title mt__title" tabindex="-1">{{ title }}</h1>
      <p v-if="step === 'contact'" class="mt-access__lead">
        Escribe el correo o el celular con el que reservaste. Te enviamos un código de 6 dígitos
        para entrar.
      </p>
      <p v-else-if="step === 'code'" class="mt-access__lead">
        Si <strong>{{ maskedContact }}</strong> tiene un turno, el código va en camino por
        {{ channelWord }}. Vence en 10 minutos.
      </p>
      <p v-else-if="step === 'manage' && !cancelledHere" class="mt-access__lead">
        Cambia el día o la hora, o cancélalo si ya no puedes ir.
      </p>
      <p v-else-if="step === 'choose'" class="mt-access__lead">
        Tienes {{ choices.length }} turnos próximos. Elige cuál quieres abrir.
      </p>

      <BaseAlert
        v-if="alert"
        :variant="alert.variant"
        :role="alert.variant === 'danger' ? 'alert' : 'status'"
      >
        {{ alert.text }}
      </BaseAlert>

      <!-- Paso 1: contacto. -->
      <form
        v-if="step === 'contact'"
        class="bk-sheet mt-form"
        novalidate
        aria-label="Buscar tu turno"
        @submit.prevent="submitContact"
      >
        <BaseInput
          v-model="contact"
          label="Correo o celular"
          name="contact"
          type="text"
          autocomplete="email"
          :error="contactError"
          hint="El mismo con el que hiciste la reserva."
          placeholder="ana@correo.com o 300 123 4567"
        />
        <!-- Por dónde llega el código: se adivina del contacto, sin pedirlo aparte. -->
        <div class="stub__channel mt-channel">
          <span class="mt-channel__label" aria-hidden="true">Te llega por</span>
          <span
            class="stub__chip mt-channel__chip"
            :class="{ 'stub__chip--on': channelPreview === 'correo' }"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
              <path d="M4 7l8 6 8-6" />
            </svg>
            Correo
          </span>
          <span
            class="stub__chip mt-channel__chip"
            :class="{ 'stub__chip--on': channelPreview === 'WhatsApp' }"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18.3L5 19z" />
            </svg>
            WhatsApp
          </span>
          <span class="visually-hidden" aria-live="polite">{{
            channelPreview ? `El código te llegará por ${channelPreview}.` : ''
          }}</span>
        </div>
        <button
          type="submit"
          class="bk-cta mt-form__action"
          :disabled="submitting"
          :aria-busy="submitting"
        >
          {{ submitting ? 'Enviando…' : 'Enviarme el código' }}
        </button>
      </form>

      <!-- Paso 2: código. -->
      <form
        v-else-if="step === 'code'"
        class="bk-sheet mt-form"
        novalidate
        aria-label="Escribir el código"
        @submit.prevent="submitCode"
      >
        <OtpInput
          v-model="code"
          label="Código de 6 dígitos"
          name="code"
          :error="codeError"
          :disabled="isLocked || submitting"
          @complete="submitCode"
        />

        <p v-if="notice" class="mt-form__notice" role="status">{{ notice }}</p>

        <button
          type="submit"
          class="bk-cta mt-form__action"
          :disabled="isLocked || submitting"
          :aria-busy="submitting"
        >
          {{ submitting ? 'Comprobando…' : 'Entrar a mi turno' }}
        </button>

        <div class="mt-form__aside">
          <p v-if="!canResend" class="mt-form__wait" aria-live="off">
            ¿No te llegó? Podrás pedir otro en
            <span class="mt-form__count">{{ formatCountdown(secondsToResend) }}</span>
          </p>
          <button v-else type="button" class="bk-link" :disabled="submitting" @click="resend">
            Pedir otro código
          </button>
          <button type="button" class="bk-link" @click="changeContact">Cambiar el contacto</button>
        </div>
      </form>

      <!-- Paso 3: el turno y sus acciones, sin salir de la página (#647). -->
      <template v-else-if="step === 'manage'">
        <button
          v-if="hasSeveral"
          type="button"
          class="bk-link mt-access__back"
          @click="step = 'choose'"
        >
          Elegir otro turno
        </button>
        <AppointmentActions :token="selectedToken" :slug="slug" @cancelled="cancelledHere = true" />
      </template>

      <!-- Paso 3 con varios turnos: primero se elige cuál. -->
      <ul v-else class="mt-choices" aria-label="Tus turnos próximos">
        <li v-for="a in choices" :key="a.accessToken">
          <button type="button" class="ticket mt-choice" @click="openAppointment(a.accessToken)">
            <span class="mt-choice__when"
              >{{ a.leaf.weekday }} {{ a.leaf.day }} {{ a.leaf.month }} · {{ a.time }}</span
            >
            <span class="mt-choice__what">{{ a.serviceName }} con {{ a.professionalName }}</span>
            <span class="mt-choice__go" aria-hidden="true">Abrir</span>
          </button>
        </li>
        <li v-if="zoneCity" class="mt-choices__zone">Todas las horas son de {{ zoneCity }}.</li>
      </ul>
    </main>
  </PublicFrame>
</template>
