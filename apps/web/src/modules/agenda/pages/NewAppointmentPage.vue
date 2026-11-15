<script setup lang="ts">
// Pantalla "Nuevo turno" (HU-061): el barbero autenticado registra un
// turno manual recibido por teléfono, WhatsApp o en persona. No consulta
// disponibilidad pública ni propone franjas (B4 es dueña); no edita,
// reprograma, cancela ni cambia estado (fuera de alcance de HU-061). El
// éxito muestra un resumen honesto: HU-062 (agenda diaria) no es destino de
// este enlace, así que esta pantalla no enlaza a ninguna vista de agenda.
//
// Fidelidad visual con el atlas nuevo-turno-eventos (issue #190, segundo
// pase del 2026-09-04): esta revisión es exclusivamente de composición,
// color, jerarquía y estado visual, nunca de comportamiento. Los comentarios
// que citan un evento del atlas (docs/10-backlog/evidence/
// ui-mockups-nava-tailored-grid-2026-09-03/nuevo-turno-eventos/README.md)
// documentan a qué panel responde cada bloque.
// El resumen de éxito es el resultado persistente; el aviso emergente lo
// acompaña (DEC-095).
//
// Rediseño del issue #576 (identidad guiada, sin mockup asignado): la
// composición pasa a pasos con línea de progreso y un boleto lateral que se
// llena mientras se escribe, con las acciones —Registrar y Cancelar— pegadas
// a él. Campos, validaciones, contrato y envío no cambian.
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { useToast, useVocabulary } from '@/shared/composables'
import { isSoloProfile } from '@/shared/model'
import {
  BaseAlert,
  BaseButton,
  BaseInput,
  BarberAvatar,
  BarberSelect,
  PageState,
  PhoneField,
} from '@/shared/ui'
import { DEFAULT_PHONE_COUNTRY, composePhone } from '@/shared/model/phoneCountries'
import { formatCivilDateFull, isCivilDateString } from '@/shared/time/civilDate'
import {
  createManualAppointment,
  fetchAssignedServices,
  fetchBarberSummaries,
  fetchBarbershopTimezone,
} from '../api/appointmentsApi'
import { newIdempotencyKey } from '../model/idempotencyKey'
import type { BarberSummary, ServiceSummary } from '../model/appointment'
import type { CreatedManualAppointment } from '../model/appointmentOutcome'
import NewAppointmentSkeleton from '../components/NewAppointmentSkeleton.vue'
import {
  buildStartsAt,
  validateAttendeeName,
  validateCustomerEmail,
  validateCustomerFullName,
  validateCustomerNote,
  validateCustomerPhone,
  validateStartsAt,
} from '../validation/appointmentValidation'

type PageStatus = 'loading' | 'ready' | 'load-error'
type ServicesStatus = 'idle' | 'loading' | 'ready' | 'error'
type SaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'conflict'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'

// Tope real de `validateCustomerNote`: el contador de la nota refleja ese
// límite, no uno inventado (atlas, "Contrato visual común").
const NOTE_MAX_LENGTH = 500

const pageStatus = ref<PageStatus>('loading')
const barbers = ref<BarberSummary[]>([])
const barbershopTimezone = ref<string | null>(null)

const selectedBarberId = ref('')
const servicesStatus = ref<ServicesStatus>('idle')
const services = ref<ServiceSummary[]>([])
const selectedServiceId = ref('')

const attendeeName = ref('')
const customerFullName = ref('')
// El teléfono se escribe con el prefijo en su propia casilla (`PhoneField`);
// `customerPhone` es el E.164 compuesto que se valida y se envía (vacío si no
// se escribió número: el teléfono es opcional).
const customerPhoneCountry = ref(DEFAULT_PHONE_COUNTRY)
const customerPhoneNational = ref('')
const customerPhone = computed(() =>
  customerPhoneNational.value === ''
    ? ''
    : composePhone(customerPhoneCountry.value, customerPhoneNational.value),
)
const customerEmail = ref('')
const customerNote = ref('')
const startsAtDate = ref('')
const startsAtTime = ref('')
const noteRef = ref<HTMLTextAreaElement | null>(null)

