<script setup lang="ts">
// HU-042 / DEC-105: una instancia por profesional, compuesta en app y montada
// con key=professionalId. Los formularios y las peticiones conservan ese dueño.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getCivilDateInTimezone, shiftCivilDate } from '@/shared/time/civilDate'
import { zoneClockLabel } from '@/shared/time/timezoneCity'
import { useToast, useVocabulary } from '@/shared/composables'
import {
  BaseAlert,
  BaseButton,
  BaseDialog,
  BaseInput,
  BaseDatePicker,
  BaseTimePicker,
  BaseSelect,
  ProfessionalAvatar,
} from '@/shared/ui'
import { RouterLink } from 'vue-router'
import { fetchBusinessTimezone } from '../api/schedulesApi'
import {
  createTimeBlock,
  fetchAffectedAppointments,
  deleteTimeBlock,
  deleteTimeBlockSeries,
  fetchTimeBlockSeries,
  fetchTimeBlocks,
} from '../api/timeBlocksApi'
import { MAX_AFFECTED_DAYS, type AffectedAppointment } from '../model/affectedAppointments'
import { addCivilDays, civilDateTimeToInstant, formatInstantInTimezone } from '../model/civilTime'
import { displayCivilDate } from '../model/displayDate'
import { newIdempotencyKey } from '../model/idempotencyKey'
import {
  BLOCK_TYPES,
  blockTypeLabel,
  type BlockType,
  type TimeBlock,
  type TimeBlockSeries,
} from '../model/timeBlock'
import {
  describeWeekdays,
  ISO_WEEKDAYS,
  WEEKDAY_INITIALS,
  weekdayLabel,
} from '../model/workingHour'
import { groupSeries, type SeriesGroup } from '../model/seriesGroups'
import { civilClockLabel, timeRangeLabel } from '../model/weekBoard'
import {
  validateBlockInterval,
  validateInstant,
  validateReason,
} from '../validation/timeBlockValidation'
import SeriesFormDialog from './SeriesFormDialog.vue'
import SeriesInstancesDialog from './SeriesInstancesDialog.vue'

type ListStatus = 'idle' | 'loading' | 'ready' | 'error'
type SaveStatus =
  | 'idle'
  | 'saving'
  | 'validation-error'
  | 'idempotency-conflict'
  | 'not-found'
  | 'network-error'
  | 'unexpected-error'

const props = defineProps<{
  professionalId: string
  professionalName: string
  photoUrl?: string | null
}>()
const selectedProfessionalId = computed(() => props.professionalId)
const businessTimezone = ref<string | null>(null)
// «Hora en Bogotá · UTC−5», como en Configuración; nunca el id IANA crudo (#791).
const zoneLabel = computed(() =>
  businessTimezone.value ? zoneClockLabel(businessTimezone.value) : '',
)
const timezoneLoading = ref(false)
const todayCivilDate = computed(() =>
  businessTimezone.value ? getCivilDateInTimezone(businessTimezone.value) : null,
)
const blocksCursor = ref<string | null>(null)
const seriesCursor = ref<string | null>(null)
const loadingMoreBlocks = ref(false)
const loadingMoreSeries = ref(false)
const moreBlocksError = ref(false)
const moreSeriesError = ref(false)
let requestToken = 0
let alive = true
onUnmounted(() => {
  alive = false
  requestToken++
})

const blocksStatus = ref<ListStatus>('idle')
const blocks = ref<TimeBlock[]>([])
const seriesStatus = ref<ListStatus>('idle')
const series = ref<TimeBlockSeries[]>([])
const pendingDeleteBlockIds = ref<Set<string>>(new Set())
const pendingDeleteSeriesIds = ref<Set<string>>(new Set())

// visibleBlocks: bloqueos NO retirados lógicamente, ordenados por inicio
// (ya vienen así de la API); RN-BLQ-04 exige que un bloqueo retirado deje
// de mostrarse aquí sin desaparecer del sistema.
const visibleBlocks = computed(() => blocks.value.filter((b) => !b.deletedAt))
const activeSeries = computed(() => series.value.filter((s) => !s.deletedAt))
// Las series semanales que solo se distinguen por el día se muestran en una ficha (#499).
const seriesGroups = computed(() => groupSeries(activeSeries.value))
// Ficha cuyos días se gestionan en el diálogo «Días» (#505). Se guarda la clave y no el
// grupo, y se resuelve contra la lista viva: al retirar un día el diálogo se actualiza.
const daysGroupKey = ref<string | null>(null)
const daysGroup = computed(
  () => seriesGroups.value.find((group) => group.key === daysGroupKey.value) ?? null,
)
// Día elegido dentro del diálogo; si ya no existe (se retiró) cae al primero que quede.
const selectedDayId = ref<string | null>(null)
const activeMember = computed(
  () =>
    daysGroup.value?.items.find((member) => member.id === selectedDayId.value) ??
    daysGroup.value?.items[0] ??
    null,
)
const isDaysOpen = computed({
  get: () => daysGroup.value !== null,
  set: (open: boolean) => {
    if (!open) daysGroupKey.value = null
  },
})

const toast = useToast()
const v = useVocabulary()

async function loadTimezone() {
  timezoneLoading.value = true
  const outcome = await fetchBusinessTimezone()
  if (!alive) return
  businessTimezone.value = outcome.kind === 'success' ? outcome.timezone : null
  timezoneLoading.value = false
}

// HU-069 (RN-BLQ-03): turnos que quedaron bajo el último bloqueo creado. Solo informa;
// ninguno cambia hasta que el profesional lo abre y decide.
const affected = ref<{ items: AffectedAppointment[]; truncated: boolean } | null>(null)

// Aviso breve tras crear un bloqueo (con botón «Ver turnos») y diálogo con el detalle por día.
// El diálogo también se abre a demanda desde la ficha de un bloqueo puntual (#507).
const affectedNotice = ref(false)
const isAffectedOpen = ref(false)
const loadingAffectedBlockId = ref<string | null>(null)

async function showAffectedAppointments(startsAt: string, endsAt: string) {
  const professionalId = selectedProfessionalId.value
  const timeZone = businessTimezone.value
  if (!professionalId || !timeZone) return
  const outcome = await fetchAffectedAppointments(professionalId, startsAt, endsAt, timeZone)
  // Si mientras tanto se cambió de profesional, esta respuesta ya no le corresponde.
  if (professionalId !== selectedProfessionalId.value || outcome.kind !== 'success') return
  const found = outcome.items.length > 0 || outcome.truncated
  affected.value = found ? { items: outcome.items, truncated: outcome.truncated } : null
  affectedNotice.value = found
}

// Botón «Ver turnos» de la ficha: consulta los turnos que caen bajo ese bloqueo y abre el detalle.
async function viewBlockAppointments(block: TimeBlock) {
  const professionalId = selectedProfessionalId.value
  const timeZone = businessTimezone.value
  if (!professionalId || !timeZone || loadingAffectedBlockId.value) return
  loadingAffectedBlockId.value = block.id
  const outcome = await fetchAffectedAppointments(
    professionalId,
    block.startsAt,
    block.endsAt,
    timeZone,
  )
  loadingAffectedBlockId.value = null
  if (!alive || professionalId !== selectedProfessionalId.value) return
  if (outcome.kind !== 'success') {
    toast.error('No pudimos cargar los turnos', {
      detail: 'Revisa tu conexión e inténtalo de nuevo.',
    })
    return
  }
  affected.value = { items: outcome.items, truncated: outcome.truncated }
  affectedNotice.value = false
  isAffectedOpen.value = true
}

