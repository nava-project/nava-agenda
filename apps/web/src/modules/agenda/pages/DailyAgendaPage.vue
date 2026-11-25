<script setup lang="ts">
// Pantalla "Agenda de hoy" (HU-062) + navegación por fecha (HU-063): abre
// el panel privado mostrando cronológicamente los turnos de un día civil
// de un único profesional, calculado en la zona IANA del negocio. Anterior/
// selector de fecha/siguiente (F-CITA-02) conservan posición estable
// (estandar-diseno-visual.md §11.2) y viven en `route.query` (`date`,
// `professionalId`): sin estado global, recargable y con atrás/adelante reales.
// Selector obligatorio de un profesional (DEC-074): nunca una vista
// consolidada. Fuera de alcance a propósito: detalle de cita y cualquier
// acción sobre una cita existente (editar/cancelar/reprogramar/completar).
//
// Fidelidad visual con el atlas panel-agenda-eventos (issue #189): esta
// revisión es exclusivamente de composición/color/jerarquía/estado visual,
// nunca de comportamiento. Los comentarios que citan un evento del atlas
// (nava-docs/agenda/10-backlog/evidence/ui-mockups-nava-tailored-grid-2026-09-03/
// panel-agenda-eventos/README.md) documentan a qué panel responde cada
// bloque.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { useLoaderGrace, useVocabulary } from '@/shared/composables'
import { capitalize, isSoloProfile, worksOwnProfessional } from '@/shared/model'
import {
  ProfessionalSelect,
  BaseAlert,
  BaseBadge,
  BaseButton,
  ContentReveal,
  EmptyScene,
  PageState,
  DayRuler,
  type DayRulerMark,
} from '@/shared/ui'
import {
  formatCivilDateFull,
  formatCivilDateShort,
  getCivilDateInTimezone,
  isCivilDateString,
  minutesIntoCivilDate,
  minutesSinceCivilMidnight,
  shiftCivilDate,
} from '@/shared/time/civilDate'
import { timezoneLabel } from '@/shared/time/timezoneName'
import {
  fetchProfessionalSummaries,
  fetchBusinessTimezone,
  fetchDailyAgenda,
} from '../api/appointmentsApi'
import type { ProfessionalSummary } from '../model/appointment'
import { knownAgendaContext, rememberAgendaContext } from '../model/agendaContext'
import { summarizeDay } from '../model/daySummary'
import {
  APPOINTMENT_STATUS_BADGE_VARIANT,
  appointmentStatusLabel,
  type DailyAgendaEntry,
} from '../model/dailyAgenda'
import AgendaSkeleton from '../components/AgendaSkeleton.vue'
import { DaylightStrip, type DaylightMark } from '@/modules/public-booking'
import BaseDatePicker from '@/shared/ui/BaseDatePicker.vue'
import { sessionBusinessId } from '@/modules/auth'

type PageStatus = 'loading' | 'ready' | 'load-error'
// 'updating' (CA-063): ya hubo una agenda confirmada antes (para otra
// fecha/profesional) y esta pantalla la conserva visible mientras llega la
// siguiente; 'loading' es solo la primera carga, sin nada que conservar.
type AgendaStatus = 'idle' | 'loading' | 'updating' | 'ready' | 'error' | 'not-found'

const route = useRoute()
const router = useRouter()

const pageStatus = ref<PageStatus>('loading')
const professionals = ref<ProfessionalSummary[]>([])
// CA-063: zona IANA del negocio, nunca la del dispositivo. null solo
// mientras carga o si la consulta falla; sin ella la pantalla no puede
// resolver "hoy" ni ofrecer navegación por fecha (mismo criterio degradado
// que HU-062: la agenda del día del servidor sigue siendo legible, solo se
// oculta la fecha/zona en pantalla y los controles de navegación).
const businessTimezone = ref<string | null>(null)

// selectedProfessionalId/selectedDate reflejan la última selección ya sincronizada
// con route.query (fuente de verdad): se fijan justo antes de disparar la
// carga, nunca antes, para que la plantilla no muestre una selección que la
// URL todavía no confirma.
const selectedProfessionalId = ref<string | null>(null)
const selectedDate = ref<string | null>(null)

// agendaDate es la fecha a la que pertenecen `entries`: se fija en el mismo
// instante que ellas, al llegar la respuesta. Todo lo que se deriva de los
// turnos (eje, fichas, "Ahora", "En proceso") usa esta fecha y no
// selectedDate: si usara la seleccionada, al cambiar de día la agenda anterior
// se recalcularía contra la fecha nueva y saltaría antes de que llegue la
// siguiente.
const agendaDate = ref<string | null>(null)
const agendaStatus = ref<AgendaStatus>('idle')
const entries = ref<DailyAgendaEntry[]>([])
const hasLoadedEntriesOnce = ref(false)

let agendaRequestSeq = 0

const selectedProfessional = computed(
  () => professionals.value.find((b) => b.id === selectedProfessionalId.value) ?? null,
)

const selectedDateLabel = computed(() =>
  selectedDate.value ? formatCivilDateFull(selectedDate.value) : null,
)

const agendaDateLabel = computed(() =>
  agendaDate.value ? formatCivilDateFull(agendaDate.value) : null,
)

const canNavigateDates = computed(() => businessTimezone.value !== null)

// Día civil vigente en el negocio: el calendario lo marca y ofrece «Hoy».
const todayCivilDate = computed(() =>
  businessTimezone.value ? getCivilDateInTimezone(businessTimezone.value) : null,
)

// isViewingToday decide el texto del estado vacío ("hoy" vs. una fecha
// explícita): sin zona conocida se asume "hoy" (mismo criterio degradado
// que HU-062, que nunca navegaba y siempre mostraba "hoy").
const isViewingToday = computed(() => {
  if (!agendaDate.value || !businessTimezone.value) return true
  return agendaDate.value === getCivilDateInTimezone(businessTimezone.value)
})

const emptyStateDateText = computed(() =>
  isViewingToday.value ? 'hoy' : `el ${agendaDateLabel.value}`,
)

function requestedProfessionalIdFromRoute(): string | null {
  const value = route.query.professionalId
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requestedDateFromRoute(): string | null {
  const value = route.query.date
  return typeof value === 'string' && isCivilDateString(value) ? value : null
}

// withQuery combina route.query con overrides; una clave con valor
// undefined/vacío se elimina en vez de quedar como "date=undefined"
// literal en la URL.
function withQuery(overrides: Record<string, string | undefined>): LocationQueryRaw {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...overrides })) {
    if (typeof value === 'string' && value.length > 0) merged[key] = value
  }
  return merged
}

// Palabras del negocio (DEC-110): con los valores iniciales, el texto de siempre.
const v = useVocabulary()

// La entrada a la Agenda (#822, F2/F6): una sola espera, con la forma de la
// pantalla (controles y agenda), desde el primer cuadro hasta la primera vista
// completa. Antes la página se quedaba con solo su título ~300–420 ms, luego
// «Cargando profesionales…» asomaba 35–85 ms y después venía otro esqueleto;
// con red lenta, dos esperas distintas encadenadas. La tapa (ContentReveal) se
// va cuando hay algo entero que mostrar: la agenda del día, un aviso o el
// estado sin profesionales. Su cargador o no asoma o se queda a la vista
// (useLoaderGrace). Con la tapa, las retenciones mínimas de antes
// (useMinHoldLoading, issue 2026-09-28) ya no hacen falta: nada «se arma» a la
// vista. Lo que viene después (otro día, otro profesional) usa el velado de
// siempre (evento 06).
const loaderGrace = useLoaderGrace()
loaderGrace.start()
const firstViewShown = ref(false)
const firstViewSettled = computed(() => {
  if (pageStatus.value === 'loading') return false
  if (pageStatus.value === 'load-error' || professionals.value.length === 0) return true
  return agendaStatus.value !== 'idle' && agendaStatus.value !== 'loading'
})
watch(firstViewSettled, async (settled) => {
  if (!settled || firstViewShown.value) return
  await loaderGrace.settled()
  if (firstViewSettled.value) firstViewShown.value = true
})
// Una etiqueta corta y de una sola línea: con el nombre del profesional se
// partía en dos en móvil y empujaba el esqueleto al cambiar (#822).
const coverLabel = computed(() =>
  pageStatus.value === 'loading' ? `Cargando ${v.value.professionals}…` : 'Cargando la agenda…',
)

async function loadPage() {
  const businessId = sessionBusinessId.value
  // Lo ya leído en esta sesión dibuja la pantalla al instante y se relee por
  // detrás (#822): volver a la Agenda no vuelve a esperar a los profesionales.
  const known = knownAgendaContext(businessId)
  if (known) {
    professionals.value = known.professionals
    businessTimezone.value = known.timezone
    pageStatus.value = 'ready'
    void revalidateContext(businessId)
    if (professionals.value.length > 0) await syncFromRoute()
    return
  }

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
  // Solo se guarda un contexto completo: sin zona, la próxima entrada la vuelve a pedir.
  if (timezoneOutcome.kind === 'success')
    rememberAgendaContext(businessId, {
      professionals: professionalsOutcome.items,
      timezone: timezoneOutcome.timezone,
    })
  pageStatus.value = 'ready'

  if (professionals.value.length > 0) await syncFromRoute()
}

// La relectura por detrás: si algo cambió (un alta o una baja desde otro
// dispositivo), la pantalla se pone al día; si falla, lo que se ve se queda.
async function revalidateContext(businessId: string | null) {
  const [professionalsOutcome, timezoneOutcome] = await Promise.all([
    fetchProfessionalSummaries(),
    fetchBusinessTimezone(),
  ])
  if (professionalsOutcome.kind !== 'success' || timezoneOutcome.kind !== 'success') return
  // La sesión cambió mientras tanto: esta respuesta no es de quien mira.
  if (sessionBusinessId.value !== businessId) return
  const fresh = professionalsOutcome.items
  rememberAgendaContext(businessId, { professionals: fresh, timezone: timezoneOutcome.timezone })
  // Otra zona (se cambió en Configuración desde otra pestaña o dispositivo,
  // #831): «hoy» se vuelve a resolver con ella y la agenda se relee.
  const zoneChanged = timezoneOutcome.timezone !== businessTimezone.value
  if (zoneChanged) businessTimezone.value = timezoneOutcome.timezone
  const listChanged = !sameProfessionals(fresh, professionals.value)
  if (listChanged) professionals.value = fresh
  // El profesional que se miraba ya no está: la URL se normaliza con la lista nueva.
  const selectedGone = !fresh.some((p) => p.id === selectedProfessionalId.value)
  if (zoneChanged || (listChanged && selectedGone)) await syncFromRoute()
}

function sameProfessionals(a: ProfessionalSummary[], b: ProfessionalSummary[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (p, k) => p.id === b[k].id && p.fullName === b[k].fullName && p.photoUrl === b[k].photoUrl,
    )
  )
}

onMounted(loadPage)

function onRetryLoad() {
  // El reintento vuelve a la misma espera con forma.
  firstViewShown.value = false
  loaderGrace.start()
  void loadPage()
}

// La fecha que esta pantalla escribió en la URL por omisión («hoy»), o null.
let defaultedDate: string | null = null

// syncFromRoute (CA-063) es el único punto que traduce route.query a una
// carga de agenda: se llama una vez al abrir la pantalla (tras resolver
// profesionales/zona) y en cada cambio posterior de `route.query` (recarga,
// atrás/adelante del navegador, o un router.push propio de esta pantalla).
// Si la URL no trae una selección válida la normaliza con un único
// router.replace (nunca crea una entrada de historial por abrir /panel);
// ese replace vuelve a disparar este mismo watcher, ya con la URL
// normalizada, así que nunca hay una segunda petición duplicada.
async function syncFromRoute() {
  // Guarda de ruta: esta pantalla solo posee `route.query` mientras es la
  // ruta activa ('panel'). Navegar a otra hija del panel (p. ej. "Nuevo
  // turno") no la desmonta en las pruebas de componente (que la montan
  // fuera de un <router-view>), así que sin esta guarda el watcher de
  // route.query seguiría reaccionando a una ruta que ya no es esta
  // pantalla.
  if (route.name !== 'panel' || professionals.value.length === 0) return

  const requestedProfessionalId = requestedProfessionalIdFromRoute()
  const resolvedProfessionalId =
    requestedProfessionalId && professionals.value.some((b) => b.id === requestedProfessionalId)
      ? requestedProfessionalId
      : professionals.value[0]!.id

  // Una fecha que puso esta pantalla por omisión sigue siendo «hoy»: con otra
  // zona se vuelve a resolver (#831). La que se eligió en la URL se conserva.
  const requestedDate = requestedDateFromRoute()
  const isDefaultDate = requestedDate === null || requestedDate === defaultedDate
  const resolvedDate = businessTimezone.value
    ? isDefaultDate
      ? getCivilDateInTimezone(businessTimezone.value)
      : requestedDate
    : null
  if (isDefaultDate) defaultedDate = resolvedDate

  // La comparación usa el valor CRUDO de route.query.date (no el ya
  // validado por requestedDateFromRoute): una fecha inválida en la URL
  // ("2026-13-40", "hoy") nunca es igual a `resolvedDate` y por eso también
  // se normaliza, no solo una fecha ausente.
  const rawDateInUrl = typeof route.query.date === 'string' ? route.query.date : null
  const needsNormalization =
    requestedProfessionalId !== resolvedProfessionalId || rawDateInUrl !== resolvedDate

  if (needsNormalization) {
    await router.replace({
      query: withQuery({ professionalId: resolvedProfessionalId, date: resolvedDate ?? undefined }),
    })
    return
  }

  selectedProfessionalId.value = resolvedProfessionalId
  selectedDate.value = resolvedDate
  await loadAgenda(resolvedProfessionalId, resolvedDate)
}

