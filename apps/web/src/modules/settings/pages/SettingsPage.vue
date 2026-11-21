<script setup lang="ts">
// Pantalla "Configuración" (HU-020, DEC-110): nombre, zona horaria y contacto
// del negocio activo (HU-020) más la marca y el vocabulario de todo el
// negocio y las preferencias de pantalla de ESTE dispositivo. Mismo lenguaje
// v2 «La luz del día» que la Agenda (DEC-188): superficies del modo, tarjetas
// con borde sutil, rótulos en tipo oración y un solo acento lleno por panel
// (su acción principal); nada se anima al cargar.
//
// Dos clases de ajuste, y la pantalla lo dice en cada sección:
//  - Este dispositivo (modo, tamaño de texto, animaciones): se aplican al
//    instante y viven en el navegador; no hay nada que guardar.
//  - Todo el negocio (nombre, acento, vocabulario, zona, contacto): se
//    editan en un borrador y solo un guardado confirmado por el servidor los
//    aplica. Un error recuperable NUNCA borra lo que la persona escribió
//    (CA-020-08). Marca y datos básicos son dos recursos distintos, así que se
//    envían solo los que cambiaron y cada uno se confirma por separado.
// El acento elegido se previsualiza en toda la app mientras se edita; si se
// descarta o se sale sin guardar, vuelve al confirmado.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { PAGE_MIN_HOLD_MS, useMinHoldLoading, useToast, useVocabulary } from '@/shared/composables'
import {
  appearance,
  BRAND_ACCENTS,
  buildVocabulary,
  DEFAULT_BRAND,
  isDefaultAppearance,
  normalizeTerm,
  panelProfile,
  resetAppearance,
  resolvedTheme,
  setAccentPreview,
  setBrand,
  setMotion,
  setTextScale,
  setTheme,
  TEXT_SCALES,
  TEXT_SCALE_KEYS,
  validateTerm,
  type BrandAccentKey,
  type BrandSettings,
  type Gender,
  type MotionMode,
  type TextScaleKey,
  type ThemeMode,
} from '@/shared/model'
import { isMapAvailable } from '@/shared/model/mapEmbed'
import { roundPoint } from '@/shared/model/mapPicker'
import type { PlaceSelection } from '@/shared/model/placesAutocomplete'
import {
  DEFAULT_PHONE_COUNTRY,
  composePhone,
  nationalDigits,
  splitInternationalPhone,
} from '@/shared/model/phoneCountries'
import {
  BaseAlert,
  BaseButton,
  AddressAutocomplete,
  BaseInput,
  DiamondLoader,
  DiamondRule,
  LocationMap,
  LocationPicker,
  PhoneField,
} from '@/shared/ui'
import { updateBusinessName } from '@/modules/auth'
import { fetchBrand, saveBrand } from '../api/brandApi'
import { fetchBusinessSettings, saveBusinessSettings } from '../api/settingsApi'
import { toFormValues, type BusinessSettingsFormValues } from '../model/businessSettings'
import { DEFAULT_LOCATION, type LocationSettings } from '../model/brandOutcome'
import {
  ADDRESS_MAX_LENGTH,
  draftFromSaved,
  locationChange,
  normalizeAddress,
  needsGeocoding,
  addressChanged,
  savedPoint,
  sameLocation,
  validateAddress,
  type LocationDraft,
} from '../model/locationDraft'
import {
  brandForSave,
  BUSINESS_PRESETS,
  PROFESSIONAL_PRESETS,
  sameBusiness,
  sameBrand,
  suggestPlural,
} from '../model/settingsDraft'
import {
  validateContactEmail,
  validateContactPhone,
  validateName,
  validateTimezone,
} from '../validation/settingsValidation'
import OptionGroup from '../components/OptionGroup.vue'
import LoginOtpPanel from '../components/LoginOtpPanel.vue'
import ReminderPanel from '../components/ReminderPanel.vue'
import OpeningHoursPanel from '../components/OpeningHoursPanel.vue'
import PublicLinkPanel from '../components/PublicLinkPanel.vue'
import SaveBar from '../components/SaveBar.vue'
import SettingsIndex from '../components/SettingsIndex.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import SwitchField from '../components/SwitchField.vue'
import TimezoneField from '../components/TimezoneField.vue'

type LoadStatus = 'loading' | 'ready' | 'load-error'
type GroupError = 'validation' | 'network' | 'unexpected'

const v = useVocabulary()
const toast = useToast()

const loadStatus = ref<LoadStatus>('loading')
const saving = ref(false)
const attempted = ref(false)
const shopError = ref<GroupError | null>(null)
const brandError = ref<GroupError | null>(null)

const shop = reactive<BusinessSettingsFormValues>({
  name: '',
  timezone: '',
  contactEmail: '',
  contactPhone: '',
})
const brand = reactive<BrandSettings>({ ...DEFAULT_BRAND })
// El teléfono de contacto se escribe en dos casillas (país y número nacional),
// igual que en la reserva pública, pero `shop.contactPhone` sigue siendo el
// único valor: un E.164 completo, o '' si no hay teléfono. Las casillas son su
// vista; solo se escribe de vuelta cuando la persona edita alguna.
const phoneCountryIso = ref(DEFAULT_PHONE_COUNTRY)
const phoneNational = ref('')

function composedContactPhone(): string {
  return phoneNational.value === '' ? '' : composePhone(phoneCountryIso.value, phoneNational.value)
}

watch(
  () => shop.contactPhone,
  (value) => {
    // Es la escritura de las propias casillas: no hay nada que repartir.
    if (value === composedContactPhone()) return
    const parts = splitInternationalPhone(value)
    if (parts) {
      phoneCountryIso.value = parts.country
      phoneNational.value = parts.national
      return
    }
    // Vacío (descartar, o ninguno guardado): se conserva el país elegido. Un
    // prefijo fuera de la lista se muestra completo hasta que se edite.
    phoneNational.value = nationalDigits(value)
  },
  { immediate: true },
)

function onContactPhoneChange() {
  shop.contactPhone = composedContactPhone()
  revalidate()
}

function onContactPhoneCountry(iso: string) {
  phoneCountryIso.value = iso
  onContactPhoneChange()
}

function onContactPhoneNational(value: string) {
  phoneNational.value = value
  onContactPhoneChange()
}

// Último valor confirmado por el servidor: contra él se mide qué cambió.
const savedShop = ref<BusinessSettingsFormValues>({ ...shop })
const savedBrand = ref<BrandSettings>({ ...DEFAULT_BRAND })
// Ubicación física (DEC-130): se guarda con la misma petición que la marca.
const location = reactive<LocationDraft>(draftFromSaved(DEFAULT_LOCATION))
const savedLocation = ref<LocationSettings>({ ...DEFAULT_LOCATION })

const { start: startLoadingHold, hold: holdLoadingReveal } = useMinHoldLoading(PAGE_MIN_HOLD_MS)
let requestToken = 0

async function load() {
  const token = ++requestToken
  loadStatus.value = 'loading'
  startLoadingHold()
  const [shopOutcome, brandOutcome] = await Promise.all([fetchBusinessSettings(), fetchBrand()])
  if (token !== requestToken) return
  holdLoadingReveal(() => {
    if (token !== requestToken) return
    if (shopOutcome.kind === 'success' && brandOutcome.kind === 'success') {
      Object.assign(shop, toFormValues(shopOutcome.settings))
      Object.assign(brand, brandOutcome.brand)
      savedShop.value = { ...shop }
      savedBrand.value = { ...brandOutcome.brand }
      Object.assign(location, draftFromSaved(brandOutcome.location))
      savedLocation.value = { ...brandOutcome.location }
      loadStatus.value = 'ready'
      return
    }
    loadStatus.value = 'load-error'
  })
}

onMounted(load)

// --- Borrador --------------------------------------------------------------

const shopDirty = computed(() => !sameBusiness(shop, savedShop.value))
const brandDirty = computed(() => !sameBrand(brand, savedBrand.value))
const locationDirty = computed(() => !sameLocation(location, savedLocation.value))
const dirty = computed(() => shopDirty.value || brandDirty.value || locationDirty.value)