// Los turnos afectados se agrupan por día civil (zona del negocio) para leerlos como una
// agenda: un encabezado por día y, debajo, hora, persona y servicio de cada turno.
const affectedByDay = computed(() => {
  const tz = businessTimezone.value ?? 'UTC'
  const days = new Map<
    string,
    { date: string; heading: string; rows: { item: AffectedAppointment; time: string }[] }
  >()
  for (const item of affected.value?.items ?? []) {
    const start = formatInstantInTimezone(item.startsAt, tz)
    const end = formatInstantInTimezone(item.endsAt, tz)
    let day = days.get(start.date)
    if (!day) {
      day = { date: start.date, heading: affectedDayHeading(start.date), rows: [] }
      days.set(start.date, day)
    }
    day.rows.push({ item, time: `${civilClockLabel(start.time)} – ${civilClockLabel(end.time)}` })
  }
  return [...days.values()]
})

function affectedDayHeading(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

function affectedWhen(item: AffectedAppointment): string {
  const tz = businessTimezone.value ?? 'UTC'
  const start = formatInstantInTimezone(item.startsAt, tz)
  const end = formatInstantInTimezone(item.endsAt, tz)
  return `${displayCivilDate(start.date)}, ${civilClockLabel(start.time)} a ${civilClockLabel(end.time)}`
}

async function loadLists() {
  const token = ++requestToken
  affected.value = null
  affectedNotice.value = false
  blocksStatus.value = 'loading'
  seriesStatus.value = 'loading'
  const [blocksOutcome, seriesOutcome] = await Promise.all([
    fetchTimeBlocks(props.professionalId),
    fetchTimeBlockSeries(props.professionalId),
  ])
  if (!alive || token !== requestToken) return
  if (blocksOutcome.kind === 'success') {
    blocks.value = blocksOutcome.page.items
    blocksCursor.value = blocksOutcome.page.nextCursor
    blocksStatus.value = 'ready'
  } else blocksStatus.value = 'error'
  if (seriesOutcome.kind === 'success') {
    series.value = seriesOutcome.page.items
    seriesCursor.value = seriesOutcome.page.nextCursor
    seriesStatus.value = 'ready'
  } else seriesStatus.value = 'error'
}

onMounted(() => {
  void loadTimezone()
  void loadLists()
})

async function loadMore(kind: 'blocks' | 'series') {
  const isBlocks = kind === 'blocks'
  const cursor = isBlocks ? blocksCursor.value : seriesCursor.value
  const busy = isBlocks ? loadingMoreBlocks : loadingMoreSeries
  const error = isBlocks ? moreBlocksError : moreSeriesError
  if (!cursor || busy.value) return
  busy.value = true
  error.value = false
  const token = requestToken
  if (isBlocks) {
    const outcome = await fetchTimeBlocks(props.professionalId, cursor)
    if (alive && token === requestToken) {
      if (outcome.kind === 'success') {
        const known = new Set(blocks.value.map((item) => item.id))
        blocks.value.push(...outcome.page.items.filter((item) => !known.has(item.id)))
        blocksCursor.value = outcome.page.nextCursor
      } else error.value = true
    }
  } else {
    const outcome = await fetchTimeBlockSeries(props.professionalId, cursor)
    if (alive && token === requestToken) {
      if (outcome.kind === 'success') {
        const known = new Set(series.value.map((item) => item.id))
        series.value.push(...outcome.page.items.filter((item) => !known.has(item.id)))
        seriesCursor.value = outcome.page.nextCursor
      } else error.value = true
    }
  }
  busy.value = false
}

function isPast(block: TimeBlock): boolean {
  return Date.parse(block.endsAt) <= Date.now()
}
const displayDate = displayCivilDate
// La hora es opcional (#507): sin hora de inicio el bloqueo arranca a las 00:00 del primer día
// y sin hora de fin llega hasta el final del último día (su fin exclusivo es las 00:00 del
// siguiente). Con ambas vacías es de día completo (vacaciones, un día libre, una emergencia).
const blockPreview = computed(() => {
  const startDate = createStartDate.value
  const endDate = createEndDate.value
  if (!startDate || !endDate) return 'Elige desde qué día hasta qué día. La hora es opcional.'
  const startTime = createStartTime.value
  const endTime = createEndTime.value
  if (!startTime && !endTime) {
    return startDate === endDate
      ? `${displayDate(startDate)} · Todo el día`
      : `${displayDate(startDate)} → ${displayDate(endDate)} · Todo el día`
  }
  return `${displayDate(startDate)} · ${startTime ? civilClockLabel(startTime) : 'Inicio del día'} → ${displayDate(endDate)} · ${endTime ? civilClockLabel(endTime) : 'Fin del día'}`
})

// --- Alta de bloqueo puntual --------------------------------------------

const isCreateBlockOpen = ref(false)
const createBlockType = ref<BlockType>('emergency')
const createStartDate = ref('')
const createStartTime = ref('')
const createEndDate = ref('')
const createEndTime = ref('')
const createBlockReason = ref('')
const createBlockError = ref<string | undefined>(undefined)
const createBlockStatus = ref<SaveStatus>('idle')
let createBlockIdempotencyKey = newIdempotencyKey()

function openCreateBlockDialog() {
  createBlockType.value = 'emergency'
  createStartDate.value = ''
  createStartTime.value = ''
  createEndDate.value = ''
  createEndTime.value = ''
  createBlockReason.value = ''
  createBlockError.value = undefined
  createBlockStatus.value = 'idle'
  createBlockIdempotencyKey = newIdempotencyKey()
  isCreateBlockOpen.value = true
}

function onCreateBlockDialogClosed() {
  createBlockStatus.value = 'idle'
}

async function onSubmitCreateBlock() {
  if (createBlockStatus.value === 'saving' || !selectedProfessionalId.value) return
  createBlockError.value = undefined

  const timeZone = businessTimezone.value
  if (!timeZone) {
    createBlockError.value = `No pudimos determinar la zona horaria ${v.value.ofTheBusiness}. Reintenta.`
    return
  }

  if (!createStartDate.value || !createEndDate.value) {
    createBlockError.value = 'Elige la fecha de inicio y la de fin.'
    return
  }

  let startsAt: string
  let endsAt: string
  try {
    startsAt = civilDateTimeToInstant(
      createStartDate.value,
      createStartTime.value || '00:00',
      timeZone,
    )
    // Sin hora de fin el bloqueo cubre todo el último día: fin exclusivo a las 00:00 del siguiente.
    endsAt = createEndTime.value
      ? civilDateTimeToInstant(createEndDate.value, createEndTime.value, timeZone)
      : civilDateTimeToInstant(addCivilDays(createEndDate.value, 1), '00:00', timeZone)
  } catch {
    createBlockError.value =
      validateInstant(`${createStartDate.value}T${createStartTime.value || '00:00'}`) ??
      validateInstant(`${createEndDate.value}T${createEndTime.value || '00:00'}`) ??
      `La fecha u hora no es válida en la zona ${v.value.ofTheBusiness}.`
    return
  }

  const intervalError = validateBlockInterval(startsAt, endsAt)
  if (intervalError) {
    createBlockError.value = intervalError
    return
  }
  const reasonError = validateReason(createBlockReason.value)
  if (reasonError) {
    createBlockError.value = reasonError
    return
  }

  createBlockStatus.value = 'saving'
  const outcome = await createTimeBlock(
    selectedProfessionalId.value,
    createBlockType.value,
    startsAt,
    endsAt,
    createBlockReason.value.trim() === '' ? null : createBlockReason.value.trim(),
    createBlockIdempotencyKey,
  )

  switch (outcome.kind) {
    case 'success':
      requestToken++
      blocks.value.push(outcome.block)
      blocks.value.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      isCreateBlockOpen.value = false
      createBlockStatus.value = 'idle'
      toast.success('Bloqueo agregado', {
        detail: `El bloqueo ya aparece en el calendario ${v.value.ofTheProfessional}.`,
      })
      void showAffectedAppointments(startsAt, endsAt)
      return
    case 'validation-error':
      createBlockStatus.value = 'validation-error'
      return
    case 'idempotency-conflict':
      createBlockStatus.value = 'idempotency-conflict'
      return
    case 'not-found':
      createBlockStatus.value = 'not-found'
      return
    case 'network-error':
      createBlockStatus.value = 'network-error'
      return
    case 'unexpected-error':
      createBlockStatus.value = 'unexpected-error'
  }
}

async function onDeleteBlock(block: TimeBlock) {
  if (!selectedProfessionalId.value || pendingDeleteBlockIds.value.has(block.id)) return
  pendingDeleteBlockIds.value = new Set(pendingDeleteBlockIds.value).add(block.id)

  const outcome = await deleteTimeBlock(selectedProfessionalId.value, block.id)
  const next = new Set(pendingDeleteBlockIds.value)
  next.delete(block.id)
  pendingDeleteBlockIds.value = next

  if (outcome.kind === 'success' || outcome.kind === 'not-found') {
    requestToken++
    blocks.value = blocks.value.filter((b) => b.id !== block.id)
    if (outcome.kind === 'success') toast.success('Bloqueo retirado')
    return
  }

  // No hay formulario donde mostrar el fallo: el aviso ofrece reintentar.
  toast.error('No pudimos retirar el bloqueo', {
    detail: 'Revisa tu conexión e inténtalo de nuevo.',
    action: { label: 'Reintentar', icon: 'retry', run: () => void onDeleteBlock(block) },
  })
}

function displayInstant(instant: string): string {
  if (!businessTimezone.value) return instant
  const { date, time } = formatInstantInTimezone(instant, businessTimezone.value)
  return `${displayDate(date)} · ${civilClockLabel(time)}`
}

// Un bloqueo de días completos (de 00:00 a 00:00 en la zona del negocio) se muestra por
// fechas y «Todo el día», no como dos horas a medianoche (#507). Devuelve null si no lo es.
function allDayLabel(block: TimeBlock): string | null {
  const tz = businessTimezone.value
  if (!tz) return null
  const start = formatInstantInTimezone(block.startsAt, tz)
  const end = formatInstantInTimezone(block.endsAt, tz)
  if (start.time !== '00:00' || end.time !== '00:00' || end.date <= start.date) return null
  const lastDay = addCivilDays(end.date, -1)
  return lastDay === start.date
    ? `${displayDate(start.date)} · Todo el día`
    : `${displayDate(start.date)} → ${displayDate(lastDay)} · Todo el día`
}

async function onDeleteSeries(item: TimeBlockSeries) {
  if (!selectedProfessionalId.value || pendingDeleteSeriesIds.value.has(item.id)) return
  pendingDeleteSeriesIds.value = new Set(pendingDeleteSeriesIds.value).add(item.id)

  const outcome = await deleteTimeBlockSeries(selectedProfessionalId.value, item.id)
  const next = new Set(pendingDeleteSeriesIds.value)
  next.delete(item.id)
  pendingDeleteSeriesIds.value = next

  if (outcome.kind === 'success' || outcome.kind === 'not-found') {
    requestToken++
    series.value = series.value.filter((s) => s.id !== item.id)
    if (outcome.kind === 'success') toast.success('Serie retirada')
    return
  }

  toast.error('No pudimos retirar la serie', {
    detail: 'Revisa tu conexión e inténtalo de nuevo.',
    action: { label: 'Reintentar', icon: 'retry', run: () => void onDeleteSeries(item) },
  })
}

// Retira todos los días de una ficha agrupada. Los que fallan se quedan en la lista
// (la ficha se encoge) y el aviso ofrece reintentar solo esos.
async function onDeleteGroup(group: SeriesGroup) {
  const professionalId = selectedProfessionalId.value
  if (group.items.length === 1) return onDeleteSeries(group.items[0]!)
  if (!professionalId) return
  const items = group.items.filter((item) => !pendingDeleteSeriesIds.value.has(item.id))
  if (items.length === 0) return
  const marked = new Set(pendingDeleteSeriesIds.value)
  for (const item of items) marked.add(item.id)
  pendingDeleteSeriesIds.value = marked

  const outcomes = await Promise.all(
    items.map((item) => deleteTimeBlockSeries(professionalId, item.id)),
  )
  const unmarked = new Set(pendingDeleteSeriesIds.value)
  for (const item of items) unmarked.delete(item.id)
  pendingDeleteSeriesIds.value = unmarked

  const retired = new Set<string>()
  const failed: TimeBlockSeries[] = []
  items.forEach((item, index) => {
    const kind = outcomes[index]!.kind
    if (kind === 'success' || kind === 'not-found') retired.add(item.id)
    else failed.push(item)
  })
  if (retired.size > 0) {
    requestToken++
    series.value = series.value.filter((s) => !retired.has(s.id))
  }
  if (failed.length === 0) {
    toast.success('Bloqueo retirado', { detail: `Se retiraron los ${items.length} días.` })
    return
  }
  toast.error('No pudimos retirar todos los días', {
    detail:
      retired.size > 0
        ? `Se retiraron ${retired.size} de ${items.length}. Revisa tu conexión e inténtalo de nuevo.`
        : 'Revisa tu conexión e inténtalo de nuevo.',
    action: {
      label: 'Reintentar',
      icon: 'retry',
      run: () => void onDeleteGroup({ ...group, items: failed }),
    },
  })
}

// «Lunes a viernes · 1:00 p. m. – 2:00 p. m.» (o «Lista de fechas · Todo el día»).
function groupSchedule(group: SeriesGroup): string {
  const first = group.items[0]!
  const when = timeRangeLabel(first.startsTime, first.durationMinutes)
  return first.recurrenceKind === 'weekly'
    ? `${describeWeekdays(group.weekdays)} · ${when}`
    : `Lista de fechas · ${when}`
}

function groupName(group: SeriesGroup): string {
  const first = group.items[0]!
  return group.items.length > 1
    ? `${blockTypeLabel(first.blockType)} ${describeWeekdays(group.weekdays).toLowerCase()}`
    : seriesName(first)
}

function openDays(group: SeriesGroup) {
  daysGroupKey.value = group.key
  selectedDayId.value = group.items[0]?.id ?? null
}

// Serie del grupo que corresponde a un día ISO de la tira, o undefined si ese día no está.
function memberOfDay(group: SeriesGroup, isoWeekday: number): TimeBlockSeries | undefined {
  return group.items.find((member) => member.isoWeekday === isoWeekday)
}

// --- Bloqueo por días (semanal o fechas), edición y excepciones (#100, #495) ---------------------

const isCreateDaysOpen = ref(false)
const editingSeries = ref<TimeBlockSeries | null>(null)
const editingGroup = ref<TimeBlockSeries[] | null>(null)
const isEditOpen = ref(false)
const managingSeriesId = ref<string | null>(null)
const isInstancesOpen = ref(false)
const managingSeries = computed(
  () => series.value.find((item) => item.id === managingSeriesId.value) ?? null,
)

function onSeriesCreated(created: TimeBlockSeries) {
  requestToken++
  series.value.push(created)
}

function openEditSeries(group: SeriesGroup) {
  editingSeries.value = group.items[0]!
  editingGroup.value = group.items.length > 1 ? group.items : null
  isEditOpen.value = true
}

function onSeriesUpdated(payload: {
  originalId: string
  series: TimeBlockSeries
  splitFrom: string | null
}) {
  requestToken++
  if (payload.splitFrom === null) {
    series.value = series.value.map((item) =>
      item.id === payload.originalId ? payload.series : item,
    )
    return
  }
  // «Esta y las siguientes»: la API recorta la original el día anterior al
  // corte y responde la serie nueva; la lista refleja las dos.
  const until = shiftCivilDate(payload.splitFrom, -1)
  series.value = series.value
    .map((item) => (item.id === payload.originalId ? { ...item, effectiveUntil: until } : item))
    .concat(payload.series)
}

function onSeriesRemoved(id: string) {
  requestToken++
  series.value = series.value.filter((item) => item.id !== id)
}

function openInstances(item: TimeBlockSeries) {
  managingSeriesId.value = item.id
  isInstancesOpen.value = true
}

function onSeriesChanged(next: TimeBlockSeries) {
  requestToken++
  series.value = series.value.map((item) => (item.id === next.id ? next : item))
}

function seriesName(item: TimeBlockSeries): string {
  return `${blockTypeLabel(item.blockType)} ${item.isoWeekday ? weekdayLabel(item.isoWeekday) : 'por fechas'}`
}

function seriesCounts(item: TimeBlockSeries): string {
  const parts: string[] = []
  if (item.recurrenceKind === 'date_list') {
    parts.push(item.dates.length === 1 ? '1 fecha' : `${item.dates.length} fechas`)
  }
  if (item.exceptions.length > 0) {
    parts.push(
      item.exceptions.length === 1 ? '1 excepción' : `${item.exceptions.length} excepciones`,
    )
  }
  return parts.join(' · ')
}
</script>

<template>
  <section class="blocks-panel" :aria-labelledby="`blocks-title-${professionalId}`">
    <header class="blocks-panel__header">
      <div class="blocks-panel__identity">
        <ProfessionalAvatar :full-name="professionalName" :photo-url="photoUrl" size="row" />
        <div>
          <p class="blocks-panel__eyebrow">Disponibilidad · {{ professionalName }}</p>
          <h2 :id="`blocks-title-${professionalId}`">Tiempo fuera de agenda</h2>
        </div>
      </div>
      <div class="blocks-panel__actions">
        <BaseButton
          variant="primary"
          :disabled="!businessTimezone || blocksStatus !== 'ready'"
          @click="openCreateBlockDialog"
          >Agregar bloqueo</BaseButton
        >
        <BaseButton
          variant="secondary"
          :disabled="!businessTimezone || seriesStatus !== 'ready'"
          @click="isCreateDaysOpen = true"
          >Agregar bloqueo por días</BaseButton
        >
      </div>
    </header>
    <!-- Introducción y zona horaria en un solo renglón (issue #577): antes
         eran dos párrafos sueltos con márgenes propios que sumaban un alto
         vacío entre la cabecera y las listas. -->
    <div class="blocks-panel__lede">
      <p class="blocks-panel__intro">
        Un descanso, un día libre o un imprevisto. Reserva ese tiempo para {{ professionalName }}.
      </p>
      <p v-if="businessTimezone" class="blocks-panel__timezone">
        {{ zoneLabel }}
      </p>
      <p v-else-if="timezoneLoading" class="blocks-panel__timezone" role="status">
        Consultando la zona horaria…
      </p>
      <BaseAlert
        v-else
        class="blocks-panel__timezone-alert"
        variant="warning"
        title="No pudimos consultar la zona horaria"
      >
        Reintenta antes de crear un bloqueo. Tus registros siguen disponibles.
        <template #action
          ><BaseButton variant="secondary" @click="loadTimezone"
            >Reintentar zona horaria</BaseButton
          ></template
        >
      </BaseAlert>
    </div>

    <BaseAlert
      v-if="affected && affectedNotice"
      class="blocks-panel__affected"
      variant="warning"
      :title="
        affected.items.length === 0
          ? 'Revisa la agenda de los días siguientes'
          : affected.items.length === 1
            ? 'Este bloqueo cubre 1 turno'
            : `Este bloqueo cubre ${affected.items.length} turnos`
      "
    >
      <p v-if="affected.items.length > 0">
        No cambiamos ningún turno. Revísalos para reprogramarlos o cancelarlos.
      </p>
      <p v-if="affected.truncated">
        El bloqueo abarca más de {{ MAX_AFFECTED_DAYS }} días y solo revisamos los primeros. Mira la
        agenda de los días siguientes.
      </p>
      <template #action>
        <BaseButton
          v-if="affected.items.length > 0"
          variant="secondary"
          @click="isAffectedOpen = true"
          >Ver turnos</BaseButton
        >
        <BaseButton variant="secondary" @click="((affectedNotice = false), (affected = null))"
          >Entendido</BaseButton
        >
      </template>
    </BaseAlert>
    <BaseDialog
      v-model="isAffectedOpen"
      title="Turnos bajo el bloqueo"
      description="No cambiamos ningún turno. Abre cada uno para reprogramarlo o cancelarlo."
      size="lg"
      content-class="block-dialog block-dialog--affected"
    >
      <template v-if="affected">
        <p v-if="affected.items.length === 0" class="affected-empty">
          Ningún turno confirmado cae dentro de este bloqueo.
        </p>
        <div v-else class="blocks-panel__affected-days">
          <section v-for="day in affectedByDay" :key="day.date" class="affected-day">
            <h3 class="affected-day__title">
              {{ day.heading }}
              <span>{{ day.rows.length === 1 ? '1 turno' : `${day.rows.length} turnos` }}</span>
            </h3>
            <ul class="affected-day__list">
              <li v-for="row in day.rows" :key="row.item.id">
                <RouterLink
                  class="affected-row"
                  :to="{ name: 'agenda-detalle-turno', params: { appointmentId: row.item.id } }"
                  :aria-label="`${affectedWhen(row.item)} · ${row.item.attendeeName} · ${row.item.serviceName}`"
                >
                  <span class="affected-row__time">{{ row.time }}</span>
                  <span class="affected-row__who"
                    ><strong>{{ row.item.attendeeName }}</strong
                    ><small>{{ row.item.serviceName }}</small></span
                  >
                  <span class="affected-row__go" aria-hidden="true">→</span>
                </RouterLink>
              </li>
            </ul>
          </section>
        </div>
        <p v-if="affected.truncated" class="affected-empty">
          El bloqueo abarca más de {{ MAX_AFFECTED_DAYS }} días y solo revisamos los primeros. Mira
          la agenda de los días siguientes.
        </p>
      </template>
    </BaseDialog>

    <div class="blocks-panel__ledger">
      <section aria-labelledby="single-blocks-title">
        <div class="blocks-panel__section-head">
          <h3 id="single-blocks-title">Bloqueos puntuales</h3>
        </div>
        <div
          class="blocks-panel__scroll"
          role="region"
          aria-label="Lista de bloqueos puntuales"
          tabindex="0"
        >
          <!-- Skeleton con la forma de las fichas (#791), no un spinner en una caja. -->
          <div v-if="blocksStatus === 'loading'" class="blocks-panel__skeleton" role="status">
            <span class="sr-only">Cargando bloqueos…</span>
            <span class="blocks-panel__skeleton-record" aria-hidden="true">
              <span class="blocks-panel__skeleton-bar blocks-panel__skeleton-bar--type" />
              <span class="blocks-panel__skeleton-bar blocks-panel__skeleton-bar--when" />
              <span class="blocks-panel__skeleton-bar blocks-panel__skeleton-bar--foot" />
            </span>
          </div>
          <BaseAlert
            v-else-if="blocksStatus === 'error'"
            variant="warning"
            title="No pudimos cargar los bloqueos"
          >
            Revisa tu conexión e inténtalo de nuevo.
            <template #action
              ><BaseButton variant="secondary" @click="loadLists"
                >Reintentar bloqueos</BaseButton
              ></template
            >
          </BaseAlert>
          <template v-else-if="blocksStatus === 'ready'">
            <div v-if="visibleBlocks.length === 0" class="blocks-panel__empty">
              <p>Sin bloqueos puntuales</p>
              <small>Cuando necesite una pausa, aparecerá aquí.</small>
            </div>
            <TransitionGroup
              v-else
              name="block-record"
              tag="ul"
              class="blocks-panel__list"
              aria-label="Bloqueos puntuales"
            >
              <li
                v-for="block in visibleBlocks"
                :key="block.id"
                class="blocks-panel__record"
                :class="{ 'blocks-panel__record--past': isPast(block) }"
              >
                <div class="blocks-panel__record-top">
                  <strong>{{ blockTypeLabel(block.blockType) }}</strong
                  ><span class="blocks-panel__stamp">{{
                    isPast(block) ? 'Pasado' : 'Puntual'
                  }}</span>
                </div>
                <p v-if="allDayLabel(block)" class="blocks-panel__interval">
                  <time :datetime="block.startsAt">{{ allDayLabel(block) }}</time>
                </p>
                <p v-else class="blocks-panel__interval">
                  <time :datetime="block.startsAt">{{ displayInstant(block.startsAt) }}</time
                  ><span aria-hidden="true"> → </span><span class="sr-only"> hasta </span
                  ><time :datetime="block.endsAt">{{ displayInstant(block.endsAt) }}</time>
                </p>
                <p v-if="block.reason" class="blocks-panel__reason">{{ block.reason }}</p>
                <div class="blocks-panel__record-footer">
                  <span>{{
                    block.source === 'holiday_calendar'
                      ? 'Calendario de festivos'
                      : 'Bloqueo manual'
                  }}</span>
                  <div class="blocks-panel__record-actions">
                    <BaseButton
                      v-if="!isPast(block)"
                      variant="secondary"
                      :aria-label="`Ver turnos del bloqueo ${blockTypeLabel(block.blockType)} del ${displayInstant(block.startsAt)}`"
                      :loading="loadingAffectedBlockId === block.id"
                      :disabled="loadingAffectedBlockId !== null"
                      @click="viewBlockAppointments(block)"
                      >Ver turnos</BaseButton
                    >
                    <BaseButton
                      variant="secondary"
                      :aria-label="`Retirar bloqueo ${blockTypeLabel(block.blockType)} del ${displayInstant(block.startsAt)}`"
                      :loading="pendingDeleteBlockIds.has(block.id)"
                      :disabled="pendingDeleteBlockIds.has(block.id)"
                      @click="onDeleteBlock(block)"
                      >Retirar</BaseButton
                    >
                  </div>
                </div>
              </li>
            </TransitionGroup>
            <BaseAlert v-if="moreBlocksError" variant="warning"
              >No pudimos cargar más bloqueos. Puedes reintentar.</BaseAlert
            >
            <BaseButton
              v-if="blocksCursor"
              variant="secondary"
              :loading="loadingMoreBlocks"
              :disabled="loadingMoreBlocks"
              @click="loadMore('blocks')"
              >Cargar más bloqueos</BaseButton
            >
          </template>
        </div>
      </section>
      <section aria-labelledby="weekly-blocks-title">
        <div class="blocks-panel__section-head">
          <h3 id="weekly-blocks-title">Series de bloqueo</h3>
        </div>
        <div
          class="blocks-panel__scroll"
          role="region"
          aria-label="Lista de series de bloqueo"
          tabindex="0"
        >
          <!-- Skeleton con la forma de las fichas (#791), no un spinner en una caja. -->
          <div v-if="seriesStatus === 'loading'" class="blocks-panel__skeleton" role="status">
            <span class="sr-only">Cargando series…</span>
            <span class="blocks-panel__skeleton-record" aria-hidden="true">
              <span class="blocks-panel__skeleton-bar blocks-panel__skeleton-bar--type" />
              <span class="blocks-panel__skeleton-bar blocks-panel__skeleton-bar--when" />
              <span class="blocks-panel__skeleton-bar blocks-panel__skeleton-bar--foot" />
            </span>
          </div>
          <BaseAlert
            v-else-if="seriesStatus === 'error'"
            variant="warning"
            title="No pudimos cargar las series"
          >
            Revisa tu conexión e inténtalo de nuevo.
            <template #action
              ><BaseButton variant="secondary" @click="loadLists"
                >Reintentar series</BaseButton
              ></template
            >
          </BaseAlert>
          <template v-else-if="seriesStatus === 'ready'">
            <div v-if="activeSeries.length === 0" class="blocks-panel__empty">
              <p>Sin pausas recurrentes</p>
              <small>Una misma pausa, cada semana.</small>
            </div>
            <TransitionGroup
              v-else
              name="block-record"
              tag="ul"
              class="blocks-panel__list"
              aria-label="Series de bloqueo"
            >
              <li v-for="group in seriesGroups" :key="group.key" class="blocks-panel__record">
                <div class="blocks-panel__record-top">
                  <strong>{{ blockTypeLabel(group.items[0]!.blockType) }}</strong
                  ><span class="blocks-panel__stamp">{{
                    group.items[0]!.recurrenceKind === 'weekly' ? 'Semanal' : 'Fechas'
                  }}</span>
                </div>
                <ul
                  v-if="group.items[0]!.recurrenceKind === 'weekly'"
                  class="blocks-panel__week"
                  aria-hidden="true"
                >
                  <li
                    v-for="day in ISO_WEEKDAYS"
                    :key="day.value"
                    :class="{ 'blocks-panel__week-day--on': group.weekdays.includes(day.value) }"
                  >
                    {{ WEEKDAY_INITIALS[day.value] }}
                  </li>
                </ul>
                <p class="blocks-panel__interval">{{ groupSchedule(group) }}</p>
                <p class="blocks-panel__validity">
                  Desde {{ displayDate(group.items[0]!.effectiveFrom)
                  }}<template v-if="group.items[0]!.effectiveUntil">
                    hasta {{ displayDate(group.items[0]!.effectiveUntil) }}</template
                  ><template v-else> · Sin fecha de fin</template>
                </p>
                <p v-if="group.items[0]!.reason" class="blocks-panel__reason">
                  {{ group.items[0]!.reason }}
                </p>
                <p
                  v-if="group.items.length === 1 && seriesCounts(group.items[0]!)"
                  class="blocks-panel__validity"
                >
                  {{ seriesCounts(group.items[0]!) }}
                </p>
                <div class="blocks-panel__record-footer">
                  <span>{{
                    group.items[0]!.recurrenceKind === 'weekly'
                      ? 'Se repite cada semana'
                      : 'Fechas explícitas'
                  }}</span>
                  <div class="blocks-panel__record-actions">
                    <BaseButton
                      v-if="group.items.length === 1"
                      variant="secondary"
                      :aria-label="`${group.items[0]!.recurrenceKind === 'date_list' ? 'Fechas y excepciones' : 'Excepciones'} de la serie ${seriesName(group.items[0]!)}`"
                      @click="openInstances(group.items[0]!)"
                      >{{
                        group.items[0]!.recurrenceKind === 'date_list' ? 'Fechas' : 'Excepciones'
                      }}</BaseButton
                    >
                    <BaseButton
                      v-else
                      variant="secondary"
                      aria-haspopup="dialog"
                      :aria-label="`Días de la serie ${groupName(group)}`"
                      @click="openDays(group)"
                      >Días</BaseButton
                    >
                    <BaseButton
                      variant="secondary"
                      :aria-label="`Editar serie ${groupName(group)}`"
                      @click="openEditSeries(group)"
                      >Editar</BaseButton
                    >
                    <BaseButton
                      variant="secondary"
                      :aria-label="`Retirar serie ${groupName(group)}`"
                      :loading="group.items.some((member) => pendingDeleteSeriesIds.has(member.id))"
                      :disabled="
                        group.items.some((member) => pendingDeleteSeriesIds.has(member.id))
                      "
                      @click="onDeleteGroup(group)"
                      >{{ group.items.length > 1 ? 'Retirar todo' : 'Retirar' }}</BaseButton
                    >
                  </div>
                </div>
              </li>
            </TransitionGroup>
            <BaseAlert v-if="moreSeriesError" variant="warning"
              >No pudimos cargar más series. Puedes reintentar.</BaseAlert
            >
            <BaseButton
              v-if="seriesCursor"
              variant="secondary"
              :loading="loadingMoreSeries"
              :disabled="loadingMoreSeries"
              @click="loadMore('series')"
              >Cargar más series</BaseButton
            >
          </template>
        </div>
      </section>
    </div>
    <p class="blocks-panel__note">Un bloqueo no cancela ni reprograma los turnos ya agendados.</p>

    <BaseDialog
      v-model="isCreateBlockOpen"
      title="Agregar bloqueo puntual"
      description="Define el tiempo que no estará disponible en la agenda."
      size="lg"
      content-class="block-dialog"
      :close-on-backdrop="createBlockStatus !== 'saving'"
      :close-on-escape="createBlockStatus !== 'saving'"
      :show-close="createBlockStatus !== 'saving'"
      @close="onCreateBlockDialogClosed"
    >
      <form
        id="create-block-form"
        :aria-label="`Bloqueo puntual para ${professionalName}`"
        class="blocks-page__form block-form"
        @submit.prevent="onSubmitCreateBlock"
      >
        <BaseSelect
          id="create-block-type"
          v-model="createBlockType"
          label="Tipo de bloqueo"
          :options="BLOCK_TYPES"
          :disabled="createBlockStatus === 'saving'"
        />
        <fieldset :disabled="createBlockStatus === 'saving'">
          <legend>01 · Inicio</legend>
          <div class="block-form__row">
            <div class="block-form__date-field">
              <label id="block-start-date-label" for="block-start-date"
                >Fecha de inicio <span aria-hidden="true">*</span></label
              >
              <BaseDatePicker
                v-model="createStartDate"
                trigger-id="block-start-date"
                label-id="block-start-date-label"
                :today="todayCivilDate"
                :disabled="createBlockStatus === 'saving'"
                required
              />
            </div>
            <BaseTimePicker
              v-model="createStartTime"
              label="Hora de inicio"
              optional
              :disabled="createBlockStatus === 'saving'"
            />
          </div>
        </fieldset>
        <fieldset :disabled="createBlockStatus === 'saving'">
          <legend>02 · Fin</legend>
          <div class="block-form__row">
            <div class="block-form__date-field">
              <label id="block-end-date-label" for="block-end-date"
                >Fecha de fin <span aria-hidden="true">*</span></label
              >
              <BaseDatePicker
                v-model="createEndDate"
                trigger-id="block-end-date"
                label-id="block-end-date-label"
                :today="todayCivilDate"
                :disabled="createBlockStatus === 'saving'"
                required
              />
            </div>
            <BaseTimePicker
              v-model="createEndTime"
              label="Hora de fin"
              closing
              optional
              :disabled="createBlockStatus === 'saving'"
            />
          </div>
        </fieldset>
        <p class="block-form__hint">
          Sin hora, el bloqueo es de día completo: desde el inicio del primer día hasta el final del
          último. Sirve para vacaciones, un día libre o una emergencia.
        </p>
        <BaseInput
          v-model="createBlockReason"
          type="text"
          label="Motivo (opcional)"
          :disabled="createBlockStatus === 'saving'"
        />
        <div class="block-form__preview" aria-live="polite">
          <span class="blocks-panel__eyebrow">Así queda el bloqueo</span>
          <p>{{ blockTypeLabel(createBlockType) }} · {{ blockPreview }}</p>
          <small>{{ zoneLabel }}</small>
        </div>
        <BaseAlert v-if="createBlockError" variant="danger">{{ createBlockError }}</BaseAlert>
        <BaseAlert v-else-if="createBlockStatus === 'validation-error'" variant="danger"
          >Revisa los datos del bloqueo.</BaseAlert
        >
        <BaseAlert v-else-if="createBlockStatus === 'idempotency-conflict'" variant="danger"
          >Este intento ya se envió con otros datos. Cierra y vuelve a abrir el formulario para
          iniciar un bloqueo nuevo.</BaseAlert
        >
        <BaseAlert v-else-if="createBlockStatus === 'not-found'" variant="danger"
          >{{ v.ThisProfessional }} ya no está disponible.</BaseAlert
        >
        <BaseAlert
          v-else-if="
            createBlockStatus === 'network-error' || createBlockStatus === 'unexpected-error'
          "
          variant="danger"
          >No pudimos guardar el bloqueo. Tus datos siguen aquí; inténtalo de nuevo.</BaseAlert
        >
      </form>
      <template #footer
        ><div class="block-form__footer">
          <BaseButton
            variant="secondary"
            :disabled="createBlockStatus === 'saving'"
            @click="isCreateBlockOpen = false"
            >Cancelar</BaseButton
          ><BaseButton
            type="submit"
            form="create-block-form"
            variant="primary"
            :loading="createBlockStatus === 'saving'"
            :disabled="createBlockStatus === 'saving'"
            >Guardar bloqueo</BaseButton
          >
        </div></template
      >
    </BaseDialog>

    <BaseDialog
      v-model="isDaysOpen"
      :title="daysGroup ? `Días de ${groupName(daysGroup)}` : 'Días de la serie'"
      description="Elige un día para gestionar sus excepciones o retirarlo."
      size="md"
      content-class="block-dialog block-dialog--days"
    >
      <div v-if="daysGroup" class="days-picker">
        <p class="days-picker__summary">{{ groupSchedule(daysGroup) }}</p>
        <div class="days-picker__week" role="group" aria-label="Elige un día">
          <button
            v-for="day in ISO_WEEKDAYS"
            :key="day.value"
            type="button"
            class="days-picker__tile"
            :class="{
              'days-picker__tile--on': memberOfDay(daysGroup, day.value),
              'days-picker__tile--active':
                memberOfDay(daysGroup, day.value)?.id === activeMember?.id,
            }"
            :disabled="!memberOfDay(daysGroup, day.value)"
            :aria-pressed="memberOfDay(daysGroup, day.value)?.id === activeMember?.id"
            :aria-label="
              memberOfDay(daysGroup, day.value)
                ? weekdayLabel(day.value)
                : `${weekdayLabel(day.value)}, sin bloqueo`
            "
            @click="selectedDayId = memberOfDay(daysGroup, day.value)?.id ?? selectedDayId"
          >
            <span class="days-picker__initial" aria-hidden="true">{{
              WEEKDAY_INITIALS[day.value]
            }}</span>
            <span class="days-picker__abbr" aria-hidden="true">{{
              weekdayLabel(day.value).slice(0, 3)
            }}</span>
          </button>
        </div>
        <section v-if="activeMember" class="days-picker__detail" aria-live="polite">
          <p class="blocks-panel__eyebrow">Día elegido</p>
          <h3 class="days-picker__day">{{ weekdayLabel(activeMember.isoWeekday ?? 0) }}</h3>
          <p class="days-picker__meta">
            {{ timeRangeLabel(activeMember.startsTime, activeMember.durationMinutes) }}
            <span aria-hidden="true">·</span>
            {{ seriesCounts(activeMember) || 'Sin excepciones' }}
          </p>
          <div class="days-picker__actions">
            <BaseButton
              variant="secondary"
              :aria-label="`Excepciones de la serie ${seriesName(activeMember)}`"
              @click="openInstances(activeMember)"
              >Excepciones</BaseButton
            >
            <BaseButton
              variant="secondary"
              :aria-label="`Retirar serie ${seriesName(activeMember)}`"
              :loading="pendingDeleteSeriesIds.has(activeMember.id)"
              :disabled="pendingDeleteSeriesIds.has(activeMember.id)"
              @click="onDeleteSeries(activeMember)"
              >Retirar este día</BaseButton
            >
          </div>
        </section>
      </div>
    </BaseDialog>
    <SeriesFormDialog
      v-model="isCreateDaysOpen"
      mode="create"
      :professional-id="professionalId"
      :professional-name="professionalName"
      :today="todayCivilDate"
      @created="onSeriesCreated"
    />
    <SeriesFormDialog
      v-model="isEditOpen"
      mode="edit"
      :professional-id="professionalId"
      :professional-name="professionalName"
      :series="editingSeries"
      :group="editingGroup"
      @created="onSeriesCreated"
      @removed="onSeriesRemoved"
      :today="todayCivilDate"
      @updated="onSeriesUpdated"
    />
    <SeriesInstancesDialog
      v-model="isInstancesOpen"
      :professional-id="professionalId"
      :series="managingSeries"
      :today="todayCivilDate"
      @update:series="onSeriesChanged"
    />
  </section>
</template>

<style scoped>
.sr-only {
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

/* Panel v2 (DEC-188): superficie con borde sutil, rótulos en tipo oración y
   seleccionado en tinta. El acento del negocio queda solo en «Agregar
   bloqueo», la acción principal (BaseButton primario sin repintar). */
.blocks-panel {
  color: var(--color-text-primary);
  padding: 28px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}
.blocks-panel__header,
.blocks-panel__identity,
.blocks-panel__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.blocks-panel__header {
  justify-content: space-between;
  flex-wrap: wrap;
}
.blocks-panel__identity {
  min-width: 0;
}
.blocks-panel__identity > div {
  min-width: 0;
}
/* El titular del panel es el del diálogo (#791): serif de la familia. */
.blocks-panel h2 {
  margin: 2px 0 0;
  font-family: var(--font-display);
  font-size: clamp(28px, 3vw, 34px);
  font-weight: 400;
  line-height: 1.1;
}
.blocks-panel__eyebrow {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  font-family: var(--font-sans);
  overflow-wrap: anywhere;
}
.blocks-panel__lede {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 20px;
  margin: 18px 0 22px;
}
.blocks-panel__intro {
  margin: 0;
  font-size: var(--font-size-body-sm);
  color: var(--color-text-secondary);
}
/* La zona va como etiqueta discreta al final del renglón. */
.blocks-panel__timezone {
  margin: 0;
  padding: 3px 10px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  white-space: nowrap;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill);
}
.blocks-panel__timezone-alert {
  flex-basis: 100%;
}
.blocks-panel__ledger {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}
.blocks-panel__ledger > section {
  min-width: 0;
}
.blocks-panel__section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: 14px;
  margin-bottom: 16px;
}
.blocks-panel h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: var(--font-size-title-item);
}
.blocks-panel__list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  display: grid;
  gap: 10px;
}
.blocks-panel__scroll {
  min-width: 0;
}
.blocks-panel__scroll:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-focus);
}
/* Ficha de bloqueo: tarjeta v2 con borde sutil, sin filete de acento. */
.blocks-panel__record {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow-wrap: anywhere;
}
.blocks-panel__record--past {
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  color: var(--color-text-secondary);
}
.blocks-panel__record-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.blocks-panel__record-top strong {
  font-family: var(--font-sans);
  font-size: var(--font-size-title-item);
  font-weight: 600;
  line-height: 1.2;
}
/* Sello del tipo: pastilla neutra en tipo oración. */
.blocks-panel__stamp {
  flex-shrink: 0;
  padding: 1px 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-pill);
}
.blocks-panel__interval {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
  line-height: 1.4;
}
.blocks-panel__reason {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-body-sm);
  line-height: 1.5;
}
.blocks-panel__validity {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: 1.5;
}
.blocks-panel__record-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 12px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-subtle);
}
.blocks-panel__record-footer > span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}
.blocks-panel__record-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
/* Acciones del registro: BaseButton secundario neutro con texto más pequeño,
   pero con su alto de 44 px (objetivo táctil del estándar visual). El alto fijo
   de 34 px de #720 las dejaba por debajo y el E2E de series lo detectó (#764). */
