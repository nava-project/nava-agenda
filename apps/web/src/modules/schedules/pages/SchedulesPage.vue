<script setup lang="ts">
// Pantalla "Horarios" (HU-040): elegir un profesional y mantener sus tramos de
// horario laboral recurrente, agrupados por día ISO de la semana (los
// siete días siempre aparecen, con o sin tramos, CA-040-01). Un profesional con
// un solo tramo y uno con jornada partida en varios días usan exactamente
// el mismo componente (CA-040-02): nunca hay una rama especial. Estados
// discriminados: carga inicial, listo, vacío (sin profesionales), error
// recuperable, cargando tramos del profesional elegido, guardando. Un error
// recuperable nunca borra lo que ya se escribió en el diálogo abierto; solo
// una respuesta exitosa del servidor cierra el diálogo o cambia una fila
// (trabajo requerido §4.3/§4.4 de HU-021, mismo criterio aquí). Cada cambio
// confirmado añade un aviso emergente (DEC-095); los errores siguen en línea.
// La semana se dibuja como un tablero (WeeklyBoard): barras en tinta suave sobre una
// regla horaria común, con la lista real de tramos debajo de cada día.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  LOADER_APPEAR_MS,
  LOADER_MIN_VISIBLE_MS,
  useCountUp,
  useToast,
  useVocabulary,
} from '@/shared/composables'
import { isSoloProfile, worksOwnProfessional } from '@/shared/model'
import { formatCivilDateLong, getCivilDateInTimezone } from '@/shared/time/civilDate'
import { timezoneName } from '@/shared/time/timezoneName'
import {
  ProfessionalAvatar,
  BaseAlert,
  BaseButton,
  BaseDatePicker,
  BaseDialog,
  BaseInput,
  BaseSelect,
  BaseTimePicker,
  DialogSeal,
  DiamondLoader,
  EmptyScene,
  ContentReveal,
} from '@/shared/ui'
import AccordionItem from '../components/AccordionItem.vue'
import DayTrack from '../components/DayTrack.vue'
import WeekdayPicker from '../components/WeekdayPicker.vue'
import WeeklyBoard from '../components/WeeklyBoard.vue'
import {
  createWorkingHour,
  deleteWorkingHour,
  fetchProfessionalSummaries,
  fetchBusinessTimezone,
  fetchWorkingHours,
  updateWorkingHour,
} from '../api/schedulesApi'
import {
  createScheduleException,
  deleteScheduleException,
  fetchColombianHolidays,
  fetchHolidayCalendar,
  fetchScheduleExceptions,
  updateHolidayCalendar,
  updateScheduleException,
  type ScheduleExceptionSegmentInput,
} from '../api/scheduleExceptionsApi'
import { newIdempotencyKey } from '../model/idempotencyKey'
import {
  civilDateTile as dateTile,
  clockRangeLabel,
  computeScale,
  durationBetween,
  formatHours,
  minutesToTime,
  timeToMinutes,
  nowInTimezone,
  type BoardNow,
} from '../model/weekBoard'
import type { ColombianHoliday, ScheduleException } from '../model/scheduleException'
import {
  ISO_WEEKDAYS,
  weekdayLabel,
  type ProfessionalSummary,
  type WorkingHour,
} from '../model/workingHour'
import {
  validateDurationMinutes,
  validateISOWeekday,
  validateStartsTime,
} from '../validation/scheduleValidation'
import {
  validateEffectiveDate,
  validateExceptionShape,
  validateReason,
} from '../validation/exceptionValidation'

type PageStatus = 'loading' | 'ready' | 'load-error'
type WorkingHoursStatus = 'idle' | 'loading' | 'ready' | 'error'
type SaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'overlap-conflict'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'

const pageStatus = ref<PageStatus>('loading')
const professionals = ref<ProfessionalSummary[]>([])
const selectedProfessionalId = ref<string | null>(null)
// CA-040-06: zona IANA del negocio, nunca la del dispositivo. null
// mientras carga o si la consulta falla; no bloquea la pantalla (la hora
// civil ya es correcta sin conversión alguna).
const businessTimezone = ref<string | null>(null)

const workingHoursStatus = ref<WorkingHoursStatus>('idle')
const workingHours = ref<WorkingHour[]>([])
const pendingDeleteIds = ref<Set<string>>(new Set())

const v = useVocabulary()

// Perfil de profesional individual (DEC-115): con un solo profesional no hay selector.
const hideProfessionalPicker = computed(
  () => worksOwnProfessional.value && professionals.value.length === 1,
)

const selectedProfessional = computed(
  () => professionals.value.find((b) => b.id === selectedProfessionalId.value) ?? null,
)

// groupedByWeekday siempre incluye los siete días, en orden, con o sin
// tramos (CA-040-01): un día sin ninguno simplemente muestra su lista
// vacía, nunca desaparece de la pantalla.
const groupedByWeekday = computed(() => {
  return ISO_WEEKDAYS.map((day) => ({
    ...day,
    items: workingHours.value
      .filter((wh) => wh.isoWeekday === day.value)
      .sort((a, b) => a.startsTime.localeCompare(b.startsTime)),
  }))
})

const toast = useToast()

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
  pageStatus.value = 'ready'

  if (professionals.value.length > 0) {
    await selectProfessional(professionals.value[0]!.id)
  }
}

onMounted(loadPage)

function onRetryLoad() {
  void loadPage()
}

// Al cambiar de profesional la semana anterior queda en pantalla, atenuada e inerte,
// bajo un velo de carga: cambiar el tablero por un esqueleto de otro alto hacía
// saltar toda la pantalla (issue #575). El esqueleto queda solo para la
// primera carga, cuando aún no hay semana que mostrar.
const hasShownWorkingHours = ref(false)
const boardBusy = computed(
  () => workingHoursStatus.value === 'loading' && hasShownWorkingHours.value,
)

// El velo y la atenuación esperan LOADER_APPEAR_MS antes de verse (un temporizador:
// un transition-delay que se cancela a medias destella al salir) y, si asomaron,
// se quedan su entrada más LOADER_MIN_VISIBLE_MS. El cargador de dentro no suma
// su propio retardo: es uno solo (#843, CA-22; el patrón del velo de #841).
const VEIL_ENTER_MS = 180
const veilShown = ref(false)
let veilTimer: ReturnType<typeof setTimeout> | undefined
let veilShownAt = 0
watch(boardBusy, (busy) => {
  clearTimeout(veilTimer)
  veilTimer = undefined
  if (busy) {
    if (veilShown.value) return
    veilTimer = setTimeout(() => {
      veilShownAt = Date.now()
      veilShown.value = true
    }, LOADER_APPEAR_MS)
    return
  }
  const hold = veilShownAt + VEIL_ENTER_MS + LOADER_MIN_VISIBLE_MS - Date.now()
  if (!veilShown.value || hold <= 0) {
    veilShown.value = false
    return
  }
  veilTimer = setTimeout(() => (veilShown.value = false), hold)
})
// El esqueleto de la página tapa también la primera vista completa (#817): la
// semana, el calendario de festivos, las excepciones y los festivos de
// referencia. Sin esto se destapaba un segundo esqueleto (el del tablero), la
// semana llegaba después desde transparente y los acordeones del lateral
// crecían con la pantalla ya a la vista. Un fallo también se destapa: trae su
// aviso. Se marca una sola vez (ver el watch junto a los festivos).
const firstViewSettled = ref(false)
const coverLoading = computed(
  () => pageStatus.value === 'loading' || (pageStatus.value === 'ready' && !firstViewSettled.value),
)
// Las cifras de la semana aún no tienen dato que mostrar (primera carga).
const statsPending = computed(() => workingHoursStatus.value !== 'ready' && !boardBusy.value)

async function selectProfessional(professionalId: string) {
  selectedProfessionalId.value = professionalId
  workingHoursStatus.value = 'loading'
  // Las tres consultas del profesional salen a la vez (#817): antes el
  // lateral esperaba a la semana y llegaba una ida y vuelta más tarde.
  void loadHolidayCalendar(professionalId)
  void loadExceptions(professionalId)

  const outcome = await fetchWorkingHours(professionalId)
  // El profesional seleccionado pudo cambiar mientras la solicitud estaba en
  // vuelo (cambio rápido en el selector): descarta una respuesta obsoleta.
  if (selectedProfessionalId.value !== professionalId) return

  if (outcome.kind === 'success') {
    workingHours.value = outcome.page.items
    workingHoursStatus.value = 'ready'
    hasShownWorkingHours.value = true
  } else {
    workingHoursStatus.value = 'error'
  }
}

function onProfessionalChange(professionalId: string) {
  if (professionalId === selectedProfessionalId.value) return
  void selectProfessional(professionalId)
}

// El aviso con «Reintentar» desaparece en cuanto vuelve a cargar: el foco pasa
// antes al selector de profesional, que sigue ahí (o al área del horario, en el
// perfil individual sin selector), para que no caiga al body (#843, CA-13).
const whoRef = ref<HTMLElement | null>(null)
const workspaceMainRef = ref<HTMLElement | null>(null)

function onRetryWorkingHours() {
  const target =
    whoRef.value?.querySelector<HTMLElement>('#schedules-professional-select') ??
    workspaceMainRef.value
  target?.focus()
  if (selectedProfessionalId.value) void selectProfessional(selectedProfessionalId.value)
}

// --- Alta -------------------------------------------------------------

const isCreateOpen = ref(false)
const createISOWeekday = ref(1)
const createStartsTime = ref('')
// Una hora de fin igual o anterior a la de inicio cruza la medianoche (22:00 →
// 01:00 son 180 min), igual que en los bloqueos y las excepciones.
function derivedDuration(startsTime: string, endsTime: string): number {
  return startsTime && endsTime ? durationBetween(startsTime, endsTime) : 0
}

function endsTimeError(endsTime: string, durationMinutes: number): string | undefined {
  return endsTime === '' ? 'Elige la hora de fin.' : validateDurationMinutes(durationMinutes)
}

// El tramo se captura como «de HH:MM a HH:MM»; durationMinutes (lo que pide la
// API) se deriva de ambas horas y vale 0 mientras falte alguna.
const createEndsTime = ref('')
const createDurationMinutes = ref(0)
const createWeekdayError = ref<string | undefined>(undefined)
const createStartsTimeError = ref<string | undefined>(undefined)
const createDurationError = ref<string | undefined>(undefined)
const createStatus = ref<SaveStatus>('idle')
const createAttempted = ref(false)
// Clave de idempotencia del intento lógico vigente (RN-IDE-01): se genera
// al abrir el diálogo y se reutiliza en cada reintento del mismo intento
// (mismo criterio que staff/pages/StaffPage.vue).
let createIdempotencyKey = newIdempotencyKey()

function openCreateDialog(isoWeekday: number) {
  createISOWeekday.value = isoWeekday
  createStartsTime.value = ''
  createEndsTime.value = ''
  createDurationMinutes.value = 0
  createWeekdayError.value = undefined
  createStartsTimeError.value = undefined
  createDurationError.value = undefined
  createStatus.value = 'idle'
  createAttempted.value = false
  createIdempotencyKey = newIdempotencyKey()
  isCreateOpen.value = true
}

function onCreateDialogClosed() {
  createStatus.value = 'idle'
}

function revalidateCreate() {
  if (!createAttempted.value) return
  createWeekdayError.value = validateISOWeekday(createISOWeekday.value)
  createStartsTimeError.value = validateStartsTime(createStartsTime.value)
  createDurationError.value = endsTimeError(createEndsTime.value, createDurationMinutes.value)
}

function onCreateWeekdayInput(value: number) {
  createISOWeekday.value = value
  revalidateCreate()
}

function onCreateStartsTimeInput(value: string | number) {
  createStartsTime.value = String(value)
  createDurationMinutes.value = derivedDuration(createStartsTime.value, createEndsTime.value)
  revalidateCreate()
}

function onCreateEndsTimeInput(value: string | number) {
  createEndsTime.value = String(value)
  createDurationMinutes.value = derivedDuration(createStartsTime.value, createEndsTime.value)
  revalidateCreate()
}