// La nota crece con su contenido en vez de dejar que la persona la
// arrastre a mano (`resize: none` en el estilo): el alto sigue al
// `scrollHeight` real del contenido en cada cambio, incluido el reinicio a
// '' de `onStartNewAppointment`.
function autoGrowNote() {
  const el = noteRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

watch(customerNote, () => {
  void nextTick(autoGrowNote)
})

const fieldErrors = ref<Record<string, string | undefined>>({})
const attempted = ref(false)
const toast = useToast()
// Palabras de la barbería (DEC-110): con los valores iniciales, el texto de siempre.
const v = useVocabulary()
const hideBarberField = computed(() => isSoloProfile.value && barbers.value.length === 1)
const saveStatus = ref<SaveStatus>('idle')
const saveErrorDetail = ref<string | undefined>(undefined)
const created = ref<CreatedManualAppointment | null>(null)
let idempotencyKey = newIdempotencyKey()

async function loadPage() {
  pageStatus.value = 'loading'
  const [barbersOutcome, timezoneOutcome] = await Promise.all([
    fetchBarberSummaries(),
    fetchBarbershopTimezone(),
  ])
  barbershopTimezone.value = timezoneOutcome.kind === 'success' ? timezoneOutcome.timezone : null
  if (barbersOutcome.kind !== 'success') {
    pageStatus.value = 'load-error'
    return
  }
  barbers.value = barbersOutcome.items
  // Perfil de barbero individual (DEC-115): con un solo barbero no hay nada que
  // elegir, así que queda seleccionado y el campo se oculta.
  if (hideBarberField.value) selectedBarberId.value = barbers.value[0]!.id
  pageStatus.value = 'ready'
}

void loadPage()

watch(selectedBarberId, async (barberId) => {
  selectedServiceId.value = ''
  services.value = []
  if (!barberId) {
    servicesStatus.value = 'idle'
    return
  }
  servicesStatus.value = 'loading'
  const outcome = await fetchAssignedServices(barberId)
  if (selectedBarberId.value !== barberId) return
  if (outcome.kind === 'success') {
    services.value = outcome.items
    servicesStatus.value = 'ready'
  } else {
    servicesStatus.value = 'error'
  }
})

const startsAt = computed(() => buildStartsAt(startsAtDate.value, startsAtTime.value))

// Resumen antes del CTA (estandar-diseno-visual.md §10, "Crear/editar
// turno": secciones cortas en orden, resumen; especificacion-frontend-nava.md
// §7.3: "resumen antes del CTA" en móvil). Solo refleja selecciones ya
// hechas, sin inventar datos que el contrato de servicios no expone
// todavía (ServiceSummary hoy solo trae id/name, sin duración ni precio).
const selectedBarberName = computed(
  () => barbers.value.find((b) => b.id === selectedBarberId.value)?.fullName ?? '',
)
const selectedServiceName = computed(
  () => services.value.find((s) => s.id === selectedServiceId.value)?.name ?? '',
)
const summaryDateLabel = computed(() =>
  isCivilDateString(startsAtDate.value) ? formatCivilDateFull(startsAtDate.value) : '',
)

// Pasos resueltos: encienden la cifra de cada banda, tiñen el tramo de la
// línea de progreso que la une con la siguiente y alimentan el contador del
// boleto. Solo cuentan los tres pasos con campos obligatorios; la nota es
// opcional y nunca bloquea el avance.
const stepDone = computed(() => ({
  selection: !!selectedBarberId.value && !!selectedServiceId.value,
  person: !!attendeeName.value.trim() && !!customerFullName.value.trim(),
  when: !!startsAtDate.value && !!startsAtTime.value,
  note: !!customerNote.value.trim(),
}))
const REQUIRED_STEPS = 3
const requiredStepsDone = computed(
  () =>
    [stepDone.value.selection, stepDone.value.person, stepDone.value.when].filter(Boolean).length,
)

// El campo de servicio depende del barbero (DEC-072): sin barbero elegido,
// mientras llegan sus servicios, o sin servicios activos que ofrecer, queda
// deshabilitado y pierde el filete de latón (atlas, eventos 04 y 05).
const isServiceDisabled = computed(
  () =>
    !selectedBarberId.value ||
    servicesStatus.value === 'loading' ||
    (servicesStatus.value !== 'idle' && services.value.length === 0),
)

// Rótulo de la opción vacía del `<select>`: sin esto, un barbero sin
// servicios activos (o cuya carga falló) mostraba "Elige un servicio" como
// única opción, prometiendo una lista que no existe.
const serviceSelectPlaceholder = computed(() => {
  if (!selectedBarberId.value) return `Elige primero ${v.value.aProfessional}`
  if (servicesStatus.value === 'loading') return 'Cargando servicios…'
  if (servicesStatus.value === 'error') return 'No pudimos cargar los servicios'
  if (services.value.length === 0) return 'Sin servicios activos asignados'
  return 'Elige un servicio'
})

// Cancelar vuelve a la agenda sin guardar nada. La agenda pasa su barbero y
// su fecha al abrir esta pantalla (`?barberId=…&date=…`); se devuelven tal
// cual para que la persona aterrice en el mismo día que estaba mirando. Sin
// ellos, la agenda resuelve su selección por defecto.
const route = useRoute()
const router = useRouter()
const agendaOrigin = computed<LocationQueryRaw>(() => {
  const origin: LocationQueryRaw = {}
  const { barberId, date } = route.query
  if (typeof barberId === 'string' && barberId !== '') origin.barberId = barberId
  if (typeof date === 'string' && isCivilDateString(date)) origin.date = date
  return origin
})

function onCancel() {
  void router.push({ name: 'panel', query: agendaOrigin.value })
}

function validateAll(): boolean {
  const errors: Record<string, string | undefined> = {
    barberId: selectedBarberId.value ? undefined : `Elige ${v.value.aProfessional}.`,
    serviceId: selectedServiceId.value ? undefined : 'Elige un servicio.',
    attendeeName: validateAttendeeName(attendeeName.value),
    customerFullName: validateCustomerFullName(customerFullName.value),
    customerPhone: validateCustomerPhone(customerPhone.value),
    customerEmail: validateCustomerEmail(customerEmail.value),
    customerNote: validateCustomerNote(customerNote.value),
    startsAt: validateStartsAt(startsAt.value),
  }
  fieldErrors.value = errors
  return Object.values(errors).every((e) => e === undefined)
}

async function onSubmit() {
  if (saveStatus.value === 'saving') return
  attempted.value = true
  saveErrorDetail.value = undefined
  if (!validateAll()) {
    saveStatus.value = 'validation-error'
    return
  }

  saveStatus.value = 'saving'
  const outcome = await createManualAppointment(
    {
      barberId: selectedBarberId.value,
      serviceId: selectedServiceId.value,
      attendeeName: attendeeName.value.trim(),
      customerFullName: customerFullName.value.trim(),
      customerPhone: customerPhone.value.trim() === '' ? null : customerPhone.value.trim(),
      customerEmail: customerEmail.value.trim() === '' ? null : customerEmail.value.trim(),
      customerNote: customerNote.value.trim() === '' ? null : customerNote.value.trim(),
      startsAt: startsAt.value,
    },
    idempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      created.value = outcome.appointment
      saveStatus.value = 'idle'
      toast.success('Turno registrado', { detail: 'El turno ya está en la agenda.' })
      return
    case 'conflict':
      saveErrorDetail.value = outcome.detail
      // El conflicto es SIEMPRE sobre el instante elegido: además de la
      // alerta global, el mismo detalle del servidor marca el campo de hora
      // (atlas evento 11, dos niveles de error a la vez). No se inventa
      // texto: es el `detail` que devolvió el API.
      fieldErrors.value = { ...fieldErrors.value, startsAt: outcome.detail }
      saveStatus.value = 'conflict'
      return
    case 'validation-error':
      saveErrorDetail.value = outcome.detail
      saveStatus.value = 'validation-error'
      return
    case 'idempotency-conflict':
      saveStatus.value = 'idempotency-conflict'
      return
    case 'not-found':
      saveStatus.value = 'not-found'
      return
    case 'network-error':
      saveStatus.value = 'network-error'
      return
    case 'unexpected-error':
      saveStatus.value = 'unexpected-error'
  }
}

function onStartNewAppointment() {
  created.value = null
  attendeeName.value = ''
  customerFullName.value = ''
  customerPhoneCountry.value = DEFAULT_PHONE_COUNTRY
  customerPhoneNational.value = ''
  customerEmail.value = ''
  customerNote.value = ''
  startsAtDate.value = ''
  startsAtTime.value = ''
  fieldErrors.value = {}
  attempted.value = false
  saveStatus.value = 'idle'
  saveErrorDetail.value = undefined
  idempotencyKey = newIdempotencyKey()
}

function onRetryLoad() {
  void loadPage()
}

function onBarberSelect(barberId: string) {
  selectedBarberId.value = barberId
}
</script>

<template>
  <section class="new-appointment-page" aria-labelledby="new-appointment-title">
    <header class="new-appointment-page__header">
      <h1 id="new-appointment-title" class="new-appointment-page__title">Nuevo turno</h1>
      <p v-if="barbershopTimezone" class="new-appointment-page__timezone">
        Horas en la zona horaria {{ v.ofTheBusiness }}: {{ barbershopTimezone }}
      </p>
    </header>

    <!-- Evento 01: sin barberos ni zona resueltos, la espera conserva la
         geometría del formulario por llegar (esqueleto, no un indicador
         suelto sobre una pantalla vacía). -->
    <NewAppointmentSkeleton
      v-if="pageStatus === 'loading'"
      :label="`Cargando ${v.professionals}…`"
    />

    <!-- Evento 02: fallo al cargar el contexto inicial. -->
    <div
      v-else-if="pageStatus === 'load-error'"
      class="new-appointment-page__state new-appointment-page__state--warning"
    >
      <PageState
        variant="warning"
        status-label="Atención"
        headline="No pudimos cargar esta sección"
        role="alert"
      >
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton type="button" variant="secondary" @click="onRetryLoad">Reintentar</BaseButton>
        </template>
      </PageState>
    </div>

    <template v-else>
      <!-- Evento 03: sin barberos activos no hay formulario que ofrecer. El
           destino nombrado en el mensaje se resalta en latón, sin convertirse
           en un enlace que el copy real no promete. -->
      <div v-if="barbers.length === 0" class="new-appointment-page__state">
        <PageState
          variant="info"
          :headline="`Aún no tienes ${v.professionalsRegistered}.`"
          role="status"
        >
          Agrega {{ v.oneProfessional }} en la sección
          <span class="new-appointment-page__dest">"{{ v.Professionals }}"</span> antes de registrar
          turnos.
        </PageState>
      </div>

      <!-- Evento 12: el éxito es la pantalla completa —divisor, rótulo,
           titular en serif y ficha de pergamino con el turno creado—, no una
           alerta pequeña flotando arriba a la izquierda. -->
      <div
        v-else-if="created"
        class="new-appointment-page__state new-appointment-page__state--success"
      >
        <PageState
          variant="success"
          status-label="Confirmación"
          headline="Turno registrado"
          role="status"
        >
          <span class="new-appointment-page__ticket">
            {{ created.attendeeName }} · {{ created.serviceName }} ({{
              created.durationMinutes
            }}
            min) · {{ created.priceAmount }} {{ created.currency }}
          </span>
          <span class="new-appointment-page__success-note">
            El turno quedó confirmado en la agenda {{ v.ofTheProfessional }}. Las notificaciones al
            cliente todavía no están disponibles (B5 las agrega más adelante).
          </span>
          <template #action>
            <BaseButton
              type="button"
              variant="primary"
              class="new-appointment-page__submit"
              @click="onStartNewAppointment"
            >
              Registrar otro turno
            </BaseButton>
          </template>
        </PageState>
      </div>

      <form v-else class="new-appointment-page__layout" novalidate @submit.prevent="onSubmit">
        <!-- Hoja continua de cuatro pasos. Cada paso lleva su cifra sobre una
             línea vertical que une los pasos entre sí: cuando sus campos
             obligatorios quedan resueltos, la cifra se vuelve una marca de
             listo y el tramo de línea que baja al siguiente se tiñe con el
             acento, así el avance se lee sin contar campos. -->
        <div class="new-appointment-page__form">
          <div class="new-appointment-page__sheet">
            <section
              class="new-appointment-page__section"
              :class="{ 'new-appointment-page__section--done': stepDone.selection }"
              style="--i: 0"
            >
              <div class="new-appointment-page__section-head">
                <span class="new-appointment-page__section-number" aria-hidden="true">
                  <Transition name="nt-mark" mode="out-in">
                    <svg
                      v-if="stepDone.selection"
                      key="done"
                      class="new-appointment-page__section-check"
                      viewBox="0 0 16 16"
                      focusable="false"
                    >
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                    <span v-else key="number">1</span>
                  </Transition>
                </span>
                <div class="new-appointment-page__section-stack">
                  <h2 class="new-appointment-page__section-title">
                    Selecciona<span v-if="stepDone.selection" class="new-appointment-page__sr-only">
                      (listo)</span
                    >
                  </h2>
                  <p class="new-appointment-page__section-hint">
                    {{
                      hideBarberField
                        ? 'Elige el servicio.'
                        : `Elige ${v.toTheProfessional} y el servicio.`
                    }}
                  </p>
                </div>
              </div>

              <div class="new-appointment-page__section-body">
                <div class="new-appointment-page__row">
                  <div
                    v-if="!hideBarberField"
                    class="new-appointment-page__field"
                    :class="{
                      'new-appointment-page__field--filled': !!selectedBarberId,
                      'new-appointment-page__field--error': attempted && !!fieldErrors.barberId,
                    }"
                  >
                    <label for="new-appointment-barber" class="new-appointment-page__label">
                      {{ v.Professional }}
                      <span class="new-appointment-page__required" aria-hidden="true">*</span>
                    </label>
                    <BarberSelect
                      :model-value="selectedBarberId || null"
                      :barbers="barbers"
                      trigger-id="new-appointment-barber"
                      :placeholder="`Elige ${v.aProfessional}`"
                      @update:model-value="onBarberSelect"
                    />
                    <p
                      v-if="attempted && fieldErrors.barberId"
                      class="new-appointment-page__error"
                      role="alert"
                    >
                      {{ fieldErrors.barberId }}
                    </p>
                  </div>

                  <div
                    class="new-appointment-page__field"
                    :class="{
                      'new-appointment-page__field--filled': !!selectedServiceId,
                      'new-appointment-page__field--off': isServiceDisabled,
                      'new-appointment-page__field--error': attempted && !!fieldErrors.serviceId,
                    }"
                  >
                    <label for="new-appointment-service" class="new-appointment-page__label">
                      Servicio
                      <span class="new-appointment-page__required" aria-hidden="true">*</span>
                    </label>
                    <div class="new-appointment-page__select-wrap">
                      <select
                        id="new-appointment-service"
                        v-model="selectedServiceId"
                        class="new-appointment-page__select"
                        :disabled="isServiceDisabled"
                      >
                        <option value="" disabled>
                          {{ serviceSelectPlaceholder }}
                        </option>
                        <option v-for="s in services" :key="s.id" :value="s.id">
                          {{ s.name }}
                        </option>
                      </select>
                      <span class="new-appointment-page__caret" aria-hidden="true" />
                    </div>
                    <p
                      v-if="servicesStatus === 'loading'"
                      class="new-appointment-page__note new-appointment-page__note--loading"
                      role="status"
                      aria-live="polite"
                    >
                      <span class="new-appointment-page__note-spinner" aria-hidden="true" />
                      <span>Cargando servicios…</span>
                    </p>
                    <p
                      v-else-if="servicesStatus === 'ready' && services.length === 0"
                      class="new-appointment-page__note new-appointment-page__note--warning"
                    >
                      {{ v.ThisProfessional }} no tiene servicios activos asignados.
                    </p>
                    <p
                      v-else-if="servicesStatus === 'error'"
                      class="new-appointment-page__note new-appointment-page__note--danger"
                      role="alert"
                    >
                      No pudimos cargar los servicios {{ v.ofThisProfessional }}.
                    </p>
                    <p
                      v-if="attempted && fieldErrors.serviceId"
                      class="new-appointment-page__error"
                      role="alert"
                    >
                      {{ fieldErrors.serviceId }}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section
              class="new-appointment-page__section"
              :class="{ 'new-appointment-page__section--done': stepDone.person }"
              style="--i: 1"
            >
              <div class="new-appointment-page__section-head">
                <span class="new-appointment-page__section-number" aria-hidden="true">
                  <Transition name="nt-mark" mode="out-in">
                    <svg
                      v-if="stepDone.person"
                      key="done"
                      class="new-appointment-page__section-check"
                      viewBox="0 0 16 16"
                      focusable="false"
                    >
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                    <span v-else key="number">2</span>
                  </Transition>
                </span>
                <div class="new-appointment-page__section-stack">
                  <h2 class="new-appointment-page__section-title">
                    Persona atendida<span
                      v-if="stepDone.person"
                      class="new-appointment-page__sr-only"
                    >
                      (listo)</span
                    >
                  </h2>
                  <p class="new-appointment-page__section-hint">
                    Indica quién recibirá el servicio.
                  </p>
                </div>
              </div>

              <div class="new-appointment-page__section-body">
                <div class="new-appointment-page__row">
                  <BaseInput
                    v-model="attendeeName"
                    type="text"
                    label="Persona atendida"
                    placeholder="Persona atendida"
                    required
                    :class="{ 'new-appointment-page__input--filled': !!attendeeName }"
                    :error="attempted ? fieldErrors.attendeeName : undefined"
                  />
                  <BaseInput
                    v-model="customerFullName"
                    type="text"
                    label="Nombre del cliente"
                    placeholder="Nombre del cliente"
                    required
                    :class="{ 'new-appointment-page__input--filled': !!customerFullName }"
                    :error="attempted ? fieldErrors.customerFullName : undefined"
                  />
                </div>
                <div class="new-appointment-page__row">
                  <PhoneField
                    v-model:country="customerPhoneCountry"
                    v-model:national="customerPhoneNational"
                    tone="ink"
                    label="Teléfono (opcional)"
                    :class="{ 'new-appointment-page__input--filled': !!customerPhone }"
                    :error="attempted ? fieldErrors.customerPhone : undefined"
                  />
                  <BaseInput
                    v-model="customerEmail"
                    type="email"
                    label="Correo (opcional)"
                    placeholder="Correo (opcional)"
                    :class="{ 'new-appointment-page__input--filled': !!customerEmail }"
                    :error="attempted ? fieldErrors.customerEmail : undefined"
                  />
                </div>
                <p v-if="!customerPhone && !customerEmail" class="new-appointment-page__hint">
                  Sin teléfono ni correo, el cliente no recibirá recordatorios.
                </p>
              </div>
            </section>

            <section
              class="new-appointment-page__section"
              :class="{ 'new-appointment-page__section--done': stepDone.when }"
              style="--i: 2"
            >
              <div class="new-appointment-page__section-head">
                <span class="new-appointment-page__section-number" aria-hidden="true">
                  <Transition name="nt-mark" mode="out-in">
                    <svg
                      v-if="stepDone.when"
                      key="done"
                      class="new-appointment-page__section-check"
                      viewBox="0 0 16 16"
                      focusable="false"
                    >
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                    <span v-else key="number">3</span>
                  </Transition>
                </span>
                <div class="new-appointment-page__section-stack">
                  <h2 class="new-appointment-page__section-title">
                    Fecha y hora<span v-if="stepDone.when" class="new-appointment-page__sr-only">
                      (listo)</span
                    >
                  </h2>
                  <p class="new-appointment-page__section-hint">Define cuándo será el turno.</p>
                </div>
              </div>

              <div class="new-appointment-page__section-body">
                <div class="new-appointment-page__row">
                  <BaseInput
                    v-model="startsAtDate"
                    type="date"
                    label="Fecha del turno"
                    required
                    :class="{ 'new-appointment-page__input--filled': !!startsAtDate }"
                  />
                  <BaseInput
                    v-model="startsAtTime"
                    type="time"
                    label="Hora del turno"
                    required
                    :class="{ 'new-appointment-page__input--filled': !!startsAtTime }"
                    :error="attempted ? fieldErrors.startsAt : undefined"
                  />
                </div>
              </div>
            </section>

            <section
              class="new-appointment-page__section"
              :class="{ 'new-appointment-page__section--done': stepDone.note }"
              style="--i: 3"
            >
              <div class="new-appointment-page__section-head">
                <span class="new-appointment-page__section-number" aria-hidden="true">
                  <Transition name="nt-mark" mode="out-in">
                    <svg
                      v-if="stepDone.note"
                      key="done"
                      class="new-appointment-page__section-check"
                      viewBox="0 0 16 16"
                      focusable="false"
                    >
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                    <span v-else key="number">4</span>
                  </Transition>
                </span>
                <div class="new-appointment-page__section-stack">
                  <h2 class="new-appointment-page__section-title">
                    Nota (opcional)<span v-if="stepDone.note" class="new-appointment-page__sr-only">
                      (listo)</span
                    >
                  </h2>
                  <p class="new-appointment-page__section-hint">
                    Agrega información adicional si es necesario.
                  </p>
                </div>
              </div>

              <div class="new-appointment-page__section-body">
                <div
                  class="new-appointment-page__field"
                  :class="{
                    'new-appointment-page__field--filled': !!customerNote,
                    'new-appointment-page__field--error': attempted && !!fieldErrors.customerNote,
                  }"
                >
                  <label for="new-appointment-note" class="new-appointment-page__label">
                    Nota (opcional)
                  </label>
                  <!-- Caja multilínea con contador (atlas evento 08): el tope
                       del contador es el de `validateCustomerNote`, y no se
                       fija `maxlength` para que un exceso siga produciendo el
                       mensaje de validación real en vez de truncarse en
                       silencio. -->
                  <textarea
                    id="new-appointment-note"
                    ref="noteRef"
                    v-model="customerNote"
                    class="new-appointment-page__textarea"
                    rows="2"
                    :aria-invalid="attempted && !!fieldErrors.customerNote"
                    :aria-describedby="
                      attempted && fieldErrors.customerNote
                        ? 'new-appointment-note-error'
                        : 'new-appointment-note-counter'
                    "
                  />
                  <div class="new-appointment-page__field-foot">
                    <span
                      v-if="attempted && fieldErrors.customerNote"
                      id="new-appointment-note-error"
                      class="new-appointment-page__error"
                      role="alert"
                    >
                      {{ fieldErrors.customerNote }}
                    </span>
                    <span v-else />
                    <span id="new-appointment-note-counter" class="new-appointment-page__counter">
                      {{ customerNote.length }}/{{ NOTE_MAX_LENGTH }}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <!-- Columna lateral: alerta global, boleto del turno y acciones, en ese
             orden. En escritorio se queda pegada a la vista mientras el
             formulario se desplaza, así Registrar y Cancelar siempre están a
             mano; en móvil la retícula colapsa y cae después del último paso,
             que es donde especificacion-frontend-nava.md §7.3 pide el resumen
             antes del CTA. -->
        <aside class="new-appointment-page__rail">
          <!-- El titular de la alerta va en el cuerpo, no en el prop `title`
               de BaseAlert: ese prop compone un <h4> y esta pantalla ya tiene
               un <h2> por banda, así que un titular de alerta rompería el
               orden de encabezados (axe `heading-order`). -->
          <BaseAlert v-if="saveStatus === 'conflict'" variant="danger" role="alert">
            <span class="new-appointment-page__alert-title">{{ saveErrorDetail }}</span>
          </BaseAlert>
          <BaseAlert v-else-if="saveStatus === 'validation-error'" variant="danger" role="alert">
            <span class="new-appointment-page__alert-title">
              {{ saveErrorDetail ?? 'Revisa los datos del turno.' }}
            </span>
          </BaseAlert>
          <BaseAlert
            v-else-if="saveStatus === 'idempotency-conflict'"
            variant="danger"
            role="alert"
          >
            Este intento ya estaba en curso o cambió mientras se procesaba. Recarga la página e
            inténtalo de nuevo.
          </BaseAlert>
          <BaseAlert v-else-if="saveStatus === 'not-found'" variant="danger" role="alert">
            {{ v.TheProfessional }} o el servicio elegidos ya no están disponibles.
          </BaseAlert>
          <BaseAlert
            v-else-if="saveStatus === 'network-error' || saveStatus === 'unexpected-error'"
            variant="danger"
            role="alert"
          >
            No pudimos registrar el turno. Tus datos se conservaron; inténtalo de nuevo.
          </BaseAlert>

          <!-- Boleto del turno: se llena mientras se escribe. Lo pendiente se
               nombra en tenue («Por elegir») en vez de ocultarse, para que la
               forma del boleto no salte con cada campo. -->
          <div
            class="new-appointment-page__resumen"
            aria-labelledby="new-appointment-resumen-title"
          >
            <div class="new-appointment-page__resumen-head">
              <h2 id="new-appointment-resumen-title" class="new-appointment-page__resumen-title">
                Resumen
              </h2>
              <span class="new-appointment-page__resumen-progress">
                {{ requiredStepsDone }}/{{ REQUIRED_STEPS }} pasos
              </span>
            </div>

            <div class="new-appointment-page__resumen-when">
              <Transition name="nt-swap" mode="out-in">
                <span
                  :key="startsAtTime || 'empty'"
                  class="new-appointment-page__resumen-time"
                  :class="{ 'new-appointment-page__resumen-time--empty': !startsAtTime }"
                >
                  {{ startsAtTime || '--:--' }}
                </span>
              </Transition>
              <Transition name="nt-swap" mode="out-in">
                <span :key="summaryDateLabel || 'empty'" class="new-appointment-page__resumen-date">
                  {{ summaryDateLabel || 'Fecha por definir' }}
                </span>
              </Transition>
            </div>

            <div class="new-appointment-page__resumen-perforation" aria-hidden="true" />

            <dl class="new-appointment-page__resumen-list">
              <div v-if="!hideBarberField" class="new-appointment-page__resumen-item">
                <dt class="new-appointment-page__resumen-label">{{ v.Professional }}</dt>
                <dd class="new-appointment-page__resumen-value">
                  <Transition name="nt-swap" mode="out-in">
                    <span
                      v-if="selectedBarberName"
                      :key="selectedBarberName"
                      class="new-appointment-page__resumen-swap"
                    >
                      <BarberAvatar :full-name="selectedBarberName" size="closed" />
                      <span>{{ selectedBarberName }}</span>
                    </span>
                    <span
                      v-else
                      key="empty"
                      class="new-appointment-page__resumen-swap new-appointment-page__resumen-value--empty"
                    >
                      Por elegir
                    </span>
                  </Transition>
                </dd>
              </div>
              <div class="new-appointment-page__resumen-item">
                <dt class="new-appointment-page__resumen-label">Servicio</dt>
                <dd class="new-appointment-page__resumen-value">
                  <Transition name="nt-swap" mode="out-in">
                    <span
                      :key="selectedServiceName || 'empty'"
                      class="new-appointment-page__resumen-swap"
                      :class="{
                        'new-appointment-page__resumen-value--empty': !selectedServiceName,
                      }"
                    >
                      {{ selectedServiceName || 'Por elegir' }}
                    </span>
                  </Transition>
                </dd>
              </div>
              <div class="new-appointment-page__resumen-item">
                <dt class="new-appointment-page__resumen-label">Persona atendida</dt>
                <dd
                  class="new-appointment-page__resumen-value"
                  :class="{ 'new-appointment-page__resumen-value--empty': !attendeeName.trim() }"
                >
                  {{ attendeeName.trim() || 'Por escribir' }}
                </dd>
              </div>
            </dl>
          </div>

          <!-- Acciones del formulario: Registrar es la acción principal y
               Cancelar vuelve a la agenda sin guardar. -->
          <div class="new-appointment-page__actions">
            <BaseButton
              type="submit"
              variant="primary"
              class="new-appointment-page__submit"
              :disabled="saveStatus === 'saving'"
            >
              {{ saveStatus === 'saving' ? 'Guardando…' : 'Registrar turno' }}
            </BaseButton>
            <BaseButton
              type="button"
              variant="ghost"
              class="new-appointment-page__cancel"
              :disabled="saveStatus === 'saving'"
              @click="onCancel"
            >
              Cancelar
            </BaseButton>
          </div>
        </aside>
      </form>
    </template>
  </section>
