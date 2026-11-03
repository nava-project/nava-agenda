<script setup lang="ts">
// HU-042 / DEC-105: una instancia por barbero, compuesta en app y montada
// con key=barberId. Los formularios y las peticiones conservan ese dueño.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getCivilDateInTimezone, shiftCivilDate } from '@/shared/time/civilDate'
import { useToast, useVocabulary } from '@/shared/composables'
import {
  BaseAlert,
  BaseButton,
  BaseDialog,
  BaseInput,
  BaseDatePicker,
  BaseTimePicker,
  BaseSelect,
  BarberAvatar,
  BaseSpinner,
} from '@/shared/ui'
import { RouterLink } from 'vue-router'
import { fetchBarbershopTimezone } from '../api/schedulesApi'
import {
  createTimeBlock,
  fetchAffectedAppointments,
  deleteTimeBlock,
  deleteTimeBlockSeries,
  fetchTimeBlockSeries,
  fetchTimeBlocks,
} from '../api/timeBlocksApi'
import { MAX_AFFECTED_DAYS, type AffectedAppointment } from '../model/affectedAppointments'
import { civilDateTimeToInstant, formatInstantInTimezone } from '../model/civilTime'
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

const props = defineProps<{ barberId: string; barberName: string; photoUrl?: string | null }>()
const selectedBarberId = computed(() => props.barberId)
const barbershopTimezone = ref<string | null>(null)
const timezoneLoading = ref(false)
const todayCivilDate = computed(() =>
  barbershopTimezone.value ? getCivilDateInTimezone(barbershopTimezone.value) : null,
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
const expandedGroups = ref<Set<string>>(new Set())

const toast = useToast()
const v = useVocabulary()

async function loadTimezone() {
  timezoneLoading.value = true
  const outcome = await fetchBarbershopTimezone()
  if (!alive) return
  barbershopTimezone.value = outcome.kind === 'success' ? outcome.timezone : null
  timezoneLoading.value = false
}

// HU-069 (RN-BLQ-03): turnos que quedaron bajo el último bloqueo creado. Solo informa;
// ninguno cambia hasta que el barbero lo abre y decide.
const affected = ref<{ items: AffectedAppointment[]; truncated: boolean } | null>(null)

async function showAffectedAppointments(startsAt: string, endsAt: string) {
  const barberId = selectedBarberId.value
  const timeZone = barbershopTimezone.value
  if (!barberId || !timeZone) return
  const outcome = await fetchAffectedAppointments(barberId, startsAt, endsAt, timeZone)
  // Si mientras tanto se cambió de profesional, esta respuesta ya no le corresponde.
  if (barberId !== selectedBarberId.value || outcome.kind !== 'success') return
  affected.value =
    outcome.items.length > 0 || outcome.truncated
      ? { items: outcome.items, truncated: outcome.truncated }
      : null
}

function affectedWhen(item: AffectedAppointment): string {
  const tz = barbershopTimezone.value ?? 'UTC'
  const start = formatInstantInTimezone(item.startsAt, tz)
  const end = formatInstantInTimezone(item.endsAt, tz)
  return `${displayCivilDate(start.date)}, ${start.time} a ${end.time}`
}

async function loadLists() {
  const token = ++requestToken
  affected.value = null
  blocksStatus.value = 'loading'
  seriesStatus.value = 'loading'
  const [blocksOutcome, seriesOutcome] = await Promise.all([
    fetchTimeBlocks(props.barberId),
    fetchTimeBlockSeries(props.barberId),
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
    const outcome = await fetchTimeBlocks(props.barberId, cursor)
    if (alive && token === requestToken) {
      if (outcome.kind === 'success') {
        const known = new Set(blocks.value.map((item) => item.id))
        blocks.value.push(...outcome.page.items.filter((item) => !known.has(item.id)))
        blocksCursor.value = outcome.page.nextCursor
      } else error.value = true
    }
  } else {
    const outcome = await fetchTimeBlockSeries(props.barberId, cursor)
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
const blockPreview = computed(() =>
  createStartDate.value && createEndDate.value
    ? `${displayDate(createStartDate.value)} · ${createStartTime.value || '—'} → ${displayDate(createEndDate.value)} · ${createEndTime.value || '—'}`
    : 'Elige cuándo empieza y termina este tiempo fuera.',
)

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
  if (createBlockStatus.value === 'saving' || !selectedBarberId.value) return
  createBlockError.value = undefined

  const timeZone = barbershopTimezone.value
  if (!timeZone) {
    createBlockError.value = `No pudimos determinar la zona horaria ${v.value.ofTheBusiness}. Reintenta.`
    return
  }

  const startInstantRaw = `${createStartDate.value}T${createStartTime.value}`
  const endInstantRaw = `${createEndDate.value}T${createEndTime.value}`
  if (
    !createStartDate.value ||
    !createStartTime.value ||
    !createEndDate.value ||
    !createEndTime.value
  ) {
    createBlockError.value = 'Completa fecha y hora de inicio y de fin.'
    return
  }

  let startsAt: string
  let endsAt: string
  try {
    startsAt = civilDateTimeToInstant(createStartDate.value, createStartTime.value, timeZone)
    endsAt = civilDateTimeToInstant(createEndDate.value, createEndTime.value, timeZone)
  } catch {
    createBlockError.value =
      validateInstant(startInstantRaw) ??
      validateInstant(endInstantRaw) ??
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
    selectedBarberId.value,
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
  if (!selectedBarberId.value || pendingDeleteBlockIds.value.has(block.id)) return
  pendingDeleteBlockIds.value = new Set(pendingDeleteBlockIds.value).add(block.id)

  const outcome = await deleteTimeBlock(selectedBarberId.value, block.id)
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
  if (!barbershopTimezone.value) return instant
  const { date, time } = formatInstantInTimezone(instant, barbershopTimezone.value)
  return `${displayDate(date)} · ${time}`
}

async function onDeleteSeries(item: TimeBlockSeries) {
  if (!selectedBarberId.value || pendingDeleteSeriesIds.value.has(item.id)) return
  pendingDeleteSeriesIds.value = new Set(pendingDeleteSeriesIds.value).add(item.id)

  const outcome = await deleteTimeBlockSeries(selectedBarberId.value, item.id)
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
  const barberId = selectedBarberId.value
  if (group.items.length === 1) return onDeleteSeries(group.items[0]!)
  if (!barberId) return
  const items = group.items.filter((item) => !pendingDeleteSeriesIds.value.has(item.id))
  if (items.length === 0) return
  const marked = new Set(pendingDeleteSeriesIds.value)
  for (const item of items) marked.add(item.id)
  pendingDeleteSeriesIds.value = marked

  const outcomes = await Promise.all(items.map((item) => deleteTimeBlockSeries(barberId, item.id)))
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

function groupName(group: SeriesGroup): string {
  const first = group.items[0]!
  return group.items.length > 1
    ? `${blockTypeLabel(first.blockType)} ${describeWeekdays(group.weekdays).toLowerCase()}`
    : seriesName(first)
}

function toggleGroup(key: string) {
  const next = new Set(expandedGroups.value)
  if (!next.delete(key)) next.add(key)
  expandedGroups.value = next
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
  <section class="blocks-panel" :aria-labelledby="`blocks-title-${barberId}`">
    <header class="blocks-panel__header">
      <div class="blocks-panel__identity">
        <BarberAvatar :full-name="barberName" :photo-url="photoUrl" size="row" />
        <div>
          <p class="blocks-panel__eyebrow">Disponibilidad · {{ barberName }}</p>
          <h2 :id="`blocks-title-${barberId}`">Tiempo fuera de agenda</h2>
        </div>
      </div>
      <div class="blocks-panel__actions">
        <BaseButton
          variant="primary"
          :disabled="!barbershopTimezone || blocksStatus !== 'ready'"
          @click="openCreateBlockDialog"
          >Agregar bloqueo</BaseButton
        >
        <BaseButton
          variant="secondary"
          :disabled="!barbershopTimezone || seriesStatus !== 'ready'"
          @click="isCreateDaysOpen = true"
          >Agregar bloqueo por días</BaseButton
        >
      </div>
    </header>
    <p class="blocks-panel__intro">
      Un descanso, un día libre o un imprevisto. Reserva ese tiempo para {{ barberName }}.
    </p>
    <p v-if="barbershopTimezone" class="blocks-panel__timezone">
      Horas {{ v.ofTheBusiness }} · {{ barbershopTimezone }}
    </p>
    <p v-else-if="timezoneLoading" role="status">Consultando la zona horaria…</p>
    <BaseAlert v-else variant="warning" title="No pudimos consultar la zona horaria">
      Reintenta antes de crear un bloqueo. Tus registros siguen disponibles.
      <template #action
        ><BaseButton variant="secondary" @click="loadTimezone"
          >Reintentar zona horaria</BaseButton
        ></template
      >
    </BaseAlert>

    <BaseAlert
      v-if="affected"
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
        No cambiamos ningún turno. Abre cada uno para reprogramarlo o cancelarlo.
      </p>
      <ul v-if="affected.items.length > 0" class="blocks-panel__affected-list">
        <li v-for="item in affected.items" :key="item.id">
          <RouterLink :to="{ name: 'agenda-detalle-turno', params: { appointmentId: item.id } }">
            {{ affectedWhen(item) }} · {{ item.attendeeName }} · {{ item.serviceName }}
          </RouterLink>
        </li>
      </ul>
      <p v-if="affected.truncated">
        El bloqueo abarca más de {{ MAX_AFFECTED_DAYS }} días y solo revisamos los primeros. Mira la
        agenda de los días siguientes.
      </p>
      <template #action
        ><BaseButton variant="secondary" @click="affected = null">Entendido</BaseButton></template
      >
    </BaseAlert>

    <div class="blocks-panel__ledger">
      <section aria-labelledby="single-blocks-title">
        <div class="blocks-panel__section-head">
          <span aria-hidden="true">01</span>
          <h3 id="single-blocks-title">Bloqueos puntuales</h3>
        </div>
        <div
          class="blocks-panel__scroll"
          role="region"
          aria-label="Lista de bloqueos puntuales"
          tabindex="0"
        >
          <div v-if="blocksStatus === 'loading'" class="blocks-panel__state" role="status">
            <BaseSpinner size="sm" />
            <p>Cargando bloqueos…</p>
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
              <span aria-hidden="true">◇</span>
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
                <p class="blocks-panel__interval">
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
                  }}</span
                  ><BaseButton
                    variant="secondary"
                    :aria-label="`Retirar bloqueo ${blockTypeLabel(block.blockType)} del ${displayInstant(block.startsAt)}`"
                    :loading="pendingDeleteBlockIds.has(block.id)"
                    :disabled="pendingDeleteBlockIds.has(block.id)"
                    @click="onDeleteBlock(block)"
                    >Retirar</BaseButton
                  >
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
          <span aria-hidden="true">02</span>
          <h3 id="weekly-blocks-title">Series de bloqueo</h3>
        </div>
        <div
          class="blocks-panel__scroll"
          role="region"
          aria-label="Lista de series de bloqueo"
          tabindex="0"
        >
          <div v-if="seriesStatus === 'loading'" class="blocks-panel__state" role="status">
            <BaseSpinner size="sm" />
            <p>Cargando series…</p>
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
              <span aria-hidden="true">↻</span>
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
                <p class="blocks-panel__interval">
                  <template v-if="group.items[0]!.recurrenceKind === 'weekly'"
                    >{{ describeWeekdays(group.weekdays) }} · {{ group.items[0]!.startsTime }} ·
                    {{ group.items[0]!.durationMinutes }} min</template
                  ><template v-else
                    >Lista de fechas · {{ group.items[0]!.startsTime }} ·
                    {{ group.items[0]!.durationMinutes }} min</template
                  >
                </p>
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
                      :aria-expanded="expandedGroups.has(group.key)"
                      :aria-controls="`series-days-${group.items[0]!.id}`"
                      :aria-label="`Días de la serie ${groupName(group)}`"
                      @click="toggleGroup(group.key)"
                      >{{ expandedGroups.has(group.key) ? 'Ocultar días' : 'Días' }}</BaseButton
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
                <ul
                  v-if="group.items.length > 1 && expandedGroups.has(group.key)"
                  :id="`series-days-${group.items[0]!.id}`"
                  class="blocks-panel__members"
                  :aria-label="`Días de ${groupName(group)}`"
                >
                  <li v-for="member in group.items" :key="member.id">
                    <span class="blocks-panel__member-day"
                      >{{ weekdayLabel(member.isoWeekday ?? 0)
                      }}<small v-if="seriesCounts(member)">{{ seriesCounts(member) }}</small></span
                    >
                    <div class="blocks-panel__record-actions">
                      <BaseButton
                        variant="secondary"
                        :aria-label="`Excepciones de la serie ${seriesName(member)}`"
                        @click="openInstances(member)"
                        >Excepciones</BaseButton
                      >
                      <BaseButton
                        variant="secondary"
                        :aria-label="`Retirar serie ${seriesName(member)}`"
                        :loading="pendingDeleteSeriesIds.has(member.id)"
                        :disabled="pendingDeleteSeriesIds.has(member.id)"
                        @click="onDeleteSeries(member)"
                        >Retirar</BaseButton
                      >
                    </div>
                  </li>
                </ul>
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
        :aria-label="`Bloqueo puntual para ${barberName}`"
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
              :disabled="createBlockStatus === 'saving'"
              required
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
              :disabled="createBlockStatus === 'saving'"
              required
            />
          </div>
        </fieldset>
        <BaseInput
          v-model="createBlockReason"
          type="text"
          label="Motivo (opcional)"
          :disabled="createBlockStatus === 'saving'"
        />
        <div class="block-form__preview" aria-live="polite">
          <span class="blocks-panel__eyebrow">Así queda el bloqueo</span>
          <p>{{ blockTypeLabel(createBlockType) }} · {{ blockPreview }}</p>
          <small>Horas {{ v.ofTheBusiness }} · {{ barbershopTimezone }}</small>
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

    <SeriesFormDialog
      v-model="isCreateDaysOpen"
      mode="create"
      :barber-id="barberId"
      :barber-name="barberName"
      :today="todayCivilDate"
      @created="onSeriesCreated"
    />
    <SeriesFormDialog
      v-model="isEditOpen"
      mode="edit"
      :barber-id="barberId"
      :barber-name="barberName"
      :series="editingSeries"
      :group="editingGroup"
      :today="todayCivilDate"
      @updated="onSeriesUpdated"
    />
    <SeriesInstancesDialog
      v-model="isInstancesOpen"
      :barber-id="barberId"
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

.blocks-panel {
  --color-text-primary: var(--color-on-strong);
  --color-text-secondary: var(--color-on-strong-muted);
  --color-accent-brass: var(--color-brand-accent-surface);
  color: var(--color-on-strong);
  padding: 28px;
  background: var(--color-surface-strong);
  border: 1px solid var(--color-field-strong-border);
  border-top: 2px solid var(--color-brand-accent-surface);
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
.blocks-panel h2 {
  margin: 5px 0 0;
  font-family: var(--font-display);
  font-size: clamp(24px, 3vw, 32px);
  font-weight: 400;
  line-height: 1.2;
}
.blocks-panel__eyebrow {
  margin: 0;
  color: var(--color-brand-accent-surface);
  font-family: var(--font-sans);
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.blocks-panel__intro {
  margin: 20px 0 8px;
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong-muted);
}
.blocks-panel__timezone {
  margin: 0 0 24px;
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
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
  border-bottom: 1px solid var(--color-field-strong-border);
  padding-bottom: 14px;
  margin-bottom: 16px;
}
.blocks-panel__section-head > span {
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
}
.blocks-panel h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
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
/* Ficha de bloqueo: hueco hundido sobre la tinta del diálogo con filete de latón
   a la izquierda, el mismo lenguaje de las fichas del tablero de Horarios. */
.blocks-panel__record {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  color: var(--color-on-strong);
  background: var(--color-field-strong);
  border: 1px solid var(--color-field-strong-border);
  border-left: 3px solid var(--color-brand-accent-surface);
  border-radius: 2px;
  overflow-wrap: anywhere;
}
.blocks-panel__record--past {
  background: transparent;
  color: var(--color-on-strong-muted);
  border-left-color: color-mix(in srgb, var(--color-brand-accent-surface) 40%, transparent);
}
.blocks-panel__record-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.blocks-panel__record-top strong {
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
  font-weight: 400;
  line-height: 1.2;
}
.blocks-panel__stamp {
  flex-shrink: 0;
  padding: 3px 8px;
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
  border-radius: 2px;
}
.blocks-panel__interval {
  margin: 0;
  color: var(--color-on-strong);
  font-size: var(--font-size-body);
  line-height: 1.4;
}
.blocks-panel__reason {
  margin: 0;
  color: var(--color-on-strong);
  font-size: var(--font-size-body-sm);
  line-height: 1.5;
}
.blocks-panel__validity {
  margin: 0;
  color: var(--color-on-strong-muted);
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
  border-top: 1px solid var(--color-field-strong-border);
}
.blocks-panel__record-footer > span {
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
}
.blocks-panel__record-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
/* Acciones compactas: la ficha manda, los botones acompañan. */
.blocks-panel__record :deep(.base-button) {
  min-height: 34px;
  padding-inline: 12px;
  font-size: var(--font-size-body-sm);
  color: var(--color-on-strong);
  background: transparent;
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
}
.blocks-panel__record :deep(.base-button:hover:not(:disabled):not(.base-button--loading)) {
  color: var(--color-on-strong);
  background: color-mix(in srgb, var(--color-brand-accent-surface) 14%, transparent);
  border-color: var(--color-brand-accent-surface);
}
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
  color: var(--color-on-strong-muted);
  font-family: var(--font-display);
  font-size: var(--font-size-caption);
  line-height: 1;
  border: 1px solid color-mix(in srgb, var(--color-on-strong) 14%, transparent);
  border-radius: 2px;
}
.blocks-panel__week > li.blocks-panel__week-day--on {
  color: var(--color-brand-accent-text);
  background: var(--color-brand-accent-surface);
  border-color: var(--color-brand-accent-surface);
}
.blocks-panel__members {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 10px 0 0;
  list-style: none;
  border-top: 1px dashed var(--color-field-strong-border);
}
.blocks-panel__members > li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.blocks-panel__member-day {
  display: grid;
  font-size: var(--font-size-body-sm);
}
.blocks-panel__member-day small {
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
}
.blocks-panel__affected {
  margin-bottom: var(--space-4, 1rem);
}

.blocks-panel__affected-list {
  margin: var(--space-2, 0.5rem) 0 0;
  padding-left: 1.25rem;
}

.blocks-panel__affected-list a {
  color: inherit;
  text-decoration: underline;
}

.blocks-panel__empty,
.blocks-panel__state {
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px;
  text-align: center;
  border: 1px dashed var(--color-field-strong-border);
  color: var(--color-on-strong-muted);
}
.blocks-panel__empty > span {
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-title-section);
}
.blocks-panel__empty p {
  margin: 10px 0;
  color: var(--color-on-strong);
  font-family: var(--font-display);
  font-size: var(--font-size-title-item);
}
.blocks-panel__empty small {
  font-size: var(--font-size-caption);
  line-height: 1.6;
}
.blocks-panel__note {
  margin: 24px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--color-field-strong-border);
  font-size: var(--font-size-caption);
  color: var(--color-on-strong-muted);
  line-height: 1.6;
}
.blocks-panel__actions :deep(.base-button--primary) {
  --color-action-primary-hover: var(--color-brand-accent-surface);
  --color-action-primary-active: var(--color-brand-accent-surface);
  background: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}
.blocks-panel__actions :deep(.base-button--secondary),
.blocks-panel__scroll > :deep(.base-button--secondary) {
  --color-surface-muted: var(--color-field-strong);
  --color-border-subtle: var(--color-field-strong-border);
  color: var(--color-on-strong);
  border-color: var(--color-brand-accent-surface);
  background: transparent;
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
  border-bottom: 1px solid var(--color-field-strong-border);
}
.block-form__identity strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--font-size-body-lg);
  font-weight: 400;
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
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.1em;
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
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
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
.block-form__preview {
  border-top: 2px solid var(--color-brand-accent-surface);
  background: var(--color-field-strong);
  padding: 16px 20px;
}
.block-form__preview p {
  font-family: var(--font-display);
  font-size: var(--font-size-body-lg);
  line-height: 1.4;
  margin: 8px 0;
}
.block-form__preview small {
  color: var(--color-on-strong-muted);
  font-size: var(--font-size-caption);
}
.block-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.block-record-enter-active,
.block-record-leave-active,
.block-record-move {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
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
    scrollbar-color: color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent)
      transparent;
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
  .block-record-move {
    transition: none;
  }
}
</style>