async function onSubmitCreate() {
  if (createStatus.value === 'saving' || !selectedProfessionalId.value) return

  createAttempted.value = true
  const weekdayError = validateISOWeekday(createISOWeekday.value)
  const startsTimeError = validateStartsTime(createStartsTime.value)
  const durationError = endsTimeError(createEndsTime.value, createDurationMinutes.value)
  createWeekdayError.value = weekdayError
  createStartsTimeError.value = startsTimeError
  createDurationError.value = durationError
  if (weekdayError || startsTimeError || durationError) return

  createStatus.value = 'saving'
  const outcome = await createWorkingHour(
    selectedProfessionalId.value,
    createISOWeekday.value,
    createStartsTime.value,
    createDurationMinutes.value,
    createIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      workingHours.value.push(outcome.workingHour)
      isCreateOpen.value = false
      createStatus.value = 'idle'
      toast.success('Tramo agregado', { detail: 'El tramo ya forma parte de la jornada semanal.' })
      return
    case 'validation-error':
      createStatus.value = 'validation-error'
      return
    case 'overlap-conflict':
      createStatus.value = 'overlap-conflict'
      return
    case 'idempotency-conflict':
      createStatus.value = 'idempotency-conflict'
      return
    case 'not-found':
      createStatus.value = 'not-found'
      return
    case 'network-error':
      createStatus.value = 'network-error'
      return
    case 'unexpected-error':
      createStatus.value = 'unexpected-error'
  }
}

// --- Edición ------------------------------------------------------------

const isEditOpen = ref(false)
const editTarget = ref<WorkingHour | null>(null)
const editISOWeekday = ref(1)
const editStartsTime = ref('')
const editEndsTime = ref('')
const editDurationMinutes = ref(0)
const editWeekdayError = ref<string | undefined>(undefined)
const editStartsTimeError = ref<string | undefined>(undefined)
const editDurationError = ref<string | undefined>(undefined)
const editStatus = ref<SaveStatus>('idle')
const editAttempted = ref(false)

function openEditDialog(wh: WorkingHour) {
  editTarget.value = wh
  editISOWeekday.value = wh.isoWeekday
  editStartsTime.value = wh.startsTime
  editEndsTime.value = minutesToTime(timeToMinutes(wh.startsTime) + wh.durationMinutes)
  editDurationMinutes.value = wh.durationMinutes
  editWeekdayError.value = undefined
  editStartsTimeError.value = undefined
  editDurationError.value = undefined
  editStatus.value = 'idle'
  editAttempted.value = false
  isEditOpen.value = true
}

function onEditDialogClosed() {
  editStatus.value = 'idle'
}

/** El tramo del diálogo de edición tal como llegó: nada que guardar todavía. */
const editPristine = computed(() => {
  const target = editTarget.value
  if (!target) return false
  return (
    editISOWeekday.value === target.isoWeekday &&
    editStartsTime.value === target.startsTime &&
    editEndsTime.value === minutesToTime(timeToMinutes(target.startsTime) + target.durationMinutes)
  )
})

function revalidateEdit() {
  if (!editAttempted.value) return
  editWeekdayError.value = validateISOWeekday(editISOWeekday.value)
  editStartsTimeError.value = validateStartsTime(editStartsTime.value)
  editDurationError.value = endsTimeError(editEndsTime.value, editDurationMinutes.value)
}

function onEditWeekdayInput(value: number) {
  editISOWeekday.value = value
  revalidateEdit()
}

function onEditStartsTimeInput(value: string | number) {
  editStartsTime.value = String(value)
  editDurationMinutes.value = derivedDuration(editStartsTime.value, editEndsTime.value)
  revalidateEdit()
}

function onEditEndsTimeInput(value: string | number) {
  editEndsTime.value = String(value)
  editDurationMinutes.value = derivedDuration(editStartsTime.value, editEndsTime.value)
  revalidateEdit()
}

async function onSubmitEdit() {
  if (editStatus.value === 'saving' || !editTarget.value || !selectedProfessionalId.value) return

  editAttempted.value = true
  const weekdayError = validateISOWeekday(editISOWeekday.value)
  const startsTimeError = validateStartsTime(editStartsTime.value)
  const durationError = endsTimeError(editEndsTime.value, editDurationMinutes.value)
  editWeekdayError.value = weekdayError
  editStartsTimeError.value = startsTimeError
  editDurationError.value = durationError
  if (weekdayError || startsTimeError || durationError) return

  editStatus.value = 'saving'
  const outcome = await updateWorkingHour(
    selectedProfessionalId.value,
    editTarget.value.id,
    editISOWeekday.value,
    editStartsTime.value,
    editDurationMinutes.value,
  )

  switch (outcome.kind) {
    case 'success': {
      const index = workingHours.value.findIndex((wh) => wh.id === outcome.workingHour.id)
      if (index !== -1) workingHours.value[index] = outcome.workingHour
      isEditOpen.value = false
      editStatus.value = 'idle'
      toast.success('Tramo actualizado', { detail: 'Guardamos los cambios del tramo.' })
      return
    }
    case 'validation-error':
      editStatus.value = 'validation-error'
      return
    case 'overlap-conflict':
      editStatus.value = 'overlap-conflict'
      return
    case 'not-found':
      editStatus.value = 'not-found'
      return
    case 'network-error':
      editStatus.value = 'network-error'
      return
    case 'unexpected-error':
      editStatus.value = 'unexpected-error'
  }
}

// --- Retiro ---------------------------------------------------------------

const deleteError = ref<string | null>(null)

function isDeletePending(id: string): boolean {
  return pendingDeleteIds.value.has(id)
}

async function onDelete(wh: WorkingHour) {
  const professionalId = selectedProfessionalId.value
  if (!professionalId || isDeletePending(wh.id)) return

  const next = new Set(pendingDeleteIds.value)
  next.add(wh.id)
  pendingDeleteIds.value = next
  deleteError.value = null

  const outcome = await deleteWorkingHour(professionalId, wh.id)

  const after = new Set(pendingDeleteIds.value)
  after.delete(wh.id)
  pendingDeleteIds.value = after

  if (outcome.kind === 'success') {
    workingHours.value = workingHours.value.filter((item) => item.id !== wh.id)
    toast.success('Tramo retirado', { detail: 'El tramo ya no forma parte de la jornada.' })
    return
  }

  switch (outcome.kind) {
    case 'not-found':
      // Ya no existe (retirado antes, quizá en otra pestaña): se refleja
      // igual, sin tratarlo como un error nuevo que exija reintento.
      workingHours.value = workingHours.value.filter((item) => item.id !== wh.id)
      break
    case 'network-error':
      deleteError.value = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
      break
    case 'unexpected-error':
      deleteError.value = 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.'
  }
}

// --- HU-041: calendario de festivos colombianos (CA-041-01/02) -----------

type HolidayCalendarStatus = 'idle' | 'loading' | 'ready' | 'error'
const holidayCalendarStatus = ref<HolidayCalendarStatus>('idle')
const holidayCalendarEnabled = ref(false)
const holidayCalendarSaving = ref(false)
const holidayCalendarError = ref<string | null>(null)

async function loadHolidayCalendar(professionalId: string) {
  holidayCalendarStatus.value = 'loading'
  const outcome = await fetchHolidayCalendar(professionalId)
  if (selectedProfessionalId.value !== professionalId) return

  if (outcome.kind === 'success') {
    holidayCalendarEnabled.value = outcome.enabled
    holidayCalendarStatus.value = 'ready'
    return
  }
  holidayCalendarStatus.value = 'error'
}

async function onToggleHolidayCalendar(event: Event) {
  const professionalId = selectedProfessionalId.value
  const checked = (event.target as HTMLInputElement).checked
  if (!professionalId || holidayCalendarSaving.value) return

  holidayCalendarSaving.value = true
  holidayCalendarError.value = null
  const outcome = await updateHolidayCalendar(professionalId, checked)
  holidayCalendarSaving.value = false

  if (outcome.kind === 'success') {
    holidayCalendarEnabled.value = outcome.enabled
    toast.success(outcome.enabled ? 'Festivos activados' : 'Festivos desactivados', {
      detail: outcome.enabled
        ? 'Los festivos colombianos quedan cerrados, salvo una excepción manual.'
        : 'Los festivos ya no agregan ningún bloqueo automático.',
    })
    return
  }
  // La casilla vuelve a su valor real: ninguna respuesta distinta de
  // `success` cambió el estado persistido.
  holidayCalendarError.value =
    outcome.kind === 'network-error'
      ? 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
      : 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.'
}

// --- HU-041: festivos colombianos de referencia (RN-BLQ-02) ---------------

// upcomingColombianHolidays es un dato de referencia único para toda la
// pantalla (no depende del profesional elegido): se carga una sola vez.
const colombianHolidays = ref<ColombianHoliday[]>([])
const colombianHolidaysSettled = ref(false)

async function loadColombianHolidays() {
  const year = new Date().getFullYear()
  const outcome = await fetchColombianHolidays(year)
  if (outcome.kind === 'success') {
    const today = new Date().toISOString().slice(0, 10)
    colombianHolidays.value = outcome.items.filter((h) => h.date >= today)
  }
  colombianHolidaysSettled.value = true
}

// La primera vista completa (ver coverLoading): con profesionales, la semana y
// el lateral resueltos (bien o con su aviso); sin ellos, solo la escena vacía.
function settled(status: 'idle' | 'loading' | 'ready' | 'error'): boolean {
  return status === 'ready' || status === 'error'
}
watch(
  () =>
    pageStatus.value === 'ready' &&
    colombianHolidaysSettled.value &&
    (professionals.value.length === 0 ||
      (settled(workingHoursStatus.value) &&
        settled(holidayCalendarStatus.value) &&
        settled(exceptionsStatus.value))),
  (done) => {
    if (done) firstViewSettled.value = true
  },
)

// --- HU-041: excepciones de jornada (CA-041-04/05) -------------------------

type ExceptionsStatus = 'idle' | 'loading' | 'ready' | 'error'
const exceptionsStatus = ref<ExceptionsStatus>('idle')
const exceptions = ref<ScheduleException[]>([])
const pendingDeleteExceptionIds = ref<Set<string>>(new Set())
const exceptionDeleteError = ref<string | null>(null)

const sortedExceptions = computed(() =>
  [...exceptions.value].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
)

async function loadExceptions(professionalId: string) {
  exceptionsStatus.value = 'loading'
  const outcome = await fetchScheduleExceptions(professionalId)
  if (selectedProfessionalId.value !== professionalId) return

  if (outcome.kind === 'success') {
    exceptions.value = outcome.page.items
    exceptionsStatus.value = 'ready'
    return
  }
  exceptionsStatus.value = 'error'
}

function onRetryExceptions() {
  if (selectedProfessionalId.value) void loadExceptions(selectedProfessionalId.value)
}

type ExceptionSaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'date-conflict'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'

// El tramo se captura como «de HH:MM a HH:MM»; durationMinutes es lo que pide
// la API y se deriva de ambas horas (0 mientras falte alguna, que la validación
// rechaza). Una hora de fin igual o anterior a la de inicio cruza la
// medianoche, igual que en los bloqueos.
interface ExceptionSegmentRow {
  startsTime: string
  endsTime: string
  durationMinutes: number
}

function newSegmentRow(): ExceptionSegmentRow {
  return { startsTime: '', endsTime: '', durationMinutes: 0 }
}

function syncSegmentDuration(segment: ExceptionSegmentRow) {
  segment.durationMinutes =
    segment.startsTime && segment.endsTime
      ? durationBetween(segment.startsTime, segment.endsTime)
      : 0
}

function segmentCrossesMidnight(segment: ExceptionSegmentRow): boolean {
  return (
    !!segment.startsTime &&
    !!segment.endsTime &&
    timeToMinutes(segment.endsTime) <= timeToMinutes(segment.startsTime)
  )
}

// --- Alta de excepción -----------------------------------------------------

const isExceptionCreateOpen = ref(false)
const createEffectiveDate = ref('')
const createIsClosed = ref(true)
const createReason = ref('')
const createSegments = ref<ExceptionSegmentRow[]>([])
const createEffectiveDateError = ref<string | undefined>(undefined)
const createReasonError = ref<string | undefined>(undefined)
const createShapeError = ref<string | undefined>(undefined)
const createExceptionStatus = ref<ExceptionSaveStatus>('idle')
const createExceptionAttempted = ref(false)
let createExceptionIdempotencyKey = newIdempotencyKey()

function openExceptionCreateDialog(prefillDate?: string) {
  createEffectiveDate.value = prefillDate ?? ''
  createIsClosed.value = true
  createReason.value = ''
  createSegments.value = []
  createEffectiveDateError.value = undefined
  createReasonError.value = undefined
  createShapeError.value = undefined
  createExceptionStatus.value = 'idle'
  createExceptionAttempted.value = false
  createExceptionIdempotencyKey = newIdempotencyKey()
  isExceptionCreateOpen.value = true
}

