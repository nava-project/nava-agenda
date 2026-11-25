<script setup lang="ts">
// Pantalla "Nuevo turno" (HU-061): el profesional autenticado registra un
// turno manual recibido por teléfono, WhatsApp o en persona. La hora se elige
// sobre los inicios libres reales (#717, DEC-190: ManualStartPicker), con
// «Otra hora» para escribirla a mano; no edita,
// reprograma, cancela ni cambia estado (fuera de alcance de HU-061). El
// éxito muestra un resumen honesto: HU-062 (agenda diaria) no es destino de
// este enlace, así que esta pantalla no enlaza a ninguna vista de agenda.
//
// Fidelidad visual con el atlas nuevo-turno-eventos (issue #190, segundo
// pase del 2026-09-04): esta revisión es exclusivamente de composición,
// color, jerarquía y estado visual, nunca de comportamiento. Los comentarios
// que citan un evento del atlas (nava-docs/agenda/10-backlog/evidence/
// ui-mockups-nava-tailored-grid-2026-09-03/nuevo-turno-eventos/README.md)
// documentan a qué panel responde cada bloque.
// El resumen de éxito es el resultado persistente; el aviso emergente lo
// acompaña (DEC-095).
//
// Rediseño del issue #576 (identidad guiada, sin mockup asignado): la
// composición pasa a pasos con línea de progreso y un boleto lateral que se
// llena mientras se escribe, con las acciones —Registrar y Cancelar— pegadas
// a él. Campos, validaciones, contrato y envío no cambian.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { useVocabulary } from '@/shared/composables'
import { worksOwnProfessional } from '@/shared/model'
import { sessionBusinessName } from '@/modules/auth'
import {
  AppointmentTicket,
  BaseAlert,
  BaseButton,
  BaseInput,
  PageState,
  PhoneField,
  ProfessionalSelect,
  SunDiamond,
} from '@/shared/ui'
import { DEFAULT_PHONE_COUNTRY, composePhone } from '@/shared/model/phoneCountries'
import { isCivilDateString } from '@/shared/time/civilDate'
import { readableMoney } from '@/shared/model/money'
import { civilTicketMoment, ticketMoment } from '@/shared/time/ticketMoment'
import {
  createManualAppointment,
  fetchAssignedServices,
  fetchProfessionalSummaries,
  fetchBusinessTimezone,
} from '../api/appointmentsApi'
import { newIdempotencyKey } from '../model/idempotencyKey'
import type { ProfessionalSummary, ServiceSummary } from '../model/appointment'
import type { CreatedManualAppointment } from '../model/appointmentOutcome'
import NewAppointmentSkeleton from '../components/NewAppointmentSkeleton.vue'
import ManualStartPicker from '../components/ManualStartPicker.vue'
import { timezoneLabel } from '@/shared/time/timezoneName'
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
const professionals = ref<ProfessionalSummary[]>([])
const businessTimezone = ref<string | null>(null)

const selectedProfessionalId = ref('')
const servicesStatus = ref<ServicesStatus>('idle')
const services = ref<ServiceSummary[]>([])
const selectedServiceId = ref('')

const attendeeName = ref('')
const customerFullName = ref('')
// Casi siempre la persona atendida es quien reserva (revisión de #716): el
// nombre del cliente copia al atendido hasta que se edita a mano, para no
// escribir el mismo nombre dos veces en cada turno.
const customerNameEdited = ref(false)
watch(attendeeName, (name) => {
  if (!customerNameEdited.value) customerFullName.value = name
})
function onCustomerNameInput(value: string | number) {
  customerFullName.value = String(value)
  customerNameEdited.value = customerFullName.value !== attendeeName.value
}
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
const startPicker = ref<InstanceType<typeof ManualStartPicker> | null>(null)

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
// Palabras del negocio (DEC-110): con los valores iniciales, el texto de siempre.
const v = useVocabulary()
const hideProfessionalField = computed(
  () => worksOwnProfessional.value && professionals.value.length === 1,
)
const saveStatus = ref<SaveStatus>('idle')
const saveErrorDetail = ref<string | undefined>(undefined)
const created = ref<CreatedManualAppointment | null>(null)
const successHeading = ref<HTMLElement | null>(null)
let idempotencyKey = newIdempotencyKey()

async function loadPage() {
  pageStatus.value = 'loading'
  const [professionalsOutcome, timezoneOutcome] = await Promise.all([
    fetchProfessionalSummaries(),
    fetchBusinessTimezone(),
  ])
  businessTimezone.value = timezoneOutcome.kind === 'success' ? timezoneOutcome.timezone : null
  if (professionalsOutcome.kind !== 'success') {
    pageStatus.value = 'load-error'
    return
  }
  professionals.value = professionalsOutcome.items
  // Perfil de profesional individual (DEC-115): con un solo profesional no hay nada que
  // elegir, así que queda seleccionado y el campo se oculta.
  if (hideProfessionalField.value) selectedProfessionalId.value = professionals.value[0]!.id
  pageStatus.value = 'ready'
}

