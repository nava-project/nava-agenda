<script setup lang="ts">
// Pantalla «Google Calendar» (issue #325, DEC-099, DEC-101, DEC-122): el profesional
// conecta, ve el estado, sincroniza ahora y desconecta SU Google Calendar, y
// elige la anticipación del recordatorio. La publicación es de NAVA hacia
// Google: lo que se cambie allí no altera la agenda de NAVA. La pantalla nunca
// maneja tokens: el flujo OAuth ocurre entre el navegador, Google y el API, y la
// vuelta la completa GoogleCalendarCallbackPage.
//
// Estados (derivados del recurso, no campos de la API): no disponible, falta
// vincular el profesional, no conectado, conectado, sincronizando (cambios en cola),
// requiere reconexión y error de sincronización. Las acciones se bloquean mientras
// una está en curso, así un doble clic nunca la repite.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useToast, useVocabulary } from '@/shared/composables'
import { isSoloProfile } from '@/shared/model'
import { BaseAlert, BaseButton, BaseDialog, BaseInput, DiamondLoader } from '@/shared/ui'
import GoogleCalendarEmblem from '../components/GoogleCalendarEmblem.vue'
import GoogleCalendarSteps from '../components/GoogleCalendarSteps.vue'
import {
  disconnect,
  fetchConnection,
  linkSoleProfessional,
  startConnect,
  syncNow,
  updateReminder,
} from '../api/googleCalendarApi'
import {
  viewOf,
  type GoogleCalendarConnection,
  type GoogleCalendarView,
} from '../model/googleCalendar'
import {
  MAX_REMINDER_MINUTES,
  MIN_REMINDER_MINUTES,
  validateReminderMinutes,
} from '../validation/reminder'

const toast = useToast()
const v = useVocabulary()

// Mientras hay cambios en cola se vuelve a consultar el estado hasta que se vacíe.
const POLL_MS = 5000

type LoadStatus = 'loading' | 'ready' | 'load-error'
type Busy = 'connect' | 'sync' | 'disconnect' | 'reminder' | null

const loadStatus = ref<LoadStatus>('loading')
const connection = ref<GoogleCalendarConnection | null>(null)
const busy = ref<Busy>(null)
const actionError = ref<string | null>(null)
const redirecting = ref(false)
const isDisconnectOpen = ref(false)

// Formulario del recordatorio.
const useDefaultReminder = ref(true)
const reminderText = ref('30')
const reminderError = ref<string | undefined>(undefined)

const view = computed<GoogleCalendarView | null>(() =>
  connection.value ? viewOf(connection.value) : null,
)
const isConnectedLike = computed(
  () => view.value === 'connected' || view.value === 'syncing' || view.value === 'sync-error',
)
const canConnect = computed(
  () => view.value === 'not-connected' || view.value === 'reauth' || view.value === 'sync-error',
)

let pollTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

function applyConnection(next: GoogleCalendarConnection) {
  connection.value = next
  receivedAt.value = Date.now()
  if (next.reminderMinutes === null) {
    useDefaultReminder.value = true
  } else {
    useDefaultReminder.value = false
    reminderText.value = String(next.reminderMinutes)
  }
  schedulePoll()
}

function schedulePoll() {
  clearTimeout(pollTimer)
  if (disposed || !connection.value || connection.value.pendingSyncJobs === 0) return
  pollTimer = setTimeout(() => void refresh(), POLL_MS)
}

async function load() {
  loadStatus.value = 'loading'
  let outcome = await fetchConnection()
  if (disposed) return
  // Independiente (DEC-155): solo existe su ficha, así que no hay nada que elegir.
  // Si el vínculo se logra se vuelve a leer el estado; si no, queda el flujo manual.
  if (
    outcome.kind === 'success' &&
    outcome.connection.enabled &&
    !outcome.connection.professionalLinked &&
    isSoloProfile.value
  ) {
    const linked = await linkSoleProfessional()
    if (disposed) return
    if (linked.kind === 'success') {
      outcome = await fetchConnection()
      if (disposed) return
    }
  }
  if (outcome.kind === 'success') {
    applyConnection(outcome.connection)
    loadStatus.value = 'ready'
  } else {
    loadStatus.value = 'load-error'
  }
}

// Actualiza el estado sin volver a mostrar la carga: lo usan las acciones y el sondeo.
async function refresh() {
  const outcome = await fetchConnection()
  if (disposed) return
  if (outcome.kind === 'success') applyConnection(outcome.connection)
}