function onExceptionCreateDialogClosed() {
  createExceptionStatus.value = 'idle'
}

function onCreateIsClosedChange(isClosed: boolean) {
  createIsClosed.value = isClosed
  if (!isClosed && createSegments.value.length === 0) {
    createSegments.value = [newSegmentRow()]
  }
  revalidateExceptionCreate()
}

function onCreateEffectiveDateInput(value: string) {
  createEffectiveDate.value = value
  revalidateExceptionCreate()
}

function addCreateSegment() {
  createSegments.value = [...createSegments.value, newSegmentRow()]
}

function removeCreateSegment(index: number) {
  createSegments.value = createSegments.value.filter((_, i) => i !== index)
  revalidateExceptionCreate()
}

function revalidateExceptionCreate() {
  if (!createExceptionAttempted.value) return
  createEffectiveDateError.value = validateEffectiveDate(createEffectiveDate.value)
  createReasonError.value = validateReason(createReason.value)
  createShapeError.value = validateExceptionShape(createIsClosed.value, createSegments.value)
}

async function onSubmitExceptionCreate() {
  if (createExceptionStatus.value === 'saving' || !selectedProfessionalId.value) return

  createExceptionAttempted.value = true
  const effectiveDateError = validateEffectiveDate(createEffectiveDate.value)
  const reasonError = validateReason(createReason.value)
  const shapeError = validateExceptionShape(createIsClosed.value, createSegments.value)
  createEffectiveDateError.value = effectiveDateError
  createReasonError.value = reasonError
  createShapeError.value = shapeError
  if (effectiveDateError || reasonError || shapeError) return

  createExceptionStatus.value = 'saving'
  const segments: ScheduleExceptionSegmentInput[] = createIsClosed.value
    ? []
    : createSegments.value.map((s) => ({
        startsTime: s.startsTime,
        durationMinutes: s.durationMinutes,
      }))
  const outcome = await createScheduleException(
    selectedProfessionalId.value,
    createEffectiveDate.value,
    createIsClosed.value,
    createReason.value.trim() === '' ? null : createReason.value.trim(),
    segments,
    createExceptionIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      exceptions.value.push(outcome.exception)
      isExceptionCreateOpen.value = false
      createExceptionStatus.value = 'idle'
      toast.success('Excepción agregada', { detail: 'La excepción ya está en el calendario.' })
      return
    case 'validation-error':
      createExceptionStatus.value = 'validation-error'
      return
    case 'date-conflict':
      createExceptionStatus.value = 'date-conflict'
      return
    case 'idempotency-conflict':
      createExceptionStatus.value = 'idempotency-conflict'
      return
    case 'not-found':
      createExceptionStatus.value = 'not-found'
      return
    case 'network-error':
      createExceptionStatus.value = 'network-error'
      return
    case 'unexpected-error':
      createExceptionStatus.value = 'unexpected-error'
  }
}

// --- Edición de excepción ---------------------------------------------------

const isExceptionEditOpen = ref(false)
const editExceptionTarget = ref<ScheduleException | null>(null)
const editEffectiveDate = ref('')
const editIsClosed = ref(true)
const editReason = ref('')
const editSegments = ref<ExceptionSegmentRow[]>([])
const editEffectiveDateError = ref<string | undefined>(undefined)
const editReasonError = ref<string | undefined>(undefined)
const editShapeError = ref<string | undefined>(undefined)
const editExceptionStatus = ref<ExceptionSaveStatus>('idle')
const editExceptionAttempted = ref(false)

function openExceptionEditDialog(exception: ScheduleException) {
  editExceptionTarget.value = exception
  editEffectiveDate.value = exception.effectiveDate
  editIsClosed.value = exception.isClosed
  editReason.value = exception.reason ?? ''
  editSegments.value = exception.segments.map((s) => ({
    startsTime: s.startsTime,
    endsTime: minutesToTime(timeToMinutes(s.startsTime) + s.durationMinutes),
    durationMinutes: s.durationMinutes,
  }))
  editEffectiveDateError.value = undefined
  editReasonError.value = undefined
  editShapeError.value = undefined
  editExceptionStatus.value = 'idle'
  editExceptionAttempted.value = false
  isExceptionEditOpen.value = true
}

function onExceptionEditDialogClosed() {
  editExceptionStatus.value = 'idle'
}

function onEditIsClosedChange(isClosed: boolean) {
  editIsClosed.value = isClosed
  if (!isClosed && editSegments.value.length === 0) {
    editSegments.value = [newSegmentRow()]
  }
  revalidateExceptionEdit()
}

function onEditEffectiveDateInput(value: string) {
  editEffectiveDate.value = value
  revalidateExceptionEdit()
}

function addEditSegment() {
  editSegments.value = [...editSegments.value, newSegmentRow()]
}

function removeEditSegment(index: number) {
  editSegments.value = editSegments.value.filter((_, i) => i !== index)
  revalidateExceptionEdit()
}

function revalidateExceptionEdit() {
  if (!editExceptionAttempted.value) return
  editEffectiveDateError.value = validateEffectiveDate(editEffectiveDate.value)
  editReasonError.value = validateReason(editReason.value)
  editShapeError.value = validateExceptionShape(editIsClosed.value, editSegments.value)
}

async function onSubmitExceptionEdit() {
  if (
    editExceptionStatus.value === 'saving' ||
    !editExceptionTarget.value ||
    !selectedProfessionalId.value
  )
    return

  editExceptionAttempted.value = true
  const effectiveDateError = validateEffectiveDate(editEffectiveDate.value)
  const reasonError = validateReason(editReason.value)
  const shapeError = validateExceptionShape(editIsClosed.value, editSegments.value)
  editEffectiveDateError.value = effectiveDateError
  editReasonError.value = reasonError
  editShapeError.value = shapeError
  if (effectiveDateError || reasonError || shapeError) return

  editExceptionStatus.value = 'saving'
  const segments: ScheduleExceptionSegmentInput[] = editIsClosed.value
    ? []
    : editSegments.value.map((s) => ({
        startsTime: s.startsTime,
        durationMinutes: s.durationMinutes,
      }))
  const outcome = await updateScheduleException(
    selectedProfessionalId.value,
    editExceptionTarget.value.id,
    editEffectiveDate.value,
    editIsClosed.value,
    editReason.value.trim() === '' ? null : editReason.value.trim(),
    segments,
  )

  switch (outcome.kind) {
    case 'success': {
      const index = exceptions.value.findIndex((e) => e.id === outcome.exception.id)
      if (index !== -1) exceptions.value[index] = outcome.exception
      isExceptionEditOpen.value = false
      editExceptionStatus.value = 'idle'
      toast.success('Excepción actualizada', { detail: 'Guardamos los cambios de la excepción.' })
      return
    }
    case 'validation-error':
      editExceptionStatus.value = 'validation-error'
      return
    case 'date-conflict':
      editExceptionStatus.value = 'date-conflict'
      return
    case 'not-found':
      editExceptionStatus.value = 'not-found'
      return
    case 'network-error':
      editExceptionStatus.value = 'network-error'
      return
    case 'unexpected-error':
      editExceptionStatus.value = 'unexpected-error'
  }
}

// --- Retiro de excepción ----------------------------------------------------

function isExceptionDeletePending(id: string): boolean {
  return pendingDeleteExceptionIds.value.has(id)
}

async function onDeleteException(exception: ScheduleException) {
  const professionalId = selectedProfessionalId.value
  if (!professionalId || isExceptionDeletePending(exception.id)) return

  const next = new Set(pendingDeleteExceptionIds.value)
  next.add(exception.id)
  pendingDeleteExceptionIds.value = next
  exceptionDeleteError.value = null

  const outcome = await deleteScheduleException(professionalId, exception.id)

  const after = new Set(pendingDeleteExceptionIds.value)
  after.delete(exception.id)
  pendingDeleteExceptionIds.value = after

  if (outcome.kind === 'success') {
    exceptions.value = exceptions.value.filter((item) => item.id !== exception.id)
    toast.success('Excepción retirada', { detail: 'La excepción ya no está en el calendario.' })
    return
  }

  switch (outcome.kind) {
    case 'not-found':
      exceptions.value = exceptions.value.filter((item) => item.id !== exception.id)
      break
    case 'network-error':
      exceptionDeleteError.value = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
      break
    case 'unexpected-error':
      exceptionDeleteError.value =
        'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.'
  }
}

onMounted(loadColombianHolidays)

// --- Tablero semanal, cifras y reloj del negocio -------------------------

// Duraciones que un profesional escribe una y otra vez: atajos, no una regla.
// Panel lateral en acordeón: un solo apartado abierto a la vez para que la
// pantalla quepa sin desplazarse. Las excepciones abren primero: son lo que
// más se edita; el estado de los festivos se lee en la insignia del apartado.
type AsidePanel = 'holidays' | 'exceptions' | 'upcoming'
const openPanel = ref<AsidePanel | null>('exceptions')

function togglePanel(panel: AsidePanel) {
  openPanel.value = openPanel.value === panel ? null : panel
}

const professionalOptions = computed(() =>
  professionals.value.map((professional) => ({
    value: professional.id,
    label: professional.fullName,
  })),
)

const boardScale = computed(() => computeScale(workingHours.value))
const weekMinutes = computed(() =>
  workingHours.value.reduce((sum, wh) => sum + wh.durationMinutes, 0),
)
const activeDays = computed(() => new Set(workingHours.value.map((wh) => wh.isoWeekday)).size)
// Las cifras de la cabecera cuentan hasta su valor al aparecer o cambiar (#743).
// Las horas cuentan en horas enteras: contar minutos alargaría el texto
// («37 h 12 min») a mitad de la cuenta; el formato exacto llega al final.
const shownWeekMinutes = useCountUp(() => weekMinutes.value)
const shownActiveDays = useCountUp(() => activeDays.value)
const weekHoursLabel = computed(() =>
  shownWeekMinutes.value === weekMinutes.value
    ? formatHours(weekMinutes.value)
    : `${Math.floor(shownWeekMinutes.value / 60)} h`,
)

// La cifra protagonista y sus unidades menudas, como el «/7» de los días
// (revisión de #783): «51 h 30 min» no se parte ni desborda a 320.
const weekHoursParts = computed(() =>
  weekHoursLabel.value
    .split(/(\d+)/)
    .filter(Boolean)
    .map((text) => ({ text, unit: !/^\d+$/.test(text) })),
)

// "Hoy" y "ahora" se leen en la zona del negocio, nunca en la del
// dispositivo (CA-040-06). Sin zona conocida no se marca ninguno.
const clock = ref<BoardNow | null>(null)

function refreshClock() {
  if (!businessTimezone.value) {
    clock.value = null
    return
  }
  try {
    clock.value = nowInTimezone(businessTimezone.value)
  } catch {
    clock.value = null
  }
}

watch(businessTimezone, refreshClock, { immediate: true })

let clockTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clockTimer = setInterval(refreshClock, 30_000)
})
onUnmounted(() => {
  clearTimeout(veilTimer)
  if (clockTimer !== undefined) clearInterval(clockTimer)
})

const todayIsoWeekday = computed(() => clock.value?.isoWeekday ?? null)
const nowMinute = computed(() => clock.value?.minute ?? null)
const todayCivilDate = computed(() =>
  businessTimezone.value && clock.value ? getCivilDateInTimezone(businessTimezone.value) : null,
)

// Fechas de excepciones y festivos en palabras, nunca ISO (revisión de #783):
// «martes 8 de diciembre», con el año solo si no es el de hoy en el negocio.
function longDate(civilDate: string): string {
  return formatCivilDateLong(
    civilDate,
    todayCivilDate.value ?? new Date().toISOString().slice(0, 10),
  )
}

const exceptionDates = computed(() => new Set(exceptions.value.map((e) => e.effectiveDate)))

function weekdayInitial(isoWeekday: number): string {
  return weekdayLabel(isoWeekday).charAt(0)
}

