<script setup lang="ts">
// Enlace de Odin para cancelar o cambiar la hora (HU-106, DEC-179): el cliente ya dijo
// «sí, es mi turno» por WhatsApp y recibió un código de 6 dígitos; aquí solo lo escribe.
// La pantalla abre directo en el código, sin pedir el contacto, con el mismo lenguaje v2
// que «Encuentra tu turno» (HU-105, DEC-188).
//
// El enlace lleva solo una referencia opaca de un uso: por sí sola no da acceso ni dice de
// quién es el turno. Qué código sirve lo decide el servidor y no lo distingue de «vencido»
// o «ya usado» (CA-106-05); la pantalla solo cuenta los intentos fallidos para ofrecer
// pedir un enlace nuevo en vez de seguir probando. Nada se guarda en el navegador: la
// credencial de 60 minutos viaja únicamente en la ruta del turno, como la del correo.
//
// Issue #647: con el propósito «cancelar» la cancelación se confirma aquí mismo, en el paso
// «Tu turno», en vez de saltar a la pantalla completa de «Mi turno». «Cambiar la hora» sí va a
// su pantalla, que es la que elige el día y la hora.
//
// Issue #651 (DEC-181): Odin ya tiene el teléfono y ya confirmó el turno en el chat, así que
// el paso 01 «Contacto» aparece hecho y la página abre en el 02 «Código». Con el propósito
// `manage` (el que Odin usa por defecto) el paso 03 ofrece las dos acciones y la persona elige.
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BaseAlert, OtpInput } from '@/shared/ui'
import { BookingStateScreen, PublicFrame } from '@/modules/public-booking'
import AppointmentActions from '../components/AppointmentActions.vue'
import { verifyAccessRef } from '../api/verifyAccessRefApi'
import type { AccessPurpose } from '../model/customerAccessOutcome'
import '../styles/myTurnV2.css'

interface Props {
  /** Slug público del negocio (`:slug`). No confiado: el servidor lo resuelve. */
  slug: string
  /** Referencia de un uso del enlace (`:accessRef`). No confiada ni mostrada. */
  accessRef: string
}
const props = defineProps<Props>()
const router = useRouter()

type Step = 'code' | 'manage' | 'opening' | 'business-not-found'

/** Códigos incorrectos que admite el servidor por código (DEC-178). */
const MAX_WRONG_CODES = 5

const step = ref<Step>('code')
const code = ref('')
const codeError = ref('')
const alert = ref<{ variant: 'warning' | 'danger'; text: string } | null>(null)
const submitting = ref(false)
const wrongCodes = ref(0)
const purpose = ref<AccessPurpose | null>(null)
/** Credencial del turno para el paso «Tu turno». */
const accessToken = ref('')
const cancelledHere = ref(false)
/** Qué muestra el paso 03: las dos opciones o la cancelación abierta. */
const actionsMode = ref<'menu' | 'cancel'>('menu')
const manageTitle = computed(() => {
  if (cancelledHere.value) return 'Turno cancelado'
  return actionsMode.value === 'cancel' ? 'Cancelar tu turno' : '¿Qué quieres hacer?'
})

// El contacto lo resolvió Odin en WhatsApp: el paso 01 se muestra hecho.
const STEPS = [
  { id: 1, label: 'Contacto' },
  { id: 2, label: 'Código' },
  { id: 3, label: 'Tu turno' },
]
const stepNumber = computed(() => (step.value === 'code' ? 2 : 3))

const heading = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)

const isLocked = computed(() => wrongCodes.value >= MAX_WRONG_CODES)

async function focusCode() {
  await nextTick()
  root.value?.querySelector<HTMLInputElement>('.otp-input__slots input')?.focus()
}
// Primero el título (lo que un lector de pantalla debe anunciar), luego la primera casilla.
onMounted(async () => {
  await nextTick()
  heading.value?.focus()
})