onMounted(() => void load())
onUnmounted(() => {
  disposed = true
  clearTimeout(pollTimer)
})

function failureMessage(kind: 'network-error' | 'unexpected-error', what: string): string {
  return kind === 'network-error'
    ? `No pudimos ${what}. Revisa tu conexión e inténtalo de nuevo.`
    : `No pudimos ${what}. Inténtalo de nuevo en un momento.`
}

async function onConnect() {
  if (busy.value) return
  busy.value = 'connect'
  actionError.value = null
  const outcome = await startConnect()
  if (outcome.kind === 'success') {
    // Google toma la pantalla: no se libera `busy` para que nadie vuelva a pulsar.
    redirecting.value = true
    window.location.assign(outcome.authorizationUrl)
    return
  }
  busy.value = null
  if (outcome.kind === 'unavailable') {
    actionError.value = 'Ahora no se puede conectar. Revisa el estado de abajo.'
    await refresh()
  } else {
    actionError.value = failureMessage(outcome.kind, 'abrir Google')
  }
}

async function onSync() {
  if (busy.value) return
  busy.value = 'sync'
  actionError.value = null
  const outcome = await syncNow()
  if (outcome.kind === 'success') {
    toast.success('Sincronizando con Google Calendar', {
      detail: 'Tus cambios pendientes se publicarán en unos segundos.',
    })
    await refresh()
  } else if (outcome.kind === 'not-connected' || outcome.kind === 'unavailable') {
    actionError.value = 'No hay una conexión activa con Google Calendar.'
    await refresh()
  } else {
    actionError.value = failureMessage(outcome.kind, 'sincronizar')
  }
  busy.value = null
}

function openDisconnect() {
  if (busy.value) return
  actionError.value = null
  isDisconnectOpen.value = true
}

async function onConfirmDisconnect() {
  if (busy.value) return
  busy.value = 'disconnect'
  const outcome = await disconnect()
  busy.value = null
  isDisconnectOpen.value = false
  if (outcome.kind === 'success') {
    toast.success('Google Calendar desconectado', {
      detail: 'Los eventos que ya están en tu calendario se quedan allí.',
    })
    await refresh()
  } else {
    actionError.value = failureMessage(outcome.kind, 'desconectar')
  }
}

function onReminderInput(value: string | number) {
  reminderText.value = String(value)
  reminderError.value = undefined
}

async function onSaveReminder() {
  if (busy.value || !connection.value) return
  actionError.value = null
  let minutes: number | null = null
  if (!useDefaultReminder.value) {
    const result = validateReminderMinutes(reminderText.value)
    if (!result.ok) {
      reminderError.value = result.message
      return
    }
    minutes = result.minutes
  }
  reminderError.value = undefined
  busy.value = 'reminder'
  const outcome = await updateReminder(minutes)
  busy.value = null
  if (outcome.kind === 'success') {
    toast.success('Recordatorio guardado', {
      detail:
        minutes === null
          ? 'Tus eventos usarán los recordatorios predeterminados de Google.'
          : `Te avisaremos ${minutes} min antes de cada turno.`,
    })
    await refresh()
  } else if (outcome.kind === 'validation-error') {
    reminderError.value = `El aviso debe ser de ${MIN_REMINDER_MINUTES} a ${MAX_REMINDER_MINUTES} minutos.`
  } else if (outcome.kind === 'not-connected') {
    actionError.value = 'Conecta Google Calendar para guardar el recordatorio.'
    await refresh()
  } else {
    actionError.value = failureMessage(outcome.kind, 'guardar el recordatorio')
  }
}

const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
const relativeFormat = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
function formatMoment(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

// «hace 5 min»: se calcula al recibir el estado, no corre un reloj propio.
const receivedAt = ref(Date.now())
function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const diffSeconds = Math.round((new Date(iso).getTime() - receivedAt.value) / 1000)
  if (Number.isNaN(diffSeconds)) return ''
  const abs = Math.abs(diffSeconds)
  // Un instante futuro (reloj desfasado) se lee como «ahora» en vez de «dentro de…».
  if (diffSeconds > -60) return 'hace un momento'
  if (abs < 3600) return relativeFormat.format(Math.round(diffSeconds / 60), 'minute')
  if (abs < 86400) return relativeFormat.format(Math.round(diffSeconds / 3600), 'hour')
  return relativeFormat.format(Math.round(diffSeconds / 86400), 'day')
}