watch(
  () => [route.query.date, route.query.professionalId],
  () => void syncFromRoute(),
)

async function loadAgenda(professionalId: string, date: string | null) {
  const requestId = ++agendaRequestSeq
  const isFirstLoad = !hasLoadedEntriesOnce.value
  agendaStatus.value = isFirstLoad ? 'loading' : 'updating'

  const outcome = await fetchDailyAgenda(professionalId, date ?? undefined)

  // Una selección posterior (fecha, profesional o ambas) ya reemplazó el
  // destino vigente: esta respuesta llegó fuera de orden y se descarta sin
  // tocar el contenido ya mostrado (nunca sustituye la selección vigente
  // con una respuesta obsoleta).
  if (requestId !== agendaRequestSeq) return

  switch (outcome.kind) {
    case 'success':
      entries.value = [...outcome.items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      agendaDate.value = date
      agendaStatus.value = 'ready'
      hasLoadedEntriesOnce.value = true
      return
    case 'not-found':
      agendaStatus.value = 'not-found'
      return
    default:
      agendaStatus.value = 'error'
  }
}

function onProfessionalSelect(professionalId: string) {
  void router.push({ query: withQuery({ professionalId }) })
}

function onRetryAgenda() {
  if (selectedProfessionalId.value)
    void loadAgenda(selectedProfessionalId.value, selectedDate.value)
}

function goToDate(newDate: string) {
  void router.push({ query: withQuery({ date: newDate }) })
}

function goToPreviousDay() {
  if (selectedDate.value) goToDate(shiftCivilDate(selectedDate.value, -1))
}

function goToNextDay() {
  if (selectedDate.value) goToDate(shiftCivilDate(selectedDate.value, 1))
}

// «Nuevo turno» recibe el profesional y la fecha que se estaban mirando para que
// su botón Cancelar devuelva a este mismo día (issue #576).
function goToNewAppointment() {
  const query: Record<string, string> = {}
  if (selectedProfessionalId.value) query.professionalId = selectedProfessionalId.value
  if (selectedDate.value) query.date = selectedDate.value
  void router.push({ name: 'agenda-nuevo-turno', query })
}

// Ritmo propio del rombo de cada turno: duración y desfase derivados del id
// (hash estable), así los rombos no laten a la vez y el orden no cambia al
// volver a pintar la lista. El turno en proceso late algo más rápido.
// «En curso» y «Por registrar» se derivan de `confirmed` según la hora (diseno-v2,
// «Estados de la cita»): es solo presentación de la agenda, no cambia el dato.
function statusLabel(entry: DailyAgendaEntry): string {
  if (isEntryInProgress(entry)) return 'En curso'
  if (isEntryPending(entry)) return 'Por registrar'
  return appointmentStatusLabel(entry.status, v.value)
}

function statusBadgeVariant(entry: DailyAgendaEntry) {
  return APPOINTMENT_STATUS_BADGE_VARIANT[entry.status]
}

// Perfil de profesional individual (DEC-115): con un solo profesional no hay nada que
// elegir, así que el selector se oculta. La selección sigue viviendo en
// `route.query.professionalId` (DEC-074): solo desaparece el control.
const hideProfessionalPicker = computed(
  () => worksOwnProfessional.value && professionals.value.length === 1,
)
// La silueta de la espera lo anticipa antes de saber cuántos hay: quien trabaja
// su propio perfil casi siempre tiene uno solo.
const coverHidesPicker = computed(
  () =>
    worksOwnProfessional.value &&
    (pageStatus.value === 'loading' || professionals.value.length === 1),
)

// «Mi día» (DEC-115): una frase con lo que queda de hoy, derivada de los turnos ya
// cargados. Solo para el día en curso: en otra fecha «siguiente» no significaría nada.
// Un día sin turnos ya tiene su propio estado vacío, así que no repite el mensaje.
const soloDaySummary = computed<string | null>(() => {
  if (!isSoloProfile.value || !isViewingToday.value) return null
  if (agendaStatus.value !== 'ready' || !businessTimezone.value) return null
  const summary = summarizeDay(entries.value, Date.now())
  if (summary.total === 0) return null
  if (summary.remaining === 0) return 'No te quedan turnos por atender hoy.'
  const count = `${summary.remaining} ${summary.remaining === 1 ? 'turno por atender' : 'turnos por atender'}`
  if (summary.inProgress) {
    return `${count} · En curso hasta las ${formatAgendaTime(summary.inProgress.endsAt)}`
  }
  if (summary.next) {
    return `${count} · Siguiente a las ${formatAgendaTime(summary.next.startsAt)} · ${summary.next.serviceName}`
  }
  return count
})

// v2 (revisión del 4a): la agenda dice la hora como la reserva y «Mi turno»
// (es-CO, 12 h: «7:15 a. m.»), no en 24 h; una sola forma en toda la pantalla,
// también en la franja del teléfono y en el eje del carril.
function formatAgendaTime(instant: string): string {
  if (!businessTimezone.value) return ''
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: businessTimezone.value,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).format(new Date(instant))
}

// DEC-193 (#854): un «No vino» marcado dentro de su franja la libera desde el
// minuto de la marca. El corte lo da el servidor (`occupiedUntil`); la agenda lo
// dice con palabras («Libre desde las 12:10 p. m.»), nunca solo con color.
function noShowFreedFrom(entry: DailyAgendaEntry): string | null {
  if (entry.status !== 'no_show' || !entry.occupiedUntil) return null
  return Date.parse(entry.occupiedUntil) < Date.parse(entry.endsAt) ? entry.occupiedUntil : null
}

function noShowFreedLabel(entry: DailyAgendaEntry): string {
  const freedFrom = noShowFreedFrom(entry)
  return freedFrom ? `Libre desde las ${formatAgendaTime(freedFrom)}` : ''
}

// «7:15 – 7:45 a. m.»: el periodo una sola vez cuando los dos extremos lo
// comparten; si no, en ambos («11:30 a. m. – 12:15 p. m.»).
function entryTimeRange(entry: DailyAgendaEntry): string {
  const start = formatAgendaTime(entry.startsAt)
  const end = formatAgendaTime(entry.endsAt)
  const period = (text: string) => text.replace(/^[\d:]+\s*/, '')
  if (period(start) && period(start) === period(end)) {
    return `${start.slice(0, start.length - period(start).length).trim()} – ${end}`
  }
  return `${start} – ${end}`
}

// Margen de la libreta (G3, #802): el inicio en grande, con su
// periodo en pequeño si no lo comparte con el fin, y el fin debajo. El texto
// concatenado es el mismo de `entryTimeRange`, así el nombre accesible del
// enlace no cambia.
function entryTimeParts(entry: DailyAgendaEntry): {
  start: string
  startPeriod: string
  end: string
  endPeriod: string
} {
  const [startText = '', endText = ''] = entryTimeRange(entry).split(' – ')
  const split = (text: string) => {
    const match = /^([\d:]+)\s*(.*)$/.exec(text)
    return [match?.[1] ?? text, match?.[2] ?? ''] as const
  }
  const [start, startPeriod] = split(startText)
  const [end, endPeriod] = split(endText)
  return { start, startPeriod, end, endPeriod }
}

// Una vez por turno, no tres veces por fila en cada render. Los espacios van
// dentro de las interpolaciones: Vue condensa los de la plantilla y el nombre
// accesible del enlace quedaría «9:30a. m.».
const listTimes = computed(
  () => new Map(entries.value.map((entry) => [entry.id, entryTimeParts(entry)])),
)

function entryTime(entry: DailyAgendaEntry): string {
  return formatAgendaTime(entry.startsAt)
}

// Línea temporal horizontal de escritorio (estandar-diseno-visual.md §11.2,
// especificacion-frontend-nava.md §7.2): "no es fuente de disponibilidad",
// solo posiciona visualmente las fichas ya devueltas por el servidor. La
// lista cronológica de arriba sigue siendo la fuente accesible equivalente;
// esta franja se marca aria-hidden y sus enlaces quedan fuera del tabulado
// (mismo turno, doble forma de abrir el detalle sería redundante para
// teclado/lector).

// Zoom del carril (pedido explícito del propietario, 2026-09-04: "habilita
// que se pueda hacer zoom al calendario para que se parta en 15 en 15...
// y se puedan ver bien las cards"). No representado en el atlas panel-
// agenda-eventos (una imagen estática sin controles): es una función
// nueva, fuera del modo "fidelidad medible" de DEC-080 para el resto de
// esta pantalla, autorizada aparte. Cada nivel reduce el paso del eje
// (60min → 30min → 15min) y ensancha el carril en la misma proporción;
// timelineBounds/timelinePercent no cambian, solo el ancho en px del
// contenedor que las interpreta.
const TIMELINE_ZOOM_LEVELS = [1, 2, 4] as const
const timelineZoomIndex = ref(0)
const timelineZoom = computed(() => TIMELINE_ZOOM_LEVELS[timelineZoomIndex.value]!)
const canZoomInTimeline = computed(() => timelineZoomIndex.value < TIMELINE_ZOOM_LEVELS.length - 1)
const canZoomOutTimeline = computed(() => timelineZoomIndex.value > 0)

function zoomTimelineIn() {
  if (canZoomInTimeline.value) changeTimelineZoom(1)
}

function zoomTimelineOut() {
  if (canZoomOutTimeline.value) changeTimelineZoom(-1)
}

// Ancho mínimo de una hora del carril a zoom 1 (issue #587, reporte del
// propietario: «está como apeñuscado donde se ven las citas»). Con el día
// completo metido en el ancho de la pantalla una hora medía ~76 px a 1920 y
// ~39 px a 1024, y las fichas quedaban en «Nic…». 180 px deja a un turno de
// 45 min (135 px) con horario, persona y servicio; el día completo se sigue
// pudiendo recorrer, ahora con desplazamiento horizontal dentro del carril.
const TIMELINE_MIN_HOUR_PX = 180
// Ancho real a partir del cual la ficha lleva sus tres líneas, y ancho mínimo
// visual de una ficha muy corta (en px reales, no en % del carril: con un
// carril ancho un % fijo inflaría un turno de 10 min).
const TIMELINE_SLIP_FULL_PX = 120
const TIMELINE_SLIP_MIN_PX = 44
// En 12 h el rango («11:45 a. m. – 12:15 p. m.») pide ~190 px en una línea;
// una ficha más estrecha lleva solo la hora de inicio (el rango está en la lista).
const TIMELINE_SLIP_RANGE_PX = 190
// Ancho aproximado de una ficha ensanchada (--expanded): decide si se ancla
// por la derecha para no salirse del carril.
const TIMELINE_SLIP_EXPANDED_PX = 200
// Ancho que necesita una etiqueta de hora («12:30 p. m.») con aire a los lados.
const TIMELINE_TICK_LABEL_PX = 84

const timelineViewport = ref<HTMLElement | null>(null)
const timelineViewportWidth = ref(0)
let timelineResizeObserver: ResizeObserver | null = null

watch(timelineViewport, (el) => {
  timelineResizeObserver?.disconnect()
  timelineResizeObserver = null
  if (!el) return
  timelineViewportWidth.value = el.clientWidth
  // jsdom no implementa ResizeObserver: sin él se usa el ancho mínimo.
  if (typeof ResizeObserver === 'undefined') return
  timelineResizeObserver = new ResizeObserver(() => {
    timelineViewportWidth.value = el.clientWidth
  })
  timelineResizeObserver.observe(el)
})
onUnmounted(() => timelineResizeObserver?.disconnect())

/**
 * Ancho mínimo del carril en px para el día y el zoom vigentes. Un día sin
 * turnos no tiene fichas que leer: el carril se acomoda al ancho disponible,
 * sin desplazamiento horizontal (pedido del propietario, 2026-11-15: «debe
 * acomodarse siempre y no generar un scroll cuando no hay nada»).
 */
