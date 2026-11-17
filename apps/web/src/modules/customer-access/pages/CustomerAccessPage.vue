<script setup lang="ts">
// Acceso al turno con un código de un solo uso (HU-105, DEC-178): para quien no
// tiene el enlace del correo de confirmación. Tres pasos —contacto, código, turno—
// sobre la misma tinta de «Mi turno» y «Cambiar la hora», con el formulario en un
// talón de papel: la persona «presenta su talón» para que le abran el turno.
// Sin mockup asignado: identidad guiada NAVA / Tailored Grid (DEC-078).
//
// La página posee el flujo y los intentos locales. Qué contactos existen, cuántos
// códigos se pueden pedir y si un código sirve lo decide solo el servidor, y nunca
// lo revela: la interfaz no distingue «no existe» de «se envió» (CA-105-01) ni
// «incorrecto» de «vencido» (CA-105-02). El contacto, el código y las credenciales
// viven solo en memoria: nada se guarda en el navegador ni viaja en la URL salvo la
// credencial de 60 minutos de «Cambiar la hora», igual que el enlace del correo.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BaseAlert, BaseButton, BaseInput, NavaWordmark, OtpInput, PageState } from '@/shared/ui'
import { BookingBackdrop } from '@/modules/public-booking'
import { requestAccessCode } from '../api/requestAccessCodeApi'
import { verifyAccessCode } from '../api/verifyAccessCodeApi'
import { formatCountdown, maskContact, waitMinutes, isEmailContact } from '../model/accessContact'
import { calendarLeaf, timezoneCity } from '../model/appointmentMoment'
import { formatTimeInTimezone } from '@/shared/time/formatInstant'
import type { AccessGrant } from '../model/customerAccessOutcome'

interface Props {
  /** Slug público de la barbería (`:slug`). No confiado: el servidor lo resuelve. */
  slug: string
}
const props = defineProps<Props>()
const router = useRouter()

type Step = 'contact' | 'code' | 'choose' | 'opening' | 'barbershop-not-found'

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
    case 'barbershop-not-found':
      step.value = 'barbershop-not-found'
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
      await enter(outcome.grant)
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
    case 'barbershop-not-found':
      step.value = 'barbershop-not-found'
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

/** Un solo turno entra directo a «Mi turno» (ahí se cambia la hora o se cancela); varios se
 * eligen en una lista. */
async function enter(access: AccessGrant) {
  const only = access.appointments[0]
  if (access.appointments.length === 1 && only) {
    step.value = 'opening'
    await router.replace({ name: 'mi-turno', params: { token: only.accessToken } })
    return
  }
  step.value = 'choose'
}

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
    case 'barbershop-not-found':
      step.value = 'barbershop-not-found'
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

/** Hoja de calendario y hora de cada turno, en la zona de la barbería (RN-DIS-07). */
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
  <div ref="root" class="access">
    <BookingBackdrop />

    <header class="access__masthead">
      <NavaWordmark variant="inverted" size="sm" />
      <span class="access__caption">Mi turno</span>
    </header>

    <main v-if="step === 'barbershop-not-found'" class="access__main access__main--state">
      <h1 class="visually-hidden">Tu turno</h1>
      <PageState
        variant="danger"
        status-label="Error"
        headline="No encontramos este enlace"
        role="alert"
      >
        <template #default
          >Puede estar incompleto o ya no recibir reservas en línea. Revisa el enlace que te
          compartieron.</template
        >
      </PageState>
    </main>

    <main v-else-if="step === 'opening'" class="access__main access__main--state">
      <h1 class="visually-hidden">Abriendo tu turno</h1>
      <PageState variant="loading" headline="Abriendo tu turno…" role="status" />
    </main>

    <main v-else class="access__main">
      <ol class="access__steps" aria-label="Pasos para entrar a tu turno">
        <li
          v-for="s in STEPS"
          :key="s.id"
          class="access__step"
          :class="{
            'access__step--done': s.id < stepNumber,
            'access__step--current': s.id === stepNumber,
          }"
          :aria-current="s.id === stepNumber ? 'step' : undefined"
        >
          <span class="access__step-num" aria-hidden="true">{{
            String(s.id).padStart(2, '0')
          }}</span>
          <span class="access__step-label">{{ s.label }}</span>
        </li>
      </ol>

      <div class="access__intro">
        <p class="access__eyebrow">Tu turno</p>
        <h1 ref="heading" class="access__title" tabindex="-1">{{ title }}</h1>
        <p v-if="step === 'contact'" class="access__lead">
          Escribe el correo o el celular con el que reservaste. Te enviamos un código de 6 dígitos
          para entrar.
        </p>
        <p v-else-if="step === 'code'" class="access__lead">
          Si <strong class="access__contact">{{ maskedContact }}</strong> tiene un turno, el código
          va en camino por {{ channelWord }}. Vence en 10 minutos.
        </p>
        <p v-else class="access__lead">
          Tienes {{ choices.length }} turnos próximos. Elige cuál quieres abrir.
        </p>
      </div>

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
        class="stub"
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
        <BaseButton type="submit" size="lg" :loading="submitting" class="stub__action">
          Enviarme el código
        </BaseButton>
      </form>

      <!-- Paso 2: código. -->
      <form
        v-else-if="step === 'code'"
        class="stub"
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

        <p v-if="notice" class="stub__notice" role="status">{{ notice }}</p>

        <BaseButton
          type="submit"
          size="lg"
          :loading="submitting"
          :disabled="isLocked"
          class="stub__action"
        >
          Entrar a mi turno
        </BaseButton>

        <div class="stub__aside">
          <p v-if="!canResend" class="stub__wait" aria-live="off">
            ¿No te llegó? Podrás pedir otro en
            <span class="stub__count">{{ formatCountdown(secondsToResend) }}</span>
          </p>
          <BaseButton v-else variant="ghost" :loading="submitting" @click="resend">
            Pedir otro código
          </BaseButton>
          <BaseButton variant="ghost" @click="changeContact">Cambiar el contacto</BaseButton>
        </div>
      </form>

      <!-- Paso 3: varios turnos. -->
      <ul v-else class="access__list" aria-label="Tus turnos próximos">
        <li v-for="a in choices" :key="a.accessToken">
          <RouterLink class="ticket" :to="{ name: 'mi-turno', params: { token: a.accessToken } }">
            <span class="ticket__leaf" aria-hidden="true">
              <span class="ticket__leaf-month">{{ a.leaf.month }}</span>
              <span class="ticket__leaf-day">{{ a.leaf.day }}</span>
            </span>
            <span class="ticket__body">
              <span class="ticket__when"
                ><span class="ticket__weekday">{{ a.leaf.weekday }}</span> · {{ a.time }}</span
              >
              <span class="ticket__what">{{ a.serviceName }} con {{ a.barberName }}</span>
            </span>
            <span class="ticket__go">Abrir mi turno<span aria-hidden="true"> →</span></span>
          </RouterLink>
        </li>
        <li v-if="zoneCity" class="access__zone">Todas las horas son de {{ zoneCity }}.</li>
      </ul>
    </main>
  </div>
</template>

<style scoped src="../styles/customerAccess.css"></style>