// buildPreview dibuja el tramo que se está escribiendo sobre la pista de su
// día, junto a los que ese día ya tiene (atenuados): así un solape se ve antes
// de guardar. El servidor sigue siendo quien decide (CA-040-04).
function buildPreview(
  isoWeekday: number,
  startsTime: string,
  durationMinutes: number,
  excludeId: string | null,
) {
  const context = workingHours.value
    .filter((wh) => wh.isoWeekday === isoWeekday && wh.id !== excludeId)
    .map((wh) => ({
      id: wh.id,
      startsTime: wh.startsTime,
      durationMinutes: wh.durationMinutes,
      muted: true,
    }))
  const valid =
    /^\d{2}:\d{2}$/.test(startsTime) &&
    Number.isInteger(durationMinutes) &&
    durationMinutes >= 1 &&
    durationMinutes <= 1440
  const draft = { id: 'draft', startsTime, durationMinutes, muted: false }
  return {
    segments: valid ? [...context, draft] : context,
    scale: computeScale(valid ? [...context, draft] : context),
    text: valid
      ? `${weekdayLabel(isoWeekday)} · ${clockRangeLabel(startsTime, durationMinutes)} · ${formatHours(durationMinutes)}`
      : 'Elige la hora de inicio y de fin para ver cómo queda.',
  }
}

const createPreview = computed(() =>
  buildPreview(createISOWeekday.value, createStartsTime.value, createDurationMinutes.value, null),
)
const editPreview = computed(() =>
  buildPreview(
    editISOWeekday.value,
    editStartsTime.value,
    editDurationMinutes.value,
    editTarget.value?.id ?? null,
  ),
)
</script>