// v2 (DEC-188, revisión del 4a): a zoom 1 el turno más corto del día mide al
// menos TIMELINE_SHORTEST_PX, para que su ficha lleve el nombre completo y no
// «Daniel …». La hora crece hasta TIMELINE_MAX_HOUR_PX; un turno aún más corto
// queda en modo compacto (hora e inicial), con el nombre en la lista.
const TIMELINE_SHORTEST_PX = 140
const TIMELINE_MAX_HOUR_PX = 420
const timelineHourPx = computed(() => {
  const durations = entries.value.map(
    (e) => (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60_000,
  )
  const shortest = Math.max(5, Math.min(...durations, 60))
  return Math.min(
    TIMELINE_MAX_HOUR_PX,
    Math.max(TIMELINE_MIN_HOUR_PX, (TIMELINE_SHORTEST_PX * 60) / shortest),
  )
})

const timelineMinWidthPx = computed(() => {
  const bounds = timelineBounds.value
  if (!bounds || entries.value.length === 0) return 0
  return ((bounds.end - bounds.start) / 60) * timelineHourPx.value * timelineZoom.value
})

/** Ancho real del carril: el del contenedor por el zoom, nunca menos que el mínimo. */
const timelineLaneWidthPx = computed(() =>
  Math.max(timelineViewportWidth.value * timelineZoom.value, timelineMinWidthPx.value),
)

// Cambiar el zoom conserva el punto del día que está en el centro de la vista,
// en vez de saltar al inicio del carril.
function changeTimelineZoom(delta: number) {
  const el = timelineViewport.value
  const centerRatio =
    el && el.scrollWidth > 0 ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : null
  timelineZoomIndex.value += delta
  if (el === null || centerRatio === null) return
  void nextTick(() => {
    el.scrollLeft = Math.max(0, centerRatio * el.scrollWidth - el.clientWidth / 2)
  })
}

const timelineTickStepMinutes = computed(() => {
  const zoom = timelineZoom.value
  if (zoom >= 4) return 15
  if (zoom >= 2) return 30
  return 60
})

const timelineZoomLabel = computed(() => {
  const step = timelineTickStepMinutes.value
  return step === 60 ? '1 h' : `${step} min`
})

const timelineBounds = computed(() => {
  if (!businessTimezone.value || !agendaDate.value) return null
  const tz = businessTimezone.value
  const date = agendaDate.value

  // Pedido explícito del propietario (2026-09-04): el carril siempre
  // cubre el día completo (00:00–24:00), no una ventana recortada
  // alrededor de los turnos reales — el zoom (arriba) ya resuelve ver el
  // detalle de una franja concreta. Un día vacío que no es "hoy" conserva
  // el comportamiento anterior (sin línea temporal): sin turnos ni "Ahora"
  // que centrar no hay nada real que el eje esté mostrando.
  if (entries.value.length === 0 && !isViewingToday.value) return null
  if (entries.value.length === 0) return { start: 0, end: 24 * 60 }

  // El fin usa la versión SIN recortar (issue #189): un turno que termina el
  // día siguiente (evento 11 del atlas) extiende el eje hasta esa hora real
  // en vez de cortarlo en medianoche, para que la ficha se vea completa y la
  // marca "Cambio de día" tenga carril donde dibujarse. En cualquier otro
  // caso el fin es medianoche (24:00), nunca antes.
  const ends = entries.value.map((e) => minutesSinceCivilMidnight(e.endsAt, date, tz))
  const lastEnd = Math.max(...ends)
  return { start: 0, end: Math.max(24 * 60, lastEnd) }
})

// `align` evita que la etiqueta centrada de la primera o la última hora se
// salga del carril (issue #189): centrar (translateX(-50%)) es correcto
// para una marca interior, pero en los dos extremos la mitad de la
// etiqueta cae fuera del carril — ahí se ancla hacia adentro en vez de
// centrarse, sin recortar el texto ni disparar scroll horizontal.
const timelineTicks = computed(() => {
  const bounds = timelineBounds.value
  if (!bounds) return []
  const step = timelineTickStepMinutes.value
  // Con el carril acomodado al ancho (día sin turnos, issue #587) una hora
  // puede medir menos que su etiqueta («00:0001:00»): se rotula una de cada
  // N marcas y las líneas se conservan todas. Sin medida (pruebas), todas.
  const lane = timelineLaneWidthPx.value
  const pxPerTick = lane > 0 ? (lane * step) / (bounds.end - bounds.start) : Infinity
  const labelEvery = Math.max(1, Math.ceil(TIMELINE_TICK_LABEL_PX / pxPerTick))
  const ticks: {
    minute: number
    label: string
    align: 'start' | 'center' | 'end'
    labeled: boolean
  }[] = []
  for (let minute = bounds.start; minute <= bounds.end; minute += step) {
    const hour = Math.floor(minute / 60) % 24
    const mins = minute % 60
    const align = minute === bounds.start ? 'start' : minute === bounds.end ? 'end' : 'center'
    ticks.push({
      minute,
      label: `${hour % 12 === 0 ? 12 : hour % 12}${mins ? `:${String(mins).padStart(2, '0')}` : ''} ${hour < 12 ? 'a. m.' : 'p. m.'}`,
      align,
      labeled: ((minute - bounds.start) / step) % labelEvery === 0,
    })
  }
  return ticks
})

const timelineLabeledTicks = computed(() => timelineTicks.value.filter((t) => t.labeled))

// Una etiqueta del eje que la vista corta por un borde («4 p.») se oculta hasta
// que cabe entera (revisión del 4a). Se mide con el desplazamiento del carril.
const timelineScrollLeft = ref(0)
function onTimelineScroll(event: Event) {
  timelineScrollLeft.value = (event.currentTarget as HTMLElement).scrollLeft
}
function isTickClipped(tick: { minute: number; align: 'start' | 'center' | 'end' }): boolean {
  const bounds = timelineBounds.value
  const view = timelineViewportWidth.value
  if (!bounds || view === 0 || tick.align !== 'center') return false
  const lane = timelineLaneWidthPx.value
  const x = ((tick.minute - bounds.start) / (bounds.end - bounds.start)) * lane
  const half = TIMELINE_TICK_LABEL_PX / 2
  const left = timelineScrollLeft.value
  return x - half < left || x + half > left + view
}

// Guías de media hora (issue #189): tenues, sin etiqueta — solo marcan el
// carril entre cada par de horas para que una ficha corta se pueda leer
// contra el eje sin contar píxeles. Con zoom >1 el eje ya etiqueta cada
// 30/15min (arriba), así que esta guía intermedia deja de aportar nada
// nuevo y se apaga.
const timelineHalfHourGuides = computed(() => {
  const bounds = timelineBounds.value
  if (!bounds || timelineZoom.value > 1) return []
  const guides: number[] = []
  for (let minute = bounds.start + 30; minute < bounds.end; minute += 60) {
    guides.push(minute)
  }
  return guides
})

function timelinePercent(minute: number): string {
  const bounds = timelineBounds.value
  if (!bounds) return '0%'
  return `${((minute - bounds.start) / (bounds.end - bounds.start)) * 100}%`
}

// v2 (DEC-188): el carril pinta el cielo de la hora real del día, como la reserva:
// noche, alba, mañana, tarde y otra vez noche. Las paradas son minutos civiles del
// día mostrado, así que siguen en su hora con el zoom o si el eje pasa de medianoche.
const timelineSkyStyle = computed((): Record<string, string> => {
  if (!timelineBounds.value) return {}
  const stops: Array<[string, number]> = [
    ['night', 0],
    ['night', 5 * 60],
    ['morning', 7 * 60],
    ['morning', 11 * 60 + 30],
    ['afternoon', 13 * 60],
    ['afternoon', 17 * 60],
    ['night', 19 * 60],
    ['night', 30 * 60],
  ]
  const list = stops.map(([sky, minute]) => `var(--color-sky-${sky}) ${timelinePercent(minute)}`)
  return { backgroundImage: `linear-gradient(90deg, ${list.join(', ')})` }
})

function timelineSlipWidthPercent(entry: DailyAgendaEntry): number {
  const bounds = timelineBounds.value
  if (!bounds || !agendaDate.value || !businessTimezone.value) return 0
  const start = minutesIntoCivilDate(entry.startsAt, agendaDate.value, businessTimezone.value)
  // Fin sin recortar, igual que en timelineBounds: la ficha ocupa su
  // duración real aunque cruce medianoche. Un «No vino» que liberó su franja
  // (DEC-193) llega solo hasta el corte, para no tapar el turno que tomó el resto.
  const end = minutesSinceCivilMidnight(
    noShowFreedFrom(entry) ?? entry.endsAt,
    agendaDate.value,
    businessTimezone.value,
  )
  const span = bounds.end - bounds.start
  // Ancho mínimo visual en px reales: una ficha muy corta sigue siendo
  // legible en la línea de tiempo sin que eso cambie su duración real.
  const minPercent = (TIMELINE_SLIP_MIN_PX / timelineLaneWidthPx.value) * 100
  return Math.max(((end - start) / span) * 100, minPercent)
}

function timelineSlipWidthPx(entry: DailyAgendaEntry): number {
  return (timelineSlipWidthPercent(entry) / 100) * timelineLaneWidthPx.value
}

// Ficha ensanchada al pasar el cursor o tocarla: crece hacia la derecha, salvo
// las que arrancan cerca del final del carril, que se anclan por su borde
// derecho y crecen hacia la izquierda para no salirse del contenedor. El
// umbral se mide en px reales del carril (~200 px, el ancho al que se
// ensancha una ficha, --expanded en CSS).
function timelineSlipStyle(entry: DailyAgendaEntry): {
  left?: string
  right?: string
  width: string
} {
  const bounds = timelineBounds.value
  if (!bounds || !agendaDate.value || !businessTimezone.value) return { left: '0%', width: '0%' }
  const start = minutesIntoCivilDate(entry.startsAt, agendaDate.value, businessTimezone.value)
  const width = timelineSlipWidthPercent(entry)
  const leftPercent = ((start - bounds.start) / (bounds.end - bounds.start)) * 100
  const lane = timelineLaneWidthPx.value
  if ((leftPercent / 100) * lane > lane - TIMELINE_SLIP_EXPANDED_PX) {
    return { right: `${Math.max(0, 100 - leftPercent - width)}%`, width: `${width}%` }
  }
  return { left: timelinePercent(start), width: `${width}%` }
}

// Ficha «seleccionada» con el dedo: en táctil no hay cursor, así que el primer
// toque la ensancha (nombre completo, horario y servicio) y el segundo abre el
// detalle. Con ratón el clic navega directo; el ensanche lo da :hover.
const expandedSlipId = ref<string | null>(null)
let lastPointerType = 'mouse'

function onSlipPointerDown(event: PointerEvent) {
  lastPointerType = event.pointerType
}

function onSlipClick(event: MouseEvent, entryId: string) {
  if (lastPointerType === 'mouse' || expandedSlipId.value === entryId) return
  event.preventDefault()
  expandedSlipId.value = entryId
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!expandedSlipId.value) return
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.daily-agenda-page__timeline-slip')) {
    expandedSlipId.value = null
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onDocumentPointerDown))

// La ficha muestra rango horario, persona y servicio cuando la duración le
// da ancho; con poco ancho conserva solo la hora de inicio y la persona,
// sin el rango completo ni el servicio (issue #189, atlas evento 01: solo
// la ficha más ancha del ejemplo — Samuel Díaz, 60min — lleva las tres
// líneas; el resto muestra hora de inicio + nombre). El umbral es el mismo
// porcentaje que ya gobierna el ancho real de la ficha, no un breakpoint de
// viewport aparte.
function timelineSlipDetail(entry: DailyAgendaEntry): 'full' | 'compact' {
  // El umbral se mide en ancho real (px del carril con zoom), no en el %
  // crudo respecto al carril: con el carril ensanchado por zoom, una ficha
  // que antes no cabía con las tres líneas ahora sí tiene espacio real.
  return timelineSlipWidthPx(entry) >= TIMELINE_SLIP_FULL_PX ? 'full' : 'compact'
}

function isEntryCancelled(entry: (typeof entries.value)[number]): boolean {
  return entry.status === 'cancelled_by_customer' || entry.status === 'cancelled_by_professional'
}

// Por registrar (diseno-v2, «Estados de la cita»): confirmado cuya hora ya terminó
// sin que se registrara el resultado. Como «En curso», se evalúa al pintar la agenda;
// vale también para un día pasado. Un confirmado por llegar sigue siendo «Confirmada».
function isEntryPending(entry: (typeof entries.value)[number]): boolean {
  return entry.status === 'confirmed' && Date.now() >= new Date(entry.endsAt).getTime()
}

// Turno en curso: confirmado y con `ahora` dentro de [inicio, fin). Es solo
// presentación (no cambia `confirmed`) y, como el marcador "Ahora", se evalúa
// al pintar la agenda, sin reloj en vivo. Solo aplica al día en curso.
function isEntryInProgress(entry: (typeof entries.value)[number]): boolean {
  if (entry.status !== 'confirmed' || !isViewingToday.value) return false
  const nowMs = Date.now()
  return nowMs >= new Date(entry.startsAt).getTime() && nowMs < new Date(entry.endsAt).getTime()
}

// "Ahora" (estandar-diseno-visual.md §7.2, §9.3): decorativo respecto al
// estado del turno, nunca cambia `confirmed`. Solo se calcula al montar/
// recargar la agenda (sin reloj en vivo): un dato de referencia visual, no
// una fuente de disponibilidad que necesite exactitud al segundo.
const nowMarkerPercent = computed(() => {
  const bounds = timelineBounds.value
  if (!bounds || !agendaDate.value || !businessTimezone.value || !isViewingToday.value) {
    return null
  }
  const nowMinute = minutesIntoCivilDate(
    new Date().toISOString(),
    agendaDate.value,
    businessTimezone.value,
  )
  if (nowMinute < bounds.start || nowMinute > bounds.end) return null
  return timelinePercent(nowMinute)
})