<style>
/* BaseDialog se teleporta al body: este ámbito solo gobierna el panel de HU-042. */
/* `size="lg"` solo fija max-width; el ancho real se declara aquí para que los
   formularios de bloqueo respiren igual que los de Servicios. */
.block-dialog.base-dialog {
  width: min(100%, 720px) !important;
}
.block-dialog {
  --color-text-primary: var(--color-on-strong);
  --color-text-secondary: var(--color-on-strong-muted);
  --color-accent-brass: var(--color-brand-accent-surface);
  --color-border-control: var(--color-field-strong-border);
  --color-surface: var(--color-field-strong);
  --color-focus: var(--color-brand-accent-surface);
  background: var(--color-surface-strong);
  color: var(--color-on-strong);
  border: 1px solid var(--color-field-strong-border);
  border-top: 2px solid var(--color-brand-accent-surface);
  box-shadow: var(--shadow-dialog);
}
.block-dialog .base-dialog__title {
  font-family: var(--font-display);
  font-size: var(--font-size-title-section);
  font-weight: 400;
  line-height: 1.2;
}
.block-dialog .base-dialog__header,
.block-dialog .base-dialog__footer {
  border-color: var(--color-field-strong-border);
}
.block-dialog .base-input {
  --input-bg: var(--color-field-strong);
  --input-border-color: var(--color-field-strong-border);
  --input-border-base-color: var(--color-brand-accent-surface);
  --input-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);
  color-scheme: dark;
}
.block-dialog .base-input__label {
  color: var(--color-on-strong-muted);
}
.block-dialog .base-button--primary {
  --color-action-primary-hover: var(--color-brand-accent-surface);
  --color-action-primary-active: var(--color-brand-accent-surface);
  background: var(--color-brand-accent-surface);
  border-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
}
.block-dialog .base-button--secondary {
  background: transparent;
  border-color: var(--color-brand-accent-surface);
  color: var(--color-on-strong);
}
/* El hover/active base del botón secundario usa superficies claras: sobre la
   tinta del diálogo dejaban texto claro sobre fondo claro (contraste 1,13). */
