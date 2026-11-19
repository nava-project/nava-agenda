<script setup lang="ts">
// «Ventana por profesional» (DEC-169): cada profesional puede tener su propia
// anticipación mínima, ventana máxima y rejilla —cada cuánto ofrece una
// franja—. Sin ventana propia hereda la del negocio, incluidos sus cambios
// futuros. El panel carga y guarda por su cuenta (PUT/DELETE por profesional, sin
// If-Match); vive dentro del formulario de la página, así que nunca envía ese
// formulario: sus botones son `type="button"` y Enter en sus campos guarda
// solo la ventana del profesional.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useToast, useVocabulary } from '@/shared/composables'
import { ProfessionalSelect, BaseAlert, BaseButton, BaseInput, DiamondLoader } from '@/shared/ui'
import {
  fetchProfessionalWindows,
  removeProfessionalWindow,
  saveProfessionalWindow,
} from '../api/professionalBookingPolicyApi'
import {
  PROFESSIONAL_WINDOW_MAX_DAYS,
  sameWindow,
  type ProfessionalBookingWindow,
  type ProfessionalWindowOption,
  type BookingWindowValues,
} from '../model/professionalBookingPolicy'
import { formatDuration, sampleSlotLabels } from '../model/bookingPolicy'
import {
  SLOT_GRID_MINUTES_CEIL,
  validateMinAdvanceMinutes,
  validateSlotGridMinutes,
} from '../validation/bookingPolicyValidation'
import SettingsPanel from './SettingsPanel.vue'
import SwitchField from './SwitchField.vue'

const props = defineProps<{
  /** La ventana del negocio confirmado por el servidor: la que hereda quien no tiene propia. */
  shopWindow: BookingWindowValues
  /** Panel del empleado (DEC-173): solo su profesional, sin selector ni recuento del equipo. */
  ownOnly?: boolean
}>()

type LoadStatus = 'loading' | 'ready' | 'load-error'
type ActionStatus =
  'idle' | 'saving' | 'validation-error' | 'not-found' | 'network-error' | 'unexpected-error'

const v = useVocabulary()
const toast = useToast()

const loadStatus = ref<LoadStatus>('loading')
const actionStatus = ref<ActionStatus>('idle')
const professionals = ref<ProfessionalWindowOption[]>([])
const windows = ref<Map<string, ProfessionalBookingWindow>>(new Map())
const selectedId = ref<string | null>(null)

// Borrador del profesional elegido: si quiere ventana propia y con qué valores.
const ownDraft = ref(false)
const draft = reactive<BookingWindowValues>({ ...props.shopWindow })
type FieldErrors = Partial<Record<keyof BookingWindowValues, string>>
const fieldErrors = ref<FieldErrors>({})
const attempted = ref(false)

let requestToken = 0

async function load() {
  const token = ++requestToken
  loadStatus.value = 'loading'
  const outcome = await fetchProfessionalWindows()
  if (token !== requestToken) return
  if (outcome.kind !== 'success') {
    loadStatus.value = 'load-error'
    return
  }
  professionals.value = outcome.professionals
  windows.value = new Map(outcome.windows.map((w) => [w.professionalId, w]))
  const stillThere = professionals.value.some((b) => b.id === selectedId.value)
  selectProfessional(
    stillThere && selectedId.value ? selectedId.value : (professionals.value[0]?.id ?? null),
  )
  loadStatus.value = 'ready'
}

onMounted(load)

const selected = computed(() => professionals.value.find((b) => b.id === selectedId.value) ?? null)
const savedOwn = computed(() =>
  selectedId.value ? windows.value.get(selectedId.value) : undefined,
)
const ownCount = computed(() => professionals.value.filter((b) => windows.value.has(b.id)).length)

function resetDraft() {
  const own = savedOwn.value
  ownDraft.value = own !== undefined
  Object.assign(draft, own ? pickWindow(own) : props.shopWindow)
  if (ownDraft.value) draft.maxAdvanceDays = PROFESSIONAL_WINDOW_MAX_DAYS
  fieldErrors.value = {}
  attempted.value = false
}