// Encuadre inicial del carril (issue #587): con el día completo más ancho
// que la pantalla, al abrir un día (o cambiar de profesional) el carril se
// desplaza solo hasta el primer turno, o hasta «Ahora» si es hoy y no hay
// turnos, con media hora de aire a la izquierda. Solo una vez por día y
// profesional: una recarga tras atender o cancelar un turno no le mueve la vista
// a quien ya está mirando otra hora.
// v2 (revisión del 4a): hoy, el carril abre con «Ahora» a un tercio del ancho,
// para que se vea lo que viene y no lo que pasó; otro día, en el primer turno.
const timelineFocusMinute = computed(() => {
  const date = agendaDate.value
  const tz = businessTimezone.value
  if (!timelineBounds.value || !date || !tz) return null
  if (isViewingToday.value) return minutesIntoCivilDate(new Date().toISOString(), date, tz)
  if (entries.value.length > 0) {
    return Math.min(...entries.value.map((e) => minutesIntoCivilDate(e.startsAt, date, tz)))
  }
  return null
})

let timelineFramedKey: string | null = null

watch(
  [timelineViewport, timelineFocusMinute, agendaStatus],
  ([el, focusMinute, status]) => {
    const bounds = timelineBounds.value
    if (!el || focusMinute === null || !bounds || status !== 'ready') return
    const key = `${agendaDate.value}|${selectedProfessionalId.value}`
    if (key === timelineFramedKey) return
    timelineFramedKey = key
    const span = bounds.end - bounds.start
    const toPx = (minute: number) => ((minute - bounds.start) / span) * el.scrollWidth
    if (isViewingToday.value) {
      const now = Date.now()
      const ahead = entries.value.some((e) => new Date(e.endsAt).getTime() > now)
      const last = entries.value[entries.value.length - 1]
      if (ahead || !last) {
        // Hay turnos por venir: «Ahora» a un tercio, para ver lo que viene.
        el.scrollLeft = Math.max(0, toPx(focusMinute) - el.clientWidth / 3)
        return
      }
      // Ya no queda nada: el último turno y «Ahora» a los dos tercios, para que
      // el carril nunca abra vacío con la lista llena (revisión del 4a).
      const lastStart = minutesIntoCivilDate(
        last.startsAt,
        agendaDate.value!,
        businessTimezone.value!,
      )
      el.scrollLeft = Math.max(
        0,
        Math.min(toPx(focusMinute) - (el.clientWidth * 2) / 3, toPx(lastStart - 30)),
      )
      return
    }
    const ratio = (Math.max(bounds.start, focusMinute - 30) - bounds.start) / span
    el.scrollLeft = Math.max(0, ratio * el.scrollWidth)
  },
  { flush: 'post' },
)

function entryTone(entry: DailyAgendaEntry): DaylightMark['tone'] {
  if (isEntryInProgress(entry)) return 'current'
  if (isEntryPending(entry)) return 'pending'
  if (entry.status === 'completed') return 'completed'
  if (entry.status === 'no_show') return 'no-show'
  if (isEntryCancelled(entry)) return 'cancelled'
  return 'confirmed'
}

// Franja del día en el teléfono (revisión del 4a; se queda en G3, #802: a 320
// la regla compacta funde los rombos de turnos a 30 min y perdería el toque que
// lleva a la ficha y la duración de cada turno): el mismo DaylightStrip de la
// reserva y de «Cambiar la hora», con los turnos como marcas y «Ahora» como el
// sol. Así el dueño ve el día como lo vio su cliente al reservar. Es decorativa:
// la lista de abajo dice lo mismo en texto y es la que se recorre con teclado.
const stripNowMinute = computed(() => {
  if (!isViewingToday.value || !agendaDate.value || !businessTimezone.value) return null
  return minutesIntoCivilDate(new Date().toISOString(), agendaDate.value, businessTimezone.value)
})

const stripMarks = computed<DaylightMark[]>(() => {
  const date = agendaDate.value
  const tz = businessTimezone.value
  if (!date || !tz) return []
  return entries.value.map((entry) => ({
    key: entry.id,
    start: minutesSinceCivilMidnight(entry.startsAt, date, tz),
    end: Math.min(24 * 60, minutesSinceCivilMidnight(entry.endsAt, date, tz)),
    tone: entryTone(entry),
  }))
})

const stripWindow = computed(() => {
  const points = stripMarks.value.flatMap((m) => [m.start, m.end])
  if (stripNowMinute.value !== null) points.push(stripNowMinute.value)
  if (points.length === 0) return null
  return {
    start: Math.max(0, Math.min(...points) - 30),
    end: Math.min(24 * 60, Math.max(...points) + 30),
  }
})

// La regla del día sobre el carril (G3, #802; DEC-189, «la libreta»): la vista
// general de la jornada encima del carril detallado, que no cambia (00–24,
// 180 px/h y zoom, pedidos de la propietaria). Su ventana son los turnos ±30 min
// en horas enteras; «ahora» no la ensancha, solo se dibuja si cae dentro. Es una
// imagen con su lectura: la lista sigue siendo la fuente accesible.
const rulerKind: Record<DaylightMark['tone'], DayRulerMark['kind']> = {
  confirmed: 'confirmed',
  completed: 'confirmed',
  current: 'mine',
  pending: 'to-record',
  'no-show': 'no-show',
  cancelled: 'cancelled',
}

const dayRuler = computed(() => {
  const marks = stripMarks.value
  if (marks.length === 0) return null
  const first = Math.min(...marks.map((m) => m.start))
  const last = Math.max(...marks.map((m) => m.end))
  const from = Math.max(0, Math.floor((first - 30) / 60) * 60)
  const to = Math.min(24 * 60, Math.ceil((last + 30) / 60) * 60)
  // La lectura cuenta los turnos que siguen en pie y nombra aparte los
  // cancelados, que también tienen su rombo. Va del primer inicio al fin más
  // tardío: un turno largo puede terminar después de que empiece el último.
  const items = entries.value
  const cancelled = items.filter(isEntryCancelled).length
  const active = items.length - cancelled
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const count = [
    active > 0 || cancelled === 0 ? plural(active, 'turno', 'turnos') : '',
    cancelled > 0 ? plural(cancelled, 'cancelado', 'cancelados') : '',
  ]
    .filter(Boolean)
    .join(' y ')
  const firstStart = formatAgendaTime(items[0]!.startsAt)
  const latestEnd = items.reduce((a, b) => (Date.parse(b.endsAt) > Date.parse(a.endsAt) ? b : a))
  const lastEnd = formatAgendaTime(latestEnd.endsAt)
  return {
    from,
    to,
    marks: marks.map((m) => ({ at: m.start, kind: rulerKind[m.tone] })),
    label: `Regla del día: ${count}, de ${firstStart} a ${lastEnd}`,
  }
})

// La regla del día sin turnos (#809, DEC-189): la hoja de libreta en blanco
// lleva su regla, sin rombos. El Sol marca «ahora» solo si el día mostrado es
// hoy (stripNowMinute ya es null en cualquier otro día). La ventana es la
// jornada habitual, de 6 a. m. a 9 p. m., y se abre en horas enteras hasta
// incluir «ahora» con media hora de aire.
const BLANK_FROM = 6 * 60
const BLANK_TO = 21 * 60
const blankRuler = computed(() => {
  if (entries.value.length > 0 || !agendaDate.value || !businessTimezone.value) return null
  const now = stripNowMinute.value
  const from =
    now === null ? BLANK_FROM : Math.max(0, Math.min(BLANK_FROM, Math.floor((now - 30) / 60) * 60))
  const to =
    now === null ? BLANK_TO : Math.min(24 * 60, Math.max(BLANK_TO, Math.ceil((now + 30) / 60) * 60))
  const label =
    now === null
      ? 'Regla del día: sin turnos'
      : `Regla del día: sin turnos; ahora, ${formatAgendaTime(new Date().toISOString())}`
  return { from, to, label }
})

// Sobre el carril (escritorio, hoy) va la regla de los turnos o, sin turnos, la
// de la hoja en blanco: el mismo lugar que en G3.
const headRuler = computed(
  () => dayRuler.value ?? (blankRuler.value ? { ...blankRuler.value, marks: [] } : null),
)

// Un toque en una marca lleva a su ficha de la lista y la enfoca.
const entryList = ref<HTMLElement | null>(null)
function focusEntry(entryId: string) {
  const row = [...(entryList.value?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? [])].find(
    (el) => el.dataset.entryId === entryId,
  )
  const link = row?.querySelector<HTMLElement>('.daily-agenda-page__item-main')
  if (!link) return
  const reduced =
    document.documentElement.dataset.motion === 'reduced' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  link.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  link.focus({ preventScroll: true })
}

// «Ahora» en la lista (revisión del 4a): un separador entre lo que pasó y lo
// que viene. Va antes del primer turno que no ha terminado; si todos
// terminaron, al final. Solo hoy, y como «Ahora» del carril, sin reloj en vivo.
const nowSeparatorIndex = computed(() => {
  if (!isViewingToday.value || entries.value.length === 0) return null
  const now = Date.now()
  const index = entries.value.findIndex((e) => new Date(e.endsAt).getTime() > now)
  return index === -1 ? entries.value.length : index
})

const nowSeparatorLabel = computed(() => `Ahora · ${formatAgendaTime(new Date().toISOString())}`)

// El carril desplazable es una parada de Tab: lleva nombre propio, y su
// contenido (eje, marcas y fichas) es decorativo: la lista lo dice en texto.
const timelineRegionLabel = computed(() => {
  const who = selectedProfessional.value?.fullName
  const when = agendaDateLabel.value
  return ['Carril', who ? `de ${who}` : '', when ? `, ${when}` : ''].join(' ').replace(' ,', ',')
})

// "Cambio de día" (issue #189, evento 11 del atlas): decorativa igual que
// "Ahora" — marca dónde el carril cruza medianoche cuando un turno de este
// día se extiende hasta el siguiente. Nunca decide a qué día pertenece una
// cita (eso ya lo resolvió el servidor, DEC-075): es solo geometría.
const dayChangeMarkerPercent = computed(() => {
  const bounds = timelineBounds.value
  if (!bounds || bounds.end <= 24 * 60) return null
  return timelinePercent(24 * 60)
})
</script>

