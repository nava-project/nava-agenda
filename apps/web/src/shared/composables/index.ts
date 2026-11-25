// Composables reutilizados por más de un módulo. Una función pura de
// formato o validación vive en shared/model o shared/validation, no aquí,
// según nava-docs/agenda/03-desarrollo/estandar-frontend-vue.md.
export { useToast } from './useToast'
export type { ToastOptions, UseToast } from './useToast'
export { DEFAULT_MIN_HOLD_MS, PAGE_MIN_HOLD_MS, useMinHoldLoading } from './useMinHoldLoading'
export type { MinHoldLoading } from './useMinHoldLoading'
export {
  LOADER_APPEAR_MS,
  LOADER_FADE_MS,
  LOADER_MIN_VISIBLE_MS,
  useLoaderGrace,
} from './useLoaderGrace'
export type { LoaderGrace, LoaderGraceOptions } from './useLoaderGrace'
export { useVocabulary } from './useVocabulary'
export { ARRIVAL_MS, arrivalKey, finishArrival, useArrival } from './useArrival'
export { COUNT_UP_MS, useCountUp } from './useCountUp'
export type { Arrival } from './useArrival'
export { FOCUS_VIEW_MARGIN_PX, keepFocusInView } from './focusInView'