function selectProfessional(id: string | null) {
  selectedId.value = id
  if (actionStatus.value !== 'saving') actionStatus.value = 'idle'
  resetDraft()
}

// Mientras el profesional hereda, el borrador sigue al negocio: si se guarda
// otra ventana del negocio, lo que se muestra como heredado cambia con ella.
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
  // Al activar parte de lo vigente (la propia guardada o la del negocio);
  // al apagar, lo que se ve es exactamente lo que heredaría.
  Object.assign(draft, value && savedOwn.value ? pickWindow(savedOwn.value) : props.shopWindow)
  // DEC-172: la ventana propia no tiene tope de días elegido; dura hasta apagarla.
  if (value) draft.maxAdvanceDays = PROFESSIONAL_WINDOW_MAX_DAYS
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
  const professional = selected.value
  if (!professional || busy.value || pendingAction.value === null) return

  if (pendingAction.value === 'save') {
    attempted.value = true
    const errors = validate()
    fieldErrors.value = errors
    if (Object.keys(errors).length > 0) return
  }

  actionStatus.value = 'saving'
  if (pendingAction.value === 'save') {
    const outcome = await saveProfessionalWindow(professional.id, pickWindow(draft))
    if (outcome.kind === 'success') {
      windows.value = new Map(windows.value).set(professional.id, outcome.window)
      actionStatus.value = 'idle'
      resetDraft()
      toast.success(`Ventana de ${professional.fullName} guardada`, {
        detail: `Sus horarios se ofrecen cada ${outcome.window.slotGridMinutes} min desde ya.`,
      })
      return
    }
    actionStatus.value = outcome.kind
    return
  }

  const outcome = await removeProfessionalWindow(professional.id)
  if (outcome.kind === 'success') {
    const next = new Map(windows.value)
    next.delete(professional.id)
    windows.value = next
    actionStatus.value = 'idle'
    resetDraft()
    toast.success(`${professional.fullName} usa la ventana de ${v.value.thisBusiness}`, {
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

// Enter en un campo del panel guarda la ventana del profesional, nunca el
// formulario del negocio que lo contiene.
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
  professionals.value.flatMap((b) => {
    const own = windows.value.get(b.id)
    return own ? [{ ...b, grid: own.slotGridMinutes, summary: summaryOf(own) }] : []
  }),
)
</script>

<template>
  <SettingsPanel
    id="reserva-por-profesional"
    :number="ownOnly ? '01' : '02'"
    :title="ownOnly ? 'Tu ventana de reserva' : `Ventana por ${v.professional}`"
    :description="
      ownOnly
        ? `Elige cada cuánto ofreces una franja y con cuánta anticipación recibes reservas. Sin ventana propia, usas la de ${v.thisBusiness}.`
        : `Cada ${v.professional} tiene su ritmo: elige cada cuánto ofrece una franja y con cuánta anticipación recibe reservas. Sin ventana propia, usa la de ${v.thisBusiness}.`
    "
    scope="shop"
    :scope-label="ownOnly ? 'Solo tú' : `Por ${v.professional}`"
  >
    <div class="professional-window" @keydown.enter="onEnter">
      <div
        v-if="loadStatus === 'loading'"
        class="professional-window__state"
        role="status"
        aria-live="polite"
      >
        <DiamondLoader :label="`Cargando ${v.theProfessionals}…`" layout="inline" />
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

      <p v-else-if="professionals.length === 0 && ownOnly" class="professional-window__empty">
        Tu cuenta aún no tiene un perfil. Pídele {{ v.toTheBusiness }} que vincule tu usuario con tu
        perfil de {{ v.professional }}.
      </p>

      <p v-else-if="professionals.length === 0" class="professional-window__empty">
        Aún no tienes {{ v.professionalsRegistered }}. Cuando agregues {{ v.oneProfessional }},
        podrás darle su propia ventana aquí.
      </p>

      <div v-else class="professional-window__body">
        <div v-if="!ownOnly" class="professional-window__pick">
          <div class="professional-window__select">
            <label for="professional-window-select" class="professional-window__label">{{
              v.Professional
            }}</label>
            <ProfessionalSelect
              :model-value="selectedId"
              :professionals="professionals"
              trigger-id="professional-window-select"
              :disabled="busy"
              @update:model-value="selectProfessional"
            />
          </div>
          <p class="professional-window__count">
            <span class="professional-window__count-number">{{ ownCount }}</span>
            de {{ professionals.length }} con ventana propia
          </p>
        </div>

        <Transition name="professional-window-swap" mode="out-in">
          <div v-if="selected" :key="selected.id" class="professional-window__card">
            <div
              class="professional-window__status"
              :class="{ 'professional-window__status--own': savedOwn }"
            >
              <span class="professional-window__status-mark" aria-hidden="true" />
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

            <Transition name="professional-window-fields" mode="out-in">
              <div v-if="ownDraft" key="own" class="professional-window__grid">
                <BaseInput
                  :model-value="draft.minAdvanceMinutes"
                  type="number"
                  name="professionalMinAdvanceMinutes"
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
                  name="professionalSlotGridMinutes"
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
                <p class="professional-window__no-limit">
                  Sin límite de días: los clientes reservan con {{ selected.fullName }} tan adelante
                  como permite el sistema (3 meses), hasta que apagues la ventana propia.
                </p>
              </div>
              <dl v-else key="inherit" class="professional-window__inherited">
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

            <div class="professional-window__strip">
              <p class="professional-window__strip-label">
                Así ve el cliente sus horarios de una mañana
              </p>
              <ol
                :key="shownWindow.slotGridMinutes"
                class="professional-window__slots"
                :aria-label="`Franjas de ejemplo cada ${shownWindow.slotGridMinutes} minutos`"
              >
                <li v-for="slot in slots" :key="slot" class="professional-window__slot">
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

            <Transition name="professional-window-actions">
              <div v-if="pendingAction" class="professional-window__actions">
                <BaseButton variant="secondary" type="button" :disabled="busy" @click="onDiscard"
                  >Descartar</BaseButton
                >
                <!-- Texto corto para que quepa a 320 px; el nombre del profesional
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

        <div v-if="ownRoster.length > 0" class="professional-window__roster">
          <p class="professional-window__roster-label">Con ventana propia</p>
          <ul class="professional-window__roster-list">
            <li v-for="item in ownRoster" :key="item.id">
              <button
                type="button"
                class="professional-window__chip"
                :class="{ 'professional-window__chip--active': item.id === selectedId }"
                :aria-pressed="item.id === selectedId"
                :title="item.summary"
                :disabled="busy"
                @click="selectProfessional(item.id)"
              >
                <span class="professional-window__chip-name">{{ item.fullName }}</span>
                <span class="professional-window__chip-grid">cada {{ item.grid }} min</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </SettingsPanel>
</template>

<style scoped>
.professional-window {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.professional-window__state {
  color: var(--color-text-secondary);
}

.professional-window__empty {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
}

.professional-window__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

/* Selector a la izquierda, contador a la derecha, alineados por la base. */
.professional-window__pick {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 20px;
}

.professional-window__select {
  display: flex;
  flex: 1 1 260px;
  flex-direction: column;
  gap: 8px;
  max-width: 380px;
  min-width: 0;
}

.professional-window__label,
.professional-window__strip-label,
.professional-window__roster-label {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.professional-window__count {
  margin: 0;
  padding-bottom: 12px;
  font-size: var(--font-size-caption);
  line-height: 18px;
  color: var(--color-text-secondary);
}

.professional-window__count-number {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

/* La ficha del profesional elegido: una superficie hundida dentro del panel,
   sin filete de acento (v2, DEC-188). */
.professional-window__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 18px;
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.professional-window__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

/* Punto hueco (hereda) o lleno (propia): la palabra lo dice, el punto acompaña. */
.professional-window__status-mark {
  width: 8px;
  height: 8px;
  border: var(--border-width-normal) solid currentColor;
  border-radius: 50%;
  transition:
    background-color var(--motion-duration-base) var(--motion-easing-standard),
    color var(--motion-duration-base) var(--motion-easing-standard);
}

.professional-window__status--own {
  color: var(--color-text-primary);
}

.professional-window__status--own .professional-window__status-mark {
  background: currentColor;
}

.professional-window__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.professional-window__no-limit {
  grid-column: 1 / -1;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
}

/* Lo heredado se lee, no se edita: tres cifras sobre una regla fina. */
.professional-window__inherited {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

.professional-window__inherited > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
}

.professional-window__inherited > div + div {
  border-left: var(--border-width-normal) solid var(--color-border-subtle);
}

.professional-window__inherited dt {
  font-size: var(--font-size-caption);
  line-height: 16px;
  color: var(--color-text-secondary);
}

.professional-window__inherited dd {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: 600;
  line-height: 24px;
  color: var(--color-text-primary);
}

.professional-window__strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.professional-window__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.professional-window__slot {
  padding: 6px 10px;
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  color: var(--color-text-primary);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
}

/* La primera franja, la más temprana, se destaca en tinta. */
.professional-window__slot:first-child {
  font-weight: 600;
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-color: var(--color-text-primary);
}

.professional-window__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 14px;
  border-top: var(--border-width-normal) solid var(--color-border-subtle);
}

.professional-window__roster {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.professional-window__roster-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.professional-window__chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  max-width: 100%;
  min-height: 36px;
  padding: 8px 12px;
  font: inherit;
  font-size: var(--font-size-caption);
  color: var(--color-text-primary);
  cursor: pointer;
  background: transparent;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.professional-window__chip:hover:not(:disabled) {
  border-color: var(--color-text-primary);
}

.professional-window__chip:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.professional-window__chip--active {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  border-color: var(--color-text-primary);
}

.professional-window__chip-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.professional-window__chip-grid {
  flex: 0 0 auto;
  color: var(--color-text-secondary);
}

/* Campos y botones: los compartidos v2 (BaseInput, BaseButton) sin
   repintar; aquí solo la altura de las acciones. «Guardar ventana» es la
   acción principal del panel y conserva el acento de BaseButton primary. */
.professional-window__actions :deep(.base-button) {
  height: 40px;
  padding-inline: 18px;
}

/* Cambio de profesional: la ficha sale y entra con un desliz corto. */
.professional-window-swap-enter-active,
.professional-window-swap-leave-active {
  transition:
    opacity 180ms var(--motion-easing-standard),
    transform 180ms var(--motion-easing-standard);
}

.professional-window-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.professional-window-swap-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.professional-window-fields-enter-active,
.professional-window-fields-leave-active {
  transition: opacity 160ms var(--motion-easing-standard);
}

.professional-window-fields-enter-from,
.professional-window-fields-leave-to {
  opacity: 0;
}

.professional-window-actions-enter-active {
  transition:
    opacity 200ms var(--motion-easing-standard),
    transform 200ms var(--motion-easing-standard);
}

.professional-window-actions-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 760px) {
  .professional-window__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 480px) {
  .professional-window__card {
    padding: 14px;
  }

  .professional-window__inherited {
    grid-template-columns: minmax(0, 1fr);
  }

  .professional-window__inherited > div + div {
    border-top: var(--border-width-normal) solid var(--color-border-subtle);
    border-left: 0;
  }

  .professional-window__count {
    padding-bottom: 0;
  }

  /* El rótulo del interruptor ocupa todo el ancho y el control baja debajo. */
  .professional-window :deep(.switch-field) {
    flex-wrap: wrap;
  }

  .professional-window :deep(.switch-field__copy) {
    flex: 1 1 100%;
  }

  .professional-window__actions :deep(.base-button) {
    flex: 1 1 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .professional-window-swap-enter-active,
  .professional-window-swap-leave-active,
  .professional-window-fields-enter-active,
  .professional-window-fields-leave-active,
  .professional-window-actions-enter-active {
    transition: none;
  }
}
</style>