</template>

<style scoped>
/* Superficie de tinta de punta a punta, igual que /panel: el formulario vive
   SOBRE el canvas, no sobre tarjetas de pergamino (atlas nuevo-turno-eventos,
   "Contrato visual común"). Móvil primero (viewport 420 del atlas); la escala
   de escritorio (1440) entra en @media (min-width: 1024px). */
.new-appointment-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
  padding: 20px;
  /* Transparente: la tinta y el fondo animado los pone el cascarón. */
  background: transparent;
}

.new-appointment-page__header {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.new-appointment-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 1.05;
  font-weight: var(--font-weight-h1);
  color: var(--color-on-strong);
}

.new-appointment-page__timezone {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  color: var(--color-on-strong-muted);
}

/* ---------------------------------------------------------------- retícula */

.new-appointment-page__layout {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'form' 'rail';
  row-gap: 16px;
}

.new-appointment-page__form {
  grid-area: form;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.new-appointment-page__rail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: nt-rise 460ms cubic-bezier(0.2, 0.7, 0.2, 1) 260ms backwards;
}

.new-appointment-page__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ------------------------------------------------------ hoja del formulario */

/* Las cuatro secciones son pasos de UNA hoja, no cuatro tarjetas sueltas: la
   línea vertical de los pasos es lo que las une. */
