<script setup lang="ts">
// Enlace de Odin para cancelar o cambiar la hora (HU-106, DEC-179): el cliente ya dijo
// «sí, es mi turno» por WhatsApp y recibió un código de 6 dígitos; aquí solo lo escribe.
// La pantalla abre directo en el código, sin pedir el contacto, sobre la misma tinta y el
// mismo talón de «Encuentra tu turno» (HU-105). Sin mockup asignado: identidad NAVA /
// Tailored Grid (DEC-078).
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
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BaseAlert, BaseButton, NavaWordmark, OtpInput, PageState } from '@/shared/ui'
import { BookingBackdrop } from '@/modules/public-booking'
import AppointmentActions from '../components/AppointmentActions.vue'
import { verifyAccessRef } from '../api/verifyAccessRefApi'
import type { AccessPurpose } from '../model/customerAccessOutcome'

interface Props {
  /** Slug público de la barbería (`:slug`). No confiado: el servidor lo resuelve. */
  slug: string
  /** Referencia de un uso del enlace (`:accessRef`). No confiada ni mostrada. */
  accessRef: string
}
const props = defineProps<Props>()
const router = useRouter()

type Step = 'code' | 'manage' | 'opening' | 'barbershop-not-found'

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
/** `menu` si la persona volvió a las opciones desde la cancelación. */
const actionsMode = ref<'menu' | 'cancel'>('cancel')
const manageTitle = computed(() => {
  if (cancelledHere.value) return 'Turno cancelado'
  return actionsMode.value === 'cancel' ? 'Cancelar tu turno' : '¿Qué quieres hacer?'
})

const STEPS = [
  { id: 1, label: 'Código' },
  { id: 2, label: 'Tu turno' },
]
const stepNumber = computed(() => (step.value === 'code' ? 1 : 2))

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
      // `cancel` confirma aquí mismo, en «Tu turno»; `reschedule` va a «Cambiar la hora».
      // `replace` para que «Atrás» no vuelva a un código gastado.
      if (outcome.purpose === 'cancel') {
        accessToken.value = outcome.accessToken
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
          >Puede estar incompleto o ya no recibir reservas en línea. Pide un enlace nuevo en
          WhatsApp.</template
        >
      </PageState>
    </main>

    <main v-else-if="step === 'opening'" class="access__main access__main--state">
      <h1 class="visually-hidden">Abriendo tu turno</h1>
      <PageState variant="loading" headline="Abriendo tu turno…" role="status" />
    </main>

    <main v-else class="access__main">
      <ol class="access__steps access__steps--two" aria-label="Pasos para entrar a tu turno">
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
        <h1 ref="heading" class="access__title" tabindex="-1">
          {{ step === 'manage' ? manageTitle : 'Escribe tu código' }}
        </h1>
        <p v-if="step === 'manage' && !cancelledHere" class="access__lead">
          {{
            actionsMode === 'cancel'
              ? 'Confirma la cancelación. Si prefieres otra hora, vuelve a las opciones.'
              : 'Cambia el día o la hora, o cancélalo si ya no puedes venir.'
          }}
        </p>
        <p v-else-if="step === 'code'" class="access__lead">
          Te enviamos un código de 6 dígitos a tu WhatsApp. Escríbelo para continuar; vence en 10
          minutos.
        </p>
      </div>

      <AppointmentActions
        v-if="step === 'manage'"
        :token="accessToken"
        :slug="slug"
        initial-action="cancel"
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

        <BaseButton
          type="submit"
          size="lg"
          :loading="submitting"
          :disabled="isLocked"
          class="stub__action"
        >
          Continuar
        </BaseButton>

        <p class="stub__wait">
          ¿No te llegó? Vuelve a la conversación de WhatsApp y pide otro enlace.
        </p>
      </form>
    </main>
  </div>
</template>

<style scoped src="../styles/customerAccess.css"></style>