<template>
  <section class="schedules-page" aria-labelledby="schedules-page-title">
    <header class="schedules-page__header">
      <div class="schedules-page__heading">
        <h1 id="schedules-page-title" class="schedules-page__title">Horarios</h1>
        <p class="schedules-page__subtitle">Jornada semanal, festivos y excepciones.</p>
      </div>
      <!-- Controles de la jornada junto al título: sin profesionales no hay jornada
           que armar, así que la acción principal tampoco aparece. Mientras carga,
           un esqueleto del mismo alto ocupa su sitio: la cabecera no crece al
           llegar los datos y el contenido de debajo no salta (CLS, revisión de
           #720). -->
      <div
        v-if="pageStatus === 'loading' || (pageStatus === 'ready' && professionals.length > 0)"
        class="schedules-page__controls"
      >
        <div
          v-if="pageStatus === 'loading'"
          class="schedules-page__who schedules-page__who--skeleton"
          aria-hidden="true"
        >
          <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--portrait" />
          <!-- El perfil del panel se conoce antes de cargar (DEC-115): quien trabaja
               su propia agenda ve su nombre y no el selector, así que el esqueleto
               toma desde el primer cuadro el alto del nombre (47 px). -->
          <span
            v-if="worksOwnProfessional"
            class="schedules-page__skeleton-bar schedules-page__skeleton-bar--name"
          />
          <span v-else class="schedules-page__select schedules-page__skeleton-select">
            <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--label" />
            <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--field" />
          </span>
        </div>
        <div v-else ref="whoRef" class="schedules-page__who">
          <!-- El retrato de la familia (#782, como la ficha de #762): filete de
               latón y su rombo asomando bajo el borde, como un sello. -->
          <span class="schedules-page__frame">
            <ProfessionalAvatar
              class="schedules-page__portrait"
              size="row"
              :full-name="selectedProfessional?.fullName ?? ''"
              :photo-url="selectedProfessional?.photoUrl ?? null"
            />
          </span>
          <BaseSelect
            v-if="!hideProfessionalPicker"
            id="schedules-professional-select"
            class="schedules-page__select"
            :label="v.Professional"
            :model-value="selectedProfessionalId ?? ''"
            :options="professionalOptions"
            @update:model-value="onProfessionalChange"
          />
          <!-- Perfil de profesional individual (DEC-115): con un solo profesional no hay nada que elegir. -->
          <span v-else class="schedules-page__who-name">{{ selectedProfessional?.fullName }}</span>
        </div>

        <!-- Las cifras quedan montadas desde la carga (con un marcador en lugar
             del número) para no empujar el tablero al llegar la jornada. -->
        <dl
          v-if="workingHoursStatus !== 'error'"
          class="schedules-page__stats"
          :class="{ 'schedules-page__stats--busy': veilShown }"
          :aria-busy="statsPending || undefined"
          :inert="veilShown || undefined"
        >
          <div>
            <dt>Horas por semana</dt>
            <dd>
              <span
                v-if="statsPending"
                class="schedules-page__skeleton-bar schedules-page__skeleton-bar--stat"
                aria-hidden="true"
              />
              <Transition v-else name="schedules-stat" mode="out-in">
                <span :key="weekMinutes"
                  ><template v-for="(part, index) in weekHoursParts" :key="index"
                    ><small v-if="part.unit" class="schedules-page__stat-unit">{{
                      part.text
                    }}</small
                    ><template v-else>{{ part.text }}</template></template
                  ></span
                >
              </Transition>
            </dd>
          </div>
          <div>
            <dt>Días con jornada</dt>
            <dd>
              <span
                v-if="statsPending"
                class="schedules-page__skeleton-bar schedules-page__skeleton-bar--stat"
                aria-hidden="true"
              />
              <Transition v-else name="schedules-stat" mode="out-in">
                <span :key="activeDays"
                  >{{ Math.round(shownActiveDays)
                  }}<small class="schedules-page__stat-total">/7</small></span
                >
              </Transition>
            </dd>
          </div>
        </dl>
      </div>
    </header>

    <!-- Carga → tablero sin parpadeo (#817, ContentReveal, como Servicios y
         Profesionales): el esqueleto se desvanece por encima del tablero ya
         montado. Antes un mode="out-in" dejaba un instante en blanco. -->
    <ContentReveal class="schedules-page__stage" :loading="coverLoading">
      <template #loading>
        <div class="schedules-page__state" role="status" aria-live="polite">
          <DiamondLoader :label="`Cargando los horarios…`" layout="overlay" />
          <div class="schedules-page__skeleton" aria-hidden="true">
            <span v-for="n in 4" :key="n" class="schedules-page__skeleton-row">
              <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--day" />
              <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--track" />
            </span>
          </div>
        </div>
      </template>

      <BaseAlert
        v-if="pageStatus === 'load-error'"
        variant="warning"
        title="No pudimos cargar esta sección"
        role="alert"
      >
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton type="button" variant="secondary" @click="onRetryLoad">Reintentar</BaseButton>
        </template>
      </BaseAlert>

      <div v-else-if="pageStatus !== 'loading'" class="schedules-page__ready">
        <EmptyScene v-if="professionals.length === 0" scene="agenda" class="schedules-page__empty">
          <template #title>{{
            isSoloProfile
              ? 'Aún no tienes tu perfil.'
              : `Aún no tienes ${v.professionalsRegistered}.`
          }}</template>
          <template #hint>
            <template v-if="isSoloProfile">
              Créalo en la sección
              <RouterLink :to="{ name: 'staff-profesionales' }">«Mi perfil»</RouterLink>
              antes de configurar tu horario.
            </template>
            <template v-else>
              Agrega uno en la sección
              <RouterLink :to="{ name: 'staff-profesionales' }">«{{ v.Professionals }}»</RouterLink>
              antes de configurar su horario.
            </template>
          </template>
        </EmptyScene>

        <div v-else class="schedules-page__workspace">
          <div ref="workspaceMainRef" class="schedules-page__main" tabindex="-1">
            <div
              v-if="workingHoursStatus === 'loading' && !hasShownWorkingHours"
              class="schedules-page__state"
              role="status"
              aria-live="polite"
            >
              <DiamondLoader
                :label="`Cargando el horario de ${selectedProfessional?.fullName}…`"
                layout="inline"
              />
              <div class="schedules-page__skeleton" aria-hidden="true">
                <span v-for="n in 7" :key="n" class="schedules-page__skeleton-row">
                  <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--day" />
                  <span class="schedules-page__skeleton-bar schedules-page__skeleton-bar--track" />
                </span>
              </div>
            </div>

            <BaseAlert
              v-else-if="workingHoursStatus === 'error'"
              variant="warning"
              :title="`No pudimos cargar el horario ${v.ofThisProfessional}`"
              role="alert"
            >
              Revisa tu conexión e inténtalo de nuevo.
              <template #action>
                <BaseButton type="button" variant="secondary" @click="onRetryWorkingHours">
                  Reintentar
                </BaseButton>
              </template>
            </BaseAlert>

            <template v-else-if="workingHoursStatus === 'ready' || boardBusy">
              <BaseAlert
                v-if="deleteError"
                variant="danger"
                role="alert"
                class="schedules-page__delete-error"
              >
                {{ deleteError }}
              </BaseAlert>

              <div
                class="schedules-page__board-wrap"
                :class="{ 'schedules-page__board-wrap--busy': veilShown }"
                :aria-busy="boardBusy ? 'true' : undefined"
              >
                <!-- inert con undefined: Vue escribiría inert="false", que el
                     navegador trata como activo. -->
                <WeeklyBoard
                  class="schedules-page__board"
                  :inert="boardBusy || veilShown || undefined"
                  :days="groupedByWeekday"
                  :scale="boardScale"
                  :today-iso-weekday="todayIsoWeekday"
                  :now-minute="nowMinute"
                  :pending-delete-ids="pendingDeleteIds"
                  :region-label="`Semana de ${selectedProfessional?.fullName ?? v.theProfessional}`"
                  @add="openCreateDialog"
                  @edit="openEditDialog"
                  @remove="onDelete"
                />
                <Transition name="schedules-veil">
                  <div
                    v-if="veilShown"
                    class="schedules-page__veil"
                    role="status"
                    aria-live="polite"
                  >
                    <DiamondLoader
                      :label="`Cargando el horario de ${selectedProfessional?.fullName}…`"
                    />
                  </div>
                </Transition>
              </div>
            </template>

            <p v-if="businessTimezone" class="schedules-page__timezone">
              <!-- El reloj de la familia es un rombo con manecillas (#767), no un círculo. -->
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" />
                <path d="M8 5v3l2 1.4" />
              </svg>
              <!-- La zona con su nombre, como en la agenda («hora de Colombia»),
                   no el identificador IANA (revisión de #720). -->
              <span
                >Horas en <strong>{{ timezoneName(businessTimezone) }}</strong></span
              >
            </p>
          </div>

          <!-- Ajustes del profesional en acordeón: festivos (HU-041), excepciones de
               jornada (HU-041) y festivos de referencia. -->
          <aside
            class="schedules-page__aside"
            :style="{ '--accordion-count': colombianHolidays.length > 0 ? 3 : 2 }"
            aria-label="Festivos y excepciones"
          >
            <AccordionItem
              id="schedules-holidays"
              title="Calendario de festivos colombianos"
              :open="openPanel === 'holidays'"
              :badge="
                holidayCalendarStatus === 'ready'
                  ? holidayCalendarEnabled
                    ? 'Activo'
                    : 'Inactivo'
                  : undefined
              "
              :badge-tone="holidayCalendarEnabled ? 'on' : 'off'"
              @toggle="togglePanel('holidays')"
            >
              <label
                class="schedules-switch"
                :class="{ 'schedules-switch--on': holidayCalendarEnabled }"
              >
                <input
                  type="checkbox"
                  class="schedules-switch__input"
                  :checked="holidayCalendarEnabled"
                  :disabled="holidayCalendarStatus !== 'ready' || holidayCalendarSaving"
                  @change="onToggleHolidayCalendar"
                />
                <span class="schedules-switch__track" aria-hidden="true">
                  <span class="schedules-switch__thumb" />
                </span>
                <span class="schedules-switch__text"
                  >Cerrar automáticamente los festivos colombianos {{ v.ofThisProfessional }}</span
                >
              </label>
              <BaseAlert v-if="holidayCalendarError" variant="warning" role="alert">
                {{ holidayCalendarError }}
              </BaseAlert>
              <p class="schedules-card__hint">
                <template v-if="holidayCalendarEnabled">
                  Activado: un festivo se cierra por defecto, salvo que exista una excepción manual
                  para esa fecha.
                </template>
                <template v-else>
                  Desactivado: los festivos no agregan ningún bloqueo automático.
                </template>
              </p>
            </AccordionItem>

            <AccordionItem
              id="schedules-exceptions"
              title="Excepciones de jornada"
              :open="openPanel === 'exceptions'"
              :badge="exceptionsStatus === 'ready' ? String(sortedExceptions.length) : undefined"
              @toggle="togglePanel('exceptions')"
            >
              <BaseButton
                type="button"
                variant="secondary"
                class="schedules-page__aside-action"
                @click="openExceptionCreateDialog()"
              >
                Agregar excepción
              </BaseButton>

              <div
                v-if="exceptionsStatus === 'loading'"
                class="schedules-page__state schedules-page__state--card"
                role="status"
                aria-live="polite"
              >
                <DiamondLoader layout="inline" label="Cargando excepciones…" />
              </div>

              <BaseAlert v-else-if="exceptionsStatus === 'error'" variant="warning" role="alert">
                No pudimos cargar las excepciones {{ v.ofThisProfessional }}. Revisa tu conexión e
                inténtalo de nuevo.
                <template #action>
                  <BaseButton type="button" variant="secondary" @click="onRetryExceptions">
                    Reintentar
                  </BaseButton>
                </template>
              </BaseAlert>

              <template v-else-if="exceptionsStatus === 'ready'">
                <BaseAlert
                  v-if="exceptionDeleteError"
                  variant="danger"
                  role="alert"
                  class="schedules-page__delete-error"
                >
                  {{ exceptionDeleteError }}
                </BaseAlert>

                <!-- Vacío de la familia: un rombo hueco de latón y la frase en serif,
                     entre dos troqueles, no una caja gris. -->
                <p v-if="sortedExceptions.length === 0" class="schedules-card__empty">
                  <span class="schedules-card__empty-mark" aria-hidden="true" />
                  Sin excepciones registradas.
                  <small>Un día con otro horario o cerrado aparece aquí.</small>
                </p>

                <TransitionGroup
                  v-else
                  name="schedules-row"
                  tag="ul"
                  class="schedules-card__list"
                  aria-label="Excepciones de jornada"
                >
                  <li
                    v-for="exception in sortedExceptions"
                    :key="exception.id"
                    class="schedules-row"
                  >
                    <span class="schedules-tile" aria-hidden="true">
                      <b>{{ dateTile(exception.effectiveDate).day }}</b>
                      <i>{{ dateTile(exception.effectiveDate).month }}</i>
                    </span>
                    <div class="schedules-row__main">
                      <p class="schedules-row__title">
                        <span v-if="exception.isClosed" class="schedules-row__state">Cerrado</span>
                        <template v-else>
                          <span class="schedules-row__state schedules-row__state--open"
                            >Abierto</span
                          >
                          <!-- Cada rango entero, nunca partido (revisión de #783):
                               si no caben juntos, el siguiente baja completo. -->
                          <span class="schedules-row__segments"
                            ><template v-for="(segment, index) in exception.segments" :key="index"
                              ><template v-if="index > 0">, </template
                              ><span class="schedules-row__range">{{
                                clockRangeLabel(segment.startsTime, segment.durationMinutes)
                              }}</span></template
                            ></span
                          >
                        </template>
                      </p>
                      <p class="schedules-row__meta">
                        <span class="schedules-row__date">{{
                          longDate(exception.effectiveDate)
                        }}</span>
                        <span v-if="exception.reason"> · {{ exception.reason }}</span>
                      </p>
                    </div>
                    <div class="schedules-row__actions">
                      <BaseButton
                        type="button"
                        variant="ghost"
                        class="schedules-row__action"
                        :aria-label="`Editar excepción del ${longDate(exception.effectiveDate)}`"
                        @click="openExceptionEditDialog(exception)"
                      >
                        Editar
                      </BaseButton>
                      <span class="schedules-row__sep" aria-hidden="true" />
                      <BaseButton
                        type="button"
                        variant="ghost"
                        class="schedules-row__action schedules-row__remove"
                        :loading="isExceptionDeletePending(exception.id)"
                        :disabled="isExceptionDeletePending(exception.id)"
                        :aria-label="`Retirar excepción del ${longDate(exception.effectiveDate)}`"
                        @click="onDeleteException(exception)"
                      >
                        Retirar
                      </BaseButton>
                    </div>
                  </li>
                </TransitionGroup>
              </template>
            </AccordionItem>

            <AccordionItem
              v-if="colombianHolidays.length > 0"
              id="schedules-upcoming"
              title="Próximos festivos colombianos"
              :open="openPanel === 'upcoming'"
              :badge="String(colombianHolidays.length)"
              @toggle="togglePanel('upcoming')"
            >
              <ul class="schedules-card__list">
                <li
                  v-for="holiday in colombianHolidays"
                  :key="holiday.date"
                  class="schedules-row schedules-row--static"
                >
                  <span class="schedules-tile" aria-hidden="true">
                    <b>{{ dateTile(holiday.date).day }}</b>
                    <i>{{ dateTile(holiday.date).month }}</i>
                  </span>
                  <div class="schedules-row__main">
                    <p class="schedules-row__title">{{ holiday.name }}</p>
                    <p class="schedules-row__meta">
                      <span class="schedules-row__date">{{ longDate(holiday.date) }}</span>
                    </p>
                  </div>
                  <span v-if="exceptionDates.has(holiday.date)" class="schedules-row__tag">
                    Con excepción
                  </span>
                  <BaseButton
                    v-else
                    type="button"
                    variant="ghost"
                    class="schedules-row__action"
                    :aria-label="`Registrar una excepción para el ${longDate(holiday.date)}, ${holiday.name}`"
                    @click="openExceptionCreateDialog(holiday.date)"
                  >
                    Registrar excepción
                  </BaseButton>
                </li>
              </ul>
            </AccordionItem>
          </aside>
        </div>
      </div>
    </ContentReveal>

    <!-- Alta de tramo -->
    <BaseDialog
      v-model="isCreateOpen"
      title="Agregar tramo"
      :description="`Define cuándo trabaja ${selectedProfessional?.fullName ?? v.theProfessional} ese día.`"
      size="lg"
      content-class="schedules-page__dialog"
      @close="onCreateDialogClosed"
    >
      <template #icon>
        <DialogSeal />
      </template>
      <form
        name="createWorkingHour"
        class="schedules-page__ink schedules-page__form"
        novalidate
        @submit.prevent="onSubmitCreate"
      >
        <BaseAlert
          v-if="createStatus === 'overlap-conflict'"
          variant="danger"
          title="Este tramo se solapa con otro existente"
          role="alert"
        >
          Elige un horario distinto para ese día.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'not-found'"
          variant="warning"
          :title="`${v.ThisProfessional} ya no está disponible`"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'idempotency-conflict'"
          variant="danger"
          title="No pudimos completar el intento anterior"
          role="alert"
        >
          Inténtalo de nuevo.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="createStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <WeekdayPicker
          :model-value="createISOWeekday"
          label="Día"
          :disabled="createStatus === 'saving'"
          :error="createWeekdayError"
          @update:model-value="onCreateWeekdayInput"
        />

        <div class="schedules-page__pair">
          <div class="schedules-page__field">
            <BaseTimePicker
              :model-value="createStartsTime"
              label="Hora de inicio"
              required
              :disabled="createStatus === 'saving'"
              @update:model-value="onCreateStartsTimeInput"
            />
            <div v-if="createStartsTimeError" class="schedules-page__field-error" role="alert">
              {{ createStartsTimeError }}
            </div>
          </div>
          <div class="schedules-page__field">
            <BaseTimePicker
              :model-value="createEndsTime"
              label="Hora de fin"
              closing
              required
              :disabled="createStatus === 'saving'"
              @update:model-value="onCreateEndsTimeInput"
            />
            <div v-if="createDurationError" class="schedules-page__field-error" role="alert">
              {{ createDurationError }}
            </div>
          </div>
        </div>

        <div class="schedules-page__preview" aria-live="polite">
          <span class="schedules-page__eyebrow">Así queda</span>
          <DayTrack :segments="createPreview.segments" :scale="createPreview.scale" preview />
          <p>{{ createPreview.text }}</p>
        </div>

        <!-- Solo «Guardar»: la X del diálogo (y Escape) ya cierra sin guardar
             (pedido del propietario, 2026-11-15). -->
        <div class="schedules-page__dialog-actions">
          <BaseButton
            type="submit"
            variant="primary"
            :loading="createStatus === 'saving'"
            loading-label="Guardando…"
            :disabled="createStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>

    <!-- Edición de tramo -->
    <BaseDialog
      v-model="isEditOpen"
      title="Editar tramo"
      :description="`Ajusta el horario de ${editTarget ? weekdayLabel(editTarget.isoWeekday) : 'ese día'}.`"
      size="lg"
      content-class="schedules-page__dialog"
      @close="onEditDialogClosed"
    >
      <template #icon>
        <DialogSeal :glyph="weekdayInitial(editISOWeekday) || undefined" />
      </template>
      <form
        name="updateWorkingHour"
        class="schedules-page__ink schedules-page__form"
        novalidate
        @submit.prevent="onSubmitEdit"
      >
        <BaseAlert
          v-if="editStatus === 'overlap-conflict'"
          variant="danger"
          title="Este tramo se solapa con otro existente"
          role="alert"
        >
          Elige un horario distinto para ese día.
        </BaseAlert>
        <BaseAlert
          v-if="editStatus === 'not-found'"
          variant="warning"
          title="Este tramo ya no está disponible"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-if="editStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="editStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <WeekdayPicker
          :model-value="editISOWeekday"
          label="Día"
          :disabled="editStatus === 'saving'"
          :error="editWeekdayError"
          @update:model-value="onEditWeekdayInput"
        />

        <div class="schedules-page__pair">
          <div class="schedules-page__field">
            <BaseTimePicker
              :model-value="editStartsTime"
              label="Hora de inicio"
              required
              :disabled="editStatus === 'saving'"
              @update:model-value="onEditStartsTimeInput"
            />
            <div v-if="editStartsTimeError" class="schedules-page__field-error" role="alert">
              {{ editStartsTimeError }}
            </div>
          </div>
          <div class="schedules-page__field">
            <BaseTimePicker
              :model-value="editEndsTime"
              label="Hora de fin"
              closing
              required
              :disabled="editStatus === 'saving'"
              @update:model-value="onEditEndsTimeInput"
            />
            <div v-if="editDurationError" class="schedules-page__field-error" role="alert">
              {{ editDurationError }}
            </div>
          </div>
        </div>

        <div class="schedules-page__preview" aria-live="polite">
          <span class="schedules-page__eyebrow">Así queda</span>
          <DayTrack :segments="editPreview.segments" :scale="editPreview.scale" preview />
          <p>{{ editPreview.text }}</p>
        </div>

        <div class="schedules-page__dialog-actions">
          <!-- Sin cambios, «Guardar» espera en reposo (contorno punteado de latón,
               como en Configuración); sigue activo. -->
          <BaseButton
            type="submit"
            variant="primary"
            :class="{ 'schedules-page__save--rest': editPristine }"
            :loading="editStatus === 'saving'"
            loading-label="Guardando…"
            :disabled="editStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>

    <!-- HU-041: alta de excepción -->
    <BaseDialog
      v-model="isExceptionCreateOpen"
      title="Agregar excepción"
      description="Un día que se sale de la jornada habitual."
      size="lg"
      content-class="schedules-page__dialog"
      @close="onExceptionCreateDialogClosed"
    >
      <template #icon>
        <DialogSeal />
      </template>
      <form
        name="createScheduleException"
        class="schedules-page__ink schedules-page__form"
        novalidate
        @submit.prevent="onSubmitExceptionCreate"
      >
        <BaseAlert
          v-if="createExceptionStatus === 'date-conflict'"
          variant="danger"
          title="Ya existe una excepción para esa fecha"
          role="alert"
        >
          Edita la excepción existente en vez de crear una nueva.
        </BaseAlert>
        <BaseAlert
          v-if="createExceptionStatus === 'not-found'"
          variant="warning"
          :title="`${v.ThisProfessional} ya no está disponible`"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-if="createExceptionStatus === 'idempotency-conflict'"
          variant="danger"
          title="No pudimos completar el intento anterior"
          role="alert"
        >
          Inténtalo de nuevo.
        </BaseAlert>
        <BaseAlert
          v-if="createExceptionStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="createExceptionStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <div class="schedules-page__field">
          <label
            id="schedules-create-date-label"
            class="schedules-page__label"
            for="schedules-create-date"
            >Fecha <span aria-hidden="true">*</span></label
          >
          <BaseDatePicker
            :model-value="createEffectiveDate"
            trigger-id="schedules-create-date"
            label-id="schedules-create-date-label"
            :today="todayCivilDate"
            required
            :disabled="createExceptionStatus === 'saving'"
            @update:model-value="onCreateEffectiveDateInput"
          />
          <div v-if="createEffectiveDateError" class="schedules-page__field-error" role="alert">
            {{ createEffectiveDateError }}
          </div>
        </div>

        <div class="schedules-page__field">
          <span class="schedules-page__label" aria-hidden="true">Estado del día</span>
          <div class="schedules-page__choice" role="radiogroup" aria-label="Estado del día">
            <label class="schedules-page__choice-option">
              <input
                type="radio"
                name="createExceptionShape"
                :checked="createIsClosed"
                :disabled="createExceptionStatus === 'saving'"
                @change="onCreateIsClosedChange(true)"
              />
              <span>Cerrado</span>
            </label>
            <label class="schedules-page__choice-option">
              <input
                type="radio"
                name="createExceptionShape"
                :checked="!createIsClosed"
                :disabled="createExceptionStatus === 'saving'"
                @change="onCreateIsClosedChange(false)"
              />
              <span>Abierto con tramos especiales</span>
            </label>
          </div>
        </div>

        <div v-if="!createIsClosed" class="schedules-page__segments">
          <div
            v-for="(segment, index) in createSegments"
            :key="index"
            class="schedules-page__segment"
          >
            <BaseTimePicker
              :model-value="segment.startsTime"
              label="Hora de inicio"
              required
              :disabled="createExceptionStatus === 'saving'"
              @update:model-value="
                (v) => {
                  segment.startsTime = v
                  syncSegmentDuration(segment)
                  revalidateExceptionCreate()
                }
              "
            />
            <BaseTimePicker
              :model-value="segment.endsTime"
              label="Hora de fin"
              closing
              required
              :disabled="createExceptionStatus === 'saving'"
              @update:model-value="
                (v) => {
                  segment.endsTime = v
                  syncSegmentDuration(segment)
                  revalidateExceptionCreate()
                }
              "
            />
            <BaseButton
              type="button"
              variant="secondary"
              :disabled="createExceptionStatus === 'saving'"
              aria-label="Quitar este tramo"
              @click="removeCreateSegment(index)"
            >
              Quitar
            </BaseButton>
            <p v-if="segmentCrossesMidnight(segment)" class="schedules-page__segment-note">
              Termina al día siguiente.
            </p>
          </div>
          <!-- Botón circular centrado bajo los tramos (issue #575): el texto
               «Agregar tramo» en una esquina pesaba más que los propios tramos. -->
          <button
            type="button"
            class="schedules-page__segment-add"
            aria-label="Agregar tramo"
            title="Agregar tramo"
            :disabled="createExceptionStatus === 'saving'"
            @click="addCreateSegment"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div v-if="createShapeError" class="schedules-page__field-error" role="alert">
            {{ createShapeError }}
          </div>
        </div>

        <BaseInput
          :model-value="createReason"
          type="text"
          name="reason"
          label="Motivo (opcional)"
          :maxlength="200"
          :disabled="createExceptionStatus === 'saving'"
          :error="createReasonError"
          :class="{ 'schedules-page__input--filled': !!createReason }"
          @update:model-value="
            (v) => {
              createReason = String(v)
              revalidateExceptionCreate()
            }
          "
        />

        <div class="schedules-page__dialog-actions">
          <BaseButton
            type="submit"
            variant="primary"
            :loading="createExceptionStatus === 'saving'"
            :disabled="createExceptionStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>

    <!-- HU-041: edición de excepción -->
    <BaseDialog
      v-model="isExceptionEditOpen"
      title="Editar excepción"
      description="Ajusta la fecha, el estado o los tramos de ese día."
      size="lg"
      content-class="schedules-page__dialog"
      @close="onExceptionEditDialogClosed"
    >
      <template #icon>
        <DialogSeal
          :glyph="editEffectiveDate ? String(dateTile(editEffectiveDate).day) : undefined"
        />
      </template>
      <form
        name="updateScheduleException"
        class="schedules-page__ink schedules-page__form"
        novalidate
        @submit.prevent="onSubmitExceptionEdit"
      >
        <BaseAlert
          v-if="editExceptionStatus === 'date-conflict'"
          variant="danger"
          title="Ya existe otra excepción para esa fecha"
          role="alert"
        >
          Elige una fecha distinta.
        </BaseAlert>
        <BaseAlert
          v-if="editExceptionStatus === 'not-found'"
          variant="warning"
          title="Esta excepción ya no está disponible"
          role="alert"
        >
          Cierra este diálogo y recarga la lista.
        </BaseAlert>
        <BaseAlert
          v-if="editExceptionStatus === 'network-error'"
          variant="warning"
          title="No pudimos conectar"
          role="alert"
        >
          Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
        </BaseAlert>
        <BaseAlert
          v-if="editExceptionStatus === 'unexpected-error'"
          variant="danger"
          title="Ocurrió un error inesperado"
          role="alert"
        >
          Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
        </BaseAlert>

        <div class="schedules-page__field">
          <label
            id="schedules-edit-date-label"
            class="schedules-page__label"
            for="schedules-edit-date"
            >Fecha <span aria-hidden="true">*</span></label
          >
          <BaseDatePicker
            :model-value="editEffectiveDate"
            trigger-id="schedules-edit-date"
            label-id="schedules-edit-date-label"
            :today="todayCivilDate"
            required
            :disabled="editExceptionStatus === 'saving'"
            @update:model-value="onEditEffectiveDateInput"
          />
          <div v-if="editEffectiveDateError" class="schedules-page__field-error" role="alert">
            {{ editEffectiveDateError }}
          </div>
        </div>

        <div class="schedules-page__field">
          <span class="schedules-page__label" aria-hidden="true">Estado del día</span>
          <div class="schedules-page__choice" role="radiogroup" aria-label="Estado del día">
            <label class="schedules-page__choice-option">
              <input
                type="radio"
                name="editExceptionShape"
                :checked="editIsClosed"
                :disabled="editExceptionStatus === 'saving'"
                @change="onEditIsClosedChange(true)"
              />
              <span>Cerrado</span>
            </label>
            <label class="schedules-page__choice-option">
              <input
                type="radio"
                name="editExceptionShape"
                :checked="!editIsClosed"
                :disabled="editExceptionStatus === 'saving'"
                @change="onEditIsClosedChange(false)"
              />
              <span>Abierto con tramos especiales</span>
            </label>
          </div>
        </div>

        <div v-if="!editIsClosed" class="schedules-page__segments">
          <div
            v-for="(segment, index) in editSegments"
            :key="index"
            class="schedules-page__segment"
          >
            <BaseTimePicker
              :model-value="segment.startsTime"
              label="Hora de inicio"
              required
              :disabled="editExceptionStatus === 'saving'"
              @update:model-value="
                (v) => {
                  segment.startsTime = v
                  syncSegmentDuration(segment)
                  revalidateExceptionEdit()
                }
              "
            />
            <BaseTimePicker
              :model-value="segment.endsTime"
              label="Hora de fin"
              closing
              required
              :disabled="editExceptionStatus === 'saving'"
              @update:model-value="
                (v) => {
                  segment.endsTime = v
                  syncSegmentDuration(segment)
                  revalidateExceptionEdit()
                }
              "
            />
            <BaseButton
              type="button"
              variant="secondary"
              :disabled="editExceptionStatus === 'saving'"
              aria-label="Quitar este tramo"
              @click="removeEditSegment(index)"
            >
              Quitar
            </BaseButton>
            <p v-if="segmentCrossesMidnight(segment)" class="schedules-page__segment-note">
              Termina al día siguiente.
            </p>
          </div>
          <!-- Botón circular centrado bajo los tramos (issue #575): el texto
               «Agregar tramo» en una esquina pesaba más que los propios tramos. -->
          <button
            type="button"
            class="schedules-page__segment-add"
            aria-label="Agregar tramo"
            title="Agregar tramo"
            :disabled="editExceptionStatus === 'saving'"
            @click="addEditSegment"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div v-if="editShapeError" class="schedules-page__field-error" role="alert">
            {{ editShapeError }}
          </div>
        </div>

        <BaseInput
          :model-value="editReason"
          type="text"
          name="reason"
          label="Motivo (opcional)"
          :maxlength="200"
          :disabled="editExceptionStatus === 'saving'"
          :error="editReasonError"
          :class="{ 'schedules-page__input--filled': !!editReason }"
          @update:model-value="
            (v) => {
              editReason = String(v)
              revalidateExceptionEdit()
            }
          "
        />

        <div class="schedules-page__dialog-actions">
          <BaseButton
            type="submit"
            variant="primary"
            :loading="editExceptionStatus === 'saving'"
            :disabled="editExceptionStatus === 'saving'"
          >
            Guardar
          </BaseButton>
        </div>
      </form>
    </BaseDialog>
  </section>
</template>

<style scoped>
/* Lenguaje v2 «La luz del día» (DEC-188): el mismo lienzo que la agenda, sin
   reasignar tokens; los controles compartidos (BaseSelect, BaseInput,
   BaseButton) se pintan con sus valores v2. Columna de lectura de 980px. */
.schedules-page {
  --schedules-width: 980px;

  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  padding: 34px 32px 48px;
  color: var(--color-on-strong);
  /* Transparente: la tinta y el fondo animado los pone el cascarón. */
  background: transparent;
  box-sizing: border-box;
}

.schedules-page__header,
.schedules-page__state,
.schedules-page__ready,
.schedules-page > :deep(.base-alert),
.schedules-page__stage > :deep(.base-alert) {
  width: min(100%, var(--schedules-width));
  margin-inline: auto;
}

.schedules-page__ready {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Cabecera: título a la izquierda y, en escritorio, los controles de la
   jornada (profesional, cifras y acción principal) en la misma franja. */
.schedules-page__header {
  /* Por encima del tablero: la lista del selector de profesional se abre sobre él. */
  position: relative;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px var(--space-4);
  padding-bottom: 14px;
  /* Troquel punteado de latón bajo el encabezado, como en Configuración (8c). */
  border-bottom: 1px dashed var(--color-brass-line);
}

/* Título como el de la agenda (DailyAgendaPage `__title`). */
.schedules-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-page-title);
  font-weight: 400;
  line-height: var(--font-size-page-title-line);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

.schedules-page__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

/* Angosto: los controles se reparten en la cabecera (acción principal junto al
   título, luego el selector y las cifras); en escritorio forman una franja. */
.schedules-page__controls {
  display: contents;
}

.schedules-page__heading {
  flex: 1 1 auto;
}

.schedules-page__state {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  color: var(--color-on-strong-muted);
}

.schedules-page__state--card {
  width: auto;
  padding: var(--space-3) 0;
  margin: 0;
}

.schedules-page__state--card p {
  margin: 0;
}

/* Esqueleto de la semana: una fila por día con su pista. Es el único
   movimiento repetido de la pantalla y solo dura lo que tarda la carga. */
/* Esqueleto con la forma del tablero (#782): el mismo papel con filete de
   latón, los troqueles entre días, el nombre del día y su pista apagada. El
   sol con el diamante (DiamondLoader) va encima. */
.schedules-page__skeleton {
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-brass-line);
  border-radius: 4px;
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
}

.schedules-page__skeleton-row {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 64px;
  padding: 0 18px;
  border-top: 1px dashed color-mix(in srgb, var(--color-brass-line) 70%, transparent);
}

.schedules-page__skeleton-row:first-child {
  border-top: none;
}

.schedules-page__skeleton-bar {
  display: block;
  background-color: color-mix(in srgb, var(--color-on-strong) 14%, transparent);
  border-radius: 2px;
  animation: schedules-skeleton-pulse 1400ms ease-in-out infinite;
}

.schedules-page__skeleton-bar--day {
  flex: 0 0 110px;
  height: 18px;
  background-color: color-mix(in srgb, var(--color-brass-body) 26%, transparent);
}

.schedules-page__skeleton-bar--track {
  flex: 1;
  height: 14px;
  background-color: color-mix(in srgb, var(--color-on-strong) 9%, transparent);
  border-radius: 3px;
}

/* Esqueleto de los controles: mismas medidas que el retrato (47 px), el
   selector (rótulo de 18 px + 8 px + campo de 46 px) y la cifra (línea de
   26 px), para que el cambio a los datos reales no mueva nada. */
.schedules-page__who--skeleton {
  align-items: flex-end;
}

.schedules-page__skeleton-bar--portrait {
  flex: 0 0 47px;
  height: 47px;
  background-color: color-mix(in srgb, var(--color-brass-body) 14%, transparent);
  border: 1px solid var(--color-brass-line);
  border-radius: 4px;
}

.schedules-page__skeleton-select {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.schedules-page__skeleton-bar--label {
  width: 88px;
  height: 18px;
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent);
}

.schedules-page__skeleton-bar--field {
  height: 46px;
  border-radius: var(--radius-md);
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent);
}

/* Nombre del perfil individual: centrado junto al retrato, como el real. */
.schedules-page__skeleton-bar--name {
  align-self: center;
  width: 160px;
  max-width: 50%;
  height: 20px;
}

.schedules-page__skeleton-bar--stat {
  display: inline-block;
  width: 44px;
  height: 18px;
  vertical-align: middle;
}

@keyframes schedules-skeleton-pulse {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}

/* Controles: quién (retrato + selector) y cuánto (cifras de la semana). */
.schedules-page__who {
  display: flex;
  order: 2;
  flex: 1 1 300px;
  align-items: flex-end;
  gap: 14px;
  min-width: 0;
}

/* Perfil de profesional individual (DEC-115): sin selector, el nombre acompaña al retrato. */
.schedules-page__who-name {
  align-self: center;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-family-base);
  font-size: var(--font-size-body-lg);
  font-weight: 500;
  color: var(--color-on-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* El retrato mide lo mismo que la casilla del selector (47 px: 10 px de
   relleno por lado, una línea de 24 px y los filetes de 1 y 2 px) y se apoya
   en su misma línea base (issue #575). Lo dibuja ProfessionalAvatar con el
   retrato de latón (BrassMonogram, #799): 1 px de filete y 3 px de paspartú por
   lado, así que la foto sigue midiendo 39 px; el rombo recorta contra el
   lienzo. Sin escala al pasar el cursor, que lo sacaba de la línea. */
.schedules-page__frame {
  flex: 0 0 auto;
  line-height: 0;
}

.schedules-page__frame .schedules-page__portrait {
  --avatar-size: 47px;
  --monogram-mat: 3px;
  --monogram-pendant: 9px;
  --monogram-cutout: var(--color-canvas);
  --monogram-radius: 4px;

  flex: 0 0 auto;
}

/* El selector conserva el aspecto v2 de BaseSelect: sin filete de acento. */
.schedules-page__select {
  flex: 1;
  max-width: 340px;
}

.schedules-page__stats {
  display: flex;
  order: 3;
  flex: 0 0 auto;
  gap: 8px;
  margin: 0;
}

/* Cifras de la semana (#782): sin caja. Rótulo de latón en versalitas y la
   cifra en serif, separadas por un filete de latón, como la hora protagonista
   de Configuración. */
.schedules-page__stats > div {
  display: flex;
  min-width: 104px;
  flex-direction: column;
  gap: 2px;
  padding: 2px 4px 2px 16px;
  border-left: 1px solid var(--color-brass-line);
}

.schedules-page__stats dt {
  color: var(--color-brass-text);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.schedules-page__stats dd {
  margin: 0;
  color: var(--color-on-strong);
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 400;
  line-height: 38px;
  font-variant-numeric: tabular-nums;
}

.schedules-page__stat-total {
  margin-left: 3px;
  color: var(--color-on-strong-muted);
  font-size: 18px;
  /* Con el interlineado heredado de la cifra (38 px) el «/7» y el «h» estiraban
     la línea a 43 px y el tablero bajaba 5 px al llegar la semana (#817). */
  line-height: 1;
}

/* «h» y «min» menudos y apagados, como «/7»; la cifra entera no se parte. */
.schedules-page__stats dd {
  white-space: nowrap;
}

.schedules-page__stat-unit {
  color: var(--color-on-strong-muted);
  font-size: 18px;
  line-height: 1;
}

@media (max-width: 380px) {
  .schedules-page__stats dd {
    font-size: 28px;
    line-height: 32px;
  }
}

.schedules-stat-enter-active,
.schedules-stat-leave-active {
  display: inline-block;
  transition:
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.schedules-stat-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.schedules-stat-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.schedules-page__timezone {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
  line-height: var(--font-size-caption-line);
}

.schedules-page__timezone svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--color-text-secondary);
}

.schedules-page__timezone strong {
  color: var(--color-on-strong);
  font-weight: 600;
}

.schedules-page__delete-error {
  margin: 0;
}

/* Espacio de trabajo: el tablero y, aparte, el panel de ajustes en acordeón
   (festivos, excepciones, referencia). En pantallas angostas se apilan. */
.schedules-page__workspace {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.schedules-page__main:focus {
  outline: none;
}

.schedules-page__main:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 4px;
}

.schedules-page__main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}

.schedules-page__aside {
  --accordion-count: 3;

  display: flex;
  min-width: 0;
  flex-direction: column;
  align-self: start;
  width: 100%;
  overflow: hidden;
  background-color: var(--color-surface);
  /* Papel con filete de latón, como el tablero (#782). */
  border: 1px solid var(--color-brass-line);
  border-radius: 4px;
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
  container: aside / inline-size;
}

.schedules-page__aside-action {
  align-self: flex-start;
}

/* Escritorio: todo cabe en la pantalla. El tablero y el panel comparten la
   altura que deja la cabecera; la lista del apartado abierto se desplaza
   dentro de su propio cuerpo si no cabe, nunca la página. */
@media (min-width: 1100px) {
  .schedules-page {
    --schedules-width: 1240px;

    height: 100%;
    min-height: 620px;
    padding: 16px 32px;
    gap: 12px;
  }

  .schedules-page__header {
    flex-wrap: nowrap;
    align-items: center;
    padding-bottom: 12px;
  }

  .schedules-page__controls {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
  }

  .schedules-page__heading {
    flex: 0 0 auto;
  }

  .schedules-page__who {
    flex: 0 1 auto;
    /* Al pie, no al centro: el centro incluía el rótulo y dejaba el retrato
       a media altura del campo (issue #575). */
    align-items: flex-end;
  }

  .schedules-page__select {
    width: 260px;
    flex: 0 1 260px;
  }

  .schedules-page__who {
    order: 1;
  }

  .schedules-page__stats {
    order: 2;
  }

  /* La cadena de alturas de escritorio pasa por el escenario de ContentReveal
     (#817): sin esto la celda tomaba el alto del contenido y el tablero, que se
     desplaza por dentro, quedaba en 6 px. */
  .schedules-page__stage {
    flex: 1 1 0;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
  }

  .schedules-page__stage > :deep(.schedules-page__ready) {
    align-self: stretch;
    min-height: 0;
  }

  .schedules-page__workspace {
    display: grid;
    flex: 1 1 0;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr) clamp(320px, 29vw, 380px);
    grid-template-rows: minmax(0, 1fr);
    gap: 16px;
  }

  /* El tablero llena la columna y se desplaza por dentro. Desde #578 va dentro
     del envoltorio del velo de «ocupado», así que la contención pasa por él: sin
     esto el tablero crecía con su contenido y desplazaba la página (#769). */
  .schedules-page__main {
    gap: 6px;
  }

  .schedules-page__board-wrap {
    display: flex;
    flex: 1 1 0;
    min-height: 0;
    flex-direction: column;
  }

  .schedules-page__board {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
  }

  .schedules-page__aside {
    --accordion-body-max: max(140px, calc(100cqh - var(--accordion-count) * 56px - 4px));

    align-self: stretch;
    container-type: size;
  }
}

.schedules-card__hint,
.schedules-card__empty {
  margin: 0;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
}

.schedules-card__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 12px 14px;
  color: var(--color-on-strong);
  font-family: var(--font-display);
  font-size: 19px;
  font-style: italic;
  line-height: 24px;
  text-align: center;
  border-block: 1px dashed color-mix(in srgb, var(--color-brass-line) 70%, transparent);
}

.schedules-card__empty small {
  color: var(--color-on-strong-muted);
  font-family: var(--font-sans);
  font-size: 13px;
  font-style: normal;
  line-height: 18px;
}

.schedules-card__empty-mark {
  width: 11px;
  height: 11px;
  margin-bottom: 4px;
  border: 1.5px solid var(--color-brass-text);
  transform: rotate(45deg);
}

.schedules-card__list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* «Agregar excepción»: contorno punteado de latón, como el «+» del tablero:
   una acción que espera, sin competir con la principal de cada diálogo. */
.schedules-page__aside-action.base-button {
  height: 36px;
  padding-inline: 14px;
  color: var(--color-brass-text);
  font-size: var(--font-size-body-sm);
  background: transparent;
  border: 1.5px dashed var(--color-brass-line);
  border-radius: 3px;
}

.schedules-page__aside-action.base-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-brass-body) 12%, transparent);
  border-color: var(--color-brass-text);
  border-style: solid;
}