const statusLabel = computed(() => {
  switch (view.value) {
    case 'connected':
      return 'Conectado'
    case 'syncing':
      return 'Sincronizando'
    case 'reauth':
      return 'Requiere reconexión'
    case 'sync-error':
      return 'Error de sincronización'
    case 'unavailable':
      return 'No disponible'
    default:
      return 'No conectado'
  }
})

const pendingLabel = computed(() => {
  const count = connection.value?.pendingSyncJobs ?? 0
  return `${count} ${count === 1 ? 'cambio' : 'cambios'}`
})

// Texto del encabezado de estado: dice qué pasa y qué sigue, sin jerga técnica.
const headline = computed(() => {
  switch (view.value) {
    case 'unavailable':
      return 'Todavía no está disponible'
    case 'needs-professional':
      return `Primero, dinos qué ${v.value.professional} eres`
    case 'reauth':
      return 'Hay que volver a conectar Google'
    case 'sync-error':
      return 'Algunos cambios no llegaron a Google'
    case 'syncing':
      return 'Publicando tus cambios'
    case 'connected':
      return 'Tu agenda ya está en Google Calendar'
    default:
      return 'Lleva tu agenda a Google Calendar'
  }
})

const lead = computed(() => {
  switch (view.value) {
    case 'unavailable':
      return 'La conexión con Google Calendar no está disponible en este entorno. El resto de Nava Agenda funciona igual.'
    case 'needs-professional':
      return `Para publicar tu agenda, Nava Agenda necesita saber cuál ${v.value.professional} eres. Abre tu ficha en ${v.value.Professionals} y pulsa «Este soy yo»: toma un clic.`
    case 'reauth':
      return 'Retiraste el permiso de Nava Agenda o caducó. Tus turnos no se pierden: vuelve a conectar y seguirán publicándose.'
    case 'sync-error':
      return 'Tus turnos están a salvo en Nava Agenda. Pulsa «Sincronizar ahora» para reintentar el envío.'
    case 'syncing':
      return `Estamos enviando ${pendingLabel.value} a Google. Tarda unos segundos.`
    case 'connected':
      return 'Cada turno nuevo, cambio o cancelación se publica solo, y tus clientes reciben su invitación.'
    default:
      return 'Tus turnos y bloqueos aparecerán solos en tu calendario, y tus clientes recibirán la invitación por correo.'
  }
})

// Recorrido hacia la conexión: solo mientras todavía no hay una conexión viva.
// El independiente no vincula su ficha (DEC-155): su recorrido empieza en Google.
const steps = computed(() => [
  ...(isSoloProfile.value
    ? []
    : [{ title: `Vincula tu ficha`, detail: `Dinos qué ${v.value.professional} eres.` }]),
  { title: 'Conecta tu Google', detail: 'Das tu permiso una sola vez.' },
  { title: 'Listo', detail: 'Tus turnos se publican solos.' },
])
const showSteps = computed(
  () =>
    view.value === 'needs-professional' ||
    view.value === 'not-connected' ||
    view.value === 'reauth',
)
const currentStep = computed(() =>
  view.value === 'needs-professional' || isSoloProfile.value ? 1 : 2,
)

// Recordatorio: dos modos y atajos de minutos habituales.
const reminderMode = computed({
  get: () => (useDefaultReminder.value ? 'default' : 'custom'),
  set: (mode: 'default' | 'custom') => {
    useDefaultReminder.value = mode === 'default'
    reminderError.value = undefined
  },
})
const REMINDER_PRESETS = [
  { minutes: 10, label: '10 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hora' },
  { minutes: 120, label: '2 horas' },
] as const
function pickPreset(minutes: number) {
  if (busy.value) return
  reminderText.value = String(minutes)
  reminderError.value = undefined
}

const HOW_IT_WORKS = [
  {
    title: 'Nava Agenda manda',
    text: 'Google es solo una vista. Lo que cambies o borres allí no modifica tus turnos, bloqueos ni disponibilidad.',
  },
  {
    title: 'Si borras un evento',
    text: 'Nava Agenda lo vuelve a crear en unos minutos. Para dejar de publicar un turno, cancélalo desde Nava Agenda.',
  },
  {
    title: 'Tus clientes, invitados',
    text: 'Si dejaron su correo, Google les envía la invitación y los avisos de cambio o cancelación. Lo que respondan no cambia tu agenda.',
  },
  {
    title: 'Si desconectas',
    text: 'Los eventos que ya están en tu calendario se quedan. Nava Agenda solo deja de publicar nuevos.',
  },
] as const
</script>

