<script setup lang="ts">
// «Ventana por barbero» (DEC-169): cada barbero puede tener su propia
// anticipación mínima, ventana máxima y rejilla —cada cuánto ofrece una
// franja—. Sin ventana propia hereda la de la barbería, incluidos sus cambios
// futuros. El panel carga y guarda por su cuenta (PUT/DELETE por barbero, sin
// If-Match); vive dentro del formulario de la página, así que nunca envía ese
// formulario: sus botones son `type="button"` y Enter en sus campos guarda
// solo la ventana del barbero.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useToast, useVocabulary } from '@/shared/composables'
import { BarberSelect, BaseAlert, BaseButton, BaseInput, DiamondLoader } from '@/shared/ui'
import {
  fetchBarberWindows,
  removeBarberWindow,
  saveBarberWindow,
} from '../api/barberBookingPolicyApi'
import {
  BARBER_WINDOW_MAX_DAYS,
  sameWindow,
  type BarberBookingWindow,
  type BarberWindowOption,
  type BookingWindowValues,
} from '../model/barberBookingPolicy'
import { formatDuration, sampleSlotLabels } from '../model/bookingPolicy'
import {
  SLOT_GRID_MINUTES_CEIL,
  validateMinAdvanceMinutes,
  validateSlotGridMinutes,
} from '../validation/bookingPolicyValidation'
import SettingsPanel from './SettingsPanel.vue'
import SwitchField from './SwitchField.vue'

const props = defineProps<{
  /** La ventana de la barbería confirmada por el servidor: la que hereda quien no tiene propia. */
  shopWindow: BookingWindowValues
}>()

type LoadStatus = 'loading' | 'ready' | 'load-error'
type ActionStatus =
  'idle' | 'saving' | 'validation-error' | 'not-found' | 'network-error' | 'unexpected-error'

const v = useVocabulary()
const toast = useToast()

const loadStatus = ref<LoadStatus>('loading')
const actionStatus = ref<ActionStatus>('idle')
const barbers = ref<BarberWindowOption[]>([])
const windows = ref<Map<string, BarberBookingWindow>>(new Map())
const selectedId = ref<string | null>(null)

// Borrador del barbero elegido: si quiere ventana propia y con qué valores.
const ownDraft = ref(false)
const draft = reactive<BookingWindowValues>({ ...props.shopWindow })
type FieldErrors = Partial<Record<keyof BookingWindowValues, string>>
const fieldErrors = ref<FieldErrors>({})
const attempted = ref(false)

let requestToken = 0

async function load() {
  const token = ++requestToken
  loadStatus.value = 'loading'
  const outcome = await fetchBarberWindows()
  if (token !== requestToken) return
  if (outcome.kind !== 'success') {
    loadStatus.value = 'load-error'
    return
  }
  barbers.value = outcome.barbers
  windows.value = new Map(outcome.windows.map((w) => [w.barberId, w]))
  const stillThere = barbers.value.some((b) => b.id === selectedId.value)
  selectBarber(stillThere && selectedId.value ? selectedId.value : (barbers.value[0]?.id ?? null))
  loadStatus.value = 'ready'
}

onMounted(load)

const selected = computed(() => barbers.value.find((b) => b.id === selectedId.value) ?? null)
const savedOwn = computed(() =>
  selectedId.value ? windows.value.get(selectedId.value) : undefined,
)
const ownCount = computed(() => barbers.value.filter((b) => windows.value.has(b.id)).length)

function resetDraft() {
  const own = savedOwn.value
  ownDraft.value = own !== undefined
  Object.assign(draft, own ? pickWindow(own) : props.shopWindow)
  if (ownDraft.value) draft.maxAdvanceDays = BARBER_WINDOW_MAX_DAYS
  fieldErrors.value = {}
  attempted.value = false
}

function selectBarber(id: string | null) {
  selectedId.value = id
  if (actionStatus.value !== 'saving') actionStatus.value = 'idle'
  resetDraft()
}

// Mientras el barbero hereda, el borrador sigue a la barbería: si se guarda
// otra ventana de la barbería, lo que se muestra como heredado cambia con ella.
watch(
  () => props.shopWindow,
  (shop) => {
    if (!ownDraft.value) Object.assign(draft, shop)
  },
  { deep: true },
)