.new-appointment-page__sheet {
  --step-size: 30px;
  --step-col: 30px;
  --step-gap: 14px;

  position: relative;
  padding: 6px 16px;
  background-color: color-mix(in srgb, var(--color-on-strong) 3.5%, transparent);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 10%, transparent);
  border-radius: 4px;
}

.new-appointment-page__section {
  position: relative;
  display: grid;
  grid-template-columns: var(--step-col) minmax(0, 1fr);
  column-gap: var(--step-gap);
  row-gap: 14px;
  padding: 18px 0;
  /* `backwards`, no `both`: terminada la entrada no queda ningún efecto de
     animación sobre el paso. Con `both` el `transform` final dejaba a cada
     paso con su propio contexto de apilamiento y la lista desplegable del
     barbero (paso 1) quedaba debajo del paso 2. */
  animation: nt-rise 460ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: calc(var(--i, 0) * 70ms);
}

/* Tramo de la línea de progreso: baja desde la cifra de este paso hasta la
   del siguiente. El filete neutro es el carril; el acento lo recorre con
   `scaleY` cuando el paso queda resuelto. */
.new-appointment-page__section:not(:last-child)::before,
.new-appointment-page__section:not(:last-child)::after {
  content: '';
  position: absolute;
  top: calc(18px + var(--step-size) + 6px);
  bottom: -12px;
  left: calc(var(--step-col) / 2 - 1px);
  width: 2px;
  border-radius: 1px;
  pointer-events: none;
}