<template>
  <section class="gcal-page" aria-labelledby="gcal-page-title">
    <header class="gcal-page__header">
      <h1 id="gcal-page-title" class="gcal-page__title">Google Calendar</h1>
      <p class="gcal-page__subtitle">
        Tus turnos y bloqueos de Nava Agenda, en el calendario que ya usas.
      </p>
    </header>

    <div v-if="loadStatus === 'loading'" class="gcal-page__state" role="status" aria-live="polite">
      <DiamondLoader label="Cargando Google Calendar…" layout="inline" />
    </div>

    <BaseAlert
      v-else-if="loadStatus === 'load-error'"
      class="gcal-page__wide"
      variant="warning"
      role="alert"
    >
      <strong>No pudimos cargar tu Google Calendar.</strong> Revisa tu conexión e inténtalo de
      nuevo.
      <template #action>
        <BaseButton variant="secondary" type="button" @click="load">Reintentar</BaseButton>
      </template>
    </BaseAlert>

    <div v-else-if="connection && view" class="gcal-page__layout gcal-ink">
      <!-- Sin `title`: BaseAlert lo dibuja como h4 y saltaría niveles bajo el h1/h2. -->
      <BaseAlert v-if="actionError" class="gcal-page__wide" variant="danger" role="alert">
        <strong>No se pudo completar.</strong> {{ actionError }}
      </BaseAlert>

      <!-- Estado y acciones -->
      <section class="gcal-hero" :class="`gcal-hero--${view}`" aria-labelledby="gcal-state-title">
        <GoogleCalendarEmblem class="gcal-hero__emblem" :view="view" />

        <div class="gcal-hero__main">
          <span class="gcal-status" role="status">
            <span class="gcal-status__dot" aria-hidden="true" />
            {{ statusLabel }}
          </span>
          <div class="gcal-hero__copy">
            <h2 id="gcal-state-title" class="gcal-hero__title">{{ headline }}</h2>
            <p class="gcal-copy" aria-live="polite">{{ lead }}</p>
          </div>

          <RouterLink
            v-if="view === 'needs-professional'"
            :to="{ name: 'staff-profesionales' }"
            class="gcal-link"
          >
            <span class="gcal-link__copy">
              <span class="gcal-link__title">Ir a {{ v.Professionals }}</span>
              <span class="gcal-link__detail">Elige tu ficha y vincúlala con tu usuario.</span>
            </span>
            <span class="gcal-link__arrow" aria-hidden="true">→</span>
          </RouterLink>

          <dl v-if="isConnectedLike" class="gcal-facts">
            <div>
              <dt>Cuenta de Google</dt>
              <dd>{{ connection.accountEmail ?? 'Cuenta conectada' }}</dd>
            </div>
            <div>
              <dt>Calendario</dt>
              <dd>Principal</dd>
            </div>
            <div>
              <dt>Última sincronización</dt>
              <dd v-if="connection.lastSyncedAt">
                {{ formatMoment(connection.lastSyncedAt) }}
                <small>{{ formatRelative(connection.lastSyncedAt) }}</small>
              </dd>
              <dd v-else>Aún no hay eventos sincronizados.</dd>
            </div>
          </dl>
        </div>

        <footer
          v-if="view !== 'unavailable' && view !== 'needs-professional'"
          class="gcal-hero__actions"
        >
          <BaseButton
            v-if="canConnect"
            type="button"
            size="lg"
            :variant="view === 'sync-error' ? 'secondary' : 'primary'"
            :disabled="busy !== null || redirecting"
            @click="onConnect"
          >
            <span class="gcal-action">
              <svg
                class="gcal-action__icon gcal-action__icon--plug"
                viewBox="0 0 20 20"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M8 12l4-4M7.5 9.5l-2 2a2.8 2.8 0 0 0 4 4l2-2M12.5 10.5l2-2a2.8 2.8 0 0 0-4-4l-2 2"
                />
              </svg>
              {{
                redirecting
                  ? 'Abriendo Google…'
                  : view === 'reauth' || view === 'sync-error'
                    ? 'Volver a conectar'
                    : 'Conectar Google Calendar'
              }}
            </span>
          </BaseButton>
          <BaseButton
            v-if="isConnectedLike"
            type="button"
            size="lg"
            variant="primary"
            :disabled="busy !== null"
            @click="onSync"
          >
            <span class="gcal-action">
              <svg
                class="gcal-action__icon"
                :class="{ 'gcal-action__icon--spin': busy === 'sync' || view === 'syncing' }"
                viewBox="0 0 20 20"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M16 10a6 6 0 0 1-10.5 4M4 10a6 6 0 0 1 10.5-4M14.5 3v3h-3M5.5 17v-3h3" />
              </svg>
              {{ busy === 'sync' ? 'Sincronizando…' : 'Sincronizar ahora' }}
            </span>
          </BaseButton>
          <BaseButton
            v-if="isConnectedLike || view === 'reauth'"
            class="gcal-hero__disconnect"
            type="button"
            size="lg"
            variant="danger"
            :disabled="busy !== null"
            @click="openDisconnect"
          >
            Desconectar
          </BaseButton>
        </footer>
      </section>

      <!-- Recorrido hacia la conexión -->
      <GoogleCalendarSteps
        v-if="showSteps"
        :steps="steps"
        :current="currentStep"
        label="Pasos para conectar Google Calendar"
      />

      <!-- Recordatorio (solo con una conexión viva) -->
      <section v-if="isConnectedLike" class="gcal-panel" aria-labelledby="gcal-reminder-title">
        <header class="gcal-panel__header">
          <h2 id="gcal-reminder-title" class="gcal-panel__title">Recordatorio</h2>
        </header>
        <form class="gcal-panel__body" novalidate @submit.prevent="onSaveReminder">
          <p class="gcal-copy">
            Google te avisa antes de cada turno en tu calendario. Nava Agenda no envía un aviso
            propio.
          </p>

          <fieldset class="gcal-modes" :disabled="busy !== null">
            <legend class="gcal-sr-only">Cuándo quieres que te avise Google</legend>
            <label class="gcal-mode" :class="{ 'gcal-mode--on': reminderMode === 'default' }">
              <input v-model="reminderMode" type="radio" name="reminderMode" value="default" />
              <span class="gcal-mode__dot" aria-hidden="true" />
              <span class="gcal-mode__copy">
                <span class="gcal-mode__title">Avisos de Google</span>
                <span class="gcal-mode__detail"
                  >Usa los recordatorios que ya tienes en tu calendario.</span
                >
              </span>
            </label>
            <label class="gcal-mode" :class="{ 'gcal-mode--on': reminderMode === 'custom' }">
              <input v-model="reminderMode" type="radio" name="reminderMode" value="custom" />
              <span class="gcal-mode__dot" aria-hidden="true" />
              <span class="gcal-mode__copy">
                <span class="gcal-mode__title">Avisarme antes de cada turno</span>
                <span class="gcal-mode__detail">Tú eliges cuántos minutos de anticipación.</span>
              </span>
            </label>
          </fieldset>

          <Transition name="gcal-expand">
            <div v-if="!useDefaultReminder" class="gcal-custom">
              <div class="gcal-chips" role="group" aria-label="Atajos de anticipación">
                <button
                  v-for="preset in REMINDER_PRESETS"
                  :key="preset.minutes"
                  type="button"
                  class="gcal-chip"
                  :class="{ 'gcal-chip--on': reminderText === String(preset.minutes) }"
                  :aria-pressed="reminderText === String(preset.minutes)"
                  :disabled="busy !== null"
                  @click="pickPreset(preset.minutes)"
                >
                  {{ preset.label }}
                </button>
              </div>
              <BaseInput
                :model-value="reminderText"
                name="reminderMinutes"
                type="number"
                label="Minutos de anticipación"
                :hint="`De ${MIN_REMINDER_MINUTES} a ${MAX_REMINDER_MINUTES}, por ejemplo 30`"
                :error="reminderError"
                :disabled="busy !== null"
                @update:model-value="onReminderInput"
              />
            </div>
          </Transition>

          <div class="gcal-panel__actions gcal-panel__actions--inline">
            <BaseButton type="submit" variant="primary" :disabled="busy !== null">
              {{ busy === 'reminder' ? 'Guardando…' : 'Guardar recordatorio' }}
            </BaseButton>
          </div>
        </form>
      </section>

      <!-- Cómo funciona: visible salvo cuando la integración no está disponible (no hay nada
           que explicar y, sin ningún control enfocable, la región desplazable fallaría axe). -->
      <section v-if="view !== 'unavailable'" class="gcal-how" aria-labelledby="gcal-how-title">
        <h2 id="gcal-how-title" class="gcal-how__title">Cómo funciona</h2>
        <ul class="gcal-how__grid">
          <li v-for="(item, index) in HOW_IT_WORKS" :key="item.title" class="gcal-how__item">
            <span class="gcal-how__num" aria-hidden="true">{{ index + 1 }}</span>
            <strong class="gcal-how__name">{{ item.title }}</strong>
            <span class="gcal-how__text">{{ item.text }}</span>
          </li>
        </ul>
      </section>
    </div>

    <BaseDialog
      v-model="isDisconnectOpen"
      title="¿Desconectar Google Calendar?"
      size="sm"
      content-class="gcal-dialog"
    >
      <div class="gcal-ink gcal-dialog__body">
        <p class="gcal-copy">
          Nava Agenda dejará de publicar tus turnos y bloqueos y retirará su permiso en Google. Los
          eventos que ya están en tu calendario se quedan allí y tus turnos no cambian.
        </p>
      </div>
      <template #footer>
        <div class="gcal-ink gcal-dialog__footer">
          <BaseButton
            type="button"
            variant="secondary"
            :disabled="busy === 'disconnect'"
            @click="isDisconnectOpen = false"
          >
            Cancelar
          </BaseButton>
          <BaseButton
            type="button"
            variant="danger"
            :disabled="busy === 'disconnect'"
            @click="onConfirmDisconnect"
          >
            {{ busy === 'disconnect' ? 'Desconectando…' : 'Desconectar' }}
          </BaseButton>
        </div>
      </template>
    </BaseDialog>
  </section>