const dirtySummary = computed(() => {
  const parts: string[] = []
  if (brandDirty.value) parts.push('marca y vocabulario')
  if (shopDirty.value) parts.push('datos básicos')
  if (locationDirty.value) parts.push('ubicación')
  const text = parts.join(' y ')
  return text.charAt(0).toLocaleUpperCase('es') + text.slice(1)
})

// Vocabulario del borrador para la vista previa: si un término aún no es válido
// se conserva el confirmado, así la vista previa nunca muestra basura a medias.
const draftVocabulary = computed(() =>
  buildVocabulary({
    ...brand,
    businessTerm: validateTerm(brand.businessTerm)
      ? savedBrand.value.businessTerm
      : normalizeTerm(brand.businessTerm),
    professionalTerm: validateTerm(brand.professionalTerm)
      ? savedBrand.value.professionalTerm
      : normalizeTerm(brand.professionalTerm),
    professionalTermPlural: validateTerm(brand.professionalTermPlural)
      ? savedBrand.value.professionalTermPlural
      : normalizeTerm(brand.professionalTermPlural),
  }),
)

type FieldErrors = Partial<
  Record<
    | 'name'
    | 'timezone'
    | 'contactEmail'
    | 'contactPhone'
    | 'businessTerm'
    | 'professionalTerm'
    | 'professionalTermPlural'
    | 'address',
    string
  >
>
const fieldErrors = ref<FieldErrors>({})

function runValidation(): FieldErrors {
  const errors: FieldErrors = {}
  const set = (key: keyof FieldErrors, message: string | undefined) => {
    if (message) errors[key] = message
  }
  set('name', validateName(shop.name, v.value))
  set('timezone', validateTimezone(shop.timezone))
  set('contactEmail', validateContactEmail(shop.contactEmail))
  set('contactPhone', validateContactPhone(shop.contactPhone))
  set('businessTerm', validateTerm(brand.businessTerm))
  set('professionalTerm', validateTerm(brand.professionalTerm))
  set('professionalTermPlural', validateTerm(brand.professionalTermPlural))
  set('address', validateAddress(location.address, location.pin))
  return errors
}

function revalidate() {
  if (attempted.value) fieldErrors.value = runValidation()
}

function onShopInput<K extends keyof BusinessSettingsFormValues>(field: K, value: string | number) {
  shop[field] = String(value)
  revalidate()
}

function onAddressInput(value: string | number) {
  location.address = String(value)
  revalidate()
}

// Ubicación a mano en el mapa (DEC-170). El mapa muestra el punto marcado en
// esta edición o, si no se tocó, el guardado. Un punto que vuelve del mapa se
// guarda tal cual; su texto (dirección aproximada) no pisa la dirección escrita.
const locationPickerValue = computed<PlaceSelection | null>(() => {
  const point = location.pin ?? savedPoint(savedLocation.value)
  return point ? { address: normalizeAddress(location.address) || 'Tu local', ...point } : null
})

function onPinMoved(selection: PlaceSelection) {
  location.pin = roundPoint(selection)
  revalidate()
}

// Una sugerencia del campo de dirección (por nombre del negocio o por
// dirección) ya escribió su dirección en el campo (`update:text`); aquí solo
// marca su punto, que centra el mapa. El dueño puede corregir el texto y
// ajustar el pin después.
function onPlaceChosen(selection: PlaceSelection | null) {
  if (!selection) return
  location.pin = roundPoint(selection)
  revalidate()
}

function onBusinessTermInput(value: string | number) {
  brand.businessTerm = String(value)
  revalidate()
}

// El plural acompaña al singular mientras siga siendo la sugerencia automática:
// en cuanto la persona lo corrige a mano, deja de pisarlo.
function onProfessionalTermInput(value: string | number) {
  const next = String(value)
  const follows =
    !brand.professionalTermPlural ||
    normalizeTerm(brand.professionalTermPlural) === suggestPlural(brand.professionalTerm)
  brand.professionalTerm = next
  if (follows) brand.professionalTermPlural = suggestPlural(next)
  revalidate()
}

function onProfessionalPluralInput(value: string | number) {
  brand.professionalTermPlural = String(value)
  revalidate()
}

function applyBusinessPreset(index: number) {
  const preset = BUSINESS_PRESETS[index]
  if (!preset) return
  brand.businessTerm = preset.term
  brand.businessTermGender = preset.gender
  revalidate()
}

function applyProfessionalPreset(index: number) {
  const preset = PROFESSIONAL_PRESETS[index]
  if (!preset) return
  brand.professionalTerm = preset.singular
  brand.professionalTermPlural = preset.plural
  brand.professionalTermGender = preset.gender
  revalidate()
}

const isBusinessPreset = (index: number) =>
  normalizeTerm(brand.businessTerm) === BUSINESS_PRESETS[index]?.term &&
  brand.businessTermGender === BUSINESS_PRESETS[index]?.gender
const isProfessionalPreset = (index: number) => {
  const p = PROFESSIONAL_PRESETS[index]
  return (
    !!p &&
    normalizeTerm(brand.professionalTerm) === p.singular &&
    normalizeTerm(brand.professionalTermPlural) === p.plural &&
    brand.professionalTermGender === p.gender
  )
}

// El acento se previsualiza en toda la app mientras se edita.
watch(
  () => brand.accent,
  (accent) => {
    if (loadStatus.value === 'ready') setAccentPreview(accent)
  },
)
onBeforeUnmount(() => setAccentPreview(null))

// --- Guardar y descartar ----------------------------------------------------

async function focusFirstError() {
  await nextTick()
  const first = document.querySelector<HTMLElement>(
    '.settings-page [aria-invalid="true"], .settings-page [data-invalid="true"] input',
  )
  first?.focus()
}

async function onSave() {
  // Guardia de doble envío: la asignación síncrona bloquea un segundo clic.
  if (saving.value) return

  attempted.value = true
  const errors = runValidation()
  fieldErrors.value = errors
  if (Object.keys(errors).length > 0) {
    void focusFirstError()
    return
  }

  saving.value = true
  shopError.value = null
  brandError.value = null
  let savedSomething = false

  if (shopDirty.value) {
    const outcome = await saveBusinessSettings(shop)
    if (outcome.kind === 'success') {
      Object.assign(shop, toFormValues(outcome.settings))
      savedShop.value = { ...shop }
      // Solo el valor confirmado por el servidor cambia la cabecera (CA-020-02).
      updateBusinessName(outcome.settings.name)
      savedSomething = true
    } else {
      shopError.value =
        outcome.kind === 'validation-error'
          ? 'validation'
          : outcome.kind === 'network-error'
            ? 'network'
            : 'unexpected'
    }
  }

  if (brandDirty.value || locationDirty.value) {
    // La ubicación viaja en la misma petición que la marca (un solo PATCH): solo
    // lo que cambió, para no volver a geocodificar una dirección sin tocar.
    const outcome = await saveBrand(
      brandForSave(brand),
      locationChange(location, savedLocation.value),
    )
    if (outcome.kind === 'success') {
      Object.assign(brand, outcome.brand)
      savedBrand.value = { ...outcome.brand }
      Object.assign(location, draftFromSaved(outcome.location))
      savedLocation.value = { ...outcome.location }
      setBrand(outcome.brand)
      setAccentPreview(null)
      savedSomething = true
    } else if (outcome.kind === 'location-error') {
      // Nada se guardó (ni la marca): el error se muestra junto al campo.
      fieldErrors.value = {
        ...fieldErrors.value,
        address:
          'No pudimos ubicar esa dirección en el mapa. Escríbela completa: calle, número y ciudad.',
      }
      attempted.value = true
      void focusFirstError()
    } else {
      brandError.value =
        outcome.kind === 'validation-error'
          ? 'validation'
          : outcome.kind === 'network-error'
            ? 'network'
            : 'unexpected'
    }
  }

  saving.value = false
  if (savedSomething) {
    attempted.value = false
    fieldErrors.value = {}
    toast.success('Configuración guardada', {
      detail: `Los cambios ya están aplicados en ${v.value.theBusiness}.`,
    })
  }
  announceSaveFailure()
}