.new-appointment-page__section:not(:last-child)::before {
  background-color: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
}

.new-appointment-page__section:not(:last-child)::after {
  background-color: var(--color-brand-accent-surface);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform 520ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.new-appointment-page__section--done:not(:last-child)::after {
  transform: scaleY(1);
}

/* La cabecera ocupa las dos columnas: cifra en la columna de la línea y el
   título junto a ella; los campos caen bajo el título, alineados con él. */
.new-appointment-page__section-head {
  display: contents;
}

.new-appointment-page__section-number {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--step-size);
  height: var(--step-size);
  grid-column: 1;
  grid-row: 1;
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-brand-accent-surface) 60%, transparent);
  border-radius: 50%;
  font-family: var(--font-display);
  font-size: var(--font-size-body);
  line-height: 1;
  color: var(--color-brand-accent-surface);
  background-color: var(--color-surface-strong);
  transition:
    background-color 260ms ease,
    border-color 260ms ease,
    color 260ms ease,
    box-shadow 260ms ease;
}

.new-appointment-page__section--done .new-appointment-page__section-number {
  border-color: var(--color-brand-accent-surface);
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-brand-accent-surface) 18%, transparent);
}

.new-appointment-page__section-check {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.new-appointment-page__section-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  grid-column: 2;
  grid-row: 1;
  min-height: var(--step-size);
}

.new-appointment-page__section-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-h3);
  line-height: 1.15;
  font-weight: 400;
  color: var(--color-on-strong);
}

.new-appointment-page__section-hint {
  margin: 2px 0 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: 18px;
  color: var(--color-on-strong-muted);
  text-wrap: balance;
}

.new-appointment-page__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.new-appointment-page__section-body {
  display: flex;
  flex-direction: column;
  gap: 13px;
  grid-column: 2;
  min-width: 0;
}

.new-appointment-page__row {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.new-appointment-page__row > * {
  flex: 1 1 0;
  min-width: 0;
}

/* Teléfono angosto (< 640 px): los campos toman el ancho completo bajo la
   cabecera del paso y la línea de progreso se reemplaza por un filete entre
   pasos; en 320 px la columna de la línea dejaba los campos demasiado
   estrechos. */
@media (max-width: 639px) {
  .new-appointment-page__section-body {
    grid-column: 1 / -1;
  }

  .new-appointment-page__section:not(:last-child)::before,
  .new-appointment-page__section:not(:last-child)::after {
    display: none;
  }

  .new-appointment-page__section + .new-appointment-page__section {
    border-top: var(--border-width-normal) solid
      color-mix(in srgb, var(--color-on-strong) 10%, transparent);
  }
}

@media (min-width: 640px) {
  .new-appointment-page__row {
    flex-direction: row;
    gap: 16px;
  }
}

.new-appointment-page__hint {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-caption);
  line-height: 17px;
  color: var(--color-on-strong-muted);
}