function pickWindow(w: BookingWindowValues): BookingWindowValues {
  return {
    minAdvanceMinutes: w.minAdvanceMinutes,
    maxAdvanceDays: w.maxAdvanceDays,
    slotGridMinutes: w.slotGridMinutes,
  }
}

function onOwnToggle(value: boolean) {
  ownDraft.value = value
  // Al activar parte de lo vigente (la propia guardada o la de la barbería);
  // al apagar, lo que se ve es exactamente lo que heredaría.
  Object.assign(draft, value && savedOwn.value ? pickWindow(savedOwn.value) : props.shopWindow)
  // DEC-172: la ventana propia no tiene tope de días elegido; dura hasta apagarla.
  if (value) draft.maxAdvanceDays = BARBER_WINDOW_MAX_DAYS
  fieldErrors.value = {}
  attempted.value = false
  if (actionStatus.value !== 'saving') actionStatus.value = 'idle'
}

function validate(): FieldErrors {
  const errors: FieldErrors = {}
  const minError = validateMinAdvanceMinutes(draft.minAdvanceMinutes)
  if (minError) errors.minAdvanceMinutes = minError
  const gridError = validateSlotGridMinutes(draft.slotGridMinutes)
  if (gridError) errors.slotGridMinutes = gridError
  // Sin campo de días (DEC-172): la anticipación máxima (24 h) nunca alcanza la
  // ventana propia de 90 días, así que no hay coherencia que comprobar.
  return errors
}

function onField(field: keyof BookingWindowValues, value: string | number) {
  const n = Number(value)
  draft[field] = field === 'slotGridMinutes' ? Math.min(n, SLOT_GRID_MINUTES_CEIL) : n
  if (attempted.value) fieldErrors.value = validate()
}

function capGridField(event: Event) {
  const input = event.target
  if (input instanceof HTMLInputElement && Number(input.value) > SLOT_GRID_MINUTES_CEIL) {
    input.value = String(SLOT_GRID_MINUTES_CEIL)
  }
}

/** Qué cambiaría al confirmar: guardar una ventana propia, volver a heredar o nada. */
const pendingAction = computed<'save' | 'inherit' | null>(() => {
  if (!selected.value) return null
  if (ownDraft.value) {
    return savedOwn.value && sameWindow(draft, savedOwn.value) ? null : 'save'
  }
  return savedOwn.value ? 'inherit' : null
})

const busy = computed(() => actionStatus.value === 'saving')

async function onConfirm() {
  const barber = selected.value
  if (!barber || busy.value || pendingAction.value === null) return

  if (pendingAction.value === 'save') {
    attempted.value = true
    const errors = validate()
    fieldErrors.value = errors
    if (Object.keys(errors).length > 0) return
  }

  actionStatus.value = 'saving'
  if (pendingAction.value === 'save') {
    const outcome = await saveBarberWindow(barber.id, pickWindow(draft))
    if (outcome.kind === 'success') {
      windows.value = new Map(windows.value).set(barber.id, outcome.window)
      actionStatus.value = 'idle'
      resetDraft()
      toast.success(`Ventana de ${barber.fullName} guardada`, {
        detail: `Sus horarios se ofrecen cada ${outcome.window.slotGridMinutes} min desde ya.`,
      })
      return
    }
    actionStatus.value = outcome.kind
    return
  }

  const outcome = await removeBarberWindow(barber.id)
  if (outcome.kind === 'success') {
    const next = new Map(windows.value)
    next.delete(barber.id)
    windows.value = next
    actionStatus.value = 'idle'
    resetDraft()
    toast.success(`${barber.fullName} usa la ventana de ${v.value.thisBusiness}`, {
      detail: 'Seguirá los cambios que hagas arriba.',
    })
    return
  }
  actionStatus.value = outcome.kind
}

function onDiscard() {
  if (busy.value) return
  actionStatus.value = 'idle'
  resetDraft()
}

// Enter en un campo del panel guarda la ventana del barbero, nunca el
// formulario de la barbería que lo contiene.
function onEnter(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement) {
    event.preventDefault()
    void onConfirm()
  }
}

const shownWindow = computed<BookingWindowValues>(() => (ownDraft.value ? draft : props.shopWindow))
const slots = computed(() => sampleSlotLabels(shownWindow.value.slotGridMinutes, 7))