// Un fallo de conexión o inesperado no pertenece a ningún campo: DEC-095 lo avisa como
// toast con «Reintentar». Una alerta en línea al inicio del formulario quedaba fuera de
// pantalla en móvil, donde la barra de guardado es lo único a la vista.
function announceSaveFailure() {
  const retry = { label: 'Reintentar', run: () => void onSave() }
  if (shopError.value === 'network' || brandError.value === 'network') {
    toast.warning('No pudimos conectar', {
      detail: 'Revisa tu conexión e inténtalo de nuevo. No perdiste lo que escribiste.',
      action: retry,
    })
  }
  if (shopError.value === 'unexpected' || brandError.value === 'unexpected') {
    toast.error('Ocurrió un error inesperado', {
      detail: 'Inténtalo de nuevo en unos segundos. No perdiste lo que escribiste.',
      action: retry,
    })
  }
  // El rechazo de validación sí es del formulario y sigue en línea: se lleva a la vista.
  if (shopError.value === 'validation' || brandError.value === 'validation') {
    void nextTick(() =>
      document
        .querySelector<HTMLElement>('.settings-page__form [role="alert"]')
        ?.scrollIntoView?.({ block: 'center' }),
    )
  }
}

function onDiscard() {
  if (saving.value) return
  Object.assign(shop, savedShop.value)
  Object.assign(brand, savedBrand.value)
  Object.assign(location, draftFromSaved(savedLocation.value))
  setAccentPreview(null)
  attempted.value = false
  fieldErrors.value = {}
  shopError.value = null
  brandError.value = null
}

// --- Preferencias de este dispositivo ---------------------------------------

const THEME_OPTIONS: readonly { value: ThemeMode; label: string; hint: string }[] = [
  // DEC-188: los modos de la v2 se llaman Noche y Día; los valores guardados
  // (ink, ivory) no cambian para no perder la preferencia de nadie.
  { value: 'ink', label: 'Noche', hint: 'Oscuro, para el día largo' },
  { value: 'ivory', label: 'Día', hint: 'Claro y luminoso' },
  { value: 'auto', label: 'Automático', hint: 'Sigue a tu sistema' },
]

const TEXT_OPTIONS = TEXT_SCALE_KEYS.map((key) => ({
  value: key,
  label: TEXT_SCALES[key].label,
}))

const GENDER_OPTIONS: readonly { value: Gender; label: string }[] = [
  { value: 'feminine', label: 'Femenino' },
  { value: 'masculine', label: 'Masculino' },
]

const ACCENT_OPTIONS = BRAND_ACCENTS.map((a) => ({ value: a.key, label: a.label }))

// Las miniaturas de Tinta/Marfil pintan el acento elegido (aún sin guardar) con
// el valor medido para cada modo, no el latón fijo (issue #575).
const themeTileAccent = computed(() => {
  const accent = BRAND_ACCENTS.find((a) => a.key === brand.accent) ?? BRAND_ACCENTS[0]!
  return { '--mini-accent-ink': accent.ink, '--mini-accent-ivory': accent.ivory }
})

/** Valor de cada acento tal como se verá en el modo vigente. */
function swatchColor(key: BrandAccentKey): string {
  const accent = BRAND_ACCENTS.find((a) => a.key === key)!
  return resolvedTheme.value === 'ivory' ? accent.ivory : accent.ink
}

// El sistema ya pide menos movimiento: la elección de "completas" no lo anula.
const systemReducesMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const reduceMotion = computed({
  get: () => appearance.motion === 'reduced',
  set: (on: boolean) => setMotion((on ? 'reduced' : 'full') as MotionMode),
})

// --- Índice de secciones ----------------------------------------------------

const SECTIONS = [
  { id: 'configuracion-pantalla', label: 'Pantalla' },
  { id: 'configuracion-marca', label: 'Marca' },
  { id: 'configuracion-vocabulario', label: 'Vocabulario' },
  { id: 'configuracion-hora', label: 'Hora' },
  { id: 'configuracion-contacto', label: 'Contacto' },
  { id: 'configuracion-ubicacion', label: 'Ubicación' },
  { id: 'configuracion-horario', label: 'Horario' },
  { id: 'configuracion-enlace', label: 'Enlace' },
  { id: 'configuracion-reservas', label: 'Reservas' },
  { id: 'configuracion-recordatorios', label: 'Recordatorios' },
  { id: 'configuracion-integraciones', label: 'Integraciones' },
  { id: 'configuracion-acceso', label: 'Acceso' },
] as const

const activeSection = ref<string>(SECTIONS[0].id)
const pageRef = ref<HTMLElement | null>(null)

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) return node
    node = node.parentElement
  }
  return null
}

// La sección "activa" es la última cuya cabecera ya pasó la línea de lectura
// (un tercio de la ventana). Se recalcula completa en cada aviso del
// observador, no solo con las entradas que cambiaron: un salto largo de
// desplazamiento no deja el índice atrás.
function computeActiveSection() {
  const page = pageRef.value
  if (!page) return
  const root = scrollParent(page)
  const rootTop = root ? root.getBoundingClientRect().top : 0
  const rootHeight = root ? root.clientHeight : window.innerHeight
  const line = rootTop + rootHeight * 0.33
  let current: string = SECTIONS[0].id
  for (const section of SECTIONS) {
    const el = document.getElementById(section.id)
    if (el && el.getBoundingClientRect().top <= line) current = section.id
  }
  // Al fondo del todo, la última sección gana aunque no alcance la línea.
  if (root && root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
    current = SECTIONS[SECTIONS.length - 1].id
  }
  activeSection.value = current
}

let scroller: HTMLElement | null = null
let scrollFrame = 0

function onScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    computeActiveSection()
  })
}

function observeSections() {
  const page = pageRef.value
  if (!page) return
  scroller?.removeEventListener('scroll', onScroll)
  scroller = scrollParent(page)
  scroller?.addEventListener('scroll', onScroll, { passive: true })
  computeActiveSection()
}

function goToSection(id: string) {
  activeSection.value = id
  const el = document.getElementById(id)
  if (!el) return
  const reduced =
    appearance.motion === 'reduced' ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
}

// Un panel individual o de empleado (DEC-134) no gestiona un equipo: la vista previa no
// simula «Agregar», el aviso de «aún no tienes…» ni la elección de quien atiende.
const isTeamPanel = computed(() => panelProfile.value === 'shop')

const previewClass = computed(() => ({ 'settings-page__preview--changed': brandDirty.value }))
</script>