/* Acciones de fila: texto sin caja, como las del tablero; Editar pasa a latón
   y Retirar a peligro solo al señalarlas. */
.schedules-row :deep(.schedules-row__action.base-button) {
  height: 36px;
  min-width: 0;
  padding-inline: 8px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  background: transparent;
  border-color: transparent;
}

.schedules-row
  :deep(.schedules-row__action.base-button:hover:not(:disabled):not(.base-button--loading)) {
  color: var(--color-brass-text);
  background: color-mix(in srgb, var(--color-brass-body) 10%, transparent);
}

.schedules-row
  :deep(.schedules-row__remove.base-button:hover:not(:disabled):not(.base-button--loading)) {
  color: var(--color-danger-on-strong);
  background: color-mix(in srgb, var(--color-danger-on-strong) 10%, transparent);
}

/* En táctil y en angosto, el piso de 44 px de BaseButton y del tablero
   (CA-009-03, revisión de #783); en escritorio con puntero fino bastan 36. */
@media (max-width: 767px), (pointer: coarse) {
  .schedules-page__aside-action.base-button,
  .schedules-row :deep(.schedules-row__action.base-button) {
    height: 44px;
  }
}

.schedules-row__sep {
  flex: none;
  width: 4px;
  height: 4px;
  background-color: var(--color-brass-line);
  transform: rotate(45deg);
}