</template>

<style scoped>
/*
 * Google Calendar, v2 «La luz del día» (DEC-188): el lienzo y las superficies
 * son los del modo (Día o Noche); tarjetas con borde sutil; rótulos en tipo
 * oración. El acento lleno queda para la acción principal (Conectar /
 * Sincronizar ahora / Guardar recordatorio, `BaseButton` primary). El estado
 * de la conexión usa los colores semánticos (rojo, verde, azul, ámbar) solo en
 * su etiqueta y en la insignia del emblema. Nada se anima al cargar.
 */
.gcal-page {
  --gcal-width: 760px;

  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 100%;
  padding: 34px 32px 48px;
  color: var(--color-text-primary);
  background: transparent;
  box-sizing: border-box;
}

.gcal-page__header,
.gcal-page__state,
.gcal-page__layout,
.gcal-page > :deep(.base-alert) {
  width: min(100%, var(--gcal-width));
  margin-inline: auto;
}

/* Mismo h1 que la Agenda del día (DailyAgendaPage). */
.gcal-page__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 28px;
  font-weight: 600;
  line-height: 32px;
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

@media (min-width: 1024px) {
  .gcal-page__title {
    font-size: 32px;
    line-height: 36px;
  }
}

.gcal-page__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
}

.gcal-page__state {
  color: var(--color-text-secondary);
}