<template>
  <section ref="pageRef" class="settings-page" aria-labelledby="settings-page-title">
    <header class="settings-page__header">
      <h1 id="settings-page-title" class="settings-page__title">Configuración</h1>
      <p class="settings-page__subtitle">
        Ajusta cómo se ve Nava Agenda en este dispositivo y cómo se llama {{ v.theBusiness }}.
      </p>
    </header>

    <Transition name="settings-content" mode="out-in" @after-enter="observeSections">
      <div
        v-if="loadStatus === 'loading'"
        key="loading"
        class="settings-page__state"
        role="status"
        aria-live="polite"
      >
        <DiamondLoader label="Cargando la configuración…" layout="overlay" />
        <!-- La forma real (#759): el índice sobre su riel y dos secciones con
             encabezado, rótulo de alcance, troquel y una fila de opciones, en la
             misma rejilla que la página lista. -->
        <div class="settings-page__skeletons settings-page__layout" aria-hidden="true">
          <span class="settings-page__skeleton-index">
            <span
              v-for="n in SECTIONS.length"
              :key="n"
              class="settings-page__skeleton settings-page__skeleton--index"
            />
          </span>
          <span class="settings-page__skeleton-panels">
            <span v-for="n in 2" :key="n" class="settings-page__skeleton-panel">
              <span class="settings-page__skeleton-head">
                <span class="settings-page__skeleton settings-page__skeleton--title" />
                <span class="settings-page__skeleton settings-page__skeleton--scope" />
              </span>
              <span class="settings-page__skeleton settings-page__skeleton--line" />
              <span class="settings-page__skeleton-body">
                <span class="settings-page__skeleton settings-page__skeleton--label" />
                <span class="settings-page__skeleton-tiles">
                  <span
                    v-for="t in 3"
                    :key="t"
                    class="settings-page__skeleton settings-page__skeleton--tile"
                  />
                </span>
                <span class="settings-page__skeleton settings-page__skeleton--label" />
                <span class="settings-page__skeleton settings-page__skeleton--field" />
              </span>
            </span>
          </span>
        </div>
      </div>

      <BaseAlert
        v-else-if="loadStatus === 'load-error'"
        key="error"
        variant="warning"
        title="No pudimos cargar la configuración"
        role="alert"
      >
        Revisa tu conexión e inténtalo de nuevo.
        <template #action>
          <BaseButton variant="secondary" type="button" @click="load">Reintentar</BaseButton>
        </template>
      </BaseAlert>

      <div v-else key="ready" class="settings-page__layout">
        <SettingsIndex :items="SECTIONS" :active="activeSection" @select="goToSection" />

        <form class="settings-page__form settings-ink" novalidate @submit.prevent="onSave">
          <BaseAlert
            v-if="shopError === 'validation'"
            variant="danger"
            title="No pudimos guardar los datos básicos"
            role="alert"
          >
            Revisa los datos, especialmente la zona horaria: debe ser una zona IANA reconocida (ej.
            America/Bogota).
          </BaseAlert>
          <BaseAlert
            v-if="brandError === 'validation'"
            variant="danger"
            title="No pudimos guardar la marca ni el vocabulario"
            role="alert"
          >
            Revisa las palabras: usa solo letras, espacios, guion o apóstrofo.
          </BaseAlert>

          <!-- Pantalla (este dispositivo) -->
          <SettingsPanel
            id="configuracion-pantalla"
            title="Pantalla"
            description="Cómo se ve Nava Agenda en este aparato. Se aplica al instante y no hace falta guardar."
            scope="device"
            scope-label="Solo este dispositivo"
          >
            <div class="settings-field">
              <span class="settings-field__label" id="field-theme">Modo</span>
              <OptionGroup
                :model-value="appearance.theme"
                :options="THEME_OPTIONS"
                label="Modo de la pantalla"
                class="settings-themes"
                @update:model-value="setTheme"
              >
                <template #default="{ option, selected }">
                  <span class="theme-tile" :class="{ 'theme-tile--selected': selected }">
                    <span
                      class="theme-tile__mini"
                      :class="`theme-tile__mini--${option.value}`"
                      :style="themeTileAccent"
                      aria-hidden="true"
                    >
                      <span class="theme-tile__bar" />
                      <span class="theme-tile__body">
                        <span class="theme-tile__line theme-tile__line--title" />
                        <span class="theme-tile__line" />
                        <span class="theme-tile__line theme-tile__line--short" />
                        <span class="theme-tile__accent" />
                      </span>
                    </span>
                    <span class="theme-tile__name">
                      {{ option.label }}
                    </span>
                    <span class="theme-tile__hint">{{ option.hint }}</span>
                  </span>
                </template>
              </OptionGroup>
            </div>

            <div class="settings-field">
              <span class="settings-field__label">Tamaño del texto</span>
              <OptionGroup
                :model-value="appearance.textScale"
                :options="TEXT_OPTIONS"
                label="Tamaño del texto"
                class="settings-sizes"
                @update:model-value="(value: TextScaleKey) => setTextScale(value)"
              >
                <template #default="{ option, selected }">
                  <span class="size-step" :class="{ 'size-step--selected': selected }">
                    <span
                      class="size-step__glyph"
                      :class="`size-step__glyph--${option.value}`"
                      aria-hidden="true"
                      >Aa</span
                    >
                    <span class="size-step__label">{{ option.label }}</span>
                  </span>
                </template>
              </OptionGroup>
              <p class="settings-field__hint">
                Escala toda la interfaz. En pantallas angostas se limita para que nada se corte.
              </p>
            </div>

            <div class="settings-field">
              <SwitchField
                v-model="reduceMotion"
                label="Reducir animaciones"
                :hint="
                  systemReducesMotion
                    ? 'Tu sistema ya pide menos movimiento, así que se respeta siempre.'
                    : 'Quita transiciones y destellos. Útil si el movimiento te distrae o te marea.'
                "
              />
            </div>

            <div class="settings-field settings-field--row">
              <BaseButton
                type="button"
                variant="secondary"
                :disabled="isDefaultAppearance(appearance)"
                @click="resetAppearance"
              >
                Restablecer pantalla
              </BaseButton>
            </div>
          </SettingsPanel>

          <!-- Marca (todo el negocio) -->
          <!-- El corte con intención de la página: de aquí abajo vale para todo el negocio (#728). -->
          <DiamondRule label="Para todo el negocio" class="settings-page__scope-rule" />

          <SettingsPanel
            id="configuracion-marca"
            title="Marca"
            description="El nombre y el color con los que tu equipo reconoce el panel."
            scope="shop"
            :scope-label="`Para ${v.theBusiness}`"
          >
            <BaseInput
              :model-value="shop.name"
              name="name"
              label="Nombre"
              required
              :show-required-marker="false"
              :maxlength="120"
              :disabled="saving"
              :error="fieldErrors.name"
              :class="{ 'settings-input--filled': !!shop.name }"
              @update:model-value="(value) => onShopInput('name', value)"
            />

            <div class="settings-field">
              <span class="settings-field__label">Color de acento</span>
              <OptionGroup
                :model-value="brand.accent"
                :options="ACCENT_OPTIONS"
                label="Color de acento"
                :disabled="saving"
                class="settings-accents"
                @update:model-value="(value: BrandAccentKey) => (brand.accent = value)"
              >
                <template #default="{ option, selected }">
                  <span class="accent-swatch" :class="{ 'accent-swatch--selected': selected }">
                    <span class="accent-swatch__stage" aria-hidden="true">
                      <span
                        class="accent-swatch__gem"
                        :style="{ '--swatch': swatchColor(option.value) }"
                      />
                    </span>
                    <span class="accent-swatch__label">{{ option.label }}</span>
                  </span>
                </template>
              </OptionGroup>
              <p class="settings-field__hint">
                Se ve al instante en todo el panel; se guarda para todo tu equipo. Cada color
                conserva el contraste de lectura en modo Tinta y Marfil.
              </p>
            </div>
          </SettingsPanel>

          <!-- Vocabulario (todo el negocio) -->
          <SettingsPanel
            id="configuracion-vocabulario"
            title="Vocabulario"
            description="Las palabras con las que Nava Agenda nombra tu negocio y a quien atiende los turnos."
            scope="shop"
            :scope-label="`Para ${v.theBusiness}`"
          >
            <div class="vocab-group">
              <BaseInput
                :model-value="brand.businessTerm"
                name="businessTerm"
                label="Cómo llamas a tu negocio"
                required
                :show-required-marker="false"
                :maxlength="30"
                :disabled="saving"
                :error="fieldErrors.businessTerm"
                :class="{ 'settings-input--filled': !!brand.businessTerm }"
                @update:model-value="onBusinessTermInput"
              />
              <div class="settings-field">
                <span class="settings-field__label settings-field__label--sub">Género</span>
                <OptionGroup
                  :model-value="brand.businessTermGender"
                  :options="GENDER_OPTIONS"
                  label="Género de la palabra del negocio"
                  :disabled="saving"
                  class="settings-genders"
                  @update:model-value="(value: Gender) => (brand.businessTermGender = value)"
                >
                  <template #default="{ option, selected }">
                    <span class="gender-pill" :class="{ 'gender-pill--selected': selected }">{{
                      option.label
                    }}</span>
                  </template>
                </OptionGroup>
              </div>
              <ul class="preset-list" aria-label="Palabras sugeridas para el negocio">
                <li v-for="(preset, index) in BUSINESS_PRESETS" :key="preset.term">
                  <button
                    type="button"
                    class="preset-chip"
                    :class="{ 'preset-chip--active': isBusinessPreset(index) }"
                    :aria-pressed="isBusinessPreset(index)"
                    :disabled="saving"
                    @click="applyBusinessPreset(index)"
                  >
                    {{ preset.term }}
                  </button>
                </li>
              </ul>
            </div>

            <div class="vocab-group">
              <div class="vocab-group__pair">
                <BaseInput
                  :model-value="brand.professionalTerm"
                  name="professionalTerm"
                  label="Cómo llamas a quien atiende"
                  required
                  :show-required-marker="false"
                  :maxlength="30"
                  :disabled="saving"
                  :error="fieldErrors.professionalTerm"
                  :class="{ 'settings-input--filled': !!brand.professionalTerm }"
                  @update:model-value="onProfessionalTermInput"
                />
                <BaseInput
                  :model-value="brand.professionalTermPlural"
                  name="professionalTermPlural"
                  label="En plural"
                  required
                  :show-required-marker="false"
                  :maxlength="30"
                  :disabled="saving"
                  :error="fieldErrors.professionalTermPlural"
                  :class="{ 'settings-input--filled': !!brand.professionalTermPlural }"
                  @update:model-value="onProfessionalPluralInput"
                />
              </div>
              <div class="settings-field">
                <span class="settings-field__label settings-field__label--sub">Género</span>
                <OptionGroup
                  :model-value="brand.professionalTermGender"
                  :options="GENDER_OPTIONS"
                  label="Género de la palabra del profesional"
                  :disabled="saving"
                  class="settings-genders"
                  @update:model-value="(value: Gender) => (brand.professionalTermGender = value)"
                >
                  <template #default="{ option, selected }">
                    <span class="gender-pill" :class="{ 'gender-pill--selected': selected }">{{
                      option.label
                    }}</span>
                  </template>
                </OptionGroup>
              </div>
              <ul class="preset-list" aria-label="Palabras sugeridas para quien atiende">
                <li v-for="(preset, index) in PROFESSIONAL_PRESETS" :key="preset.singular">
                  <button
                    type="button"
                    class="preset-chip"
                    :class="{ 'preset-chip--active': isProfessionalPreset(index) }"
                    :aria-pressed="isProfessionalPreset(index)"
                    :disabled="saving"
                    @click="applyProfessionalPreset(index)"
                  >
                    {{ preset.singular }}
                  </button>
                </li>
              </ul>
            </div>

            <aside
              class="settings-page__preview"
              :class="previewClass"
              aria-label="Vista previa del vocabulario"
            >
              <p class="settings-page__preview-kicker">Así se leerá en tu panel</p>
              <ul v-if="isTeamPanel" class="settings-page__preview-list">
                <li>
                  <span class="settings-page__preview-tag">Menú</span>
                  <span class="settings-page__preview-leader" aria-hidden="true" />
                  <span class="settings-page__preview-dock">{{
                    draftVocabulary.Professionals
                  }}</span>
                </li>
                <li>
                  <span class="settings-page__preview-tag">Botón</span>
                  <span class="settings-page__preview-leader" aria-hidden="true" />
                  <span class="settings-page__preview-button"
                    >+ Agregar {{ draftVocabulary.professional }}</span
                  >
                </li>
                <li>
                  <span class="settings-page__preview-tag">Aviso</span>
                  <span class="settings-page__preview-leader" aria-hidden="true" />
                  <span
                    >Aún no tienes {{ draftVocabulary.professionalsRegistered }} en
                    {{ draftVocabulary.theBusiness }}.</span
                  >
                </li>
                <li>
                  <span class="settings-page__preview-tag">Agenda</span>
                  <span class="settings-page__preview-leader" aria-hidden="true" />
                  <span>Elige {{ draftVocabulary.toTheProfessional }} y el servicio.</span>
                </li>
              </ul>
              <ul v-else class="settings-page__preview-list">
                <li>
                  <span class="settings-page__preview-tag">Perfil</span>
                  <span class="settings-page__preview-leader" aria-hidden="true" />
                  <span>Mi perfil de {{ draftVocabulary.professional }}</span>
                </li>
                <li>
                  <span class="settings-page__preview-tag">Reserva</span>
                  <span class="settings-page__preview-leader" aria-hidden="true" />
                  <span>Tus clientes reservan en {{ draftVocabulary.theBusiness }}.</span>
                </li>
              </ul>
            </aside>
          </SettingsPanel>

          <!-- Hora (todo el negocio) -->
          <SettingsPanel
            id="configuracion-hora"
            title="Hora"
            description="Toda hora de la agenda, de los horarios y de las reservas se calcula en esta zona, nunca en la de cada dispositivo."
            scope="shop"
            :scope-label="`Para ${v.theBusiness}`"
          >
            <TimezoneField
              :model-value="shop.timezone"
              label="Zona horaria"
              :disabled="saving"
              :error="fieldErrors.timezone"
              @update:model-value="(value) => onShopInput('timezone', value)"
            />
          </SettingsPanel>

          <!-- Contacto (todo el negocio) -->
          <SettingsPanel
            id="configuracion-contacto"
            title="Contacto"
            description="Opcional. Es el correo y el teléfono con los que tus clientes pueden escribirte."
            scope="shop"
            :scope-label="`Para ${v.theBusiness}`"
          >
            <div class="settings-grid">
              <BaseInput
                :model-value="shop.contactEmail"
                type="email"
                name="contactEmail"
                label="Correo de contacto"
                :maxlength="254"
                :disabled="saving"
                :error="fieldErrors.contactEmail"
                :class="{ 'settings-input--filled': !!shop.contactEmail }"
                @update:model-value="(value) => onShopInput('contactEmail', value)"
              />
              <PhoneField
                :country="phoneCountryIso"
                :national="phoneNational"
                name="contactPhone"
                label="Teléfono de contacto"
                :disabled="saving"
                :error="fieldErrors.contactPhone"
                @update:country="onContactPhoneCountry"
                @update:national="onContactPhoneNational"
              />
            </div>
          </SettingsPanel>

          <!-- Ubicación (DEC-130, HU-102): interruptor, dirección y vista previa del mapa -->
          <SettingsPanel
            id="configuracion-ubicacion"
            title="Ubicación"
            description="Dónde queda tu local y si atiendes a domicilio. Tus clientes lo ven al reservar."
            scope="shop"
            :scope-label="`Para ${v.theBusiness}`"
          >
            <SwitchField
              v-model="location.hasPhysicalLocation"
              label="Tengo un local que mostrar"
              :hint="
                location.hasPhysicalLocation
                  ? 'Tus clientes verán el mapa y la dirección en la reserva pública.'
                  : 'Apagado: la reserva pública no muestra mapa ni dirección. Útil si atiendes solo a domicilio; tu dirección se conserva.'
              "
              :disabled="saving"
            />
            <!-- Un solo campo (DEC-170): es la dirección que ven los clientes y a la vez
                 el buscador de Google por nombre del negocio o por dirección. Elegir una
                 sugerencia la escribe aquí y centra el mapa de abajo. -->
            <AddressAutocomplete
              :model-value="null"
              :text="location.address"
              name="address"
              label="Dirección del local"
              hint="Escribe la dirección o el nombre de tu local y elige una sugerencia; luego ajusta el pin en el mapa."
              :maxlength="ADDRESS_MAX_LENGTH"
              :show-map="false"
              :clear-on-input="false"
              :disabled="saving"
              :error="fieldErrors.address"
              class="settings-address"
              @update:text="onAddressInput"
              @update:model-value="onPlaceChosen"
            />
            <p class="settings-field__hint">
              La dirección es pública: cualquiera que abra tu enlace de reservas puede verla. Si
              trabajas desde tu casa, apaga el interruptor para no mostrarla.
            </p>
            <p
              v-if="
                needsGeocoding(savedLocation) &&
                !addressChanged(location, savedLocation) &&
                !location.pin
              "
              class="settings-field__hint settings-location-pending"
              role="status"
            >
              Esta dirección todavía no está ubicada en el mapa. Búscala o mueve el mapa hasta tu
              local; si no, al guardar la ubicamos con la dirección escrita.
            </p>
            <div
              v-if="location.hasPhysicalLocation && isMapAvailable()"
              class="settings-location-picker"
            >
              <LocationPicker
                :model-value="locationPickerValue"
                label="Ubicación en el mapa"
                hint="Mueve el mapa hasta que el pin quede sobre la puerta de tu local. Así lo verán tus clientes al reservar."
                :disabled="saving"
                @update:model-value="onPinMoved"
              />
            </div>
            <SwitchField
              v-model="location.offersHomeService"
              label="Atiendo a domicilio"
              :hint="
                location.offersHomeService
                  ? 'Al reservar, tus clientes podrán elegir «a domicilio» e indicar su dirección con un mapa.'
                  : 'Apagado: todos los turnos son en tu local.'
              "
              :disabled="saving"
            />
            <!-- Con el local apagado no hay mapa para ajustar (DEC-170): solo se
                 recuerda dónde quedó guardado, oculto para los clientes. -->
            <div
              v-if="
                !location.hasPhysicalLocation &&
                savedLocation.address &&
                savedLocation.latitude !== null &&
                savedLocation.longitude !== null &&
                isMapAvailable()
              "
              class="settings-location-preview"
            >
              <span class="settings-field__label settings-field__label--sub">
                Guardada, pero oculta mientras el interruptor siga apagado
              </span>
              <LocationMap
                :latitude="savedLocation.latitude"
                :longitude="savedLocation.longitude"
                :address="savedLocation.address"
              />
            </div>
          </SettingsPanel>

          <!-- Horario de atención (DEC-182): se guarda con su propio botón, no es parte del borrador -->
          <SettingsPanel
            id="configuracion-horario"
            title="Horario de atención"
            description="Los días y horas en que abre el local. Lo ven tus clientes al reservar."
          >
            <OpeningHoursPanel />
          </SettingsPanel>

          <!-- Enlace público de reservas (DEC-117): solo lectura, no es parte del borrador -->
          <SettingsPanel
            id="configuracion-enlace"
            title="Enlace público"
            description="La dirección que compartes para que tus clientes reserven. Cópiala cuando la necesites."
          >
            <PublicLinkPanel />
          </SettingsPanel>

          <!-- Reservas públicas: enlace a su propia pantalla (HU-093) -->
          <SettingsPanel
            id="configuracion-reservas"
            title="Reservas"
            description="Cuándo y con cuánta anticipación pueden reservar tus clientes, y cómo cancelan."
          >
            <RouterLink :to="{ name: 'configuracion-reserva-publica' }" class="settings-link">
              <span class="settings-link__copy">
                <span class="settings-link__title">Reglas de reserva pública</span>
                <span class="settings-link__detail"
                  >Anticipación mínima, ventana, rejilla de horarios y cancelación.</span
                >
              </span>
              <span class="settings-link__leader" aria-hidden="true" />
              <span class="settings-link__arrow" aria-hidden="true">→</span>
            </RouterLink>
          </SettingsPanel>

          <!-- Recordatorios (DEC-174): se aplica al instante, no es parte del borrador -->
          <SettingsPanel
            id="configuracion-recordatorios"
            title="Recordatorios"
            description="Cuánto antes de su turno le recordamos la cita a cada cliente."
          >
            <ReminderPanel />
          </SettingsPanel>

          <!-- Integraciones: enlace a la pantalla de Google Calendar (DEC-099) -->
          <SettingsPanel
            id="configuracion-integraciones"
            title="Integraciones"
            description="Conecta tu calendario para ver tus turnos de Nava Agenda donde ya organizas tu día."
          >
            <RouterLink :to="{ name: 'integraciones-google-calendar' }" class="settings-link">
              <span class="settings-link__copy">
                <span class="settings-link__title">Google Calendar</span>
                <span class="settings-link__detail"
                  >Publica tus turnos y bloqueos en tu calendario y elige tu recordatorio.</span
                >
              </span>
              <span class="settings-link__leader" aria-hidden="true" />
              <span class="settings-link__arrow" aria-hidden="true">→</span>
            </RouterLink>
          </SettingsPanel>

          <!-- Código de acceso (DEC-139): se aplica al instante, no es parte del borrador -->
          <SettingsPanel
            id="configuracion-acceso"
            title="Código de acceso"
            description="Por dónde llega el código de verificación cuando alguien necesita confirmar su identidad para entrar."
          >
            <LoginOtpPanel />
          </SettingsPanel>

          <div class="settings-page__save">
            <SaveBar
              v-if="dirty"
              :summary="dirtySummary"
              :saving="saving"
              @discard="onDiscard"
              @save="onSave"
            />
          </div>
        </form>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
/* v2 (DEC-188): el lienzo y las superficies son los del modo (Día o Noche),
   como en la Agenda del día. */
.settings-page {
  --settings-width: 1040px;

  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 100%;
  padding: 34px 32px 48px;
  color: var(--color-text-primary);
  /* Transparente: el lienzo del modo lo pone el cascarón. */
  background: transparent;
  box-sizing: border-box;
}

.settings-page__header,
.settings-page__state,
.settings-page__layout,
.settings-page > :deep(.base-alert) {
  width: min(100%, var(--settings-width));
  margin-inline: auto;
}

/* Mismo h1 que la Agenda del día (DailyAgendaPage). */
.settings-page__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-page-title);
  font-weight: 400;
  line-height: var(--font-size-page-title-line);
  letter-spacing: -0.005em;
  color: var(--color-text-primary);
}