/* ------------------------------------------------- campos reglados sobre tinta */

.new-appointment-page__field {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.new-appointment-page__label {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

/* El campo reglado sobre tinta se resuelve redefiniendo los tokens que
   BaseInput ya expone (--input-bg / --input-border-color /
   --input-border-base-color), en el ámbito de esta página: shared/ui sigue
   calibrado para superficie clara, que es donde vive en el resto de la app
   (auth-eventos, diálogos de configuración). */
.new-appointment-page :deep(.base-input) {
  --input-height: 46px;
  --input-padding-x: 13px;
  --input-font-size: var(--font-size-body);
  --input-line-height: 1.3;
  --input-bg: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  --input-border-color: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  --input-border-base-color: color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  --input-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);

  color: var(--color-on-strong);
}

.new-appointment-page :deep(.base-input__wrapper) {
  gap: 6px;
}

/* El teléfono usa el tono de tinta de PhoneField con la misma piel del campo
   reglado de esta página: antes iba en tono papel y el prefijo se veía como
   una casilla blanca sobre la tinta (issue #575). */
.new-appointment-page :deep(.phone-field) {
  --pf-row-bg: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  --pf-row-bg-hover: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  --pf-row-bg-focus: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  --pf-line-strong: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  --pf-row-base: color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  --pf-text: var(--color-on-strong);
  --pf-muted: var(--color-on-strong-muted);
  --pf-ring-gap: var(--color-surface-strong);
}

.new-appointment-page :deep(.new-appointment-page__input--filled .phone-field__row) {
  border-bottom-color: var(--color-brand-accent-surface);
}

.new-appointment-page :deep(.base-input__label) {
  font-size: var(--font-size-caption);
  line-height: 14px;
  letter-spacing: 0.14em;
}

/* Asterisco de obligatorio en latón, nunca en rojo: el rojo se reserva para
   error (atlas, "Contrato visual común"). El margen negativo absorbe el
   espacio en blanco que la plantilla de BaseInput deja entre el rótulo y el
   asterisco: en versalitas espaciadas ese espacio se lee como un asterisco
   suelto, y el atlas lo pega al rótulo ("PERSONA ATENDIDA*"). */
.new-appointment-page :deep(.base-input__required),
.new-appointment-page__required {
  margin-left: -5px;
  color: var(--color-brand-accent-surface);
}

.new-appointment-page :deep(.base-input::placeholder) {
  color: var(--color-on-strong-muted);
  opacity: 1;
}

.new-appointment-page :deep(.base-input:hover:not(:disabled):not(.base-input--invalid)) {
  border-color: color-mix(in srgb, var(--color-on-strong) 26%, transparent);
}

/* El latón del filete inferior marca el campo YA RESUELTO; uno vacío lleva
   filete neutro. Ocho subrayados dorados a la vez convertían el formulario en
   un muestrario de oro y ya no distinguían lo hecho de lo pendiente (compara
   los eventos 04, 05 y 08 del atlas). */
.new-appointment-page :deep(.new-appointment-page__input--filled .base-input) {
  background-color: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.new-appointment-page :deep(.base-input:disabled),
.new-appointment-page :deep(.base-input--disabled) {
  background-color: var(--input-bg);
  border-color: var(--input-border-color);
  border-bottom-color: color-mix(in srgb, var(--color-on-strong) 20%, transparent);
  color: var(--color-on-strong-muted);
  opacity: 0.45;
}

.new-appointment-page :deep(.base-input--invalid) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 7%, transparent);
  border-color: var(--input-border-color);
  border-bottom-color: var(--color-danger-on-strong);
}

.new-appointment-page :deep(.base-input__error) {
  font-size: var(--font-size-caption);
  line-height: 16px;
  font-weight: 600;
  color: var(--color-danger-on-strong);
}

/* El control nativo de fecha/hora pinta su propio icono de calendario/reloj;
   el atlas compone estos dos campos como texto reglado, igual que /panel. El
   campo entero sigue abriendo el selector nativo al hacer clic. */
.new-appointment-page :deep(.base-input::-webkit-calendar-picker-indicator) {
  display: none;
}

/* Selector de servicio: `<select>` nativo (accesibilidad y comportamiento
   intactos) con la misma piel del campo reglado y el caret de latón del
   atlas. */
.new-appointment-page__select-wrap {
  position: relative;
  display: flex;
}

.new-appointment-page__select {
  width: 100%;
  height: 46px;
  padding: 0 34px 0 13px;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: 1.3;
  color: var(--color-on-strong);
  background-color: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-bottom: var(--border-width-emphasis) solid
    color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  border-radius: 2px;
  outline: none;
  appearance: none;
}

/* La lista desplegada la pinta el sistema operativo sobre superficie clara:
   sin esto, texto marfil sobre blanco. */
.new-appointment-page__select option {
  color: var(--color-text-primary);
  background-color: var(--color-surface);
}

