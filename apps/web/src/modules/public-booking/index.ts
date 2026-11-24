// Módulo: flujo público de reserva de turnos, sin sesión del profesional.
// API pública mínima para `app`, según nava-docs/agenda/03-desarrollo/
// estandar-frontend-vue.md: las rutas (cargadas de forma diferida).
// HU-090 entrega la primera capacidad real: `/reservar/:slug` abre el
// contexto público de un negocio a partir de su enlace de reservas. Los
// componentes, el estado y el cliente API internos permanecen privados.
export { publicBookingRoutes } from './routes'
export { restoreWhenStepReady } from './layouts/stepScroll'
// DEC-188 (2c): «Mi turno» usa el mismo marco v2, las mismas pantallas de estado,
// el mismo selector de día y hora y el mismo archivo de calendario que la
// reserva. Se exponen esas
// piezas, no el cascarón con sus rutas ni el estado interno.
export { default as PublicFrame } from './components/PublicFrame.vue'
export { default as BookingStateScreen } from './components/BookingStateScreen.vue'
export { default as DayTimePicker } from './components/DayTimePicker.vue'
export { default as DaylightStrip } from './components/DaylightStrip.vue'
export { buildCalendarFile, downloadCalendarFile } from './model/calendarFile'
export {
  buildDaylightDays,
  type DaylightDay,
  type DaylightMark,
  type DaylightSlot,
} from './model/daylight'
export { usePublicBusinessName } from './model/publicBusinessName'