function summaryOf(w: BookingWindowValues): string {
  const lead = w.minAdvanceMinutes > 0 ? formatDuration(w.minAdvanceMinutes) : 'sin mínimo'
  return `Cada ${w.slotGridMinutes} min · anticipación ${lead} · sin límite de días`
}

const ownRoster = computed(() =>
  barbers.value.flatMap((b) => {
    const own = windows.value.get(b.id)
    return own ? [{ ...b, grid: own.slotGridMinutes, summary: summaryOf(own) }] : []
  }),
)
</script>

<template>
  <SettingsPanel
    id="reserva-por-profesional"
    number="02"
    :title="`Ventana por ${v.professional}`"
    :description="`Cada ${v.professional} tiene su ritmo: elige cada cuánto ofrece una franja y con cuánta anticipación recibe reservas. Sin ventana propia, usa la de ${v.thisBusiness}.`"
    scope="shop"
    :scope-label="`Por ${v.professional}`"
    style="--panel-index: 1"
  >
    <div class="barber-window" @keydown.enter="onEnter">
      <div
        v-if="loadStatus === 'loading'"
        class="barber-window__state"
        role="status"
        aria-live="polite"
      >
        <DiamondLoader
          :label="`Cargando ${v.theProfessionals}…`"
          layout="inline"
          :phrases="['Leyendo cada ritmo', 'Afinando las franjas']"
        />
      </div>

      <BaseAlert
        v-else-if="loadStatus === 'load-error'"
        variant="warning"
        :title="`No pudimos cargar ${v.theProfessionals}`"
        role="alert"
      >
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton variant="secondary" type="button" @click="load">Reintentar</BaseButton>
        </template>
      </BaseAlert>

      <p v-else-if="barbers.length === 0" class="barber-window__empty">
        Aún no tienes {{ v.professionalsRegistered }}. Cuando agregues {{ v.oneProfessional }},
        podrás darle su propia ventana aquí.
      </p>

      <div v-else class="barber-window__body">
        <div class="barber-window__pick">
          <div class="barber-window__select">
            <label for="barber-window-select" class="barber-window__label">{{
              v.Professional
            }}</label>
            <BarberSelect
              :model-value="selectedId"
              :barbers="barbers"
              trigger-id="barber-window-select"
              :disabled="busy"
              @update:model-value="selectBarber"
            />
          </div>
          <p class="barber-window__count">
            <span class="barber-window__count-number">{{ ownCount }}</span>
            de {{ barbers.length }} con ventana propia
          </p>
        </div>

        <Transition name="barber-window-swap" mode="out-in">
          <div v-if="selected" :key="selected.id" class="barber-window__card">
            <div class="barber-window__status" :class="{ 'barber-window__status--own': savedOwn }">
              <span class="barber-window__status-mark" aria-hidden="true" />
              <span>{{
                savedOwn ? 'Tiene ventana propia' : `Usa la ventana de ${v.thisBusiness}`
              }}</span>
            </div>

            <SwitchField
              :model-value="ownDraft"
              :label="`Ventana propia para ${selected.fullName}`"
              :hint="`Apagada, sigue la de ${v.thisBusiness} y sus cambios futuros.`"
              :disabled="busy"
              @update:model-value="onOwnToggle"
            />

            <Transition name="barber-window-fields" mode="out-in">
              <div v-if="ownDraft" key="own" class="barber-window__grid">
                <BaseInput
                  :model-value="draft.minAdvanceMinutes"
                  type="number"
                  name="barberMinAdvanceMinutes"
                  label="Anticipación (min)"
                  hint="Mínima. 0 la desactiva."
                  required
                  :show-required-marker="false"
                  :min="0"
                  :max="1440"
                  :disabled="busy"
                  :error="fieldErrors.minAdvanceMinutes"
                  @update:model-value="(value) => onField('minAdvanceMinutes', value)"
                />
                <BaseInput
                  :model-value="draft.slotGridMinutes"
                  type="number"
                  name="barberSlotGridMinutes"
                  label="Franja cada (min)"
                  hint="Su rejilla: de 1 a 60."
                  required
                  :show-required-marker="false"
                  :min="1"
                  :max="60"
                  :disabled="busy"
                  :error="fieldErrors.slotGridMinutes"
                  @update:model-value="(value) => onField('slotGridMinutes', value)"
                  @input="capGridField"
                />
                <!-- DEC-172: sin tope de días que elegir; la ventana dura hasta apagarla. -->
                <p class="barber-window__no-limit">
                  Sin límite de días: los clientes reservan con {{ selected.fullName }} tan adelante
                  como permite el sistema (3 meses), hasta que apagues la ventana propia.
                </p>
              </div>
              <dl v-else key="inherit" class="barber-window__inherited">
                <div>
                  <dt>Anticipación</dt>
                  <dd>
                    {{
                      shopWindow.minAdvanceMinutes > 0
                        ? formatDuration(shopWindow.minAdvanceMinutes)
                        : 'Sin mínimo'
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Ventana</dt>
                  <dd>
                    {{ shopWindow.maxAdvanceDays }}
                    {{ shopWindow.maxAdvanceDays === 1 ? 'día' : 'días' }}
                  </dd>
                </div>
                <div>
                  <dt>Franjas</dt>
                  <dd>Cada {{ shopWindow.slotGridMinutes }} min</dd>
                </div>
              </dl>
            </Transition>

            <div class="barber-window__strip">
              <p class="barber-window__strip-label">Así ve el cliente sus horarios de una mañana</p>
              <ol
                :key="shownWindow.slotGridMinutes"
                class="barber-window__slots"
                :aria-label="`Franjas de ejemplo cada ${shownWindow.slotGridMinutes} minutos`"
              >
                <li
                  v-for="(slot, index) in slots"
                  :key="slot"
                  class="barber-window__slot"
                  :style="{ '--i': index }"
                >
                  {{ slot }}
                </li>
              </ol>
            </div>

            <BaseAlert
              v-if="actionStatus === 'validation-error'"
              variant="danger"
              title="No pudimos guardar la ventana"
              role="alert"
            >
              Revisa los valores: cada campo tiene un rango permitido.
            </BaseAlert>
            <BaseAlert
              v-else-if="actionStatus === 'not-found'"
              variant="warning"
              :title="`${v.TheProfessional} ya no está disponible`"
              role="alert"
            >
              Puede que se haya retirado en otra pestaña.
              <template #action>
                <BaseButton variant="secondary" type="button" @click="load">Recargar</BaseButton>
              </template>
            </BaseAlert>
            <BaseAlert
              v-else-if="actionStatus === 'network-error'"
              variant="warning"
              title="No pudimos conectar"
              role="alert"
            >
              Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.
            </BaseAlert>
            <BaseAlert
              v-else-if="actionStatus === 'unexpected-error'"
              variant="danger"
              title="Ocurrió un error inesperado"
              role="alert"
            >
              Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.
            </BaseAlert>

            <Transition name="barber-window-actions">
              <div v-if="pendingAction" class="barber-window__actions">
                <BaseButton variant="secondary" type="button" :disabled="busy" @click="onDiscard"
                  >Descartar</BaseButton
                >
                <!-- Texto corto para que quepa a 320 px; el nombre del barbero
                     lo completa el nombre accesible. -->
                <BaseButton
                  type="button"
                  :loading="busy"
                  :aria-label="
                    pendingAction === 'save'
                      ? `Guardar ventana de ${selected.fullName}`
                      : `${selected.fullName} usará la ventana de ${v.thisBusiness}`
                  "
                  @click="onConfirm"
                  >{{
                    pendingAction === 'save' ? 'Guardar ventana' : `Usar la de ${v.thisBusiness}`
                  }}</BaseButton
                >
              </div>
            </Transition>
          </div>
        </Transition>

        <div v-if="ownRoster.length > 0" class="barber-window__roster">
          <p class="barber-window__roster-label">Con ventana propia</p>
          <ul class="barber-window__roster-list">
            <li v-for="item in ownRoster" :key="item.id">
              <button
                type="button"
                class="barber-window__chip"
                :class="{ 'barber-window__chip--active': item.id === selectedId }"
                :aria-pressed="item.id === selectedId"
                :title="item.summary"
                :disabled="busy"
                @click="selectBarber(item.id)"
              >
                <span class="barber-window__chip-name">{{ item.fullName }}</span>
                <span class="barber-window__chip-grid">cada {{ item.grid }} min</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </SettingsPanel>
</template>

<style scoped>
.barber-window {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.barber-window__state {
  color: var(--color-on-strong-muted);
}

.barber-window__empty {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

.barber-window__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

/* Selector a la izquierda, contador a la derecha, alineados por la base. */
.barber-window__pick {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 20px;
}

.barber-window__select {
  display: flex;
  flex: 1 1 260px;
  flex-direction: column;
  gap: 8px;
  max-width: 380px;
  min-width: 0;
}

.barber-window__label,
.barber-window__strip-label,
.barber-window__roster-label {
  margin: 0;
  color: var(--color-brand-accent-surface);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 14px;
  text-transform: uppercase;
}

.barber-window__count {
  margin: 0;
  padding-bottom: 12px;
  font-size: var(--font-size-caption);
  line-height: 18px;
  color: var(--color-on-strong-muted);
}

.barber-window__count-number {
  font-family: var(--font-display);
  font-size: 20px;
  color: var(--color-brand-accent-surface);
  font-variant-numeric: tabular-nums;
}

/* La ficha del barbero elegido: una hoja reglada dentro del panel. */
.barber-window__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 18px;
  background: color-mix(in srgb, var(--color-on-strong) 3%, transparent);
  border: var(--border-width-normal) solid var(--color-field-strong-border);
  border-left: 3px solid color-mix(in srgb, var(--color-brand-accent-surface) 55%, transparent);
  border-radius: 3px;
}

.barber-window__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-on-strong-muted);
}

.barber-window__status-mark {
  width: 7px;
  height: 7px;
  border: var(--border-width-normal) solid currentColor;
  transform: rotate(45deg);
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    color var(--motion-duration-base) var(--motion-easing-standard);
}

.barber-window__status--own {
  color: var(--color-brand-accent-surface);
}

.barber-window__status--own .barber-window__status-mark {
  background: currentColor;
}

.barber-window__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.barber-window__no-limit {
  grid-column: 1 / -1;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-on-strong-muted);
}