.new-appointment-page__select:focus-visible {
  border-color: var(--color-focus);
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.new-appointment-page__select:disabled {
  cursor: not-allowed;
}

.new-appointment-page__caret {
  position: absolute;
  top: 50%;
  right: 14px;
  width: 7px;
  height: 7px;
  border-right: var(--border-width-normal) solid var(--color-brand-accent-surface);
  border-bottom: var(--border-width-normal) solid var(--color-brand-accent-surface);
  transform: translateY(-70%) rotate(45deg);
  pointer-events: none;
}

.new-appointment-page__field--filled .new-appointment-page__select {
  background-color: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

/* Deshabilitado (servicio sin barbero elegido o cargando): se atenúa y pierde
   el latón, nunca lo conserva (atlas eventos 04 y 05). */
.new-appointment-page__field--off .new-appointment-page__select,
.new-appointment-page__field--off .new-appointment-page__caret {
  opacity: 0.45;
}

.new-appointment-page__field--off .new-appointment-page__select {
  border-bottom-color: color-mix(in srgb, var(--color-on-strong) 20%, transparent);
}

.new-appointment-page__field--error .new-appointment-page__select,
.new-appointment-page__field--error .new-appointment-page__textarea {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 7%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

/* Selector de barbero (BarberSelect, con monograma): misma altura y piel que
   el resto de los campos de esta hoja. Sobre /panel el control vive suelto y
   siempre lleva su línea de latón; aquí obedece la misma regla de "resuelto"
   que los demás. */
.new-appointment-page__field :deep(.barber-select__trigger) {
  min-height: 46px;
  padding: 0 13px;
  gap: 10px;
  font-size: var(--font-size-body);
  background-color: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  border-color: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-bottom-color: color-mix(in srgb, var(--color-on-strong) 30%, transparent);
}

.new-appointment-page__field--filled :deep(.barber-select__trigger) {
  background-color: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.new-appointment-page__field--error :deep(.barber-select__trigger) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 7%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

/* Sin barbero elegido el disparador dibuja un cuadrado vacío del tamaño del
   monograma; el atlas deja el campo con solo su placeholder. */
.new-appointment-page__field :deep(.barber-select__trigger-icon) {
  display: none;
}

.new-appointment-page__field :deep(.barber-select__trigger-label--placeholder) {
  color: var(--color-on-strong-muted);
}

.new-appointment-page__textarea {
  width: 100%;
  min-height: 70px;
  padding: 12px 13px;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: 1.3;
  color: var(--color-on-strong);
  background-color: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-bottom: var(--border-width-emphasis) solid
    color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  border-radius: 2px;
  outline: none;
  overflow-y: hidden;
  resize: none;
}

.new-appointment-page__textarea:focus-visible {
  border-color: var(--color-focus);
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.new-appointment-page__field--filled .new-appointment-page__textarea {
  background-color: color-mix(in srgb, var(--color-on-strong) 6%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.new-appointment-page__field-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.new-appointment-page__counter {
  font-family: var(--font-family-base);
  font-size: var(--font-size-caption);
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
}

.new-appointment-page__error {
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-caption);
  line-height: 16px;
  font-weight: 600;
  color: var(--color-danger-on-strong);
}

.new-appointment-page__note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-caption);
  line-height: 16px;
  color: var(--color-on-strong-muted);
}

.new-appointment-page__note--loading {
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.new-appointment-page__note--warning {
  color: var(--color-warning-on-strong);
}

.new-appointment-page__note--danger {
  color: var(--color-danger-on-strong);
}

.new-appointment-page__note-spinner {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  border: 1.5px solid color-mix(in srgb, var(--color-brand-accent-surface) 22%, transparent);
  border-top-color: var(--color-brand-accent-surface);
  border-right-color: var(--color-brand-accent-surface);
  border-radius: 50%;
  transform: rotate(-38deg);
}

/* -------------------------------------------------------------- resumen */

/* Boleto del turno: superficie elevada con la hora como protagonista, una
   línea perforada con muescas a los lados y los datos debajo. Es la misma
   metáfora de boleto que usa «Mi turno» en la reserva pública. */
.new-appointment-page__resumen {
  --ticket-bg: var(--color-field-strong-raised);
  --ticket-pad: 16px;

  position: relative;
  padding: var(--ticket-pad);
  background-color: var(--ticket-bg);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  border-top: 3px solid var(--color-brand-accent-surface);
  border-radius: 4px;
  box-shadow: 0 18px 40px -28px rgb(0 0 0 / 0.55);
}

.new-appointment-page__resumen-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.new-appointment-page__resumen-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-brand-accent-surface);
}

.new-appointment-page__resumen-progress {
  font-family: var(--font-family-base);
  font-size: var(--font-size-caption);
  line-height: 14px;
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
}

.new-appointment-page__resumen-when {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
}

.new-appointment-page__resumen-time {
  font-family: var(--font-display);
  font-size: 44px;
  line-height: 1;
  color: var(--color-on-strong);
  font-variant-numeric: tabular-nums;
}

.new-appointment-page__resumen-time--empty {
  font-family: var(--font-sans);
  font-weight: 300;
  letter-spacing: 0.06em;
  color: var(--color-on-strong-muted);
}

.new-appointment-page__resumen-date {
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  color: var(--color-on-strong-muted);
}

.new-appointment-page__resumen-date::first-letter {
  text-transform: uppercase;
}

/* Perforación: filete punteado de borde a borde con dos muescas del color
   del lienzo en los extremos. */
.new-appointment-page__resumen-perforation {
  position: relative;
  height: 0;
  margin: 16px calc(var(--ticket-pad) * -1);
  border-top: 2px dashed color-mix(in srgb, var(--color-on-strong) 16%, transparent);
}

.new-appointment-page__resumen-perforation::before,
.new-appointment-page__resumen-perforation::after {
  content: '';
  position: absolute;
  top: -9px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: var(--color-surface-strong);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-on-strong) 12%, transparent);
}

.new-appointment-page__resumen-perforation::before {
  left: -9px;
  clip-path: inset(0 0 0 50%);
}

.new-appointment-page__resumen-perforation::after {
  right: -9px;
  clip-path: inset(0 50% 0 0);
}

.new-appointment-page__resumen-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}

.new-appointment-page__resumen-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.new-appointment-page__resumen-label {
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-on-strong-muted);
}

.new-appointment-page__resumen-value {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  margin: 0;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body);
  line-height: 21px;
  font-weight: 600;
  color: var(--color-on-strong);
  overflow-wrap: anywhere;
}

.new-appointment-page__resumen-swap {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.new-appointment-page__resumen-value--empty {
  font-weight: 400;
  font-style: italic;
  color: var(--color-on-strong-muted);
}

/* ------------------------------------------------------- alerta y acciones */

/* Botón primario sólido en latón sobre el canvas de tinta: BaseButton
   --primary está calibrado en tinta para superficie clara, que es lo correcto
   en el resto de la app. El prefijo `.new-appointment-page` sube la
   especificidad por encima de `.base-button--primary:hover:not(...)` para que
   el orden de inserción de los estilos del componente no decida el resultado.
   En `saving` se atenúa por opacidad y su rótulo cambia a «Guardando…», sin
   duplicar un segundo indicador de carga. */
.new-appointment-page .new-appointment-page__submit {
  width: 100%;
  height: 48px;
  padding: 0 22px;
  font-size: var(--font-size-body);
  font-weight: 600;
  letter-spacing: 0.02em;
  background-color: var(--color-brand-accent-surface);
  border-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  transition:
    filter var(--motion-duration-base) ease,
    transform var(--motion-duration-base) ease,
    box-shadow var(--motion-duration-base) ease;
}

.new-appointment-page .new-appointment-page__submit:hover:not(:disabled) {
  background-color: var(--color-brand-accent-surface);
  border-color: var(--color-brand-accent-surface);
  filter: brightness(106%);
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -14px var(--color-brand-accent-surface);
}

/* Cancelar: acción secundaria sin relleno, el mismo transparente de los
   botones de cierre de los diálogos. Nunca compite con Registrar. */
.new-appointment-page .new-appointment-page__cancel {
  width: 100%;
  height: 44px;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-on-strong-muted);
  background-color: transparent;
  border-color: transparent;
}

.new-appointment-page .new-appointment-page__cancel:hover:not(:disabled) {
  color: var(--color-on-strong);
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent);
  border-color: transparent;
}

.new-appointment-page .new-appointment-page__cancel:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.new-appointment-page .new-appointment-page__submit:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.new-appointment-page .new-appointment-page__submit:disabled {
  opacity: 0.55;
}

/* La acción del éxito es el mismo botón sólido en latón, pero centrado bajo
   la ficha y sin la medida completa del CTA del formulario (atlas evento
   12). */
.new-appointment-page .new-appointment-page__state .new-appointment-page__submit {
  width: auto;
  align-self: center;
}

/* Alerta de tinta del sistema (DEC-149): solo se ajusta la medida a la
   densidad de esta pantalla; el lienzo, el perímetro y los colores son los
   de BaseAlert. */
.new-appointment-page :deep(.base-alert) {
  --alert-padding: 13px 15px;
  --alert-title-size: 16px;
  --alert-font-size: var(--font-size-body-sm);
  --alert-line-height: 20px;
}

.new-appointment-page :deep(.base-alert__status) {
  font-size: var(--font-size-caption);
  line-height: 14px;
  letter-spacing: 0.15em;
}

.new-appointment-page__alert-title {
  display: block;
  font-size: var(--font-size-body);
  line-height: 23px;
  font-weight: 600;
  color: var(--color-surface-strong);
}

/* ------------------------------------------------- estados de página completos */

/* El destino nombrado dentro del mensaje se resalta en latón, igual que
   «Barberos» en el evento 04 del atlas de /panel. */
.new-appointment-page__dest {
  font-weight: 600;
  color: var(--color-brand-accent-surface);
}

