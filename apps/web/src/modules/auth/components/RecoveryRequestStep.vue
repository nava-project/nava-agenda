<script setup lang="ts">
// Paso 1/3 de HU-011: solicitar el código de recuperación eligiendo el
// canal (DEC-092). Dos botones —Teléfono y Correo—; hasta elegir uno no hay
// campo ni envío. Al elegir, un mensaje menciona únicamente ese canal y se
// pide su valor (número o correo), que solo identifica la cuenta: el código
// llega al contacto verificado que el servidor ya tiene (DEC-093).
// Dueño de su propio envío (mismo patrón que `PhoneChallengeForm.vue`):
// valida en cliente, llama al API real y decide cuándo avanzar al paso 2. Un
// 202 (DEC-065, no enumeración) siempre avanza; un fallo de transporte real
// (red o 5xx) no revela nada sobre la cuenta, así que sí se distingue con
// un error accionable (a diferencia del "siempre avanzar" de
// `PhoneChallengeForm`, que ahí es correcto porque ese reto ya está detrás
// de un intento de acceso autenticable).
import { computed, reactive, ref } from 'vue'
import { BaseButton, BaseInput, PhoneField } from '@/shared/ui'
import { DEFAULT_PHONE_COUNTRY, composePhone } from '@/shared/model/phoneCountries'
import { requestRecovery } from '../api/recoveryApi'
import { notifyConnectionLost, notifyUnexpectedError } from '../model/authFeedback'
import type { RecoveryChannel, RecoveryTarget } from '../model/recoveryTarget'
import {
  normalizeRecoveryPhone,
  validateRecoveryEmail,
  validateRecoveryPhone,
} from '../validation/recoveryValidation'

const emit = defineEmits<{
  advance: [payload: { target: RecoveryTarget }]
}>()

const CHANNELS: { value: RecoveryChannel; label: string }[] = [
  // El literal "whatsapp" pertenece al contrato API vigente; la interfaz se
  // mantiene agnóstica al proveedor y lo presenta como teléfono.
  { value: 'whatsapp', label: 'Teléfono' },
  { value: 'email', label: 'Correo' },
]

// Nada elegido al entrar: ni campo ni acción de envío hasta que la persona
// decide el canal (CA-011-09).
const channel = ref<RecoveryChannel | null>(null)
// Lo escrito en cada canal se conserva al alternar entre ellos.
const values = reactive<Record<RecoveryChannel, string>>({ whatsapp: '', email: '' })
// El teléfono se escribe con el prefijo en su propia casilla (`PhoneField`);
// `values.whatsapp` conserva el E.164 compuesto, que es lo que valida y envía.
const phoneCountryIso = ref(DEFAULT_PHONE_COUNTRY)
const phoneNational = ref('')
const fieldError = ref<string | undefined>(undefined)
const attemptedSubmit = ref(false)
const status = ref<'idle' | 'submitting'>('idle')

const isSubmitting = computed(() => status.value === 'submitting')

function validateCurrent(): string | undefined {
  if (channel.value === 'whatsapp') return validateRecoveryPhone(values.whatsapp)
  if (channel.value === 'email') return validateRecoveryEmail(values.email)
  return undefined
}

function chooseChannel(next: RecoveryChannel) {
  if (isSubmitting.value || channel.value === next) return
  channel.value = next
  // Cambiar de canal descarta el error y el aviso del canal anterior: ya no
  // describen el campo que se ve. El foco se queda en el botón pulsado
  // (CA-011-10); el mensaje nuevo se anuncia por su región `aria-live`.
  attemptedSubmit.value = false
  fieldError.value = undefined
  status.value = 'idle'
}

const handleInput = (value: string | number) => {
  if (!channel.value) return
  values[channel.value] = String(value)
  if (attemptedSubmit.value) {
    fieldError.value = validateCurrent()
  }
}

function syncPhone() {
  handleInput(
    phoneNational.value === '' ? '' : composePhone(phoneCountryIso.value, phoneNational.value),
  )
}