async function submitCode() {
  if (submitting.value || isLocked.value) return
  alert.value = null
  if (code.value.length !== 6) {
    codeError.value = 'El código tiene 6 dígitos.'
    return
  }
  codeError.value = ''
  submitting.value = true
  const outcome = await verifyAccessRef(props.slug, props.accessRef, code.value)
  submitting.value = false
  switch (outcome.kind) {
    case 'granted':
      purpose.value = outcome.purpose
      // `manage` y `cancel` siguen aquí, en «Tu turno»; `reschedule` va a «Cambiar la hora».
      // `replace` para que «Atrás» no vuelva a un código gastado.
      if (outcome.purpose !== 'reschedule') {
        accessToken.value = outcome.accessToken
        actionsMode.value = outcome.purpose === 'cancel' ? 'cancel' : 'menu'
        step.value = 'manage'
        await nextTick()
        heading.value?.focus()
      } else {
        step.value = 'opening'
        await router.replace({
          name: 'mi-turno-reprogramar',
          params: { token: outcome.accessToken },
        })
      }
      return
    case 'invalid-code':
    case 'invalid-input':
      wrongCodes.value += 1
      code.value = ''
      codeError.value = isLocked.value
        ? 'Ese código ya no sirve. Vuelve a WhatsApp y pide un enlace nuevo.'
        : 'Ese código no es válido o ya venció. Revísalo o pide un enlace nuevo en WhatsApp.'
      if (!isLocked.value) void focusCode()
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
</script>

<template>
  <PublicFrame caption="Mi turno">
    <template v-if="step !== 'business-not-found' && step !== 'opening'" #aside>
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
      v-if="step === 'business-not-found' || step === 'opening'"
      :status="step === 'opening' ? 'loading' : 'not-found'"
      :title="step === 'opening' ? 'Abriendo tu turno' : 'Tu turno'"
      loading-headline="Abriendo tu turno…"
      :not-found="{
        headline: 'No encontramos este enlace',
        body: 'Puede estar incompleto o ya no recibir reservas en línea. Pide un enlace nuevo en WhatsApp.',
      }"
    />

    <main v-else ref="root" class="bk-page mt mt-access">
      <p class="bk-kicker">Tu turno</p>
      <h1 ref="heading" class="bk-title mt__title" tabindex="-1">
        {{ step === 'manage' ? manageTitle : 'Escribe tu código' }}
      </h1>
      <p v-if="step === 'manage' && !cancelledHere" class="mt-access__lead">
        {{
          actionsMode === 'cancel'
            ? 'Confirma la cancelación. Si prefieres otra hora, vuelve a las opciones.'
            : 'Cambia el día o la hora, o cancélalo si ya no puedes ir.'
        }}
      </p>
      <p v-else-if="step === 'code'" class="mt-access__lead">
        Ya confirmamos tu turno por WhatsApp. Te enviamos allí un código de 6 dígitos: escríbelo
        para continuar; vence en 10 minutos.
      </p>

      <AppointmentActions
        v-if="step === 'manage'"
        :token="accessToken"
        :slug="slug"
        :initial-action="purpose === 'cancel' ? 'cancel' : undefined"
        @cancelled="cancelledHere = true"
        @mode-change="actionsMode = $event"
      />

      <BaseAlert
        v-if="alert"
        :variant="alert.variant"
        :role="alert.variant === 'danger' ? 'alert' : 'status'"
      >
        {{ alert.text }}
      </BaseAlert>

      <form
        v-if="step === 'code'"
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

        <button
          type="submit"
          class="bk-cta mt-form__action"
          :disabled="isLocked || submitting"
          :aria-busy="submitting"
        >
          {{ submitting ? 'Comprobando…' : 'Continuar' }}
        </button>

        <p class="mt-form__wait">
          ¿No te llegó? Vuelve a la conversación de WhatsApp y pide otro enlace.
        </p>
      </form>
    </main>
  </PublicFrame>
</template>