.settings-page__subtitle {
  margin: 4px 0 0;
  font-size: var(--font-size-body-sm);
  line-height: var(--font-size-body-sm-line);
  color: var(--color-text-secondary);
}

.settings-page__state {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--color-text-secondary);
}

/* El esqueleto pulsa solo mientras carga (estado finito). */
.settings-page__skeleton {
  display: block;
  background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
  border-radius: var(--radius-sm);
  animation: settings-skeleton-pulse 1400ms ease-in-out infinite;
}

.settings-page__skeleton-index {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 13px 0 13px 12px;
  border-left: var(--border-width-normal) solid var(--color-border-subtle);
}

.settings-page__skeleton--index {
  width: 62%;
  height: 12px;
}

.settings-page__skeleton-panels {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.settings-page__skeleton-panel {
  display: flex;
  flex-direction: column;
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-brass-line) 32%, var(--color-border-subtle));
  border-radius: 4px;
}

.settings-page__skeleton-head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 24px 18px;
}

.settings-page__skeleton--title {
  width: 160px;
  height: 26px;
}

.settings-page__skeleton--scope {
  width: 130px;
  height: 12px;
  margin-top: 6px;
}

.settings-page__skeleton--line {
  height: 0;
  background: none;
  border-top: var(--border-width-normal) dashed
    color-mix(in srgb, var(--color-brass-line) 60%, transparent);
  border-radius: 0;
  animation: none;
}