<template>
  <section
    class="daily-agenda-page"
    :class="{ 'daily-agenda-page--updating': agendaStatus === 'updating' }"
    :aria-busy="agendaStatus === 'updating'"
    aria-labelledby="daily-agenda-page-title"
  >
    <header class="daily-agenda-page__header">
      <div>
        <h1 id="daily-agenda-page-title" class="daily-agenda-page__title">Agenda</h1>
        <!-- Siempre presente: reserva su línea mientras carga y el cargador no
             salta cuando llega la fecha (CLS). -->
        <p class="daily-agenda-page__date">
          <template v-if="selectedDateLabel"
            >{{ selectedDateLabel
            }}<template v-if="businessTimezone">
              · {{ timezoneLabel(businessTimezone) }}</template
            ></template
          >
          <!-- Fecha y zona por separado: en un móvil estrecho la línea real se
               parte en dos y la silueta se parte igual (sin salto al llegar). -->
          <template v-else-if="!firstViewShown"
            ><span
              class="daily-agenda-page__skel daily-agenda-page__skel--date"
              aria-hidden="true" /><span
              class="daily-agenda-page__skel daily-agenda-page__skel--zone"
              aria-hidden="true"
          /></template>
        </p>
        <p v-if="soloDaySummary" class="daily-agenda-page__summary">{{ soloDaySummary }}</p>
      </div>
      <BaseButton
        v-if="pageStatus === 'ready' && professionals.length > 0"
        type="button"
        variant="primary"
        class="daily-agenda-page__cta"
        @click="goToNewAppointment"
      >
        Nuevo turno
      </BaseButton>
      <!-- Su sitio se reserva mientras llegan los profesionales: en móvil ocupa
           una fila entera y aparecer después empujaría toda la agenda (#822). -->
      <span
        v-else-if="pageStatus === 'loading'"
        class="daily-agenda-page__cta daily-agenda-page__skel daily-agenda-page__skel--cta"
        aria-hidden="true"
      />
    </header>

    <!-- #822: una sola espera con la forma de la pantalla, desde el primer
         cuadro hasta la primera vista completa (antes, evento 02 con el rombo
         sobre una página vacía y luego el evento 05). Debajo, el contenido se
         arma sin verse. -->
    <ContentReveal class="daily-agenda-page__stage" :loading="!firstViewShown">
      <template #loading>
        <div class="daily-agenda-page__cover">
          <div class="daily-agenda-page__controls" aria-hidden="true">
            <div v-if="!coverHidesPicker" class="daily-agenda-page__picker">
              <span
                class="daily-agenda-page__label daily-agenda-page__skel daily-agenda-page__skel--label"
              />
              <span class="daily-agenda-page__skel daily-agenda-page__skel--field" />
            </div>
            <div class="daily-agenda-page__date-nav">
              <span class="daily-agenda-page__skel daily-agenda-page__skel--step" />
              <div class="daily-agenda-page__date-input-wrap">
                <span
                  class="daily-agenda-page__label daily-agenda-page__skel daily-agenda-page__skel--label"
                />
                <span class="daily-agenda-page__skel daily-agenda-page__skel--field" />
              </div>
              <span class="daily-agenda-page__skel daily-agenda-page__skel--step" />
            </div>
          </div>
          <AgendaSkeleton :label="coverLabel" />
        </div>
      </template>

      <div class="daily-agenda-page__body">
        <!-- Evento 03: fallo al cargar el contexto inicial. -->
        <PageState
          v-if="pageStatus === 'load-error'"
          variant="warning"
          status-label="Atención"
          headline="No pudimos cargar esta sección"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo.
          <template #action>
            <BaseButton type="button" variant="secondary" @click="onRetryLoad"
              >Reintentar</BaseButton
            >
          </template>
        </PageState>

        <template v-else-if="pageStatus === 'ready'">
          <!-- Evento 04: sin profesionales activos, sin selección inventada ni CTA. -->
          <EmptyScene v-if="professionals.length === 0" scene="team" role="status">
            <template #title>Aún no tienes {{ v.professionalsRegistered }}.</template>
            <template #hint>
              <template v-if="isSoloProfile">
                Crea tu perfil en
                <RouterLink :to="{ name: 'staff-profesionales' }">«Mi perfil»</RouterLink>
                para ver tu agenda.
              </template>
              <template v-else>
                Agrega {{ v.oneProfessional }} en la sección
                <RouterLink :to="{ name: 'staff-profesionales' }"
                  >«{{ v.Professionals }}»</RouterLink
                >
                para ver su agenda.
              </template>
            </template>
          </EmptyScene>

          <template v-else>
            <div class="daily-agenda-page__controls">
              <div v-if="!hideProfessionalPicker" class="daily-agenda-page__picker">
                <label for="daily-agenda-professional-select" class="daily-agenda-page__label">{{
                  v.Professional
                }}</label>
                <ProfessionalSelect
                  compact
                  :model-value="selectedProfessionalId"
                  :professionals="professionals"
                  @update:model-value="onProfessionalSelect"
                />
              </div>

              <div class="daily-agenda-page__date-nav">
                <BaseButton
                  type="button"
                  variant="ghost"
                  :disabled="!canNavigateDates"
                  aria-label="Día anterior"
                  @click="goToPreviousDay"
                >
                  <svg class="daily-agenda-page__chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M10 3.5 5.5 8l4.5 4.5" />
                  </svg>
                  <span class="daily-agenda-page__nav-word">Anterior</span>
                </BaseButton>
                <div class="daily-agenda-page__date-input-wrap">
                  <label
                    id="daily-agenda-date-label"
                    for="daily-agenda-date-picker"
                    class="daily-agenda-page__label"
                    >Fecha</label
                  >
                  <BaseDatePicker
                    trigger-id="daily-agenda-date-picker"
                    :model-value="selectedDate"
                    :today="todayCivilDate"
                    :disabled="!canNavigateDates"
                    label-id="daily-agenda-date-label"
                    :format-value="(date: string) => formatCivilDateShort(date, todayCivilDate)"
                    @update:model-value="goToDate"
                  />
                </div>
                <BaseButton
                  type="button"
                  variant="ghost"
                  :disabled="!canNavigateDates"
                  aria-label="Día siguiente"
                  @click="goToNextDay"
                >
                  <span class="daily-agenda-page__nav-word">Siguiente</span>
                  <svg class="daily-agenda-page__chevron" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 3.5 10.5 8 6 12.5" />
                  </svg>
                </BaseButton>
              </div>
            </div>

            <!-- Evento 10: la zona horaria no se pudo confirmar. La agenda sigue
             visible (§ trabajo requerido 5): esta es una nota al margen que
             acompaña contenido que sigue visible, no un PageState de página
             completa. -->
            <BaseAlert
              v-if="pageStatus === 'ready' && !businessTimezone"
              variant="warning"
              title="No pudimos confirmar la zona horaria"
              role="alert"
            >
              La agenda sigue visible, pero la navegación por fecha queda bloqueada hasta recuperar
              ese dato.
              <template #action>
                <BaseButton type="button" variant="secondary" @click="onRetryLoad">
                  Reintentar
                </BaseButton>
              </template>
            </BaseAlert>

            <!-- Evento 05: profesional y fecha ya resueltos, la espera conserva la
             geometría del contenido por llegar (esqueleto, no spinner). -->
            <AgendaSkeleton
              v-if="agendaStatus === 'loading'"
              :label="`Cargando la agenda de ${selectedProfessional?.fullName}…`"
            />

            <template v-else>
              <!-- Evento 06: cambio de fecha, agenda anterior conservada. -->
              <p
                v-if="agendaStatus === 'updating'"
                class="daily-agenda-page__updating"
                role="status"
                aria-live="polite"
              >
                Actualizando…
              </p>

              <!-- Evento 08: el profesional solicitado ya no está disponible. -->
              <PageState
                v-if="agendaStatus === 'not-found'"
                variant="warning"
                status-label="Atención"
                :headline="`${capitalize(v.thisProfessional)} ya no está disponible`"
                role="alert"
              >
                Elige {{ v.anotherProfessional }} {{ v.professional }} en la lista.
              </PageState>

              <!-- Evento 07: error recuperable de la agenda, profesional/fecha
               conservados para reintentar. -->
              <PageState
                v-else-if="agendaStatus === 'error'"
                variant="warning"
                status-label="Atención"
                :headline="`No pudimos cargar la agenda ${v.ofThisProfessional}`"
                role="alert"
              >
                Revisa tu conexión e inténtalo de nuevo.
                <template #action>
                  <BaseButton type="button" variant="secondary" @click="onRetryAgenda">
                    Reintentar
                  </BaseButton>
                </template>
              </PageState>

              <template
                v-if="
                  agendaStatus === 'ready' || (hasLoadedEntriesOnce && agendaStatus !== 'not-found')
                "
              >
                <!-- Línea temporal horizontal de escritorio: presentación
                 visual adicional del mismo turno de la lista de abajo, que
                 sigue siendo la fuente accesible equivalente (§7.2, §8.1).
                 aria-hidden + tabindex="-1" evitan una segunda forma
                 redundante de llegar al mismo detalle para teclado/lector.
                 Se dibuja también con la lista vacía (evento 09): el eje del
                 día vacío se conserva con el marcador "Ahora". -->
                <div v-if="timelineBounds" class="daily-agenda-page__timeline-wrapper">
                  <!-- Control de zoom (pedido explícito del propietario,
                   2026-09-04): no representado en el atlas — es una imagen
                   estática sin controles — y por eso vive fuera del bloque
                   aria-hidden de abajo, como un control real más de la
                   pantalla. Cada nivel reduce el paso del eje (1h → 30min →
                   15min) y ensancha el carril en la misma proporción, para
                   que una ficha corta deje de ir en modo compacto. -->
                  <!-- Sin turnos no hay fichas que acercar (pedido del propietario,
                   2026-11-15): el zoom se oculta y el carril cabe en el ancho. -->
                  <div v-if="headRuler" class="daily-agenda-page__timeline-head">
                    <!-- La regla del día ocupa la fila del zoom, que antes quedaba
                     vacía a la izquierda: la vista general no le quita alto a
                     la lista (G3, #802). -->
                    <DayRuler
                      class="daily-agenda-page__ruler"
                      size="compact"
                      :from="headRuler.from"
                      :to="headRuler.to"
                      :marks="headRuler.marks"
                      :now="stripNowMinute"
                      :label="headRuler.label"
                    />
                    <div v-if="entries.length > 0" class="daily-agenda-page__timeline-zoom">
                      <button
                        type="button"
                        class="daily-agenda-page__timeline-zoom-btn"
                        :disabled="!canZoomOutTimeline"
                        aria-label="Alejar el calendario"
                        @click="zoomTimelineOut"
                      >
                        −
                      </button>
                      <span class="daily-agenda-page__timeline-zoom-label">{{
                        timelineZoomLabel
                      }}</span>
                      <button
                        type="button"
                        class="daily-agenda-page__timeline-zoom-btn"
                        :disabled="!canZoomInTimeline"
                        aria-label="Acercar el calendario"
                        @click="zoomTimelineIn"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div
                    ref="timelineViewport"
                    @scroll.passive="onTimelineScroll"
                    class="daily-agenda-page__timeline"
                    role="region"
                    tabindex="0"
                    :aria-label="timelineRegionLabel"
                  >
                    <div
                      aria-hidden="true"
                      class="daily-agenda-page__timeline-scroll"
                      :style="{
                        width: `${timelineZoom * 100}%`,
                        ...(timelineMinWidthPx > 0 ? { minWidth: `${timelineMinWidthPx}px` } : {}),
                      }"
                    >
                      <!-- Eje (horas) y marcas (Ahora/Cambio de día) del atlas son
                       dos filas propias, apiladas ANTES del carril (.axis →
                       .marks → .track en
                       tools/mockups/panel-agenda-eventos/render.mjs) — nunca
                       texto flotando dentro del carril con un top negativo.
                       Con eso una marca nunca puede quedar encima de una hora
                       en punto (issue #189, reporte en vivo: "está por
                       encima del tiempo"): ocupan bandas verticales
                       disjuntas, no compiten por el mismo espacio aunque
                       coincidan en x. -->
                      <div class="daily-agenda-page__timeline-axis">
                        <span
                          v-for="tick in timelineLabeledTicks"
                          :key="tick.minute"
                          class="daily-agenda-page__timeline-tick-wrap"
                          :class="`daily-agenda-page__timeline-tick-wrap--${tick.align}`"
                          :style="{ left: timelinePercent(tick.minute) }"
                        >
                          <span
                            class="daily-agenda-page__timeline-tick-label"
                            :class="{
                              'daily-agenda-page__timeline-tick-label--clipped':
                                isTickClipped(tick),
                            }"
                            >{{ tick.label }}</span
                          >
                        </span>
                      </div>

                      <div class="daily-agenda-page__timeline-marks">
                        <span
                          v-if="nowMarkerPercent"
                          class="daily-agenda-page__timeline-mark-label daily-agenda-page__timeline-mark-label--now"
                          :style="{ left: nowMarkerPercent }"
                          >Ahora</span
                        >
                        <span
                          v-if="dayChangeMarkerPercent"
                          class="daily-agenda-page__timeline-mark-label daily-agenda-page__timeline-mark-label--day-change"
                          :style="{ left: dayChangeMarkerPercent }"
                          >Cambio de día</span
                        >
                      </div>

                      <div class="daily-agenda-page__timeline-track">
                        <div class="daily-agenda-page__timeline-sky" :style="timelineSkyStyle" />
                        <div
                          v-for="minute in timelineHalfHourGuides"
                          :key="`half-${minute}`"
                          class="daily-agenda-page__timeline-guide"
                          :style="{ left: timelinePercent(minute) }"
                        />

                        <div
                          v-for="tick in timelineTicks"
                          :key="tick.minute"
                          class="daily-agenda-page__timeline-tick"
                          :style="{ left: timelinePercent(tick.minute) }"
                        />

                        <div
                          v-if="nowMarkerPercent"
                          class="daily-agenda-page__timeline-mark daily-agenda-page__timeline-mark--now"
                          :style="{ left: nowMarkerPercent }"
                        />

                        <div
                          v-if="dayChangeMarkerPercent"
                          class="daily-agenda-page__timeline-mark daily-agenda-page__timeline-mark--day-change"
                          :style="{ left: dayChangeMarkerPercent }"
                        />

                        <RouterLink
                          v-for="entry in entries"
                          :key="`timeline-${entry.id}`"
                          tabindex="-1"
                          class="daily-agenda-page__timeline-slip"
                          :class="{
                            'daily-agenda-page__timeline-slip--terminal':
                              entry.status !== 'confirmed',
                            'daily-agenda-page__timeline-slip--current': isEntryInProgress(entry),
                            'daily-agenda-page__timeline-slip--pending': isEntryPending(entry),
                            'daily-agenda-page__timeline-slip--completed':
                              entry.status === 'completed',
                            'daily-agenda-page__timeline-slip--no-show': entry.status === 'no_show',
                            'daily-agenda-page__timeline-slip--cancelled': isEntryCancelled(entry),
                            'daily-agenda-page__timeline-slip--expanded':
                              expandedSlipId === entry.id,
                            'daily-agenda-page__timeline-slip--end':
                              timelineSlipStyle(entry).right !== undefined,
                          }"
                          :style="timelineSlipStyle(entry)"
                          :to="{
                            name: 'agenda-detalle-turno',
                            params: { appointmentId: entry.id },
                            query: withQuery({}),
                          }"
                          @pointerdown="onSlipPointerDown"
                          @click.capture="onSlipClick($event, entry.id)"
                        >
                          <span class="daily-agenda-page__timeline-slip-time">{{
                            timelineSlipWidthPx(entry) >= TIMELINE_SLIP_RANGE_PX ||
                            expandedSlipId === entry.id
                              ? entryTimeRange(entry)
                              : entryTime(entry)
                          }}</span>
                          <span
                            v-if="
                              timelineSlipDetail(entry) === 'full' || expandedSlipId === entry.id
                            "
                            class="daily-agenda-page__timeline-slip-name"
                            >{{ entry.attendeeName }}</span
                          >
                          <span v-else class="daily-agenda-page__timeline-slip-initial">{{
                            entry.attendeeName.trim().slice(0, 1).toUpperCase()
                          }}</span>
                          <span
                            v-if="
                              timelineSlipDetail(entry) === 'full' || expandedSlipId === entry.id
                            "
                            class="daily-agenda-page__timeline-slip-service"
                            >{{ entry.serviceName }}</span
                          >
                        </RouterLink>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Evento 09: día válido sin turnos. La libreta en blanco (#809,
                 DEC-189): la regla del día, sin rombos, y la hoja con sus
                 renglones y el margen de latón. «Nuevo turno» ya está en la
                 cabecera: aquí no se repite (una sola acción principal). Con
                 el carril visible (escritorio, hoy) la regla va sobre el
                 carril, como en G3, y aquí se oculta. -->
                <div v-if="entries.length === 0" class="daily-agenda-page__blank">
                  <!-- El mensaje va antes que la regla: es lo que se lee primero y, en
                   el teléfono, lo que debe quedar sobre el dock (#809). Desde
                   768 px la regla sube por CSS, como en G3. -->
                  <div class="daily-agenda-page__blank-page">
                    <p class="daily-agenda-page__blank-title">
                      No hay turnos para {{ selectedProfessional?.fullName }}
                      {{ emptyStateDateText }}.
                    </p>
                    <p class="daily-agenda-page__blank-hint">
                      Cuando alguien reserve o registres un turno, aparecerá aquí.
                    </p>
                  </div>
                  <DayRuler
                    v-if="blankRuler"
                    class="daily-agenda-page__blank-ruler"
                    :class="{ 'daily-agenda-page__blank-ruler--lane': timelineBounds }"
                    size="compact"
                    :from="blankRuler.from"
                    :to="blankRuler.to"
                    :now="stripNowMinute"
                    :label="blankRuler.label"
                  />
                </div>

                <DaylightStrip
                  v-if="entries.length > 0 && stripWindow"
                  class="daily-agenda-page__strip"
                  variant="band"
                  :open="[]"
                  :window="stripWindow"
                  :marks="stripMarks"
                  :now="stripNowMinute"
                  @mark="focusEntry"
                />

                <ul
                  v-if="entries.length > 0"
                  ref="entryList"
                  :key="`${selectedProfessionalId}-${selectedDate}`"
                  class="daily-agenda-page__list"
                  :aria-label="`Turnos de ${selectedProfessional?.fullName}`"
                >
                  <template v-for="(entry, index) in entries" :key="entry.id">
                    <li v-if="index === nowSeparatorIndex" class="daily-agenda-page__now">
                      {{ nowSeparatorLabel }}
                    </li>
                    <li
                      :data-entry-id="entry.id"
                      class="daily-agenda-page__item nv-stagger"
                      :style="{ '--i': index }"
                      :class="{
                        'daily-agenda-page__item--terminal': entry.status !== 'confirmed',
                        'daily-agenda-page__item--current': isEntryInProgress(entry),
                        'daily-agenda-page__item--pending': isEntryPending(entry),
                        'daily-agenda-page__item--completed': entry.status === 'completed',
                        'daily-agenda-page__item--no-show': entry.status === 'no_show',
                        'daily-agenda-page__item--cancelled': isEntryCancelled(entry),
                      }"
                    >
                      <RouterLink
                        class="daily-agenda-page__item-main"
                        :to="{
                          name: 'agenda-detalle-turno',
                          params: { appointmentId: entry.id },
                          query: withQuery({}),
                        }"
                      >
                        <span class="daily-agenda-page__item-time"
                          ><span class="daily-agenda-page__item-start"
                            >{{ listTimes.get(entry.id)?.start
                            }}<small v-if="listTimes.get(entry.id)?.startPeriod">{{
                              ` ${listTimes.get(entry.id)?.startPeriod}`
                            }}</small></span
                          ><span class="daily-agenda-page__item-end"
                            ><span class="daily-agenda-page__item-until">{{
                              ` – ${listTimes.get(entry.id)?.end}`
                            }}</span
                            >{{ ' '
                            }}<span class="daily-agenda-page__item-period">{{
                              listTimes.get(entry.id)?.endPeriod
                            }}</span></span
                          ></span
                        >
                        <span class="daily-agenda-page__item-details">
                          <span class="daily-agenda-page__item-name">{{ entry.attendeeName }}</span>
                          <span class="daily-agenda-page__item-service"
                            >{{ entry.serviceName
                            }}<template v-if="entry.homeService"> · A domicilio</template></span
                          >
                          <span
                            v-if="noShowFreedLabel(entry)"
                            class="daily-agenda-page__item-freed"
                            >{{ noShowFreedLabel(entry) }}</span
                          >
                        </span>
                      </RouterLink>
                      <BaseBadge
                        :variant="statusBadgeVariant(entry)"
                        size="sm"
                        :label="statusLabel(entry)"
                      >
                        {{ statusLabel(entry) }}
                      </BaseBadge>
                    </li>
                  </template>
                  <li v-if="nowSeparatorIndex === entries.length" class="daily-agenda-page__now">
                    {{ nowSeparatorLabel }}
                  </li>
                </ul>
              </template>
            </template>
          </template>
        </template>
      </div>
    </ContentReveal>
  </section>