.gcal-page__layout {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.gcal-panel {
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.gcal-panel__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 24px 14px;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

.gcal-panel__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.gcal-panel__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 24px 22px;
  margin: 0;
}

.gcal-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.gcal-panel__actions--inline {
  padding: 0;
}

.gcal-copy {
  margin: 0;
  font-size: var(--font-size-body);
  line-height: 1.55;
  color: var(--color-text-primary);
}

.gcal-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* --- Encabezado de estado --------------------------------------------------- */

.gcal-hero {
  /* El tono lo fija el estado; lo leen la etiqueta y la insignia del emblema. */
  --gcal-tone: var(--color-text-secondary);

  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 28px;
  row-gap: 20px;
  align-items: center;
  padding: 26px 28px 24px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

/* Sin conexión: rojo; conectado: verde. Son los dos extremos que el profesional debe distinguir
   de un vistazo (el error de sincronización comparte el rojo, pero lleva su propio texto y «!»). */
.gcal-hero--not-connected,
.gcal-hero--needs-professional {
  --gcal-tone: var(--color-danger-on-strong);
}

.gcal-hero--connected {
  --gcal-tone: var(--color-success-on-strong);
}

.gcal-hero--syncing {
  --gcal-tone: var(--color-info-on-strong);
}

.gcal-hero--reauth {
  --gcal-tone: var(--color-warning-on-strong);
}

.gcal-hero--sync-error {
  --gcal-tone: var(--color-danger-on-strong);
}

.gcal-hero--unavailable {
  --gcal-tone: var(--color-text-secondary);
}

.gcal-hero__emblem {
  width: 112px;
  height: 112px;
}

/* Etiqueta de estado propia: el punto y el borde toman el tono del estado; la
   palabra va en tinta para que el color nunca diga el estado solo. */
.gcal-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 12px 0 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--color-text-primary);
  white-space: nowrap;
  background: color-mix(in srgb, var(--gcal-tone) 10%, transparent);
  border: var(--border-width-normal) solid color-mix(in srgb, var(--gcal-tone) 55%, transparent);
  border-radius: var(--radius-pill);
}