.settings-page__skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 24px 26px;
}

.settings-page__skeleton--label {
  width: 90px;
  height: 12px;
}

.settings-page__skeleton-tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.settings-page__skeleton--tile {
  flex: 1 1 168px;
  max-width: 244px;
  height: 118px;
  background: none;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-lg);
}

.settings-page__skeleton--field {
  width: 100%;
  height: 44px;
  background: none;
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
}

.settings-page__layout {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  gap: 32px;
  align-items: start;
}

.settings-page__form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.settings-page__save {
  position: sticky;
  bottom: 16px;
  z-index: var(--layer-sticky);
}

/* --- Campos de una sección ------------------------------------------------ */

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-field--row {
  flex-direction: row;
}

.settings-field__label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.settings-field__hint {
  margin: 0;
  max-width: 60ch;
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

/* Dirección sin punto en el mapa (issue #589): el aviso va en tinta y con
   peso para leerse como una acción pendiente, no como ayuda de fondo. */
.settings-location-pending {
  color: var(--color-text-primary);
  font-weight: 500;
}

.settings-location-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Buscador + mapa con pin (DEC-170): el pin es la ubicación pública. */
.settings-location-picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

/* --- Modo: tres miniaturas del panel ------------------------------------- */

.settings-themes {
  --option-group-gap: 14px;
  /* El rombo de la elegida va en la fila del nombre, no sobre la miniatura. */
  --option-mark-top: 102px;
  --option-mark-right: 14px;
}

.settings-themes :deep(.option-group__option) {
  flex: 1 1 168px;
  max-width: 244px;
}

.theme-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 10px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-lg);
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.theme-tile:hover {
  border-color: var(--option-hover-border);
}

/* Elegida en latón con su rombo (#759; el rombo lo pone OptionGroup). */
.theme-tile--selected,
.theme-tile--selected:hover {
  background: var(--option-selected-bg);
  border-color: var(--option-selected-border);
  box-shadow: inset 0 0 0 1px var(--option-selected-border);
}

