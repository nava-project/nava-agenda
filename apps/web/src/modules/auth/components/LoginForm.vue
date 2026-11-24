<script setup lang="ts">
// Formulario de acceso: correo y contraseña, sin conocer transporte HTTP
// ni la forma RFC 9457 del error (nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md
// §6). Valida forma en cliente y emite `submit` solo cuando es localmente
// válido; `LoginPage.vue` decide qué ocurre después (llamar al API,
// navegar, mostrar un resultado del servidor).
import { computed, nextTick, ref } from 'vue'
import { BaseButton, BaseInput } from '@/shared/ui'
import {
  hasLoginFieldErrors,
  validateLoginForm,
  type LoginFieldErrors,
} from '../validation/loginValidation'

const props = withDefaults(
  defineProps<{
    email: string
    password: string
    submitting: boolean
    /** El reto adicional deja las credenciales visibles pero bloqueadas:
     * mientras esté activo, su única acción primaria es verificar el OTP. */
    challengeActive?: boolean
    recoveryHref: string
  }>(),
  {
    challengeActive: false,
  },
)

const emit = defineEmits<{
  'update:email': [value: string]
  'update:password': [value: string]
  submit: []
}>()

const fieldErrors = ref<LoginFieldErrors>({})
const attemptedSubmit = ref(false)
const formRef = ref<HTMLFormElement | null>(null)

// Solo se muestran errores de campo tras el primer intento de envío: no se
// regaña al profesional mientras todavía está escribiendo por primera vez.
const showFieldErrors = computed(() => attemptedSubmit.value)
const emailError = computed(() => (showFieldErrors.value ? fieldErrors.value.email : undefined))
const passwordError = computed(() =>
  showFieldErrors.value ? fieldErrors.value.password : undefined,
)

// Revalida en vivo, tras un intento fallido, en respuesta a la escritura
// real del profesional (eventos de entrada de BaseInput), NUNCA a un cambio
// de prop en sí mismo. Esto importa porque LoginPage limpia la
// contraseña por su cuenta ante credenciales inválidas (CA-010-02): un
// `watch` sobre `props.email`/`props.password` reaccionaría también a
// ESE reinicio programático y mostraría "Escribe tu contraseña" al mismo
// tiempo que el servidor ya explicó el problema — dos mensajes
// contradictorios sobre el mismo campo. Validar con el valor recién
// escrito (no con la prop, que todavía no se actualizó) evita depender
// de un `nextTick` adicional.
const handleEmailInput = (value: string | number) => {
  const nextValue = String(value)
  emit('update:email', nextValue)
  if (attemptedSubmit.value) {
    fieldErrors.value = validateLoginForm(nextValue, props.password)
  }
}
const handlePasswordInput = (value: string | number) => {
  const nextValue = String(value)
  emit('update:password', nextValue)
  if (attemptedSubmit.value) {
    fieldErrors.value = validateLoginForm(props.email, nextValue)
  }
}

const onSubmit = async () => {
  const errors = validateLoginForm(props.email, props.password)
  fieldErrors.value = errors
  attemptedSubmit.value = true

  if (hasLoginFieldErrors(errors)) {
    // v2 (DEC-188): en un formulario de dos campos cada error ya va junto a
    // su campo; un resumen que lo repita es ruido. El foco va al primer campo
    // inválido (CA-010-05: orden y foco coherentes con teclado).
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }

  emit('submit')
}

// Para que quien descarta el aviso de sesión vencida no pierda su posición
// (el foco caería en `body`): la página lo devuelve al primer campo (#810).
function focusEmail() {
  formRef.value?.querySelector<HTMLInputElement>('input[name="email"]')?.focus()
}

defineExpose({ focusEmail })
</script>

<template>
  <form ref="formRef" class="login-form au-form" novalidate @submit.prevent="onSubmit">
    <BaseInput
      :model-value="email"
      type="email"
      name="email"
      label="Correo"
      autocomplete="username"
      placeholder="tu-correo@ejemplo.com"
      required
      :show-required-marker="false"
      :disabled="submitting || challengeActive"
      :error="emailError"
      @update:model-value="handleEmailInput"
    />

    <BaseInput
      :model-value="password"
      type="password"
      name="password"
      label="Contraseña"
      autocomplete="current-password"
      placeholder="Escribe tu contraseña"
      required
      :show-required-marker="false"
      :disabled="submitting || challengeActive"
      :error="passwordError"
      @update:model-value="handlePasswordInput"
    />

    <BaseButton
      type="submit"
      :variant="challengeActive ? 'secondary' : 'primary'"
      size="lg"
      :loading="submitting"
      loading-label="Iniciando sesión…"
      :disabled="submitting || challengeActive"
      class="login-form__submit"
    >
      {{ submitting ? 'Iniciando sesión…' : 'Iniciar sesión' }}
    </BaseButton>

    <p class="login-form__recovery">
      <RouterLink class="au-link" :to="recoveryHref">¿Olvidaste tu contraseña?</RouterLink>
    </p>
  </form>
</template>

<style scoped>
/* La forma de campos, botón y enlace la pone authV2.css (DEC-188). */
.login-form__recovery {
  margin: calc(-1 * var(--space-2)) 0 0;
  text-align: center;
}
</style>