/* Punto redondo (sin rombo, sin latido): lleno con la conexión viva; sin
   conexión es solo contorno, «todavía no hay nada encendido». */
.gcal-status__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  background: var(--gcal-tone);
  border-radius: 50%;
}

.gcal-hero--not-connected .gcal-status__dot,
.gcal-hero--needs-professional .gcal-status__dot,
.gcal-hero--unavailable .gcal-status__dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--gcal-tone);
}

.gcal-hero__main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.gcal-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.gcal-hero__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 600;
  line-height: 28px;
  overflow-wrap: anywhere;
}

.gcal-hero__copy .gcal-copy {
  max-width: 56ch;
  color: var(--color-text-secondary);
}

.gcal-hero__actions {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: 12px;
  padding-top: 18px;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.gcal-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.gcal-action__icon {
  flex: 0 0 auto;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Indicador de progreso de «Sincronizar ahora»: gira solo mientras la
   sincronización está en curso (estado finito, como una carga). */
.gcal-action__icon--spin {
  animation: gcal-spin 1s linear infinite;
}

/* «Desconectar» queda al final de la fila, apartado de la acción principal. */
.gcal-hero__disconnect {
  margin-left: auto;
}

.gcal-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
  margin: 4px 0 0;
}

/* El correo es lo más largo: ocupa su propia fila para no partirse en dos líneas. */
.gcal-facts > div:first-child {
  grid-column: 1 / -1;
}

.gcal-facts > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  background-color: var(--color-surface-muted);
  border-radius: var(--radius-md);
}

.gcal-facts dt {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.gcal-facts dd {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--font-size-body);
  line-height: 1.3;
}