/* Miniatura: superficies literales a propósito (los valores v2 de Noche y
   Día), porque cada una muestra SU modo sin importar cuál esté activo. Su
   pequeño botón es la réplica de la acción principal, por eso lleva el acento
   elegido con el valor medido para cada modo. */
.theme-tile__mini {
  --mini-bg: #0b1022;
  --mini-chrome: #0e1430;
  --mini-line: rgb(238 241 248 / 70%);
  --mini-faint: rgb(238 241 248 / 22%);
  --mini-accent: var(--mini-accent-ink, #ff8daa);

  position: relative;
  display: flex;
  flex-direction: column;
  height: 78px;
  overflow: hidden;
  background: var(--mini-bg);
  border: 1px solid rgb(127 127 127 / 35%);
  border-radius: var(--radius-sm);
}

.theme-tile__mini--ivory {
  --mini-bg: #f4f0e7;
  --mini-chrome: #ffffff;
  --mini-line: rgb(16 27 43 / 70%);
  --mini-faint: rgb(16 27 43 / 20%);
  --mini-accent: var(--mini-accent-ivory, #b23157);
}

.theme-tile__mini--auto {
  background: linear-gradient(115deg, #0b1022 0 50%, #f4f0e7 50% 100%);
}

.theme-tile__mini--auto .theme-tile__bar {
  background: linear-gradient(115deg, #0e1430 0 50%, #ffffff 50% 100%);
}

.theme-tile__mini--auto .theme-tile__line {
  background: linear-gradient(115deg, rgb(238 241 248 / 70%) 0 50%, rgb(16 27 43 / 70%) 50% 100%);
}

.theme-tile__mini--auto .theme-tile__accent {
  background: linear-gradient(
    115deg,
    var(--mini-accent-ink, #ff8daa) 0 50%,
    var(--mini-accent-ivory, #b23157) 50% 100%
  );
}

.theme-tile__bar {
  height: 14px;
  background: var(--mini-chrome);
  border-bottom: 1px solid var(--mini-faint);
}

.theme-tile__body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  padding: 9px 10px;
}

.theme-tile__line {
  display: block;
  height: 4px;
  width: 78%;
  background: var(--mini-faint);
  border-radius: 1px;
}

.theme-tile__line--title {
  width: 46%;
  height: 6px;
  background: var(--mini-line);
}

.theme-tile__line--short {
  width: 52%;
}

.theme-tile__accent {
  position: absolute;
  right: 10px;
  bottom: 9px;
  width: 16px;
  height: 6px;
  background: var(--mini-accent);
  border-radius: 2px;
}

.theme-tile__name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  line-height: 18px;
  color: var(--color-text-primary);
}

.theme-tile__hint {
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

/* --- Tamaño del texto: cuatro escalones ---------------------------------- */

.settings-sizes {
  --option-group-gap: 8px;
}

.size-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  width: 92px;
  min-height: 76px;
  padding: 10px 8px 8px;
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  transition:
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.size-step:hover {
  border-color: var(--option-hover-border);
}

.size-step--selected,
.size-step--selected:hover {
  background: var(--option-selected-bg);
  border-color: var(--option-selected-border);
  box-shadow: inset 0 0 0 1px var(--option-selected-border);
}

.settings-sizes {
  --option-mark-top: 7px;
  --option-mark-right: 7px;
}

.size-step__glyph {
  line-height: 1;
  color: var(--color-text-primary);
}

.size-step__glyph--small {
  font-size: var(--font-size-body);
}

.size-step__glyph--normal {
  font-size: var(--font-size-title-item);
}

.size-step__glyph--large {
  font-size: var(--font-size-h2);
}

.size-step__glyph--xlarge {
  font-size: var(--font-size-title-section);
}

.size-step__label {
  font-size: var(--font-size-caption);
  font-weight: 500;
  line-height: 16px;
  color: var(--color-text-secondary);
}

.size-step--selected .size-step__label {
  font-weight: 600;
  color: var(--color-text-primary);
}

/* --- Acento: muestras de color -------------------------------------------- */

.settings-accents {
  --option-group-gap: 10px;
  /* La gema ya es el rombo: no lleva el de la esquina. */
  --option-mark-display: none;
}

.accent-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 92px;
  padding: 8px 4px 10px;
  border: var(--border-width-normal) solid transparent;
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.accent-swatch:hover {
  background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
}

.accent-swatch--selected {
  background: var(--option-selected-bg);
  border-color: var(--option-selected-border);
}

.accent-swatch__stage {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
}

/* Cada muestra pinta SU color (`--swatch`): es el dato que se elige. Gema
   tallada (#759): un rombo con dos caras de luz y sombra y una arista; la
   elegida lleva un engaste del mismo rombo. */
.accent-swatch__gem {
  position: relative;
  width: 24px;
  height: 24px;
  background:
    linear-gradient(
      135deg,
      rgb(255 255 255 / 38%) 0 30%,
      transparent 30% 52%,
      rgb(0 0 0 / 18%) 52% 100%
    ),
    var(--swatch);
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 22%);
  transform: rotate(45deg);
  transition:
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.accent-swatch:hover .accent-swatch__gem {
  transform: rotate(45deg) scale(1.08);
}

.accent-swatch--selected .accent-swatch__gem {
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 22%),
    0 0 0 3px var(--color-surface),
    0 0 0 4.5px var(--swatch);
}

.accent-swatch__label {
  font-size: var(--font-size-caption);
  font-weight: 500;
  line-height: 16px;
  color: var(--color-text-secondary);
}

.accent-swatch--selected .accent-swatch__label {
  font-weight: 600;
  color: var(--color-text-primary);
}

/* --- Vocabulario ---------------------------------------------------------- */

.vocab-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 22px;
  border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
}

.vocab-group:nth-of-type(2) {
  border-bottom: 0;
  padding-bottom: 0;
}

.vocab-group__pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.settings-genders {
  --option-group-gap: 0;
}

.gender-pill {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  font-size: var(--font-size-body-sm);
  font-weight: 500;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.settings-genders > :first-child .gender-pill {
  border-radius: var(--radius-md) 0 0 var(--radius-md);
}

.settings-genders > :last-child .gender-pill {
  margin-left: -1px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

.gender-pill:hover {
  color: var(--color-text-primary);
  border-color: var(--option-hover-border);
}

/* Segmento elegido en latón; el rombo va delante de la palabra. */
.settings-genders {
  --option-mark-display: none;
}

.gender-pill--selected,
.gender-pill--selected:hover {
  position: relative;
  z-index: 1;
  font-weight: 600;
  background: var(--option-selected-bg);
  color: var(--color-text-primary);
  border-color: var(--option-selected-border);
}

.gender-pill--selected::before {
  width: 6px;
  height: 6px;
  margin-right: 9px;
  content: '';
  background: var(--color-brass-body);
  transform: rotate(45deg);
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.preset-chip {
  min-height: 36px;
  padding: 0 14px;
  color: var(--color-text-secondary);
  background: transparent;
  border: var(--border-width-normal) solid var(--color-border-subtle);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 13px;
  cursor: pointer;
  transition:
    color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.preset-chip:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--color-brass-line) 55%, var(--color-border-control));
}

.preset-chip:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

/* La palabra en uso: latón con su rombo, como la opción elegida (#759). */
.preset-chip--active,
.preset-chip--active:hover:not(:disabled) {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-brass-body) 13%, var(--color-surface));
  border-color: var(--color-brass-line);
}

.preset-chip--active::before {
  width: 5px;
  height: 5px;
  margin-right: 8px;
  content: '';
  background: var(--color-brass-body);
  transform: rotate(45deg);
}

.preset-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Vista previa del vocabulario: superficie hundida, sin filete de acento. Se
   actualiza al escribir; no destella (v2: nada parpadea). */
/* La vista previa como una ficha de la familia (#759): rótulo de latón con su
   rombo (hueco; se llena cuando hay cambios sin guardar) y cada línea con
   puntos guía entre el lugar del panel y cómo se leerá. */
.settings-page__preview {
  padding: 16px 18px 18px;
  background: var(--color-surface-muted);
  border: 1px solid color-mix(in srgb, var(--color-brass-line) 35%, transparent);
  border-radius: 4px;
}

.settings-page__preview-kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  color: var(--color-brass-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.settings-page__preview-kicker::before {
  width: 7px;
  height: 7px;
  content: '';
  border: 1.5px solid currentColor;
  rotate: 45deg;
}

.settings-page__preview--changed .settings-page__preview-kicker::before {
  background: currentColor;
}

.settings-page__preview-leader {
  flex: 1 1 24px;
  min-width: 24px;
  align-self: center;
  height: 0;
  border-bottom: 2px dotted color-mix(in srgb, var(--color-brass-line) 50%, transparent);
}

.settings-page__preview-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-size-body-sm);
  line-height: 20px;
}

.settings-page__preview-list li {
  display: flex;
  align-items: baseline;
  gap: 4px 10px;
}

.settings-page__preview-list li > :last-child {
  max-width: 70%;
  text-align: right;
}

.settings-page__preview-tag {
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}

.settings-page__preview-dock {
  font-weight: 600;
}

/* Réplica del botón principal del panel («Agregar…»): por eso, y solo por eso,
   lleva el acento lleno. */
.settings-page__preview-button {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  background: var(--color-action-primary);
  color: var(--color-brand-accent-text);
  border-radius: var(--radius-md);
  font-size: var(--font-size-caption);
  font-weight: 600;
}

/* --- Accesos a otra pantalla (#759) -------------------------------------
   Fila de la familia: el nombre en serif, su detalle, puntos guía hasta la
   flecha y un rombo de latón que la acompaña. Hover: el borde pasa a latón y
   la flecha avanza; al pulsar, la fila se hunde un poco. */

.settings-link {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: var(--border-width-normal) solid
    color-mix(in srgb, var(--color-brass-line) 40%, var(--color-border-subtle));
  border-radius: 4px;
  text-decoration: none;
}

.settings-link:hover {
  border-color: var(--color-brass-line);
}

.settings-link:active {
  transform: translateY(1px);
}

.settings-link:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.settings-link__copy {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-link__title {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 400;
  line-height: 1.15;
}

.settings-link__detail {
  font-size: 13px;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.settings-link__leader {
  flex: 1 1 24px;
  min-width: 24px;
  height: 2px;
  align-self: center;
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--color-brass-line) 70%, transparent) 1px,
    transparent 1.3px
  );
  background-size: 6px 2px;
}