/* Lo heredado se lee, no se edita: tres cifras sobre una regla fina. */
.barber-window__inherited {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  border-top: var(--border-width-normal) dashed var(--color-field-strong-border);
  border-bottom: var(--border-width-normal) dashed var(--color-field-strong-border);
}

.barber-window__inherited > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
}

.barber-window__inherited > div + div {
  border-left: var(--border-width-normal) dashed var(--color-field-strong-border);
}

.barber-window__inherited dt {
  font-size: var(--font-size-caption);
  line-height: 16px;
  color: var(--color-on-strong-muted);
}

.barber-window__inherited dd {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 24px;
  color: var(--color-on-strong);
}

.barber-window__strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.barber-window__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.barber-window__slot {
  padding: 6px 10px;
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  color: var(--color-on-strong);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-brand-accent-surface) 40%, transparent);
  border-radius: 2px;
  animation: barber-window-slot 320ms var(--motion-easing-standard) backwards;
  animation-delay: calc(var(--i) * 40ms);
}

.barber-window__slot:first-child {
  color: var(--color-brand-accent-text);
  background: var(--color-brand-accent-surface);
  border-color: var(--color-brand-accent-surface);
}

.barber-window__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 14px;
  border-top: var(--border-width-normal) solid var(--color-field-strong-border);
}