.blocks-panel__record :deep(.base-button) {
  padding-inline: 12px;
  font-size: var(--font-size-body-sm);
}
/* Días de la serie: el día incluido queda en tinta. */
.blocks-panel__week {
  display: flex;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.blocks-panel__week > li {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  line-height: 1;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}
.blocks-panel__week > li.blocks-panel__week-day--on {
  color: var(--color-text-primary);
  font-weight: 600;
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-color: var(--color-text-primary);
}
.blocks-panel__affected {
  margin-bottom: var(--space-4, 1rem);
}

.blocks-panel__affected-days {
  display: grid;
  gap: 16px;
}
.affected-empty {
  margin: 0;
  color: var(--color-text-secondary);
}
.affected-day__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 6px;
  padding-bottom: 6px;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.affected-day__title span {
  color: var(--color-text-secondary);
  font-weight: 500;
}
.affected-day__list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* La hora toma su ancho real: en 12 h («10:30 a. m. – 11:15 a. m.») no cabe en
   una columna fija de 112 px y se montaba sobre el nombre (#791). */
.affected-row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 6px 12px;
  color: var(--color-text-primary);
  text-decoration: none;
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}
.affected-row:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  border-color: var(--color-border-control);
}
.affected-row:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}
.affected-row__time {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.affected-row__who {
  display: grid;
  min-width: 0;
}
.affected-row__who strong {
  overflow: hidden;
  line-height: 1.3;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.affected-row__who small {
  overflow: hidden;
  line-height: 1.3;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.affected-row__go {
  color: var(--color-text-secondary);
}
@media (max-width: 520px) {
  .affected-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .affected-row__time {
    grid-column: 1 / -1;
  }
}

.blocks-panel__skeleton {
  display: grid;
  gap: 10px;
  margin: 0 0 16px;
}
/* Mismo borde, radio y relleno que .blocks-panel__record: al llegar la lista,
   las fichas ocupan el sitio de su silueta. */
.blocks-panel__skeleton-record {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}
.blocks-panel__skeleton-bar {
  display: block;
  height: 14px;
  border-radius: 2px;
  background-color: color-mix(in srgb, var(--color-text-primary) 9%, transparent);
  animation: blocks-skeleton-pulse 1400ms ease-in-out infinite;
}
.blocks-panel__skeleton-bar--type {
  width: 42%;
  height: 22px;
}
.blocks-panel__skeleton-bar--when {
  width: 68%;
}
.blocks-panel__skeleton-bar--foot {
  width: 30%;
  height: 12px;
  margin-top: 8px;
}
/* Solo opacidad, finita en cada ciclo; con movimiento reducido la regla global
   de base.css la deja en 0,01 ms (DEC-110). */
@keyframes blocks-skeleton-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
/* Vacío compacto (issue #577): un renglón con el texto y su ayuda, sin glifo
   decorativo (v2 quita los rombos y adornos). */
.blocks-panel__empty {
  display: grid;
  row-gap: 2px;
  padding: 16px 18px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  border-radius: var(--radius-md);
}
.blocks-panel__empty p {
  margin: 0;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: var(--font-size-body);
  font-weight: 500;
  line-height: 1.3;
}
.blocks-panel__empty small {
  font-size: var(--font-size-caption);
  line-height: 1.5;
}
.blocks-panel__note {
  margin: 20px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-caption);
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.block-form {
  display: grid;
  gap: 22px;
}
.block-form__identity {
  display: flex;
  gap: 14px;
  align-items: center;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.block-form__identity strong {
  display: block;
  font-family: var(--font-sans);
  font-size: var(--font-size-body-lg);
  font-weight: 600;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.block-form fieldset {
  min-width: 0;
  padding: 0;
  border: 0;
  margin: 0;
}
.block-form legend {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.block-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.block-form__date-field {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}
.block-form__date-field > label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}
.block-form__date-field > label span {
  color: var(--color-danger-on-strong);
}
.block-form__date-field :deep(.agenda-date-picker__trigger) {
  min-height: 44px;
}
.block-form__row > * {
  min-width: 0;
}
/* «Así queda el bloqueo»: tarjeta v2, sin filete de acento. */
.block-form__preview {
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
}
.block-form__preview p {
  font-family: var(--font-sans);
  font-size: var(--font-size-body-lg);
  line-height: 1.4;
  margin: 8px 0;
}
.block-form__preview small {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}
.block-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
/* Alta y retiro de un bloqueo: respuesta a la acción, no entrada al cargar. */
.block-record-enter-active,
.block-record-leave-active,
.block-record-move {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.block-record-enter-from,
.block-record-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
/* Escritorio con alto suficiente: el diálogo tiene alto propio y cada columna
   desplaza su lista; la cabecera, las acciones y la nota quedan fijas (no hay
   scroll general). Con poca altura las listas quedarían mínimas: ahí el diálogo
   se desplaza como un todo. */
@media (min-width: 768px) and (min-height: 800px) {
  .blocks-panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .blocks-panel__ledger {
    flex: 1 1 auto;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
  }
  .blocks-panel__ledger > section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .blocks-panel__section-head {
    flex-shrink: 0;
  }
  .blocks-panel__scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: var(--color-border-control) transparent;
  }
  .blocks-panel__note {
    flex-shrink: 0;
  }
}
@media (max-width: 767px) {
  .blocks-panel {
    padding: 20px 16px;
  }
  .blocks-panel__ledger {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .blocks-panel__actions {
    width: 100%;
    flex-wrap: wrap;
    gap: 10px;
  }
  .blocks-panel__actions :deep(.base-button) {
    flex: 1 1 auto;
  }
}
@media (max-width: 380px) {
  .block-form__row {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .blocks-panel__record {
    padding: 14px;
  }
  .blocks-panel__record-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .blocks-panel__identity {
    align-items: flex-start;
  }
  .block-form__footer :deep(.base-button) {
    flex: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .block-record-enter-active,
  .block-record-leave-active,
  .block-record-move,
  .affected-row {
    transition: none;
  }
}
</style>

<style>
/* BaseDialog se teleporta al body: este ámbito solo gobierna el panel de HU-042
   y los diálogos de series (content-class="block-dialog"). Lenguaje v2
   (DEC-188): sin reasignar tokens; campos y botones compartidos tal cual. */
/* Ayuda bajo las horas opcionales del bloqueo puntual (#507). */
.block-dialog .block-form__hint {
  margin: -10px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: 1.5;
}
.block-dialog.block-dialog--affected.base-dialog {
  width: min(100%, 600px) !important;
}
/* Diálogo «Días» (#505): un renglón por día con sus acciones. */
.block-dialog.block-dialog--days.base-dialog {
  width: min(100%, 520px) !important;
}
.days-picker {
  display: grid;
  gap: 18px;
}
.days-picker__summary {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.days-picker__week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
/* Fichas de día: contorno de control; el día elegido queda en tinta. */
.days-picker__tile {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 10px 0 8px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}
.days-picker__tile:disabled {
  opacity: 0.45;
  cursor: default;
}
.days-picker__tile--on {
  color: var(--color-text-primary);
  background: var(--color-surface);
  border-color: var(--color-border-control);
}
.days-picker__tile--on:hover {
  background: color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface));
  border-color: var(--color-text-primary);
}
.days-picker__tile--active,
.days-picker__tile--active:hover {
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-color: var(--color-text-primary);
}
.days-picker__tile:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}
.days-picker__initial {
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}
.days-picker__abbr {
  font-size: var(--font-size-caption);
}
.days-picker__detail {
  display: grid;
  gap: 6px;
  padding: 16px 18px 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}
.days-picker__day {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--color-text-primary);
}
.days-picker__meta {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
}
.days-picker__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
@media (prefers-reduced-motion: reduce) {
  .days-picker__tile {
    transition: none;
  }
}
/* `size="lg"` solo fija max-width; el ancho real se declara aquí para que los
   formularios de bloqueo respiren igual que los de Servicios. */
.block-dialog.base-dialog {
  width: min(100%, 720px) !important;
}
.block-dialog {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  box-shadow: var(--shadow-dialog);
}
.block-dialog .base-dialog__header,
.block-dialog .base-dialog__footer {
  border-color: var(--color-border-subtle);
}
.block-dialog .base-dialog__close {
  color: var(--color-text-secondary) !important;
}

.block-dialog .base-dialog__close:hover {
  background-color: color-mix(in srgb, var(--color-text-primary) 8%, transparent) !important;
  color: var(--color-text-primary) !important;
}

/* Apertura: la tarjeta se asienta con la misma curva que Servicios y Mi
   perfil (respuesta a la acción de abrir). Sin entrada escalonada de campos
   ni filete que se dibuja (v2: sin animaciones de entrada). */
.block-dialog.base-dialog--open {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}
@media (prefers-reduced-motion: reduce) {
  .block-dialog.base-dialog--open {
    transition-timing-function: var(--motion-easing-standard) !important;
  }
}
</style>