/* PageState fija su color de marca por estilo en línea, calibrado para los
   pares claros del sistema: sobre tinta, #9a6a24 (atención) y #325d43
   (confirmación) no alcanzan AA. Aquí se levantan a los tintes sobre tinta
   del atlas; el `!important` es la única forma de ganarle a un estilo en
   línea, y queda contenido en esta pantalla para no alterar /panel, que ya
   se validó con su propio atlas. */
.new-appointment-page__state {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.new-appointment-page__state :deep(.page-state) {
  max-width: 330px;
  margin-inline: auto;
  padding: 34px 0;
  gap: 12px;
}

.new-appointment-page__state :deep(.page-state__divider) {
  width: 166px;
}

.new-appointment-page__state--warning :deep(.page-state) {
  --page-state-mark: var(--color-warning-on-strong) !important;
}

.new-appointment-page__state--success :deep(.page-state) {
  --page-state-mark: var(--color-success-on-strong) !important;
}

.new-appointment-page__ticket,
.new-appointment-page__success-note {
  display: block;
}

/* Ficha del turno recién creado: pergamino, el mismo material con el que la
   agenda dibuja un turno vigente. */
.new-appointment-page__ticket {
  padding: 13px 15px;
  margin-bottom: 12px;
  font-size: var(--font-size-body);
  line-height: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: left;
  color: var(--color-text-primary);
  background-color: var(--color-surface-muted);
  border-left: 3px solid var(--color-accent-brass);
  border-radius: 2px;
}

/* ------------------------------------------------------------- movimiento */

/* Entrada escalonada: cada paso sube unos píxeles y aparece, uno tras otro;
   el boleto llega al final. Solo `transform` y `opacity`. */
@keyframes nt-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

/* Cifra ↔ marca de listo: la marca entra con un pequeño rebote. */
.nt-mark-enter-active {
  transition:
    transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 200ms ease;
}

.nt-mark-leave-active {
  transition:
    transform 140ms ease,
    opacity 140ms ease;
}

.nt-mark-enter-from,
.nt-mark-leave-to {
  opacity: 0;
  transform: scale(0.4);
}

/* Datos del boleto: el valor viejo sale hacia arriba y el nuevo entra desde
   abajo, como una ficha que se reemplaza. */
.nt-swap-enter-active,
.nt-swap-leave-active {
  transition:
    transform 180ms ease,
    opacity 180ms ease;
}

.nt-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.nt-swap-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.new-appointment-page__state {
  animation: nt-rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
}

/* Movimiento reducido (sistema o preferencia de la cuenta, DEC-110): la
   pantalla aparece ya compuesta y los cambios son instantáneos. */
@media (prefers-reduced-motion: reduce) {
  .new-appointment-page__section,
  .new-appointment-page__rail,
  .new-appointment-page__state {
    animation: none;
  }

  .new-appointment-page__section::after,
  .new-appointment-page__section-number,
  .new-appointment-page .new-appointment-page__submit,
  .nt-mark-enter-active,
  .nt-mark-leave-active,
  .nt-swap-enter-active,
  .nt-swap-leave-active {
    transition: none;
  }

  .new-appointment-page .new-appointment-page__submit:hover:not(:disabled) {
    transform: none;
  }
}

:root[data-motion='reduced'] .new-appointment-page__section,
:root[data-motion='reduced'] .new-appointment-page__rail,
:root[data-motion='reduced'] .new-appointment-page__state {
  animation: none;
}

:root[data-motion='reduced'] .new-appointment-page__section::after,
:root[data-motion='reduced'] .new-appointment-page__section-number,
:root[data-motion='reduced'] .new-appointment-page .new-appointment-page__submit,
:root[data-motion='reduced'] .nt-mark-enter-active,
:root[data-motion='reduced'] .nt-mark-leave-active,
:root[data-motion='reduced'] .nt-swap-enter-active,
:root[data-motion='reduced'] .nt-swap-leave-active {
  transition: none;
}

:root[data-motion='reduced']
  .new-appointment-page
  .new-appointment-page__submit:hover:not(:disabled) {
  transform: none;
}

/* ------------------------------------------------------------- escritorio */

@media (min-width: 1024px) {
  .new-appointment-page {
    gap: 18px;
    padding: 22px 40px 24px;
  }

  .new-appointment-page__title {
    font-size: var(--font-size-title-page);
  }

  .new-appointment-page__timezone {
    font-size: var(--font-size-body);
    line-height: 22px;
  }

  /* Formulario y boleto lado a lado; el boleto (con las acciones) se queda
     pegado a la vista mientras el formulario se desplaza. */
  .new-appointment-page__layout {
    grid-template-columns: minmax(0, 1fr) 340px;
    grid-template-areas: 'form rail';
    column-gap: 28px;
    row-gap: 0;
    max-width: 1240px;
  }

  .new-appointment-page__rail {
    position: sticky;
    top: 16px;
  }

  .new-appointment-page__sheet {
    --step-size: 34px;
    --step-col: 34px;
    --step-gap: 18px;

    padding: 4px 28px;
  }

  .new-appointment-page__section {
    padding: 22px 0;
  }

  .new-appointment-page__section:not(:last-child)::before,
  .new-appointment-page__section:not(:last-child)::after {
    top: calc(22px + var(--step-size) + 6px);
    bottom: -16px;
  }

  .new-appointment-page__section-number {
    font-size: var(--font-size-body-lg);
  }

  .new-appointment-page__section-title {
    font-size: var(--font-size-title-item);
  }

  .new-appointment-page__section-hint {
    margin-top: 3px;
  }

  .new-appointment-page__section-body {
    gap: 14px;
  }

  .new-appointment-page__row {
    gap: 20px;
  }

  .new-appointment-page__hint {
    font-size: var(--font-size-body-sm);
    line-height: 18px;
  }

  .new-appointment-page__field {
    gap: 7px;
  }

  .new-appointment-page__label,
  .new-appointment-page :deep(.base-input__label) {
    font-size: var(--font-size-caption);
    line-height: 15px;
  }

  .new-appointment-page :deep(.base-input__wrapper) {
    gap: 7px;
  }

  .new-appointment-page :deep(.base-input) {
    --input-padding-x: 14px;
  }

  .new-appointment-page__select {
    padding: 0 34px 0 14px;
  }

  .new-appointment-page__textarea {
    min-height: 74px;
    padding: 12px 14px;
  }

  .new-appointment-page__counter {
    font-size: var(--font-size-caption);
  }

  .new-appointment-page__resumen {
    --ticket-pad: 20px;
  }

  .new-appointment-page__resumen-time {
    font-size: 52px;
  }

  .new-appointment-page__resumen-title {
    font-size: var(--font-size-caption);
    line-height: 15px;
  }

  .new-appointment-page__resumen-value {
    gap: 10px;
    font-size: var(--font-size-body);
    line-height: 22px;
  }

  .new-appointment-page .new-appointment-page__state .new-appointment-page__submit {
    min-width: 0;
  }

  .new-appointment-page :deep(.base-alert) {
    --alert-padding: 15px 18px;
    --alert-title-size: 17px;
    --alert-font-size: var(--font-size-body);
    --alert-line-height: 22px;
  }

  .new-appointment-page :deep(.base-alert__status) {
    font-size: var(--font-size-caption);
    line-height: 15px;
  }

  .new-appointment-page__alert-title {
    font-size: var(--font-size-body-lg);
    line-height: 24px;
  }

  .new-appointment-page__state :deep(.page-state) {
    max-width: 520px;
    padding: 40px 0;
    gap: 14px;
  }

  .new-appointment-page__state :deep(.page-state__divider) {
    width: 220px;
  }

  .new-appointment-page__ticket {
    padding: 14px 18px;
    font-size: var(--font-size-body);
    line-height: 23px;
  }
}
</style>
