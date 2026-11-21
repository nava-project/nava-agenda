<script setup lang="ts">
// Reto telefónico de HU-007 (DEC-062): se muestra cuando el acceso responde
// 429 (umbral superado). Pide el código de 6 dígitos que el negocio entrega por
// el canal que configuró (correo, WhatsApp o ambos, DEC-139) y,
// al verificarlo, avisa a `LoginPage` para que reintente el acceso — el
// servidor ya limpió el escalamiento de esa IP en la misma verificación, así
// que no hace falta ningún dato adicional para ese reintento.
//
// El mensaje de "código enviado" es deliberadamente genérico (DEC-062, no
// enumeración): nunca afirma que un mensaje real llegó, porque el servidor
// tampoco lo confirma, y tampoco nombra el canal: antes de entrar no se sabe a
// qué negocio pertenece la cuenta y decir «correo» o «teléfono» revelaría su
// configuración o su existencia (DEC-065, DEC-139).
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { BaseButton, OtpInput, ResendDusk } from '@/shared/ui'
import { requestChallenge, verifyChallenge } from '../api/challengeApi'

const RESEND_COOLDOWN_SECONDS = 60

// DEC-081: el backend vigente solo resuelve un canal telefónico. El
// mockup asignado (auth-eventos/README.md, eventos 07-12) representa tres
// variantes de canal; renderizar correo/ambos exigiría configuración,
// contrato o preferencia persistida que no existen hoy, así que esta
// pantalla solo compone la variante real (issue #213, trabajo requerido
// §4). Las variantes restantes quedan registradas como pendientes del
// issue funcional de DEC-081, no implementadas aquí.
const CHANNEL_CHIP = 'Código de verificación'

const props = defineProps<{
  email: string
  /** Por qué aparece el reto y cuánto falta («Demasiados intentos. Podrás…»). */
  notice?: string
  /** Se deshabilitan las acciones mientras el formulario de acceso está
   * reintentando el login tras un reto verificado (evita doble envío). */
  disabled: boolean
}>()

const emit = defineEmits<{
  verified: []
}>()

type RequestPhase = 'idle' | 'requesting' | 'sent' | 'error'
type VerifyPhase = 'idle' | 'verifying' | 'invalid' | 'error'

const requestPhase = ref<RequestPhase>('idle')
const verifyPhase = ref<VerifyPhase>('idle')
const code = ref('')
// Cuenta regresiva visible del cooldown de reenvío (mockups 07-12, mismo
// tratamiento que `RecoveryVerifyStep.vue`: "cuánto falta", no solo un
// botón deshabilitado).
const resendCooldownRemaining = ref(0)
/** Cambia en cada envío para que el atardecer de la espera vuelva a empezar (#751). */
const cooldownRound = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | undefined

const codeDigitsOnly = computed(() => /^[0-9]{6}$/.test(code.value))
const canVerify = computed(
  () => codeDigitsOnly.value && verifyPhase.value !== 'verifying' && !props.disabled,
)
const canRequest = computed(
  () =>
    requestPhase.value !== 'requesting' && resendCooldownRemaining.value <= 0 && !props.disabled,
)

function startResendCooldown() {
  resendCooldownRemaining.value = RESEND_COOLDOWN_SECONDS
  cooldownRound.value += 1
  cooldownTimer = setInterval(() => {
    resendCooldownRemaining.value = Math.max(0, resendCooldownRemaining.value - 1)
    if (resendCooldownRemaining.value === 0 && cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = undefined
    }
  }, 1_000)
}

// El reto aparece tras un 429: el foco va a su título (que describe la espera)
// para que el lector anuncie qué pasó y el siguiente Tab sea «Enviar código».
const titleRef = ref<HTMLElement | null>(null)
onMounted(async () => {
  await nextTick()
  titleRef.value?.focus()
})

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})

async function onRequestCode() {
  if (!canRequest.value) return
  requestPhase.value = 'requesting'

  const outcome = await requestChallenge(props.email)

  // Siempre se trata como "solicitud recibida", incluso ante un error de
  // red o inesperado: reintentar el envío (con el mismo cooldown del
  // servidor) es más seguro que bloquear al profesional en un estado sin
  // salida por un fallo transitorio de nuestro propio resumen de UI.
  requestPhase.value = outcome.kind === 'accepted' ? 'sent' : 'error'

  // Cooldown de cliente (60 s, DEC-062) para que el botón no invite a un
  // reenvío que el servidor descartará en silencio; el servidor sigue
  // siendo la única autoridad real del límite.
  startResendCooldown()
}