/* Interruptor de festivos (#782): el de la familia, como en Configuración
   (8c). Una ranura recta con un rombo que rueda un cuarto de vuelta y se llena
   de latón al encender. Sigue siendo una casilla nativa con su rótulo. */
.schedules-switch {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.schedules-switch__input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  opacity: 0;
}

.schedules-switch__track {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 24px;
  background-color: var(--color-surface-muted);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: 3px;
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard);
}

/* El rombo: avanza y gira un cuarto de vuelta, con `translate` y `rotate`
   sueltos para que no se pisen. */
.schedules-switch__thumb {
  position: absolute;
  top: 50%;
  left: 5px;
  width: 11px;
  height: 11px;
  margin-top: -5.5px;
  background-color: var(--color-text-secondary);
  rotate: 45deg;
  translate: 0 0;
}

.schedules-switch--on .schedules-switch__track {
  background-color: var(--color-brass-body);
  border-color: var(--color-brass-text);
}

.schedules-switch--on .schedules-switch__thumb {
  background-color: var(--color-surface);
  rotate: 135deg;
  translate: 22px 0;
}

.schedules-switch:hover .schedules-switch__track {
  border-color: var(--color-brass-line);
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .schedules-switch__thumb {
    transition:
      translate 280ms cubic-bezier(0.3, 1.35, 0.5, 1),
      rotate 280ms cubic-bezier(0.3, 1.35, 0.5, 1),
      background-color 160ms ease;
  }
}