function onPhoneCountry(iso: string) {
  phoneCountryIso.value = iso
  syncPhone()
}

function onPhoneNational(national: string) {
  phoneNational.value = national
  syncPhone()
}

async function onSubmit() {
  if (isSubmitting.value || !channel.value) return

  attemptedSubmit.value = true
  const error = validateCurrent()
  fieldError.value = error
  if (error) return

  const target: RecoveryTarget =
    channel.value === 'whatsapp'
      ? { channel: 'whatsapp', value: normalizeRecoveryPhone(values.whatsapp) }
      : { channel: 'email', value: values.email.trim() }

  status.value = 'submitting'
  const outcome = await requestRecovery(target)

  switch (outcome.kind) {
    case 'accepted':
      emit('advance', { target })
      return
    case 'network-error':
      status.value = 'idle'
      notifyConnectionLost(() => void onSubmit())
      return
    case 'unexpected-error':
      status.value = 'idle'
      notifyUnexpectedError(outcome.requestId)
  }
}
</script>

<template>
  <form class="recovery-request" novalidate @submit.prevent="onSubmit">
    <div class="recovery-request__group" role="group" aria-labelledby="recovery-channel-label">
      <p id="recovery-channel-label" class="recovery-request__group-label">Recibir código por</p>
      <div class="recovery-request__choices">
        <button
          v-for="option in CHANNELS"
          :key="option.value"
          type="button"
          class="recovery-channel"
          :class="{ 'recovery-channel--selected': channel === option.value }"
          :aria-pressed="channel === option.value"
          :disabled="isSubmitting"
          @click="chooseChannel(option.value)"
        >
          <svg
            v-if="option.value === 'whatsapp'"
            class="recovery-channel__icon"
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="7" y="2.5" width="10" height="19" rx="2" />
            <path d="M10.5 18.5h3" />
          </svg>
          <svg
            v-else
            class="recovery-channel__icon"
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
          </svg>
          <span class="recovery-channel__label">{{ option.label }}</span>
          <!-- Señal distinta del color para el canal elegido (CA-011-09). -->
          <svg
            v-if="channel === option.value"
            class="recovery-channel__check"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path class="recovery-channel__check-ring" d="M12 2 L22 12 L12 22 L2 12 Z" />
            <path class="recovery-channel__check-tick" d="M7.8 12.4l3 3 5.4-6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Región `aria-live`: al elegir un canal el mensaje nuevo sustituye al
         anterior y se anuncia sin mover el foco (CA-011-10). -->
    <div class="recovery-request__message" aria-live="polite">
      <p v-if="channel === null" class="recovery-request__hint">
        Elige por dónde quieres recibir tu código de un solo uso.
      </p>
      <p
        v-else-if="channel === 'whatsapp'"
        class="recovery-request__hint recovery-request__hint--swap"
      >
        Escribe el número de teléfono de tu cuenta. Si existe, te enviaremos un código de un solo
        uso a tu <strong>teléfono</strong>.
      </p>
      <p v-else class="recovery-request__hint recovery-request__hint--swap">
        Escribe el correo de tu cuenta. Si existe, te enviaremos un código de un solo uso por
        <strong>correo</strong>.
      </p>
    </div>

    <!-- Al elegir canal el campo y el botón se despliegan (la altura crece
         desde cero) en vez de aparecer de golpe y empujar el enlace de abajo. -->
    <Transition name="recovery-reveal">
      <div v-if="channel !== null" class="recovery-reveal">
        <div class="recovery-reveal__inner">
          <!-- `key` fuerza un campo nuevo por canal: cambia tipo, etiqueta y
               autocompletado sin arrastrar el estado del anterior. -->
          <PhoneField
            v-if="channel === 'whatsapp'"
            key="whatsapp"
            class="recovery-request__field"
            tone="paper"
            name="whatsapp"
            label="Teléfono"
            required
            :show-required-marker="false"
            :disabled="isSubmitting"
            :error="fieldError"
            :country="phoneCountryIso"
            :national="phoneNational"
            @update:country="onPhoneCountry"
            @update:national="onPhoneNational"
          />
          <BaseInput
            v-else
            key="email"
            class="recovery-request__field"
            :model-value="values.email"
            type="email"
            name="email"
            label="Correo"
            autocomplete="username"
            placeholder="tu-correo@ejemplo.com"
            required
            :show-required-marker="false"
            :disabled="isSubmitting"
            :error="fieldError"
            @update:model-value="handleInput"
          />

          <BaseButton
            type="submit"
            variant="primary"
            size="lg"
            :loading="isSubmitting"
            loading-label="Enviando…"
            :disabled="isSubmitting"
            class="recovery-request__submit"
          >
            {{ isSubmitting ? 'Enviando…' : 'Enviar código' }}
          </BaseButton>
        </div>
      </div>
    </Transition>

    <p class="recovery-back">
      <RouterLink :to="{ name: 'acceso' }">Volver al acceso</RouterLink>
    </p>
  </form>