.settings-link__arrow {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  font-size: var(--font-size-h3);
  line-height: 1;
  color: var(--color-brass-text);
}

.settings-link__arrow::before {
  width: 7px;
  height: 7px;
  content: '';
  background: var(--color-brass-body);
  transform: rotate(45deg);
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced']) .settings-link {
    transition:
      border-color 160ms ease,
      transform 120ms ease;
  }

  :root:not([data-motion='reduced']) .settings-link__arrow {
    transition: transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  :root:not([data-motion='reduced']) .settings-link:hover .settings-link__arrow {
    transform: translateX(4px);
  }
}

/* --- Campos v2: los compartidos (BaseInput, BaseButton) sin repintar ---------
   Solo se alinean al mismo campo los controles compartidos que aún traen su
   propio aspecto (teléfono, buscador del local y mapa): borde de control de
   1px, radio medio y rótulo en tipo oración. */

.settings-ink :deep(.base-input) {
  height: 44px;
}

.settings-ink :deep(.phone-field) {
  --pf-row-bg: var(--color-surface);
  --pf-row-bg-hover: var(--color-surface);
  --pf-row-bg-focus: var(--color-surface);
  --pf-line-strong: var(--color-border-control);
  --pf-row-base: var(--color-border-control);
  --pf-text: var(--color-text-primary);
  --pf-muted: var(--color-text-secondary);
  --pf-ring-gap: var(--color-surface);
}

.settings-ink :deep(.phone-field__row) {
  height: 44px;
  border-bottom-width: var(--border-width-normal);
}

.settings-ink :deep(.phone-field__row:hover:not(.phone-field__row--invalid)) {
  border-color: var(--color-text-primary);
}

.settings-ink :deep(.address-autocomplete__label),
.settings-ink :deep(.location-picker__label) {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--color-text-secondary);
}

.settings-ink :deep(.address-autocomplete__input) {
  height: 44px;
  padding: 0 var(--space-4);
  color: var(--color-text-primary);
  background-color: var(--color-surface);
  border: var(--border-width-normal) solid var(--color-border-control);
  border-radius: var(--radius-md);
  outline: none;
}

.settings-ink :deep(.address-autocomplete__input:hover:not(:disabled)) {
  border-color: var(--color-text-primary);
}

.settings-ink :deep(.address-autocomplete__input:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-focus);
}

.settings-ink :deep(.address-autocomplete__input[aria-invalid='true']) {
  border-color: var(--color-danger-border);
}

.settings-ink :deep(.address-autocomplete__error) {
  color: var(--color-danger-text);
}

.settings-ink :deep(.address-autocomplete__list) {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-dialog);
}

.settings-ink :deep(.address-autocomplete__hint),
.settings-ink :deep(.address-autocomplete__status),
.settings-ink :deep(.location-picker__hint),
.settings-ink :deep(.location-picker__notice),
.settings-ink :deep(.location-picker__chosen) {
  color: var(--color-text-secondary);
}

.settings-ink :deep(.location-picker__map) {
  border-color: var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

/* Llegada (#759): al quedar lista, las secciones suben escalonadas y el índice
   entra con ellas (~700 ms, solo transform y opacity). Ocurre una vez, porque la
   rejilla se monta una sola vez por carga. Con movimiento reducido no existe. */
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-motion='reduced'])
    .settings-page__layout:not(.settings-page__skeletons)
    > .settings-page__form
    > .settings-panel {
    animation: settings-arrive 420ms 120ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  :root:not([data-motion='reduced'])
    .settings-page__layout:not(.settings-page__skeletons)
    > .settings-page__form
    > .settings-panel:nth-of-type(2) {
    animation-delay: 200ms;
  }

  :root:not([data-motion='reduced'])
    .settings-page__layout:not(.settings-page__skeletons)
    > .settings-page__form
    > .settings-panel:nth-of-type(n + 3) {
    animation-delay: 280ms;
  }

  :root:not([data-motion='reduced'])
    .settings-page__layout:not(.settings-page__skeletons)
    > .settings-index {
    animation: settings-arrive-index 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
}

@keyframes settings-arrive {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes settings-arrive-index {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
}

/* Fundido entre carga/error/listo (estandar-diseno-visual.md §12). */
.settings-content-enter-active,
.settings-content-leave-active {
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);
}

.settings-content-enter-from,
.settings-content-leave-to {
  opacity: 0;
}

@keyframes settings-skeleton-pulse {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}

/* --- Responsive ----------------------------------------------------------- */

@media (max-width: 1099px) {
  .settings-page__layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}

@media (max-width: 767px) {
  .settings-grid,
  .vocab-group__pair {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-themes :deep(.option-group__option) {
    flex-basis: 100%;
    max-width: none;
  }
}

@media (max-width: 640px) {
  .settings-page {
    gap: 16px;
    padding: 16px 16px 28px;
  }

  .settings-page__save {
    bottom: 8px;
  }

  .size-step {
    width: 76px;
  }

  .accent-swatch {
    width: 76px;
  }
}

@media (max-width: 1099px) {
  .settings-page__skeleton-index {
    flex-direction: row;
    gap: 18px;
    padding: 16px 0;
    overflow: hidden;
    border-left: 0;
    border-bottom: var(--border-width-normal) solid var(--color-border-subtle);
  }

  .settings-page__skeleton--index {
    flex: 0 0 64px;
  }
}

@media (max-width: 767px) {
  .settings-page__skeleton--tile {
    flex-basis: 100%;
    max-width: none;
    height: 96px;
  }
}

@media (max-width: 640px) {
  .settings-page__skeleton-head,
  .settings-page__skeleton-body {
    padding-inline: 16px;
  }

  .settings-page__skeleton-head {
    flex-direction: column;
    gap: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-page__skeleton {
    animation: none;
  }
}

:root[data-motion='reduced'] .settings-page__skeleton {
  animation: none;
}
</style>