.barber-window__roster {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.barber-window__roster-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.barber-window__chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  max-width: 100%;
  min-height: 36px;
  padding: 8px 12px;
  font: inherit;
  font-size: var(--font-size-caption);
  color: var(--color-on-strong);
  cursor: pointer;
  background: transparent;
  border: var(--border-width-normal) solid var(--color-field-strong-border);
  border-radius: 2px;
  transition:
    border-color var(--motion-duration-base) var(--motion-easing-standard),
    background-color var(--motion-duration-base) var(--motion-easing-standard);
}

.barber-window__chip:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 60%, transparent);
}

.barber-window__chip:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface-strong),
    0 0 0 4px var(--color-focus);
}

.barber-window__chip--active {
  background: color-mix(in srgb, var(--color-brand-accent-surface) 14%, transparent);
  border-color: var(--color-brand-accent-surface);
}

.barber-window__chip-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.barber-window__chip-grid {
  flex: 0 0 auto;
  color: var(--color-brand-accent-surface);
}

/* Campos reglados: mismo tratamiento que el resto de la página. */
.barber-window :deep(.base-input) {
  --input-bg: color-mix(in srgb, var(--color-on-strong) 4%, transparent);
  --input-border-color: color-mix(in srgb, var(--color-on-strong) 12%, transparent);
  --input-border-base-color: color-mix(in srgb, var(--color-on-strong) 30%, transparent);
  --input-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);

  height: 44px;
  color: var(--color-on-strong);
}