async function onVerifyCode() {
  if (!canVerify.value) return
  verifyPhase.value = 'verifying'

  const outcome = await verifyChallenge(props.email, code.value)

  switch (outcome.kind) {
    case 'verified':
      emit('verified')
      return
    case 'invalid-code':
      verifyPhase.value = 'invalid'
      // El mockup de código rechazado conserva las seis ranuras llenas y
      // marcadas en error. No revela la causa (el mensaje sigue uniforme),
      // pero permite revisar visualmente qué código se rechazó.
      return
    default:
      verifyPhase.value = 'error'
  }
}
</script>

<template>
  <div class="phone-challenge">
    <!-- Fase previa a solicitar el código: no representada en los mockups
         asignados (trabajo requerido §4). El porqué del reto lo comunica el
         aviso emergente que emite `LoginPage` (DEC-095, issue #485), no una
         alerta fija; aquí queda solo la acción. -->
    <template v-if="requestPhase === 'idle' || requestPhase === 'error'">
      <!-- Mientras dura el bloqueo, el reto es la salida: lleva título y una
           frase, y «Enviar código» es la única acción llena (issue #714);
           «Iniciar sesión» queda en contorno y deshabilitado. -->
      <span class="phone-challenge__divider" aria-hidden="true"></span>
      <div class="phone-challenge__intro">
        <p v-if="notice" id="phone-challenge-notice" class="phone-challenge__notice">
          {{ notice }}
        </p>
        <h2
          ref="titleRef"
          class="phone-challenge__title"
          tabindex="-1"
          :aria-describedby="notice ? 'phone-challenge-notice' : undefined"
        >
          Confirma que eres tú
        </h2>
        <p class="phone-challenge__lead">
          Te enviaremos un código de 6 dígitos al teléfono de tu cuenta para entrar sin esperar.
        </p>
      </div>
      <BaseButton
        type="button"
        variant="primary"
        size="lg"
        class="phone-challenge__send"
        :disabled="!canRequest"
        @click="onRequestCode"
      >
        Enviar código
      </BaseButton>
    </template>

    <!-- Reto con código ya enviado (mockups 07-12): sección de la misma
         columna, con la regla de latón y rombo, seguida de la línea de
         canal en versalitas y su nota (trabajo requerido §4). -->
    <template v-else>
      <span class="phone-challenge__divider" aria-hidden="true"></span>

      <div class="phone-challenge__channel">
        <p class="phone-challenge__channel-chip">{{ CHANNEL_CHIP }}</p>
        <p class="phone-challenge__channel-note" role="status">
          Si tu cuenta puede continuar, recibirás un código.
        </p>
      </div>

      <OtpInput
        v-model="code"
        label="Código de 6 dígitos"
        :disabled="verifyPhase === 'verifying' || disabled"
        :error="
          verifyPhase === 'invalid'
            ? 'El código no es válido o venció. Inténtalo de nuevo.'
            : undefined
        "
      />

      <div class="phone-challenge__actions">
        <BaseButton
          type="button"
          variant="primary"
          size="md"
          :loading="verifyPhase === 'verifying'"
          :disabled="!canVerify"
          @click="onVerifyCode"
        >
          Verificar código
        </BaseButton>
        <BaseButton
          type="button"
          variant="secondary"
          size="md"
          :disabled="!canRequest"
          @click="onRequestCode"
        >
          <ResendDusk
            v-if="resendCooldownRemaining > 0"
            :key="cooldownRound"
            :total="RESEND_COOLDOWN_SECONDS"
            :remaining="resendCooldownRemaining"
          />
          {{ canRequest ? 'Reenviar código' : `Reenviar en ${resendCooldownRemaining} s` }}
        </BaseButton>
      </div>

      <p v-if="verifyPhase === 'error'" class="phone-challenge__error" role="alert">
        No pudimos verificar el código. Revisa tu conexión e inténtalo de nuevo.
      </p>
    </template>
  </div>
</template>

<style scoped>
/* v2 (DEC-188): un filete sobrio separa el reto del formulario; el canal es un
   rótulo en tipo oración. Acciones y campos de authV2.css. */
.phone-challenge {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-2);
}

.phone-challenge__intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.phone-challenge__notice {
  margin: 0 0 var(--space-2);
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
  color: var(--color-text-primary);
}

.phone-challenge__title {
  margin: 0;
  outline: none;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  color: var(--color-text-primary);
}

.phone-challenge__lead {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

.phone-challenge__send {
  width: 100%;
}

.phone-challenge__divider {
  display: block;
  width: 100%;
  height: 1px;
  margin: var(--space-2) 0;
  background-color: var(--color-border-subtle);
}

.phone-challenge__channel {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.phone-challenge__channel-chip {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  color: var(--color-text-primary);
}

.phone-challenge__channel-note {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

.phone-challenge__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.phone-challenge__error {
  margin: 0;
  font-size: 14px;
  color: var(--color-danger-text);
}
</style>