.block-dialog .base-button--secondary:hover:not(:disabled):not(.base-button--loading),
.block-dialog .base-button--secondary:active:not(:disabled):not(.base-button--loading) {
  background: var(--color-field-strong);
  border-color: var(--color-brand-accent-surface);
}
.block-dialog .base-dialog__close {
  color: var(--color-on-strong);
}

/* Entrada: la tarjeta rebota al asentarse (misma curva que Servicios y Mi
   perfil) y los campos del formulario llegan escalonados, de arriba abajo, un
   instante después. El resumen traza su filete dorado de izquierda a derecha. */
.block-dialog.base-dialog--open {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}
.block-dialog .block-form > * {
  animation: block-dialog-field-enter 360ms var(--motion-easing-standard) backwards;
  animation-delay: calc(140ms + var(--field-index, 0) * 55ms);
}
/* `backwards` (no `both`): al terminar la entrada el campo vuelve a su estado
   natural y no deja un contexto de apilamiento; con `both` el transform final
   atrapaba la lista de BaseSelect y los campos siguientes se pintaban encima. */
.block-dialog .block-form > :focus-within {
  position: relative;
  z-index: 2;
}
.block-dialog .block-form > :nth-child(1) {
  --field-index: 0;
}
.block-dialog .block-form > :nth-child(2) {
  --field-index: 1;
}
.block-dialog .block-form > :nth-child(3) {
  --field-index: 2;
}
.block-dialog .block-form > :nth-child(4) {
  --field-index: 3;
}
.block-dialog .block-form > :nth-child(5) {
  --field-index: 4;
}
.block-dialog .block-form > :nth-child(6) {
  --field-index: 5;
}
.block-dialog .block-form > :nth-child(n + 7) {
  --field-index: 6;
}
.block-dialog .block-form__preview,
.block-dialog .block-form__summary {
  position: relative;
  border-top-color: transparent;
}
.block-dialog .block-form__preview::before,
.block-dialog .block-form__summary::before {
  content: '';
  position: absolute;
  inset: -2px 0 auto;
  height: 2px;
  background: var(--color-brand-accent-surface);
  transform-origin: left;
  animation: block-dialog-rule-draw 520ms var(--motion-easing-standard) 420ms both;
}
@keyframes block-dialog-field-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes block-dialog-rule-draw {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .block-dialog.base-dialog--open {
    transition-timing-function: var(--motion-easing-standard) !important;
  }
  .block-dialog .block-form > *,
  .block-dialog .block-form__preview::before,
  .block-dialog .block-form__summary::before {
    animation: none;
  }
}
</style>