.schedules-switch__input:focus-visible + .schedules-switch__track {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.schedules-switch__input:disabled ~ * {
  opacity: 0.5;
}

.schedules-switch__input:disabled ~ .schedules-switch__text {
  cursor: not-allowed;
}

.schedules-switch__text {
  color: var(--color-on-strong);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
}

/* Filas de excepciones y festivos: ficha de fecha, dato principal y acciones. */
.schedules-row {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 12px;
  padding: 10px 4px;
  border-top: 1px dashed color-mix(in srgb, var(--color-brass-line) 60%, transparent);
  transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.schedules-row:first-child {
  border-top: none;
}

@media (hover: hover) {
  .schedules-row:hover {
    background-color: color-mix(in srgb, var(--color-brass-body) 5%, transparent);
  }

  .schedules-row:hover .schedules-tile {
    border-color: var(--color-brass-text);
  }
}

/* Ficha de fecha. Alto y relleno pensados para que el día y el mes respiren
   dentro del marco: con 48px el número de 24px de línea más el mes llenaban
   el interior y el día tocaba el filete superior. */
.schedules-tile {
  display: flex;
  box-sizing: border-box;
  width: 48px;
  height: 60px;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 5px 0 6px;
  background-color: var(--color-surface);
  /* La hoja de calendario de la familia: filete y canto de latón, el día en
     serif y el mes en versalitas de latón. */
  border: 1px solid var(--color-brass-line);
  border-radius: 3px;
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.schedules-tile b {
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 400;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.schedules-tile i {
  color: var(--color-brass-text);
  font-size: 10px;
  line-height: 1;
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.schedules-row__main {
  min-width: 0;
}

.schedules-row__title,
.schedules-row__meta {
  margin: 0;
  overflow-wrap: anywhere;
}

.schedules-row__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  color: var(--color-on-strong);
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 400;
  line-height: 24px;
}

/* Estado de la excepción: punto del color del estado (no rombo) y rótulo en
   tipo oración. */
.schedules-row__state {
  color: var(--color-danger-on-strong);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
}

.schedules-row__state::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  vertical-align: 1px;
  background-color: currentColor;
  border-radius: 0;
  rotate: 45deg;
}

.schedules-row__state--open {
  color: var(--color-success-on-strong);
}

.schedules-row__segments {
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
}

.schedules-row__range {
  white-space: nowrap;
}

.schedules-row__meta {
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
  line-height: 18px;
}

.schedules-row__date {
  font-variant-numeric: tabular-nums;
}

.schedules-row__actions {
  display: flex;
  align-items: center;
  gap: 0;
}

.schedules-row__tag {
  color: var(--color-success-on-strong);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

/* Alta y retiro de una excepción: la fila entra desde abajo y sale hacia un
   lado; las demás se reacomodan con suavidad. */
.schedules-row-enter-active,
.schedules-row-leave-active,
.schedules-row-move {
  transition:
    opacity 260ms var(--motion-easing-standard),
    transform 260ms var(--motion-easing-standard);
}

.schedules-row-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.schedules-row-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.schedules-row-leave-active {
  position: absolute;
  right: 0;
  left: 0;
}

/* Diálogos v2: el contenido (.schedules-page__ink) usa los campos y botones
   compartidos tal cual; el fondo y el encabezado, que BaseDialog renderiza en
   <Teleport to="body">, se ajustan en el bloque sin "scoped" del final.
   La ficha del encabezado es decorativa: queda en tinta suave, sin acento
   ni animación de entrada. */

.schedules-page__ink {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  color: var(--color-text-primary);
}

.schedules-page__form {
  gap: var(--space-6);
}

.schedules-page__field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

/* Rótulo de grupo: el mismo que BaseInput v2 (tipo oración, secundario). */
.schedules-page__label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.schedules-page__label span {
  color: var(--color-danger-on-strong);
}

.schedules-page__field-error {
  color: var(--color-danger-on-strong);
  font-size: var(--font-size-body-sm);
}

.schedules-page__pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: var(--space-4);
}

/* "Así queda": la pista del día con la propuesta y lo ya existente atenuado,
   para ver el solape antes de guardar. Un recorte de la libreta: troquel
   punteado de latón, rótulo en versalitas y la frase en serif. */
.schedules-page__preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px dashed var(--color-brass-line);
  border-radius: 3px;
}

.schedules-page__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-brass-text);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.schedules-page__eyebrow::before {
  flex: none;
  width: 6px;
  height: 6px;
  content: '';
  border: 1.5px solid currentColor;
  transform: rotate(45deg);
}

.schedules-page__preview p {
  margin: 0;
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: 19px;
  line-height: 24px;
  font-variant-numeric: tabular-nums;
}

/* Estado del día: dos opciones como fichas; la elegida queda en tinta. */
.schedules-page__choice {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.schedules-page__choice-option {
  position: relative;
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  color: var(--color-text-primary);
  font-size: var(--font-size-body-sm);
  text-align: center;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border-control);
  border-radius: 3px;
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.schedules-page__choice-option input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.schedules-page__choice-option:has(input:checked) {
  gap: 8px;
  color: var(--color-text-primary);
  font-weight: 600;
  background-color: color-mix(in srgb, var(--color-brass-body) 14%, var(--color-surface));
  border-color: var(--color-brass-text);
  box-shadow: inset 0 -2px 0 var(--color-brass-body);
}

/* La elegida lleva el rombo de latón delante, como en Configuración (8c). */
.schedules-page__choice-option:has(input:checked)::before {
  flex: none;
  width: 7px;
  height: 7px;
  content: '';
  background-color: var(--color-brass-text);
  transform: rotate(45deg);
}

.schedules-page__choice-option:has(input:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.schedules-page__choice-option:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (hover: hover) {
  .schedules-page__choice-option:hover:not(:has(input:checked)):not(:has(input:disabled)) {
    background-color: color-mix(in srgb, var(--color-brass-body) 8%, var(--color-surface));
    border-color: var(--color-brass-line);
  }
}

.schedules-page__segments {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.schedules-page__segment {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-3);
  padding: 12px;
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.schedules-page__segment :deep(.base-button) {
  height: 44px;
}

.schedules-page__segment-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--color-on-strong-muted);
}

/* Velo del cambio de profesional (issue #575): misma pauta que Servicios por
   profesional. Entra con retraso para que una respuesta rápida no destelle. */
.schedules-page__board-wrap {
  position: relative;
}

.schedules-page__board {
  transition: opacity 220ms var(--motion-easing-standard);
}

.schedules-page__board-wrap--busy .schedules-page__board {
  opacity: 0.22;
}

.schedules-page__veil {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-surface) 50%, transparent);
  backdrop-filter: blur(2px);
}

.schedules-veil-enter-active {
  transition: opacity 180ms var(--motion-easing-standard);
}

.schedules-page__veil :deep(.diamond-loader) {
  animation: none;
}

.schedules-veil-leave-active {
  transition: opacity 180ms var(--motion-easing-standard);
}

.schedules-veil-enter-from,
.schedules-veil-leave-to {
  opacity: 0;
}

.schedules-page__stats {
  transition: opacity 220ms var(--motion-easing-standard);
}

.schedules-page__stats--busy {
  opacity: 0.4;
}

@media (prefers-reduced-motion: reduce) {
  .schedules-page__board,
  .schedules-page__stats,
  .schedules-veil-enter-active,
  .schedules-veil-leave-active {
    transition: none;
  }
}

.schedules-page__segment-add {
  display: grid;
  place-items: center;
  align-self: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--color-text-primary);
  cursor: pointer;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: 50%;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.schedules-page__segment-add svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.schedules-page__segment-add:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  border-color: var(--color-text-primary);
}

.schedules-page__segment-add:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.schedules-page__segment-add:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .schedules-page__segment-add {
    transition: none;
  }
}

.schedules-page__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-2);
  flex-wrap: wrap;
}

/* Nada que guardar todavía: «Guardar» espera en reposo con el contorno
   punteado de latón, no con el acento lleno (como en Configuración, 8c). Al
   cambiar algo vuelve a ser la acción principal. Con el teclado conserva el
   doble anillo de foco de BaseButton (WCAG 2.4.7, revisión de #783). */
.schedules-page__dialog-actions
  :deep(.schedules-page__save--rest.base-button--primary:not(.base-button--loading)) {
  color: var(--color-brass-text);
  background: transparent;
  border: 1px dashed var(--color-brass-line);
  box-shadow: none;
}

.schedules-page__dialog-actions
  :deep(.schedules-page__save--rest.base-button--primary:not(.base-button--loading):focus-visible) {
  box-shadow: var(--btn-focus-ring);
}

/* Filas del panel lateral: si el panel es angosto (columna de escritorio o
   móvil) las acciones bajan bajo el dato en lugar de apretarlo. */
@container aside (max-width: 520px) {
  .schedules-row {
    grid-template-columns: auto minmax(0, 1fr);
    padding-inline: 4px;
  }

  .schedules-row__actions,
  .schedules-row > :deep(.base-button),
  .schedules-row__tag {
    grid-column: 2;
    justify-self: start;
  }
}

@media (max-width: 760px) {
  .schedules-page {
    gap: 12px;
    padding: 16px 16px 28px;
  }

  .schedules-page__header {
    padding-bottom: 10px;
  }

  .schedules-page__select {
    max-width: none;
  }

  .schedules-page__stats {
    flex: 1 1 100%;
  }

  .schedules-page__stats > div {
    flex: 1;
    min-width: 0;
  }

  .schedules-page__skeleton-row {
    padding: 0 12px;
  }

  .schedules-page__pair,
  .schedules-page__choice {
    grid-template-columns: minmax(0, 1fr);
  }

  .schedules-page__segment {
    grid-template-columns: minmax(0, 1fr);
  }

  .schedules-page__dialog-actions :deep(.base-button) {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .schedules-stat-enter-active,
  .schedules-stat-leave-active,
  .schedules-row-enter-active,
  .schedules-row-leave-active,
  .schedules-row-move,
  .schedules-page__portrait,
  .schedules-tile,
  .schedules-row,
  .schedules-switch__track,
  .schedules-switch__thumb,
  .schedules-page__choice-option {
    transition: none;
  }

  .schedules-page__skeleton-bar {
    animation: none;
    opacity: 0.8;
  }
}
</style>

<style>
/* SIN "scoped" a propósito, por el mismo motivo que en Profesionales: BaseDialog.vue
   renderiza su tarjeta, encabezado, título, descripción y botón de cerrar en
   <Teleport to="body">, así que dejan de ser descendientes de .schedules-page
   en el DOM real y un :deep() con alcance de componente nunca los alcanza.
   .schedules-page__dialog es exclusivo de esta pantalla. El !important es
   necesario porque la regla propia de BaseDialog tiene la misma
   especificidad y el orden de inserción de los <style> no está garantizado. */
.schedules-page__dialog.base-dialog {
  background-color: var(--color-surface) !important;
  /* Papel con filete y canto de latón, como el tablero (#782). */
  border: 1px solid var(--color-brass-line) !important;
  border-radius: 4px !important;
  box-shadow:
    inset 0 -2px 0 var(--color-brass-body),
    var(--shadow-raised) !important;
}

/* Ancho explícito: sin él el diálogo se ajusta al contenido y, sin los campos
   de duración, el formulario de un tramo quedaba en ~320px con el selector de
   día y las dos horas apretados. El mismo ancho en los cuatro diálogos de la
   pantalla evita que cambien de tamaño según lo que muestren. */
.schedules-page__dialog.base-dialog {
  width: min(100%, 580px) !important;
}

/* Mismo rebote de apertura que los diálogos de Servicios y Profesionales. */
.schedules-page__dialog.base-dialog--open {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}

@media (prefers-reduced-motion: reduce) {
  .schedules-page__dialog.base-dialog--open {
    transition-timing-function: var(--motion-easing-standard) !important;
  }
}

/* Más aire que el diálogo base: márgenes laterales de 32px y un respiro mayor
   entre el título, la descripción y el formulario. */
.schedules-page__dialog .base-dialog__header {
  padding: var(--space-5) var(--space-6) !important;
}

.schedules-page__dialog .base-dialog__description {
  padding: var(--space-4) var(--space-6) 0 !important;
}

.schedules-page__dialog .base-dialog__content {
  padding: var(--space-5) var(--space-6) var(--space-6) !important;
}

/* Bajo el encabezado, el troquel punteado de latón de la familia. */
.schedules-page__dialog .base-dialog__header {
  border-bottom: 1px dashed var(--color-brass-line) !important;
}

.schedules-page__dialog .base-dialog__title {
  color: var(--color-on-strong) !important;
  font-family: var(--font-display) !important;
  font-size: 27px !important;
  font-weight: 400 !important;
  line-height: 1.15 !important;
  overflow-wrap: anywhere;
}

.schedules-page__dialog .base-dialog__description {
  color: var(--color-on-strong-muted) !important;
}

.schedules-page__dialog .base-dialog__close {
  color: var(--color-on-strong-muted) !important;
}

.schedules-page__dialog .base-dialog__close:hover {
  background-color: color-mix(in srgb, var(--color-on-strong) 8%, transparent) !important;
  color: var(--color-on-strong) !important;
}

.schedules-page__dialog .base-dialog__close:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus) !important;
}
</style>