</template>

<style scoped>
/*
 * Agenda del día, v2 «La luz del día» (DEC-188, entrega 4a).
 *
 * - El lienzo y las superficies son los del modo (Día o Noche), no la tinta fija.
 * - Una sola acción con el acento lleno: «Nuevo turno». Anterior y Siguiente van
 *   en contorno neutro; los rótulos, en texto secundario y tipo oración.
 * - El carril pinta el cielo de la hora real; «Ahora» es el sol que lo recorre.
 * - Cada estado lleva palabra, icono y forma; el color nunca va solo
 *   (diseno-v2, «Estados de la cita»). «Cancelada» es gris, hueca y tachada.
 *
 * La geometría se conserva: la lista es la única región con scroll (issue #189),
 * el carril cubre el día completo con zoom (pedido del propietario, 2026-09-04)
 * y se encuadra en el primer turno (issue #587).
 */
.daily-agenda-page {
  /* Color y forma de cada estado: una variable por estado, que usan igual la
     franja del carril y la ficha de la lista. */
  --ag-confirmed: var(--color-appt-confirmed);
  --ag-current: var(--color-appt-in-progress);
  --ag-pending: var(--color-appt-pending);
  --ag-completed: var(--color-appt-completed);
  --ag-cancelled: var(--color-appt-cancelled);
  --ag-no-show: var(--color-appt-no-show);

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  /* Alto del visor del cascarón: cabecera, controles y carril quedan fijos y el
     único scroll es el de la lista. Si ni así cabe, desplaza el cascarón. */
  height: 100%;
  min-height: 100%;
  padding: var(--space-5) var(--space-4);
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: transparent;
}

@media (min-width: 1024px) {
  .daily-agenda-page {
    padding: var(--space-6) var(--space-10, 40px) var(--space-8);
  }
}

/* ── Cabecera ─────────────────────────────────────────────────────────── */

.daily-agenda-page__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.daily-agenda-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-page-title);
  font-weight: 400;
  line-height: var(--font-size-page-title-line);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

.daily-agenda-page__date {
  min-height: 20px;
  margin: var(--space-1) 0 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

/* «Mi día» del profesional individual: lo que queda de la jornada, en texto
   pleno para que se lea antes que la fecha. */
.daily-agenda-page__summary {
  margin: var(--space-2) 0 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  color: var(--color-text-primary);
}

.daily-agenda-page__cta {
  flex-shrink: 0;
  min-height: 44px;
  border-radius: var(--radius-lg);
}

/* Aviso solo para lector de pantalla: fuera del flujo para que empezar una
   carga no empuje la agenda. El aviso visual es el atenuado de abajo. */
.daily-agenda-page__updating {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
}

/* La agenda anterior se atenúa solo si la respuesta tarda: una carga rápida
   no parpadea. */
.daily-agenda-page__timeline-wrapper,
.daily-agenda-page__list,
.daily-agenda-page__blank {
  transition: opacity 0.15s ease;
}

.daily-agenda-page--updating .daily-agenda-page__timeline-wrapper,
.daily-agenda-page--updating .daily-agenda-page__list,
.daily-agenda-page--updating .daily-agenda-page__blank {
  opacity: 0.55;
  transition-delay: 0.25s;
}

@media (prefers-reduced-motion: reduce) {
  .daily-agenda-page__timeline-wrapper,
  .daily-agenda-page__list,
  .daily-agenda-page__blank {
    transition: none;
  }
}

/* Día sin turnos: la libreta en blanco (#809, DEC-189). Bajo el carril el vacío
   es una nota, no una portada, y no obliga a desplazar la página (pedido del
   propietario, 2026-11-15). La hoja repite la libreta de G3: el margen fijo con
   su regla de latón y renglones finos de latón; el titular va en serif. */
.daily-agenda-page__blank {
  --ag-margin: 128px;
  --ag-margin-gap: var(--space-5);
  --ag-row: 40px;

  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

@media (min-width: 768px) {
  .daily-agenda-page__blank-ruler {
    order: -1;
  }
}

/* Con el carril visible (desde 1024 px, hoy) la regla ya va sobre el carril. */
@media (min-width: 1024px) {
  .daily-agenda-page__blank-ruler--lane {
    display: none;
  }
}

.daily-agenda-page__blank-page {
  --ag-rule-line: color-mix(in srgb, var(--color-brass-line) 30%, transparent);

  position: relative;
  padding: var(--space-3) var(--space-5) var(--space-5)
    calc(var(--space-4) + var(--ag-margin) + var(--ag-margin-gap));
  background-color: var(--color-surface);
  /* Un renglón por línea escrita (40 px; 28 en el teléfono): la hoja de un
     cuaderno. */
  background-image: linear-gradient(
    to bottom,
    transparent calc(100% - 1px),
    var(--ag-rule-line) calc(100% - 1px)
  );
  background-position: 0 var(--space-3);
  background-size: 100% var(--ag-row);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
}

/* La regla del margen, de borde a borde de la hoja. Decorativa. */
.daily-agenda-page__blank-page::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--space-4) + var(--ag-margin) + var(--ag-margin-gap) / 2);
  width: 1px;
  pointer-events: none;
  content: '';
  background-color: color-mix(in srgb, var(--color-brass-line) 72%, transparent);
}

.daily-agenda-page__blank-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
  line-height: var(--ag-row);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
  text-wrap: balance;
}

/* Cada línea escrita cae en su renglón, también la pista: con media altura
   una de cada dos quedaría tachada por la raya. */
.daily-agenda-page__blank-hint {
  max-width: 64ch;
  margin: 0;
  font-size: 15px;
  line-height: var(--ag-row);
  color: var(--color-text-secondary);
  text-wrap: pretty;
}

@media (max-width: 1023px) {
  .daily-agenda-page__blank {
    --ag-margin: 60px;
    --ag-margin-gap: var(--space-3);
  }
}

/* En el teléfono la hoja es más densa para que el mensaje entero quede sobre
   el dock (pedido de la dueña del 2026-11-15: el día vacío no obliga a
   desplazar): margen estrecho, renglón de 28 px y la regla debajo. */
@media (max-width: 767px) {
  .daily-agenda-page__blank {
    --ag-margin: 16px;
    --ag-margin-gap: var(--space-3);
    --ag-row: 28px;

    gap: var(--space-3);
  }

  .daily-agenda-page__blank-page {
    padding: var(--space-2) var(--space-4) var(--space-3)
      calc(var(--space-3) + var(--ag-margin) + var(--ag-margin-gap));
    background-position: 0 var(--space-2);
  }

  .daily-agenda-page__blank-page::before {
    left: calc(var(--space-3) + var(--ag-margin) + var(--ag-margin-gap) / 2);
  }

  .daily-agenda-page__blank-title {
    font-size: 20px;
  }
}

.daily-agenda-page__stage,
.daily-agenda-page__body {
  flex: 1 1 0;
  min-height: 0;
}

/* La tapa y el contenido comparten la celda (ContentReveal); los dos llenan el
   alto que queda bajo la cabecera, para que la lista siga siendo la única
   región con scroll (issue #189). */
.daily-agenda-page__stage {
  grid-template-rows: minmax(0, 1fr);
}

.daily-agenda-page__stage > :deep(.daily-agenda-page__body),
.daily-agenda-page__stage > :deep(.content-reveal__cover) {
  align-self: stretch;
  min-height: 0;
}

.daily-agenda-page__body,
.daily-agenda-page__cover {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
}