</template>

<style scoped>
/* v2 (DEC-188): campos, acciones y enlaces de authV2.css. */
.recovery-request {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: 100%;
}

.recovery-request__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.recovery-request__group-label {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--color-text-primary);
}

.recovery-request__choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

/* Los canales son tarjetas: la elegida lleva el borde y un tinte del acento, y
   además el visto (CA-011-09: la señal no es solo el color). */
.recovery-channel {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-height: 64px;
  padding: 0 var(--space-4);
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  cursor: pointer;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.recovery-channel:hover:not(:disabled) {
  border-color: var(--color-text-primary);
}

.recovery-channel:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.recovery-channel:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.recovery-channel--selected,
.recovery-channel--selected:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 10%, var(--color-surface));
  border-color: var(--color-brand-accent-surface);
  box-shadow: inset 0 0 0 1px var(--color-brand-accent-surface);
}

.recovery-channel__icon {
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.recovery-channel--selected .recovery-channel__icon {
  color: var(--color-text-primary);
}

.recovery-channel__check {
  flex-shrink: 0;
  color: var(--color-text-primary);
}

.recovery-channel__label {
  flex-grow: 1;
  text-align: left;
}

/* Por debajo de 480 px el icono pasa sobre el rótulo y el visto sale a la
   esquina: «Teléfono» cabe completo a 320 px. */
@media (max-width: 479px) {
  .recovery-channel {
    position: relative;
    flex-direction: column;
    gap: var(--space-1);
    justify-content: center;
    min-height: 80px;
    padding: var(--space-3) var(--space-2);
  }

  .recovery-channel__label {
    flex-grow: 0;
    text-align: center;
  }

  .recovery-channel__check {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
  }
}

.recovery-request__hint {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  color: var(--color-text-secondary);
}

.recovery-request__hint strong {
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Al elegir canal, el campo y el botón se despliegan (la fila pasa de 0fr a 1fr)
   en vez de empujar de golpe el enlace de abajo. El margen negativo reserva el
   hueco del gap dentro del bloque. El recorte solo existe durante el movimiento. */
.recovery-reveal {
  display: grid;
  grid-template-rows: 1fr;
  margin-top: calc(-1 * var(--space-5));
}

.recovery-reveal__inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding-top: var(--space-5);
}

.recovery-reveal-enter-active,
.recovery-reveal-leave-active {
  transition:
    grid-template-rows 260ms cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 200ms var(--motion-easing-standard);
}

.recovery-reveal-enter-active > .recovery-reveal__inner,
.recovery-reveal-leave-active > .recovery-reveal__inner {
  overflow: hidden;
}

.recovery-reveal-enter-from,
.recovery-reveal-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .recovery-channel,
  .recovery-reveal-enter-active,
  .recovery-reveal-leave-active {
    transition: none;
  }
}
</style>