.gcal-facts dd small {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.gcal-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  max-width: 460px;
  min-height: 44px;
  padding: 14px 16px;
  color: inherit;
  text-decoration: none;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-link:hover {
  background: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  border-color: var(--color-text-primary);
}

.gcal-link:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.gcal-link__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gcal-link__title {
  font-weight: 600;
}

.gcal-link__detail {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.gcal-link__arrow {
  color: var(--color-text-secondary);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-link:hover .gcal-link__arrow,
.gcal-link:focus-visible .gcal-link__arrow {
  transform: translateX(3px);
}

/* --- Recordatorio ----------------------------------------------------------- */

.gcal-modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

.gcal-mode {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 44px;
  padding: 14px 16px;
  cursor: pointer;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-mode:hover {
  border-color: var(--color-text-primary);
}

/* Opción elegida en tinta, no en el acento. */
.gcal-mode--on {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px var(--color-text-primary);
}

/* El radio nativo sigue siendo el control; se oculta solo a la vista. */
.gcal-mode input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  opacity: 0;
}

.gcal-mode:has(input:focus-visible) {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.gcal-mode__dot {
  position: relative;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: 50%;
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-mode__dot::after {
  position: absolute;
  inset: 4px;
  content: '';
  background: var(--color-text-primary);
  border-radius: 50%;
  transform: scale(0);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-mode--on .gcal-mode__dot {
  border-color: var(--color-text-primary);
}

.gcal-mode--on .gcal-mode__dot::after {
  transform: scale(1);
}

.gcal-mode__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gcal-mode__title {
  font-weight: 600;
  line-height: 1.3;
}

.gcal-mode__detail {
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.gcal-custom {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-md);
}

.gcal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Atajos: contorno neutro; el elegido, en tinta (v2). */
.gcal-chip {
  min-height: 40px;
  padding: 0 16px;
  font: inherit;
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

@media (hover: hover) {
  .gcal-chip:hover:not(:disabled) {
    border-color: var(--color-text-primary);
  }
}

.gcal-chip--on {
  font-weight: 600;
  background: color-mix(in srgb, var(--color-text-primary) 8%, var(--color-surface));
  border-color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px var(--color-text-primary);
}

.gcal-chip:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.gcal-chip:disabled {
  cursor: default;
  opacity: 0.4;
}

/* Se abre al elegir «Avisarme antes…»: fundido corto, responde a la acción. */
.gcal-expand-enter-active,
.gcal-expand-leave-active {
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}

.gcal-expand-enter-from,
.gcal-expand-leave-to {
  opacity: 0;
}

/* --- Cómo funciona ---------------------------------------------------------- */

.gcal-how {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 6px;
}

.gcal-how__title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.gcal-how__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.gcal-how__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 12px;
  row-gap: 4px;
  align-content: start;
  padding: 16px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

/* Número de orden en texto secundario, sin acento. */
.gcal-how__num {
  grid-row: span 2;
  display: grid;
  place-content: center;
  width: 28px;
  height: 28px;
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: 50%;
}

.gcal-how__name {
  align-self: center;
  line-height: 1.3;
}

.gcal-how__text {
  grid-column: 2;
  font-size: var(--font-size-body-sm);
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.gcal-dialog__body {
  padding: 4px 0;
}

.gcal-dialog__footer {
  display: flex;
  flex: 1;
  flex-flow: row wrap;
  justify-content: flex-end;
  gap: var(--space-3);
}

@keyframes gcal-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Campos y botones: los compartidos v2 (BaseInput, BaseButton) sin repintar;
   `.gcal-ink` ya no cambia su aspecto, solo fija el alto de los campos. */
.gcal-ink :deep(.base-input) {
  height: 44px;
}

@media (max-width: 640px) {
  .gcal-page {
    padding: 24px 16px 40px;
  }

  .gcal-panel__header,
  .gcal-panel__body {
    padding-inline: 16px;
  }

  .gcal-hero {
    grid-template-columns: 1fr;
    justify-items: start;
    padding: 20px 16px;
  }

  .gcal-hero__emblem {
    width: 84px;
    height: 84px;
  }

  .gcal-hero__actions {
    width: 100%;
  }

  .gcal-hero__disconnect {
    margin-left: 0;
  }

  .gcal-hero__actions > :deep(.base-button),
  .gcal-panel__actions > * {
    flex: 1 1 100%;
  }

  .gcal-modes,
  .gcal-how__grid,
  .gcal-facts {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gcal-action__icon--spin {
    animation: none;
  }

  .gcal-mode,
  .gcal-mode__dot,
  .gcal-mode__dot::after,
  .gcal-chip,
  .gcal-link,
  .gcal-link__arrow,
  .gcal-expand-enter-active,
  .gcal-expand-leave-active {
    transition: none;
  }

  .gcal-link:hover .gcal-link__arrow {
    transform: none;
  }
}
</style>

<style>
/* SIN "scoped" a propósito: BaseDialog dibuja su tarjeta en <Teleport to="body">, fuera del
   alcance del componente. El diálogo usa el aspecto v2 compartido de BaseDialog; aquí solo se
   evita que un título largo desborde. */
.gcal-dialog .base-dialog__title {
  overflow-wrap: anywhere;
}
</style>

<style>
/* Animaciones reducidas desde Configuración (DEC-112): mismo efecto que prefers-reduced-motion. */
:root[data-motion='reduced'] .gcal-action__icon--spin {
  animation: none;
}

:root[data-motion='reduced'] .gcal-mode,
:root[data-motion='reduced'] .gcal-mode__dot,
:root[data-motion='reduced'] .gcal-mode__dot::after,
:root[data-motion='reduced'] .gcal-chip,
:root[data-motion='reduced'] .gcal-link,
:root[data-motion='reduced'] .gcal-link__arrow,
:root[data-motion='reduced'] .gcal-expand-enter-active,
:root[data-motion='reduced'] .gcal-expand-leave-active {
  transition: none;
}
</style>