void loadPage()

watch(selectedProfessionalId, async (professionalId) => {
  selectedServiceId.value = ''
  services.value = []
  if (!professionalId) {
    servicesStatus.value = 'idle'
    return
  }
  servicesStatus.value = 'loading'
  const outcome = await fetchAssignedServices(professionalId)
  if (selectedProfessionalId.value !== professionalId) return
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
const selectedService = computed(() => services.value.find((s) => s.id === selectedServiceId.value))
const selectedProfessional = computed(() =>
  professionals.value.find((b) => b.id === selectedProfessionalId.value),
)

// ── La tarjeta del borrador (#833) ─────────────────────────────────────────
// Muestra lo que de verdad se aplicará: el servidor toma nombre, duración y
// precio del servicio del catálogo. La duración de la lectura de inicios
// libres manda en cuanto llega (la misma fuente que el selector de hora);
// antes, la del catálogo. Un dato que el formulario ya no tiene sale de la
// tarjeta con él.
const pickerDuration = ref<number | null>(null)
watch([selectedProfessionalId, selectedServiceId], () => {
  pickerDuration.value = null
})
function onPickerDuration(minutes: number) {
  pickerDuration.value = minutes
}
const draftDuration = computed(
  () => pickerDuration.value ?? selectedService.value?.durationMinutes ?? null,
)

function ticketMeta(durationMinutes: number | null, price: string, currency: string): string {
  const money = readableMoney(price, currency)
  return [durationMinutes ? `${durationMinutes} min` : '', money ?? ''].filter(Boolean).join(' · ')
}

function rulerLabel(m: { weekday: string; day: string; time: string; endTime: string }): string {
  return `El turno en el día: ${m.weekday.toLocaleLowerCase('es-CO')} ${m.day}, de ${m.time} a ${m.endTime}.`
}

const draftTicket = computed(() => {
  const service = selectedService.value
  const duration = draftDuration.value
  const zone = businessTimezone.value
  // Con fecha y sin hora, la hoja del calendario ya se llena: la hora del
  // cálculo es solo un relleno y no se muestra.
  const civil = isCivilDateString(startsAtDate.value)
    ? civilTicketMoment(startsAtDate.value, startsAtTime.value || '12:00', duration ?? 1)
    : null
  const full = startsAtTime.value && duration ? civil : null
  return {
    serviceName: service?.name ?? '',
    meta: service ? ticketMeta(duration, service.price, service.currency) : '',
    weekday: civil?.weekday ?? '',
    month: civil?.month ?? '',
    day: civil?.day ?? '',
    time: full?.time ?? '',
    timeNote: full
      ? [`hasta ${full.endTime}`, zone ? timezoneLabel(zone) : ''].filter(Boolean).join(' · ')
      : '',
    professionalName: selectedProfessional.value?.fullName ?? '',
    professionalPhotoUrl: selectedProfessional.value?.photoUrl ?? null,
    ruler: full
      ? { from: full.from, to: full.to, at: full.at, label: rulerLabel(full) }
      : undefined,
  }
})

// La misma tarjeta, registrada: con lo que devolvió el servidor.
const createdTicket = computed(() => {
  const c = created.value
  if (!c) return null
  const zone = businessTimezone.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const m = ticketMoment(c.startsAt, c.endsAt, zone)
  const professional = professionals.value.find((b) => b.id === c.professionalId)
  return {
    serviceName: c.serviceName,
    meta: ticketMeta(c.durationMinutes, c.priceAmount, c.currency),
    weekday: m.weekday,
    month: m.month,
    day: m.day,
    time: m.time,
    timeNote: [`hasta ${m.endTime}`, businessTimezone.value ? timezoneLabel(zone) : '']
      .filter(Boolean)
      .join(' · '),
    professionalName: professional?.fullName ?? '',
    professionalPhotoUrl: professional?.photoUrl ?? null,
    ruler: { from: m.from, to: m.to, at: m.at, label: rulerLabel(m) },
  }
})

// Pasos resueltos: encienden la cifra de cada banda, tiñen el tramo de la
// línea de progreso que la une con la siguiente y alimentan el contador del
// boleto. Solo cuentan los tres pasos con campos obligatorios; la nota es
// opcional y nunca bloquea el avance.
const stepDone = computed(() => ({
  selection: !!selectedProfessionalId.value && !!selectedServiceId.value,
  person: !!attendeeName.value.trim() && !!customerFullName.value.trim(),
  when: !!startsAtDate.value && !!startsAtTime.value,
  note: !!customerNote.value.trim(),
}))
const REQUIRED_STEPS = 3
const requiredStepsDone = computed(
  () =>
    [stepDone.value.selection, stepDone.value.person, stepDone.value.when].filter(Boolean).length,
)

// El campo de servicio depende del profesional (DEC-072): sin profesional elegido,
// mientras llegan sus servicios, o sin servicios activos que ofrecer, queda
// deshabilitado y pierde el filete de latón (atlas, eventos 04 y 05).
// Un único anuncio cortés, fuera de la tarjeta (#833, CA-22): cuando el
// borrador queda completo, y otra vez si se rompe y se vuelve a completar.
// Al romperse se vacía, así el mismo texto vuelve a anunciarse. Teclear
// en un campo ya lleno no cambia nada.
const DRAFT_READY = 'Turno listo para registrar.'
const draftAnnouncement = ref('')
watch(
  () => requiredStepsDone.value === REQUIRED_STEPS,
  (complete) => {
    draftAnnouncement.value = complete ? DRAFT_READY : ''
  },
)

const isServiceDisabled = computed(
  () =>
    !selectedProfessionalId.value ||
    servicesStatus.value === 'loading' ||
    (servicesStatus.value !== 'idle' && services.value.length === 0),
)

// Rótulo de la opción vacía del `<select>`: sin esto, un profesional sin
// servicios activos (o cuya carga falló) mostraba "Elige un servicio" como
// única opción, prometiendo una lista que no existe.
const serviceSelectPlaceholder = computed(() => {
  if (!selectedProfessionalId.value) return `Elige primero ${v.value.aProfessional}`
  if (servicesStatus.value === 'loading') return 'Cargando servicios…'
  if (servicesStatus.value === 'error') return 'No pudimos cargar los servicios'
  if (services.value.length === 0) return 'Sin servicios activos asignados'
  return 'Elige un servicio'
})

// Cancelar vuelve a la agenda sin guardar nada. La agenda pasa su profesional y
// su fecha al abrir esta pantalla (`?professionalId=…&date=…`); se devuelven tal
// cual para que la persona aterrice en el mismo día que estaba mirando. Sin
// ellos, la agenda resuelve su selección por defecto.
const route = useRoute()
const router = useRouter()
const agendaOrigin = computed<LocationQueryRaw>(() => {
  const origin: LocationQueryRaw = {}
  const { professionalId, date } = route.query
  if (typeof professionalId === 'string' && professionalId !== '')
    origin.professionalId = professionalId
  if (typeof date === 'string' && isCivilDateString(date)) origin.date = date
  return origin
})

function onCancel() {
  void router.push({ name: 'panel', query: agendaOrigin.value })
}

function validateAll(): boolean {
  const errors: Record<string, string | undefined> = {
    professionalId: selectedProfessionalId.value ? undefined : `Elige ${v.value.aProfessional}.`,
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
      professionalId: selectedProfessionalId.value,
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
      draftAnnouncement.value = ''
      // Sin aviso emergente (#839): la vista de confirmación ya lo es, y a
      // 1024×768 el aviso tapaba el pie de la tarjeta registrada. El foco va
      // al titular desde el primer cuadro, que se anuncia con su nota (la
      // ceremonia corta de la tarjeta no bloquea nada, #833, CA-15).
      await nextTick()
      successHeading.value?.focus()
      return
    case 'conflict':
      saveErrorDetail.value = outcome.detail
      // El conflicto es SIEMPRE sobre el instante elegido: además de la
      // alerta global, el mismo detalle del servidor marca el campo de hora
      // (atlas evento 11, dos niveles de error a la vez). No se inventa
      // texto: es el `detail` que devolvió el API.
      fieldErrors.value = { ...fieldErrors.value, startsAt: outcome.detail }
      saveStatus.value = 'conflict'
      // Alguien tomó la hora entre la lectura y el envío: se vuelve a leer ese
      // día para que la rejilla ya no la ofrezca. El resto del formulario queda.
      void startPicker.value?.refreshDay(startsAtDate.value)
      break
    case 'validation-error':
      saveErrorDetail.value = outcome.detail
      saveStatus.value = 'validation-error'
      break
    case 'idempotency-conflict':
      saveStatus.value = 'idempotency-conflict'
      break
    case 'not-found':
      saveStatus.value = 'not-found'
      break
    case 'network-error':
      saveStatus.value = 'network-error'
      break
    case 'unexpected-error':
      saveStatus.value = 'unexpected-error'
  }
  // Mientras guardaba, el botón estuvo deshabilitado y Firefox suelta el foco de
  // un control deshabilitado (queda en <body>). Si se perdió, vuelve a «Registrar
  // turno», junto a la alerta, para seguir desde ahí con el teclado (#837 r1).
  await nextTick()
  // En el teléfono la alerta empuja el botón hacia el dock: se trae el bloque de
  // la respuesta a la vista con el desplazamiento mínimo (en escritorio ya está
  // pegado al fondo y no se mueve nada).
  document.querySelector('.new-appointment-page__respond')?.scrollIntoView?.({ block: 'nearest' })
  if (!document.activeElement || document.activeElement === document.body) {
    document
      .querySelector<HTMLButtonElement>('.new-appointment-page__submit')
      ?.focus({ preventScroll: true })
  }
}

async function onStartNewAppointment() {
  created.value = null
  draftAnnouncement.value = ''
  pickerDuration.value = null
  attendeeName.value = ''
  customerFullName.value = ''
  customerNameEdited.value = false
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
  // Vuelve al borrador sin restos del cliente anterior (#833, CA-15b): se
  // limpian servicio, día y hora y la persona; el profesional elegido se
  // conserva, porque lo habitual es registrar varios turnos seguidos del
  // mismo profesional. El foco va a Servicio, o a Profesional si no hay uno.
  selectedServiceId.value = ''
  await nextTick()
  document
    .getElementById(
      selectedProfessionalId.value ? 'new-appointment-service' : 'new-appointment-professional',
    )
    ?.focus()
}

// El riel pegado nunca mide más que su contenedor (#833, CA-18b): con la
// tarjeta, los renglones y una alerta puede pasar del alto disponible
// (604 px a 1024×768). Entonces se pega por su borde inferior —`top`
// negativo— y «Registrar turno» queda siempre a la vista; lo de arriba
// sale al desplazar.
const RAIL_GAP = 16
const rail = ref<HTMLElement | null>(null)
const railStickyTop = ref(RAIL_GAP)
let railObserver: ResizeObserver | null = null
// El contenedor que se desplaza, sea cual sea el cascarón que envuelve la página.
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}
function fitRail() {
  const el = rail.value
  const scroller = el && scrollerOf(el)
  if (!el || !scroller) return
  railStickyTop.value = Math.min(RAIL_GAP, scroller.clientHeight - el.offsetHeight - RAIL_GAP)
}
watch(rail, (el) => {
  railObserver?.disconnect()
  railObserver = null
  if (!el || typeof ResizeObserver === 'undefined') return
  railObserver = new ResizeObserver(fitRail)
  railObserver.observe(el)
  const scroller = scrollerOf(el)
  if (scroller) railObserver.observe(scroller)
})
onBeforeUnmount(() => railObserver?.disconnect())

// El bloque de la respuesta va pegado al fondo de la vista mientras el riel
// no cabe (#837 r2) y entonces tapa el final de la tarjeta. Solo en ese caso
// lleva el filete de latón que lo lee como dock (#839): el pie del riel queda
// por debajo de la vista exactamente cuando el bloque está pegado.
// El bloque solo se pega desde 1024 px: por debajo es estático y no se marca,
// aunque el pie del riel quede fuera de la vista (O2 de la revisión de #848).
const DOCK_QUERY = '(min-width: 1024px)'
const railFoot = ref<HTMLElement | null>(null)
const railFootBelow = ref(false)
const dockable = ref(true)
const respondDocked = computed(() => dockable.value && railFootBelow.value)
let footObserver: IntersectionObserver | null = null
const dockMedia = typeof window.matchMedia === 'function' ? window.matchMedia(DOCK_QUERY) : null
const onDockMedia = () => (dockable.value = dockMedia?.matches ?? true)
onDockMedia()
dockMedia?.addEventListener('change', onDockMedia)
watch(railFoot, (el) => {
  footObserver?.disconnect()
  footObserver = null
  railFootBelow.value = false
  const scroller = el && scrollerOf(el)
  if (!el || !scroller || typeof IntersectionObserver === 'undefined') return
  footObserver = new IntersectionObserver(
    ([entry]) => {
      const bottom = entry?.rootBounds?.bottom
      railFootBelow.value =
        !!entry &&
        !entry.isIntersecting &&
        bottom !== undefined &&
        entry.boundingClientRect.top >= bottom - 1
    },
    { root: scroller },
  )
  footObserver.observe(el)
})
onBeforeUnmount(() => {
  footObserver?.disconnect()
  dockMedia?.removeEventListener('change', onDockMedia)
})

function onRetryLoad() {
  void loadPage()
}

function onProfessionalSelect(professionalId: string) {
  selectedProfessionalId.value = professionalId
}
</script>

<template>
  <section class="new-appointment-page" aria-labelledby="new-appointment-title">
    <header class="new-appointment-page__header">
      <h1 id="new-appointment-title" class="new-appointment-page__title">Nuevo turno</h1>
      <p v-if="businessTimezone" class="new-appointment-page__timezone">
        {{ timezoneLabel(businessTimezone) }}, la {{ v.ofTheBusiness }}
      </p>
    </header>

    <!-- El único anuncio del borrador (#833, CA-22): cortés, oculto y fuera
         de la tarjeta. Vive desde el primer cuadro para que el lector de
         pantalla lo conozca antes de que cambie. -->
    <p class="new-appointment-page__sr-only" aria-live="polite" data-testid="draft-announcer">
      {{ draftAnnouncement }}
    </p>

    <!-- Evento 01: sin profesionales ni zona resueltos, la espera conserva la
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
      <!-- Evento 03: sin profesionales activos no hay formulario que ofrecer. El
           destino nombrado en el mensaje se resalta en latón, sin convertirse
           en un enlace que el copy real no promete. -->
      <div v-if="professionals.length === 0" class="new-appointment-page__state">
        <PageState
          variant="info"
          :headline="`Aún no tienes ${v.professionalsRegistered}.`"
          role="status"
        >
          Agrega {{ v.oneProfessional }} en la sección
          <span class="new-appointment-page__dest">«{{ v.Professionals }}»</span> antes de registrar
          turnos.
        </PageState>
      </div>

      <!-- Evento 12, registrado (#833): la misma tarjeta pasa a confirmada con
           una ceremonia corta, en el sitio del riel. Ningún role="status" la
           envuelve ni sale un aviso emergente (#839): el titular recibe el foco
           y el lector lee con él la nota que lo describe. -->
      <div v-else-if="createdTicket" class="new-appointment-page__layout">
        <div class="new-appointment-page__form new-appointment-page__done">
          <p class="new-appointment-page__done-label">Confirmación</p>
          <h2
            ref="successHeading"
            tabindex="-1"
            class="new-appointment-page__done-title"
            aria-describedby="new-appointment-success-note"
          >
            Turno registrado
          </h2>
          <p id="new-appointment-success-note" class="new-appointment-page__success-note">
            El turno quedó confirmado en la agenda {{ v.ofTheProfessional }}. Las notificaciones al
            cliente todavía no están disponibles (B5 las agrega más adelante).
          </p>
          <BaseButton
            type="button"
            variant="primary"
            class="new-appointment-page__submit new-appointment-page__again"
            @click="onStartNewAppointment"
          >
            Registrar otro turno
          </BaseButton>
        </div>
        <aside class="new-appointment-page__rail new-appointment-page__rail--done">
          <AppointmentTicket
            class="new-appointment-page__card"
            state="confirmed"
            state-label="Registrado"
            ceremony="short"
            label="Turno registrado"
            :business-name="sessionBusinessName"
            :professional-label="v.Professional"
            v-bind="createdTicket"
          />
        </aside>
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
                      hideProfessionalField
                        ? 'Elige el servicio.'
                        : `Elige ${v.toTheProfessional} y el servicio.`
                    }}
                  </p>
                </div>
              </div>

              <div class="new-appointment-page__section-body">
                <div class="new-appointment-page__row">
                  <div
                    v-if="!hideProfessionalField"
                    class="new-appointment-page__field"
                    :class="{
                      'new-appointment-page__field--filled': !!selectedProfessionalId,
                      'new-appointment-page__field--error':
                        attempted && !!fieldErrors.professionalId,
                    }"
                  >
                    <label for="new-appointment-professional" class="new-appointment-page__label">
                      {{ v.Professional }}
                      <span class="new-appointment-page__required" aria-hidden="true">*</span>
                    </label>
                    <ProfessionalSelect
                      :model-value="selectedProfessionalId || null"
                      :professionals="professionals"
                      trigger-id="new-appointment-professional"
                      :placeholder="`Elige ${v.aProfessional}`"
                      @update:model-value="onProfessionalSelect"
                    />
                    <p
                      v-if="attempted && fieldErrors.professionalId"
                      class="new-appointment-page__error"
                      role="alert"
                    >
                      {{ fieldErrors.professionalId }}
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
                      <SunDiamond size="sm" class="new-appointment-page__note-spinner" />
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
                    required
                    :class="{ 'new-appointment-page__input--filled': !!attendeeName }"
                    :error="attempted ? fieldErrors.attendeeName : undefined"
                  />
                  <BaseInput
                    :model-value="customerFullName"
                    type="text"
                    label="Nombre del cliente"
                    :hint="
                      customerNameEdited
                        ? undefined
                        : 'Es la misma persona; cámbialo si reservó otra.'
                    "
                    @update:model-value="onCustomerNameInput"
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
                  <p class="new-appointment-page__section-hint">
                    Elige una hora libre o escribe otra.
                  </p>
                </div>
              </div>

              <div class="new-appointment-page__section-body">
                <ManualStartPicker
                  ref="startPicker"
                  v-model:date="startsAtDate"
                  v-model:time="startsAtTime"
                  :professional-id="selectedProfessionalId"
                  :service-id="selectedServiceId"
                  :timezone="businessTimezone"
                  :disabled="saveStatus === 'saving'"
                  :error="attempted ? fieldErrors.startsAt : undefined"
                  @duration="onPickerDuration"
                />
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
        <aside
          ref="rail"
          class="new-appointment-page__rail"
          :style="{ '--rail-sticky-top': `${railStickyTop}px` }"
        >
          <!-- La tarjeta de turno compartida, en borrador (#833): se llena a la
               vista. Cada hueco reserva su alto desde el primer cuadro, así
               un dato que llega no mueve nada. Sin región viva dentro: el
               anuncio va aparte, fuera de la tarjeta. -->
          <p class="new-appointment-page__progress">
            {{ requiredStepsDone }}/{{ REQUIRED_STEPS }} pasos
          </p>
          <AppointmentTicket
            class="new-appointment-page__card"
            state="draft"
            state-label="Por registrar"
            filling
            label="Turno por registrar"
            :business-name="sessionBusinessName"
            :professional-label="v.Professional"
            v-bind="draftTicket"
          />
          <!-- Para quién es y quién lo pide: debajo de la tarjeta, nunca dentro. -->
          <dl class="new-appointment-page__lines">
            <div class="new-appointment-page__line">
              <dt>Para</dt>
              <dd>
                <template v-if="attendeeName.trim()">{{ attendeeName.trim() }}</template>
                <span v-else class="new-appointment-page__line-blank"
                  ><span class="new-appointment-page__sr-only">Por escribir</span></span
                >
              </dd>
            </div>
            <div class="new-appointment-page__line">
              <dt>Cliente</dt>
              <dd>
                <template v-if="customerFullName.trim()">{{ customerFullName.trim() }}</template>
                <span v-else class="new-appointment-page__line-blank"
                  ><span class="new-appointment-page__sr-only">Por escribir</span></span
                >
              </dd>
            </div>
            <div v-if="customerPhone" class="new-appointment-page__line">
              <dt>Teléfono</dt>
              <dd>{{ customerPhone }}</dd>
            </div>
            <div v-if="customerEmail.trim()" class="new-appointment-page__line">
              <dt>Correo</dt>
              <dd>{{ customerEmail.trim() }}</dd>
            </div>
          </dl>

          <!-- La respuesta y las acciones, juntas al pie del riel (#837 r2): desde
               1024 px se pegan al fondo de la vista dentro del riel, así
               «Registrar turno» se ve entero sin desplazar en cualquier alto y la
               alerta aparece junto al botón que la provocó. La tarjeta sigue
               entera y se alcanza desplazando; no hay una segunda barra de
               desplazamiento ni una parada de Tab nueva. -->
          <div class="new-appointment-page__respond" :data-docked="respondDocked || undefined">
            <!-- La respuesta al registrar va justo encima de «Registrar turno», junto
                 al botón que la provocó: el riel se pega por abajo (top negativo)
                 y una alerta arriba crecería fuera de la vista (#837 r1).
                 El titular de la alerta va en el cuerpo, no en el prop `title`
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
          </div>
          <!-- Marca el pie del riel (#839): mientras queda fuera de la vista, el
               bloque de arriba está pegado y tapa la tarjeta. -->
          <span ref="railFoot" class="new-appointment-page__rail-foot" aria-hidden="true" />
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
  font-size: var(--font-size-page-title);
  line-height: var(--font-size-page-title-line);
  font-weight: 400;
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
  position: relative;
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

/* La alerta de la respuesta y las acciones, juntas (#837 r2). */
.new-appointment-page__respond {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Un píxel fuera del flujo en el borde inferior del riel (#839). */
.new-appointment-page__rail-foot {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  pointer-events: none;
}

/* ------------------------------------------- tarjeta del borrador (#833) */

/* «n/3 pasos»: una línea pequeña fuera de la tarjeta, nunca una caja. */
.new-appointment-page__progress {
  margin: 0;
  font-size: var(--font-size-caption);
  line-height: 16px;
  color: var(--color-on-strong-muted);
  font-variant-numeric: tabular-nums;
}

/* La tarjeta compartida sobre el lienzo del panel: las muescas del troquel
   se calan con el mismo color que hay detrás. */
.new-appointment-page__card {
  --ticket-backdrop: var(--color-surface-strong);
}

/* Renglones bajo la tarjeta: para quién es y quién lo pide. */
.new-appointment-page__lines {
  display: grid;
  gap: 6px;
  margin: 0;
}

.new-appointment-page__line {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
}

.new-appointment-page__line dt {
  color: var(--color-on-strong-muted);
}

.new-appointment-page__line dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--color-on-strong);
}

.new-appointment-page__line-blank {
  display: inline-block;
  width: 9em;
  height: 0.56em;
  vertical-align: middle;
  background-color: color-mix(in srgb, var(--color-on-strong) 10%, transparent);
  border-radius: 2px;
}

/* Registrado: el titular recibe el foco; la tarjeta ya está en su sitio y
   solo corre su ceremonia corta, sin entrada del riel. */
.new-appointment-page__done {
  gap: 12px;
  padding: 8px 0 4px;
}

.new-appointment-page__done-label {
  margin: 0;
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 16px;
  color: var(--color-success-on-strong);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.new-appointment-page__done-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 400;
  line-height: 40px;
  color: var(--color-on-strong);
}

.new-appointment-page__done-title:focus {
  outline: none;
}

.new-appointment-page__done-title:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 4px;
}

.new-appointment-page__success-note {
  max-width: 46ch;
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
  color: var(--color-on-strong-muted);
}

.new-appointment-page__rail--done {
  animation: none;
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
     profesional (paso 1) quedaba debajo del paso 2. */
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
  background-color: var(--color-text-secondary);
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
  width: calc(var(--step-size) * 0.78);
  height: calc(var(--step-size) * 0.78);
  margin: calc(var(--step-size) * 0.11);
  grid-column: 1;
  grid-row: 1;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: 3px;
  rotate: 45deg;
  font-family: var(--font-sans);
  font-size: var(--font-size-body);
  line-height: 1;
  color: var(--color-text-primary);
  background-color: var(--color-surface);
  transition:
    background-color 260ms ease,
    border-color 260ms ease,
    color 260ms ease,
    box-shadow 260ms ease;
  font-weight: 600;
}

.new-appointment-page__section-number > * {
  rotate: -45deg;
}

.new-appointment-page__section--done .new-appointment-page__section-number {
  border-color: var(--color-text-primary);
  background-color: var(--color-text-primary);
  color: var(--color-surface);
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
  font-family: var(--font-sans);
  font-size: var(--font-size-h3);
  line-height: 1.15;
  font-weight: 600;
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
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  color: var(--color-text-secondary);
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
  --input-bg: var(--color-surface);
  --input-border-color: var(--color-border-control);
  --input-border-base-color: var(--color-border-control);
  --input-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);

  color: var(--color-on-strong);
  --input-radius: var(--radius-md);
}

.new-appointment-page :deep(.base-input__wrapper) {
  gap: 6px;
}

/* El teléfono usa el tono de tinta de PhoneField con la misma piel del campo
   reglado de esta página: antes iba en tono papel y el prefijo se veía como
   una casilla blanca sobre la tinta (issue #575). */
.new-appointment-page :deep(.phone-field) {
  --pf-row-bg: var(--color-surface);
  --pf-row-bg-hover: var(--color-surface);
  --pf-row-bg-focus: var(--color-surface);
  --pf-line-strong: var(--color-border-control);
  --pf-row-base: var(--color-border-control);
  --pf-text: var(--color-on-strong);
  --pf-muted: var(--color-on-strong-muted);
  --pf-ring-gap: var(--color-surface-strong);
}

.new-appointment-page :deep(.new-appointment-page__input--filled .phone-field__row) {
  border-bottom-color: var(--color-border-control);
}

.new-appointment-page :deep(.phone-field__label) {
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: normal;
  text-transform: none;
  color: var(--color-text-secondary);
}

.new-appointment-page :deep(.base-input__label) {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  text-transform: none;
  color: var(--color-text-secondary);
  letter-spacing: normal;
}

/* Asterisco de obligatorio en latón, nunca en rojo: el rojo se reserva para
   error (atlas, "Contrato visual común"). El margen negativo absorbe el
   espacio en blanco que la plantilla de BaseInput deja entre el rótulo y el
   asterisco: en versalitas espaciadas ese espacio se lee como un asterisco
   suelto, y el atlas lo pega al rótulo ("PERSONA ATENDIDA*"). */
.new-appointment-page :deep(.base-input__required),
.new-appointment-page__required {
  margin-left: -2px;
  color: var(--color-text-secondary);
}

.new-appointment-page :deep(.base-input::placeholder) {
  color: var(--color-on-strong-muted);
  opacity: 1;
}

.new-appointment-page :deep(.base-input:hover:not(:disabled):not(.base-input--invalid)) {
  border-color: var(--color-text-secondary);
}

/* El latón del filete inferior marca el campo YA RESUELTO; uno vacío lleva
   filete neutro. Ocho subrayados dorados a la vez convertían el formulario en
   un muestrario de oro y ya no distinguían lo hecho de lo pendiente (compara
   los eventos 04, 05 y 08 del atlas). */
.new-appointment-page :deep(.new-appointment-page__input--filled .base-input) {
  background-color: var(--color-surface);
  border-bottom-color: var(--color-border-control);
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
  background-color: var(--color-surface);
  border-color: var(--color-danger-on-strong);
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
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
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
  border-right: var(--border-width-normal) solid var(--color-text-secondary);
  border-bottom: var(--border-width-normal) solid var(--color-text-secondary);
  transform: translateY(-70%) rotate(45deg);
  pointer-events: none;
}

.new-appointment-page__field--filled .new-appointment-page__select {
  background-color: var(--color-surface);
}

/* Deshabilitado (servicio sin profesional elegido o cargando): se atenúa y pierde
   el latón, nunca lo conserva (atlas eventos 04 y 05). */
.new-appointment-page__field--off .new-appointment-page__select,
.new-appointment-page__field--off .new-appointment-page__caret {
  opacity: 0.45;
}

.new-appointment-page__field--off .new-appointment-page__select {
}

.new-appointment-page__field--error .new-appointment-page__select,
.new-appointment-page__field--error .new-appointment-page__textarea {
  background-color: var(--color-surface);
  border-color: var(--color-danger-on-strong);
}

/* Selector de profesional (ProfessionalSelect, con monograma): misma altura y piel que
   el resto de los campos de esta hoja. Sobre /panel el control vive suelto y
   siempre lleva su línea de latón; aquí obedece la misma regla de "resuelto"
   que los demás. */
.new-appointment-page__field :deep(.professional-select__trigger) {
  min-height: 46px;
  padding: 0 13px;
  gap: 10px;
  font-size: var(--font-size-body);
  background-color: var(--color-surface);
  border-color: var(--color-border-control);
  border-bottom-color: var(--color-border-control);
  border-radius: var(--radius-md);
}

.new-appointment-page__field--filled :deep(.professional-select__trigger) {
  background-color: var(--color-surface);
  border-bottom-color: var(--color-border-control);
}

.new-appointment-page__field--error :deep(.professional-select__trigger) {
  background-color: var(--color-surface);
  border-color: var(--color-danger-on-strong);
}

/* Sin profesional elegido el disparador dibuja un cuadrado vacío del tamaño del
   monograma; el atlas deja el campo con solo su placeholder. */
.new-appointment-page__field :deep(.professional-select__trigger-icon) {
  display: none;
}

.new-appointment-page__field :deep(.professional-select__trigger-label--placeholder) {
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
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
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
  background-color: var(--color-surface);
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
  color: var(--color-text-secondary);
}

.new-appointment-page__note--warning {
  color: var(--color-warning-on-strong);
}

.new-appointment-page__note--danger {
  color: var(--color-danger-on-strong);
}

.new-appointment-page__note-spinner {
  font-size: 11px;
  color: var(--color-text-secondary);
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
.new-appointment-page .new-appointment-page__done .new-appointment-page__submit {
  width: auto;
  min-width: 220px;
  align-self: flex-start;
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
  /* El texto de la alerta (BaseAlert), no el lienzo fuerte: ese color dejaba el
     titular a 1,1:1 sobre la propia alerta, ilegible en los dos temas. */
  color: inherit;
}

/* Monograma de la familia (#757, 8d) en el disparador «Profesional»: el
   retrato ya es de latón (BrassMonogram, #799); aquí solo se enciende el
   rombo, que en los tamaños de selector va apagado, y se recorta contra el
   fondo del campo. */
.new-appointment-page :deep(.professional-select__trigger .professional-avatar) {
  --monogram-pendant-display: block;
  --monogram-pendant: 8px;
  --monogram-cutout: var(--color-field-strong);
  --monogram-radius: 2px;
}

/* ------------------------------------------------- estados de página completos */

/* El destino nombrado dentro del mensaje se resalta en latón, igual que
   «Profesionales» en el evento 04 del atlas de /panel. */
.new-appointment-page__dest {
  font-weight: 600;
  color: var(--color-text-primary);
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
  .nt-mark-leave-active {
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
:root[data-motion='reduced'] .nt-mark-leave-active {
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
    top: var(--rail-sticky-top, 16px);
  }

  /* Pegadas al fondo de la vista mientras el riel no cabe (#837 r2): al cargar
     a 1024×768 o 1440×800 el botón queda entero sin desplazar. Tapan por
     encima el final de la tarjeta, que aparece al bajar. */
  .new-appointment-page__respond {
    position: sticky;
    bottom: 0;
    z-index: 1;
    margin-top: -14px;
    padding: 14px 0 12px;
  }

  /* El relleno es el propio lienzo del panel, con su luz fija a la ventana
     (#839): fuera de la tarjeta no se ve ninguna placa, ni en Tinta ni en
     Marfil. Empieza bajo los 14 px que el bloque solapa a la tarjeta, así en
     reposo no la recorta. */
  .new-appointment-page__respond::before {
    position: absolute;
    inset: 14px 0 0;
    z-index: -1;
    background: var(--shell-canvas-fill, var(--color-surface-strong));
    content: '';
  }

  /* Pegado sobre la tarjeta, se lee como un dock y no como un corte: filete de
     latón arriba y una sombra muy suave que cae sobre la tarjeta. Pegado sube a
     todo el bloque: el filete queda 14 px sobre «Registrar turno», que si no lo
     tapa (O1 de la revisión de #848). La tarjeta corre por debajo, así que
     cubrir esos 14 px es justo lo que hace un dock. */
  .new-appointment-page__respond[data-docked]::before {
    inset: 0;
    border-top: 1px solid color-mix(in srgb, var(--color-brass-line) 70%, transparent);
    box-shadow: 0 -12px 18px -14px rgb(0 0 0 / 45%);
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