/* La silueta de los controles: mismas cajas que los reales (rótulo de 16 px y
   campo del alto de control), en el tono de AgendaSkeleton. */
.daily-agenda-page__skel {
  display: block;
  background-color: color-mix(in srgb, var(--color-on-strong) 10%, transparent);
  border-radius: var(--radius-lg);
}

.daily-agenda-page__skel--label {
  width: 72px;
  height: 16px;
  border-radius: var(--radius-sm);
}

.daily-agenda-page__skel--field {
  height: 44px;
}

.daily-agenda-page__skel--step {
  flex: none;
  height: var(--control-height);
}

.daily-agenda-page__skel--date,
.daily-agenda-page__skel--zone {
  display: inline-block;
  max-width: 100%;
  height: 12px;
  vertical-align: middle;
  border-radius: var(--radius-sm);
}

/* Lo que miden «martes, 24 de noviembre de 2026» y « · Hora de Colombia». */
.daily-agenda-page__skel--date {
  width: 210px;
  margin-right: 10px;
}

.daily-agenda-page__skel--zone {
  width: 120px;
}

.daily-agenda-page__skel--cta {
  height: 44px;
}

/* En escritorio, el ancho de «Anterior», «Siguiente» y «Nuevo turno»; debajo,
   la rejilla de la fecha y el ancho completo ya les dan su caja. */
@media (min-width: 1024px) {
  .daily-agenda-page__skel--step:first-child {
    width: 109px;
  }

  .daily-agenda-page__skel--step:last-child {
    width: 117px;
  }

  .daily-agenda-page__skel--cta {
    width: 126px;
  }
}

/* ── Profesional y fecha ──────────────────────────────────────────────── */

.daily-agenda-page__controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

@media (min-width: 640px) {
  .daily-agenda-page__controls {
    flex-flow: row wrap;
    align-items: flex-end;
  }

  .daily-agenda-page__picker {
    flex: 1 1 240px;
  }
}

.daily-agenda-page__picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Rótulos en tipo oración, con peso y color: sin versalitas ni acento. */
.daily-agenda-page__label {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0;
  color: var(--color-text-secondary);
  text-transform: none;
}

/* Anterior/fecha/siguiente conservan posiciones estables (HU-063). */
.daily-agenda-page__date-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
}

.daily-agenda-page__date-input-wrap {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 160px;
}

/* Anterior y Siguiente: contorno neutro, sin el acento (lo lleva solo la
   acción de la pantalla). */
.daily-agenda-page__date-nav :deep(.base-button--ghost) {
  --btn-height: var(--control-height);
  gap: var(--space-1);
  padding-inline: var(--space-3);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--color-text-primary);
  text-transform: none;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-lg);
}

.daily-agenda-page__date-nav
  :deep(.base-button--ghost:hover:not(:disabled):not(.base-button--loading)) {
  background-color: var(--color-surface-muted);
  border-color: var(--color-text-primary);
}

/* El selector de profesional y el de fecha, como campos v2: superficie, borde
   de control y radio, sin el subrayado del campo reglado v1. (Son compartidos;
   su versión global se alinea en la entrega 5.) */
.daily-agenda-page__controls :deep(.professional-select__trigger),
.daily-agenda-page__controls :deep(.agenda-date-picker__trigger) {
  min-height: 44px;
  color: var(--color-text-primary);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-lg);
}

.daily-agenda-page__controls :deep(.professional-select__trigger:hover:not(:disabled)),
.daily-agenda-page__controls :deep(.agenda-date-picker__trigger:hover:not(:disabled)),
.daily-agenda-page__controls :deep(.agenda-date-picker__trigger[aria-expanded='true']) {
  border-color: var(--color-text-primary);
}

.daily-agenda-page__controls :deep(.agenda-date-picker__trigger) {
  font-variant-numeric: tabular-nums;
}

.daily-agenda-page__controls :deep(.agenda-date-picker__icon) {
  color: var(--color-text-secondary);
}

.daily-agenda-page__chevron {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.75;
}

@media (min-width: 1024px) {
  .daily-agenda-page__controls {
    flex-wrap: nowrap;
  }

  .daily-agenda-page__picker {
    flex: 0 0 280px;
  }

  .daily-agenda-page__date-nav {
    flex-wrap: nowrap;
  }

  /* «Mañana, mié 30 sept» entra completo (la fecha va en palabras, v2). */
  .daily-agenda-page__date-input-wrap {
    flex: 0 0 216px;
    min-width: 216px;
  }
}

/* ── Lista de turnos ──────────────────────────────────────────────────── */

.daily-agenda-page__list {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: var(--space-2);
  /* Alto mínimo: en una pantalla muy baja prefiere desbordar la página antes
     que reducirse a una ranura. */
  min-height: 120px;
  /* Sitio para el foco y la barra de scroll sin recortarlos. */
  padding: 3px 8px 3px 3px;
  margin: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  scrollbar-color: var(--color-border-control) transparent;
  scrollbar-width: thin;
}

.daily-agenda-page__list > .daily-agenda-page__item {
  flex-shrink: 0;
}

@media (max-height: 820px) {
  .daily-agenda-page {
    gap: var(--space-3);
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }
}

/* Escritorio: el cascarón ya reserva el alto del dock (72 px) para que nada
   quede debajo; el relleno inferior del panel sumaba otros 31 px de vacío bajo
   el último turno (G3, #802). La reserva se queda; el hueco, no. */
@media (min-width: 1024px) {
  .daily-agenda-page {
    padding-bottom: 0;
  }
}

/* Pantallas muy bajas: el carril repite lo que dice la lista, así que cede su
   alto antes de obligar al panel a desplazarse. */
@media (max-height: 640px) {
  .daily-agenda-page .daily-agenda-page__timeline-wrapper {
    display: none;
  }
}

/* Ficha: superficie del modo, radio de tarjeta y filete del estado a la
   izquierda. «Confirmada» es la franja llena con filete. */
.daily-agenda-page__item {
  --ag-color: var(--ag-confirmed);
  /* La libreta (G3, #802): un margen fijo para la hora y la regla de latón que
     lo separa del renglón, como el margen de un cuaderno. */
  --ag-margin: 128px;
  --ag-margin-gap: var(--space-5);
  --ag-pad-left: var(--space-4);

  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  min-height: 64px;
  padding: var(--space-3) var(--space-5) var(--space-3) var(--ag-pad-left);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-left: 4px solid var(--ag-color);
  border-radius: 10px;
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard);
}

/* La regla del margen corre de borde a borde del renglón. Decorativa. */
.daily-agenda-page__item::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--ag-pad-left) + var(--ag-margin) + var(--ag-margin-gap) / 2);
  width: 1px;
  pointer-events: none;
  content: '';
  background-color: color-mix(in srgb, var(--color-brass-line) 72%, transparent);
}

@media (hover: hover) {
  .daily-agenda-page__item:hover {
    border-color: var(--color-border-control);
    border-left-color: var(--ag-color);
  }
}

/* En curso: relleno Sol con tinta, la única ficha llena de la lista. */
.daily-agenda-page__item--current {
  --ag-color: var(--ag-current);

  background-color: color-mix(in srgb, var(--color-sun) 22%, var(--color-surface));
  border-color: color-mix(in srgb, var(--color-sun) 70%, var(--color-border-subtle));
}

/* Por registrar: filete punteado, la hora ya pasó sin resultado. */
.daily-agenda-page__item--pending {
  --ag-color: var(--ag-pending);

  border-style: dashed;
  border-left-style: dotted;
}

.daily-agenda-page__item--completed {
  --ag-color: var(--ag-completed);
}

.daily-agenda-page__item--no-show {
  --ag-color: var(--ag-no-show);
}

/* Cancelada: gris, franja hueca (sin superficie) y texto tachado. Nunca rosa
   ni rojo: el rojo queda para errores y acciones destructivas. */
.daily-agenda-page__item--cancelled {
  --ag-color: var(--ag-cancelled);

  background-color: transparent;
  border-style: dashed;
  border-left-style: solid;
}

.daily-agenda-page__item--cancelled .daily-agenda-page__item-name {
  color: var(--color-text-secondary);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.daily-agenda-page__item--terminal .daily-agenda-page__item-time,
.daily-agenda-page__item--terminal .daily-agenda-page__item-service {
  color: var(--color-text-secondary);
}

/* La fila abre el detalle del turno (HU-064) por su bloque principal; el
   estado queda fuera del enlace. */
.daily-agenda-page__item-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--ag-margin-gap);
  min-width: 0;
  min-height: 0;
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-sm);
  outline: none;
}

.daily-agenda-page__item-main:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.daily-agenda-page__item-time {
  display: flex;
  flex: 0 0 var(--ag-margin);
  flex-direction: column;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}

/* La hora del margen, grande y en la sans tabular: es el dato que más importa
   leer bien. En la serif (que no trae un 1 alternativo) «11:00» se leía
   «ll:00» aun a 26 px; la sans distingue el 1 y alinea las cifras de renglón a
   renglón. Su periodo, si no lo comparte con el fin, va en pequeño. */
.daily-agenda-page__item-start {
  font-family: var(--font-sans);
  font-size: 24px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  /* 26 + 18 = 44 px, lo mismo que nombre y servicio: el renglón mide lo que
     medía antes de la libreta y el día corto sigue cabiendo a 1440×900. */
  line-height: 26px;
  letter-spacing: -0.01em;
}

.daily-agenda-page__item-start small,
.daily-agenda-page__item-end {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.daily-agenda-page__item-start small {
  white-space: nowrap;
}

.daily-agenda-page__item-end {
  white-space: nowrap;
}

/* En el margen estrecho del teléfono el periodo baja entero, nunca «p.» y «m.»
   en líneas distintas, y el guion no se queda solo: tras «–» se puede cortar
   aunque siga un espacio duro (UAX #14), así que «– 10:45» va en un tramo. El
   espacio entre los dos tramos queda fuera de ambos: es el único corte. */
.daily-agenda-page__item-until,
.daily-agenda-page__item-period {
  white-space: nowrap;
}

.daily-agenda-page__item-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.daily-agenda-page__item-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--color-text-primary);
}

@media (hover: hover) {
  .daily-agenda-page__item-main:hover .daily-agenda-page__item-name {
    text-decoration: underline;
    text-decoration-color: var(--color-brand-accent-surface);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }

  .daily-agenda-page__item--cancelled
    .daily-agenda-page__item-main:hover
    .daily-agenda-page__item-name {
    text-decoration: line-through;
  }
}

.daily-agenda-page__item-service {
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-secondary);
}