.barber-window :deep(.base-input__label) {
  color: var(--color-brand-accent-surface);
}

.barber-window :deep(.base-input__hint) {
  color: var(--color-on-strong-muted);
}

.barber-window :deep(.base-input--invalid) {
  background-color: color-mix(in srgb, var(--color-danger-on-strong) 7%, transparent);
  border-bottom-color: var(--color-danger-on-strong);
}

.barber-window :deep(.base-input__error) {
  color: var(--color-danger-on-strong);
}

/* Botones: los mismos de la barra de guardado (SaveBar), con el acento de la
   marca, para que «guardar» se lea igual en toda la pantalla. */
.barber-window__actions :deep(.base-button) {
  --btn-focus-ring: 0 0 0 2px var(--color-surface-strong), 0 0 0 4px var(--color-focus);

  height: 40px;
  padding-inline: 18px;
}

.barber-window__actions :deep(.base-button--primary) {
  background-color: var(--color-brand-accent-surface);
  color: var(--color-brand-accent-text);
  border-color: var(--color-brand-accent-surface);
}

.barber-window__actions
  :deep(.base-button--primary:hover:not(:disabled):not(.base-button--loading)) {
  filter: brightness(92%);
}

.barber-window__actions :deep(.base-button--secondary) {
  background-color: transparent;
  color: var(--color-brand-accent-surface);
  border-color: color-mix(in srgb, var(--color-brand-accent-surface) 50%, transparent);
  border-bottom-color: var(--color-brand-accent-surface);
}

.barber-window__actions
  :deep(.base-button--secondary:hover:not(:disabled):not(.base-button--loading)) {
  background-color: color-mix(in srgb, var(--color-brand-accent-surface) 12%, transparent);
}

/* Cambio de barbero: la ficha sale y entra con un desliz corto. */
.barber-window-swap-enter-active,
.barber-window-swap-leave-active {
  transition:
    opacity 180ms var(--motion-easing-standard),
    transform 180ms var(--motion-easing-standard);
}

.barber-window-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.barber-window-swap-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.barber-window-fields-enter-active,
.barber-window-fields-leave-active {
  transition: opacity 160ms var(--motion-easing-standard);
}

.barber-window-fields-enter-from,
.barber-window-fields-leave-to {
  opacity: 0;
}

.barber-window-actions-enter-active {
  transition:
    opacity 200ms var(--motion-easing-standard),
    transform 200ms var(--motion-easing-standard);
}

.barber-window-actions-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@keyframes barber-window-slot {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (max-width: 760px) {
  .barber-window__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 480px) {
  .barber-window__card {
    padding: 14px;
  }

  .barber-window__inherited {
    grid-template-columns: minmax(0, 1fr);
  }

  .barber-window__inherited > div + div {
    border-top: var(--border-width-normal) dashed var(--color-field-strong-border);
    border-left: 0;
  }

  .barber-window__count {
    padding-bottom: 0;
  }

  /* El rótulo del interruptor ocupa todo el ancho y el control baja debajo. */
  .barber-window :deep(.switch-field) {
    flex-wrap: wrap;
  }

  .barber-window :deep(.switch-field__copy) {
    flex: 1 1 100%;
  }

  .barber-window__actions :deep(.base-button) {
    flex: 1 1 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .barber-window__slot {
    animation: none;
  }

  .barber-window-swap-enter-active,
  .barber-window-swap-leave-active,
  .barber-window-fields-enter-active,
  .barber-window-fields-leave-active,
  .barber-window-actions-enter-active {
    transition: none;
  }
}

:root[data-motion='reduced'] .barber-window__slot {
  animation: none;
}
</style>
