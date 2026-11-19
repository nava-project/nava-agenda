<script setup lang="ts">
// Página coordinadora de la pantalla de acceso (P0, estandar-diseno-visual.md
// §10): posee estado y navegación; `LoginForm.vue` solo presenta. Traduce
// `LoginOutcome` (ya libre de detalles de transporte) a texto seguro para
// el profesional, nunca al revés.
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BaseAlert } from '@/shared/ui'
import AuthSplitLayout from '../components/AuthSplitLayout.vue'
import LoginForm from '../components/LoginForm.vue'
import PhoneChallengeForm from '../components/PhoneChallengeForm.vue'
import { login } from '../api/loginApi'
import { useToast } from '@/shared/composables'
import {
  notifyConnectionLost,
  notifyInvalidCredentials,
  notifyInvalidLoginFormat,
  notifyUnexpectedError,
} from '../model/authFeedback'
import { resetForFreshLogin } from '../model/sessionStore'
import { isSafeInternalRedirect } from '../model/redirectTarget'
import type { LoginOutcome } from '../model/loginOutcome'
import type { LoginScreenState } from '../model/loginScreenState'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const screenState = ref<LoginScreenState>({ status: 'idle' })

const isSubmitting = computed(() => screenState.value.status === 'submitting')

// "Sesión vencida" (especificacion-frontend-nava.md §7.1): installSessionHandling.ts
// ya empuja este query param al redirigir tras un 401 fuera de acceso; esta
// pantalla solo le da el mensaje en contexto que el estándar exige. No
// distingue más motivo que este (nunca revela detalle de seguridad) y deja
// de mostrarse en cuanto el profesional reintenta un envío.
const showSessionExpired = computed(
  () => route.query.motivo === 'sesion-expirada' && screenState.value.status === 'idle',
)

// HU-007 (DEC-062): un 429 ofrece el reto telefónico como salida inmediata,
// sin esperar el escalamiento de 24 horas. `PhoneChallengeForm` es dueño de
// su propio flujo (solicitar/verificar código); esta página solo decide
// cuándo mostrarlo y qué hacer cuando se verifica con éxito.
const showPhoneChallenge = computed(() => screenState.value.status === 'rate-limited')

function waitInWords(seconds: number | undefined): string {
  if (!seconds || seconds < 60) return 'unos momentos'
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60)
    return minutes === 1 ? '1 minuto' : `${minutes} minutos`
  }
  const hours = Math.ceil(seconds / 3600)
  return hours === 1 ? '1 hora' : `${hours} horas`
}

async function attemptLogin() {
  // Guardia de doble envío (CA-010-04): la asignación a un ref es
  // síncrona, así que una segunda llamada reentrante (doble clic, Enter
  // repetido) ve el estado ya actualizado antes de proceder.
  if (screenState.value.status === 'submitting') return

  screenState.value = { status: 'submitting' }

  const outcome: LoginOutcome = await login({ email: email.value, password: password.value })

  switch (outcome.kind) {
    case 'success': {
      // HU-012 (DEC-060): ya no existe un marcador local de sesión; la
      // próxima ruta privada consulta la fuente real
      // (GET /private/auth/session) en vez de reutilizar un resultado
      // `unauthenticated` previo a este mismo inicio de sesión.
      resetForFreshLogin()
      // CA-012-02: vuelve al destino pretendido si el guard lo conservó y
      // es una ruta interna segura; de lo contrario, /panel (CA-010-01).
      const redirect = route.query.redirect
      const destination = isSafeInternalRedirect(redirect) ? redirect : { name: 'panel' }
      await router.push(destination)
      return
    }
    case 'invalid-credentials':
      // CA-010-02: conserva el correo escrito, no el criterio de si la
      // contraseña se limpia. Se limpia aquí a propósito: el intento fue
      // rechazado por el servidor (credencial evaluada e incorrecta), así
      // que no hay razón funcional para reenviar el mismo valor sin que
      // el profesional lo revise. CA-010-03 (fallo de red) es distinto: ahí
      // el servidor nunca evaluó la credencial, así que sí se conserva
      // para permitir un reintento de un solo toque.
      password.value = ''
      screenState.value = { status: 'invalid-credentials' }
      notifyInvalidCredentials()
      return
    case 'validation-error':
      screenState.value = { status: 'validation-error' }
      notifyInvalidLoginFormat()
      return
    case 'network-error':
      screenState.value = { status: 'network-error' }
      notifyConnectionLost(() => void attemptLogin())
      return
    case 'rate-limited': {
      screenState.value = { status: 'rate-limited', retryAfterSeconds: outcome.retryAfterSeconds }
      // El estado conserva `rate-limited` porque abre el reto telefónico.
      const seconds = outcome.retryAfterSeconds
      // Un solo aviso (DEC-095, issue #485): explica el bloqueo y pide
      // confirmar la identidad; la acción «Enviar código» queda en el reto.
      // El tiempo se dice en palabras («24 horas», «5 minutos»), nunca con
      // «minuto(s)» ni en minutos para un bloqueo de un día (issue #714).
      const wait = `Podrás intentarlo de nuevo en ${waitInWords(seconds)}. Si no quieres esperar, confirma que eres tú con un código.`
      useToast().warning('Demasiados intentos', { detail: wait })
      return
    }
    case 'unexpected-error':
      screenState.value = { status: 'unexpected-error', requestId: outcome.requestId }
      notifyUnexpectedError(outcome.requestId)
  }
}

const onSubmit = () => {
  void attemptLogin()
}

// El servidor ya limpió el escalamiento de esta IP en la misma verificación
// exitosa (DEC-062): reintenta el login normalmente, con las credenciales
// que el profesional ya escribió, sin pedirle que las repita a mano.
const onChallengeVerified = () => {
  void attemptLogin()
}
</script>

<template>
  <AuthSplitLayout>
    <div class="au-head">
      <h1 class="au-title">Accede a Nava Agenda</h1>
      <p class="au-lead">Tu agenda y tu equipo, en un solo lugar.</p>
    </div>

    <LoginForm
      :email="email"
      :password="password"
      :submitting="isSubmitting"
      :challenge-active="showPhoneChallenge"
      recovery-href="/recuperar-acceso"
      @update:email="(value) => (email = value)"
      @update:password="(value) => (password = value)"
      @submit="onSubmit"
    />

    <BaseAlert
      v-if="showSessionExpired"
      variant="info"
      title="Tu sesión venció"
      role="status"
      dismissible
    >
      Inicia sesión de nuevo para continuar.
    </BaseAlert>

    <PhoneChallengeForm
      v-if="showPhoneChallenge"
      :email="email"
      :disabled="isSubmitting"
      @verified="onChallengeVerified"
    />
  </AuthSplitLayout>
</template>
