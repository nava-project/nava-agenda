// Módulo: flujo público de reserva de turnos, sin sesión del profesional.
// API pública mínima para `app`, según nava-docs/agenda/03-desarrollo/
// estandar-frontend-vue.md: las rutas (cargadas de forma diferida).
// HU-090 entrega la primera capacidad real: `/reservar/:slug` abre el
// contexto público de un negocio a partir de su enlace de reservas. Los
// componentes, el estado y el cliente API internos permanecen privados.
export { publicBookingRoutes } from './routes'
// Issue #573: «Mi turno» (customer-access) es la continuación del recorrido de
// reserva y comparte su mesa de patronaje animada. Se expone solo el fondo
// decorativo, no el cascarón ni sus estilos.
export { default as BookingBackdrop } from './components/BookingBackdrop.vue'