/* DEC-193: el tramo que un «No vino» dejó libre, dicho en texto. */
.daily-agenda-page__item-freed {
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

/* Estado: palabra con su icono, en tipo oración y del color del estado. No es
   un botón: sin caja ni versalitas. El icono es una máscara para que tome
   el color del texto. */
:deep(.base-badge) {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  height: auto;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0;
  color: var(--ag-color);
  text-transform: none;
  background-color: transparent;
  border: none;
  border-radius: 0;
}

:deep(.base-badge)::before {
  flex: none;
  width: 14px;
  height: 14px;
  content: '';
  background-color: currentColor;
  mask: var(--ag-icon) center / contain no-repeat;
}

/* Confirmada: el rombo NAVA lleno (marcas en styles/statusMarks.css). */
.daily-agenda-page__item {
  --ag-icon: var(--mark-confirmed);
}

/* En curso: el Sol. El texto va en tinta sobre el relleno Sol de la ficha. */
.daily-agenda-page__item--current {
  --ag-icon: var(--mark-in-progress);
}

.daily-agenda-page__item--current :deep(.base-badge) {
  color: var(--color-text-primary);
}

.daily-agenda-page__item--current :deep(.base-badge)::before {
  background-color: color-mix(in srgb, var(--color-sun) 80%, var(--color-text-primary));
}

/* Por registrar: el rombo medio. */
.daily-agenda-page__item--pending {
  --ag-icon: var(--mark-to-record);
}

/* Atendida: el rombo con el ✓ calado. */
.daily-agenda-page__item--completed {
  --ag-icon: var(--mark-completed);
}

/* Cancelada: el rombo punteado. */
.daily-agenda-page__item--cancelled {
  --ag-icon: var(--mark-cancelled);
}

/* No asistió: el rombo vacío. */
.daily-agenda-page__item--no-show {
  --ag-icon: var(--mark-no-show);
}

@media (max-width: 1023px) {
  .daily-agenda-page__cta {
    width: 100%;
  }

  /* «Fecha» encabeza la fila completa (Anterior · fecha · Siguiente), igual
     que «Profesional» sobre su selector. */
  .daily-agenda-page__date-nav {
    display: grid;
    grid-template-areas:
      'label label label'
      'prev date next';
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr) minmax(0, 1fr);
    gap: var(--space-2);
    align-items: end;
    width: 100%;
  }

  .daily-agenda-page__date-input-wrap {
    display: contents;
  }

  .daily-agenda-page__date-input-wrap > .daily-agenda-page__label {
    grid-area: label;
  }

  .daily-agenda-page__date-input-wrap > :not(.daily-agenda-page__label) {
    grid-area: date;
    min-width: 0;
  }

  .daily-agenda-page__date-nav > :first-child {
    grid-area: prev;
  }

  .daily-agenda-page__date-nav > :last-child {
    grid-area: next;
  }

  .daily-agenda-page__date-nav :deep(.base-button--ghost) {
    justify-content: center;
    padding-inline: var(--space-2);
  }

  /* En el teléfono el margen se estrecha y el estado baja al renglón, bajo el
     nombre: la regla del margen sigue de borde a borde. */
  .daily-agenda-page__item {
    --ag-margin: 60px;
    --ag-margin-gap: var(--space-3);

    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .daily-agenda-page__item-main {
    align-items: flex-start;
    width: 100%;
  }

  .daily-agenda-page__item-start {
    font-size: 20px;
    line-height: 24px;
  }

  /* «11:30 a. m.» no cabe en el margen: el periodo baja bajo las cifras. */
  .daily-agenda-page__item-start small {
    display: block;
    margin-left: 0;
  }

  .daily-agenda-page__item-end {
    font-size: 12px;
    white-space: normal;
  }

  .daily-agenda-page__item :deep(.base-badge) {
    margin-left: calc(var(--ag-margin) + var(--ag-margin-gap));
  }
}

/* En un teléfono la palabra cede y queda la flecha, en un botón de 44 px; el
   nombre accesible («Día anterior», «Día siguiente») lo da `aria-label`. */
@media (max-width: 639px) {
  .daily-agenda-page__date-nav {
    grid-template-columns: 44px minmax(0, 1fr) 44px;
  }

  .daily-agenda-page__date-nav :deep(.base-button--ghost) {
    width: 44px;
    padding: 0;
  }

  .daily-agenda-page__nav-word {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .daily-agenda-page__chevron {
    width: 20px;
    height: 20px;
  }
}

/* ── Carril del día (escritorio) ──────────────────────────────────────── */

.daily-agenda-page__timeline-wrapper,
.daily-agenda-page__timeline {
  display: none;
}

@media (min-width: 1024px) {
  .daily-agenda-page__timeline-wrapper {
    display: block;
  }

  /* La regla del día y el zoom comparten fila: la regla ocupa el ancho que el
     zoom dejaba vacío y el zoom queda al pie, junto al carril (G3, #802). */
  .daily-agenda-page__timeline-head {
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    gap: var(--space-6);
    /* Aire entre los rombos de la regla y las horas del carril: son dos escalas
       distintas (la jornada y el tramo ampliado) y no deben leerse como una. */
    margin-bottom: var(--space-3);
  }

  .daily-agenda-page__ruler {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Los numerales de la regla asoman unos px sobre su caja, hacia el hueco que
     ya hay bajo los controles: así la fila no le quita a la lista el alto de un
     renglón y el día corto (4 turnos) cabe entero sobre el dock a 1440×900. */
  .daily-agenda-page__timeline-head .daily-agenda-page__ruler {
    padding-top: 17px;
  }

  .daily-agenda-page__timeline-zoom {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
  }

  .daily-agenda-page__timeline-zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
    color: var(--color-text-primary);
    cursor: pointer;
    background-color: var(--color-surface);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-md);
    transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
  }

  .daily-agenda-page__timeline-zoom-btn:hover:not(:disabled) {
    background-color: var(--color-surface-muted);
  }

  .daily-agenda-page__timeline-zoom-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .daily-agenda-page__timeline-zoom-btn:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .daily-agenda-page__timeline-zoom-label {
    min-width: 48px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
    text-align: center;
  }

  /* El carril interno tiene ancho mínimo por hora y crece con el zoom: se
     recorre con su propio scroll horizontal, nunca el de la página. */
  .daily-agenda-page__timeline {
    display: block;
    border-radius: 10px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-color: var(--color-border-control) transparent;
    scrollbar-width: thin;
  }

  .daily-agenda-page__timeline-scroll {
    min-width: 100%;
  }

  /* Eje, marcas y carril: tres filas propias (issue #189). Una marca nunca
     queda encima de una hora en punto. */
  .daily-agenda-page__timeline-axis {
    position: relative;
    height: 18px;
  }

  .daily-agenda-page__timeline-tick-wrap {
    position: absolute;
    top: 0;
  }

  .daily-agenda-page__timeline-tick-label--clipped {
    visibility: hidden;
  }

  .daily-agenda-page__timeline-tick-label {
    display: block;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* En los extremos la etiqueta se ancla hacia adentro (issue #189). */
  .daily-agenda-page__timeline-tick-wrap--center {
    transform: translateX(-50%);
  }

  .daily-agenda-page__timeline-tick-wrap--end {
    transform: translateX(-100%);
  }

  .daily-agenda-page__timeline-marks {
    position: relative;
    height: 26px;
  }

  .daily-agenda-page__timeline-marks:has(.daily-agenda-page__timeline-mark-label--day-change) {
    height: 52px;
  }

  /* «Ahora»: píldora Sol con tinta. Es del modo, no del negocio. */
  .daily-agenda-page__timeline-mark-label {
    position: absolute;
    top: 2px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
    letter-spacing: 0;
    white-space: nowrap;
    text-transform: none;
    border-radius: var(--radius-pill);
    transform: translateX(-50%);
  }

  .daily-agenda-page__timeline-mark-label--now {
    color: var(--color-on-sun);
    background-color: var(--color-sun);
  }

  .daily-agenda-page__timeline-mark-label--day-change {
    top: 28px;
    color: var(--color-text-secondary);
    background-color: var(--color-surface);
    border: 1px solid var(--color-border-control);
  }

  /* El carril: el cielo de la hora detrás de las franjas. */
  .daily-agenda-page__timeline-track {
    position: relative;
    height: 104px;
    padding: 0;
    overflow: hidden;
    background-color: var(--color-surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: 10px;
  }

  .daily-agenda-page__timeline-sky {
    position: absolute;
    inset: 0;
    opacity: 0.85;
  }

  .daily-agenda-page__timeline-guide,
  .daily-agenda-page__timeline-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid color-mix(in srgb, var(--color-text-primary) 7%, transparent);
  }

  .daily-agenda-page__timeline-tick {
    border-left-color: color-mix(in srgb, var(--color-text-primary) 16%, transparent);
  }

  .daily-agenda-page__timeline-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 2;
    border-left: 2px solid var(--color-text-secondary);
  }

  /* «Ahora» es el sol que recorre el día: la línea en Sol con su disco
     arriba. Pulsa tres veces y se detiene (WCAG 2.2.2). */
  .daily-agenda-page__timeline-mark--now {
    border-left-color: var(--color-sun);
  }

  .daily-agenda-page__timeline-mark--now::before,
  .daily-agenda-page__timeline-mark--now::after {
    position: absolute;
    top: -1px;
    left: -7px;
    width: 12px;
    height: 12px;
    content: '';
    border-radius: 1px;
    rotate: 45deg;
  }

  .daily-agenda-page__timeline-mark--now::before {
    background-color: var(--color-sun);
    box-shadow: 0 0 0 2px var(--color-surface);
  }

  .daily-agenda-page__timeline-mark--now::after {
    border: 2px solid var(--color-sun);
    opacity: 0;
    animation: agenda-now-ring 1.6s var(--motion-ease-out) 3;
  }

  @keyframes agenda-now-ring {
    from {
      opacity: 0.9;
      transform: scale(1);
    }

    to {
      opacity: 0;
      transform: scale(2.6);
    }
  }

  /* Franja: radio de 6 px, el filete del estado a la izquierda y la superficie
     encima del cielo. Crece desde su hora de inicio al llegar. */
  .daily-agenda-page__timeline-slip {
    --ag-color: var(--ag-confirmed);
    --slip-bg: color-mix(in srgb, var(--ag-color) 12%, var(--color-surface));

    position: absolute;
    top: 12px;
    bottom: 12px;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    padding: 0 var(--space-3);
    overflow: hidden;
    color: var(--color-text-primary);
    text-decoration: none;
    background: var(--slip-bg);
    border: 1px solid color-mix(in srgb, var(--ag-color) 45%, transparent);
    border-left: 4px solid var(--ag-color);
    border-radius: 6px;
    transition: box-shadow var(--motion-duration-base) var(--motion-easing-standard);
  }

  /* En curso: relleno Sol con tinta. Pulsa tres veces y se detiene. */
  .daily-agenda-page__timeline-slip--current {
    --ag-color: var(--ag-current);
    --slip-bg: var(--color-sun);

    color: var(--color-on-sun);
    border-color: var(--color-sun);
    border-left-color: color-mix(in srgb, var(--color-sun) 60%, var(--color-on-sun));
  }

  .daily-agenda-page__timeline-slip--current .daily-agenda-page__timeline-slip-time,
  .daily-agenda-page__timeline-slip--current .daily-agenda-page__timeline-slip-name,
  .daily-agenda-page__timeline-slip--current .daily-agenda-page__timeline-slip-service {
    color: var(--color-on-sun);
  }

  /* Por registrar: filete punteado sobre la superficie. */
  .daily-agenda-page__timeline-slip--pending {
    --ag-color: var(--ag-pending);
    --slip-bg: var(--color-surface);

    border-style: dashed;
    border-left-style: dotted;
  }

  .daily-agenda-page__timeline-slip--completed {
    --ag-color: var(--ag-completed);
  }

  /* No asistió y Cancelada: franjas huecas, sobre el cielo. */
  .daily-agenda-page__timeline-slip--no-show {
    --ag-color: var(--ag-no-show);
    --slip-bg: color-mix(in srgb, var(--color-surface) 55%, transparent);

    border-style: dashed;
    border-left-style: solid;
  }

  .daily-agenda-page__timeline-slip--cancelled {
    --ag-color: var(--ag-cancelled);
    --slip-bg: color-mix(in srgb, var(--color-surface) 55%, transparent);

    border-style: dashed;
    border-left-style: solid;
  }

  .daily-agenda-page__timeline-slip--cancelled .daily-agenda-page__timeline-slip-name {
    color: var(--color-text-secondary);
    text-decoration: line-through;
  }

  .daily-agenda-page__timeline-slip--terminal .daily-agenda-page__timeline-slip-name {
    font-weight: 500;
  }

  /* Ficha ensanchada (cursor encima o tocada): se lee entera, opaca y por
     encima de las vecinas. El hover solo cuenta con puntero fino. */
  .daily-agenda-page__timeline-slip--expanded {
    z-index: 3;
    min-width: max-content;
    overflow: visible;
    background: linear-gradient(var(--slip-bg), var(--slip-bg)), var(--color-surface);
    box-shadow: var(--shadow-dialog);
  }

  @media (hover: hover) {
    .daily-agenda-page__timeline-slip:hover {
      z-index: 3;
      min-width: max-content;
      overflow: visible;
      background: linear-gradient(var(--slip-bg), var(--slip-bg)), var(--color-surface);
      box-shadow: var(--shadow-dialog);
    }

    .daily-agenda-page__timeline-slip:hover .daily-agenda-page__timeline-slip-name {
      overflow: visible;
      text-overflow: clip;
    }
  }

  .daily-agenda-page__timeline-slip--expanded .daily-agenda-page__timeline-slip-name,
  .daily-agenda-page__timeline-slip--expanded .daily-agenda-page__timeline-slip-service {
    overflow: visible;
    text-overflow: clip;
  }

  .daily-agenda-page__timeline:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  /* Ficha estrecha: la hora y la inicial en un círculo; el nombre completo
     está en la lista y al pasar o tocar la ficha. */
  .daily-agenda-page__timeline-slip-initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
    background-color: var(--color-surface);
    border: 1px solid var(--color-border-control);
    border-radius: 50%;
  }

  .daily-agenda-page__timeline-slip-time {
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    color: var(--color-text-secondary);
  }

  .daily-agenda-page__timeline-slip-name {
    overflow: hidden;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    color: var(--color-text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .daily-agenda-page__timeline-slip-service {
    overflow: hidden;
    font-size: 12px;
    line-height: 16px;
    color: var(--color-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .daily-agenda-page__timeline-mark--now::after {
    animation: none;
  }
}

:root[data-motion='reduced'] .daily-agenda-page__timeline-mark--now::after {
  animation: none;
}

/* «Ahora» en la lista: un filete Sol fino entre lo que pasó y lo que viene. */
.daily-agenda-page__now {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
  align-items: center;
  margin: var(--space-1) 0;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  color: var(--color-text-primary);
}

.daily-agenda-page__now::before {
  flex: none;
  width: 10px;
  height: 10px;
  content: '';
  background-color: var(--color-sun);
  border-radius: 1px;
  rotate: 45deg;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-sun) 30%, transparent);
}

.daily-agenda-page__now::after {
  flex: 1;
  height: 2px;
  content: '';
  background-color: var(--color-sun);
  border-radius: 1px;
}

/* La franja del día va en el teléfono y la tableta; en escritorio la reemplaza
   el carril. */
.daily-agenda-page__strip {
  flex-shrink: 0;
}

@media (min-width: 1024px) {
  .daily-agenda-page__strip {
    display: none;
  }
}
</style>
