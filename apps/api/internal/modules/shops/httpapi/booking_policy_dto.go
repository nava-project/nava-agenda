package httpapi

// BookingPolicyResponse es la representación canónica de la política
// pública de reserva y cancelación (HU-093, CA-093-01): los seis campos de
// configuración más VersionToken, el único dato de concurrencia expuesto,
// opaco (shops.EncodeBookingPolicyVersionToken). Misma forma para GET y
// para la respuesta 200 de PUT.
type BookingPolicyResponse struct {
	MinAdvanceMinutes              int    `json:"minAdvanceMinutes"`
	MaxAdvanceDays                 int    `json:"maxAdvanceDays"`
	SlotGridMinutes                int    `json:"slotGridMinutes"`
	CancellationDeadlineMinutes    int    `json:"cancellationDeadlineMinutes"`
	LateCancellationClientAllowed  bool   `json:"lateCancellationClientAllowed"`
	LateCancellationReasonRequired bool   `json:"lateCancellationReasonRequired"`
	VersionToken                   string `json:"versionToken"`
}

// UpdateBookingPolicyRequest es el cuerpo de
// PUT /private/settings/booking-policy (CA-093-02). Cerrado: el handler
// rechaza cualquier campo desconocido, igual que
// UpdateBarbershopSettingsRequest. Contrato PUT completo: los seis campos
// son siempre obligatorios, nunca una actualización parcial. Nunca declara
// barbershopId: el tenant se deriva exclusivamente de auth.Principal
// (CA-093-03). La precondición de versión viaja en la cabecera If-Match,
// no en el cuerpo (mismo criterio que booking.HU-065).
type UpdateBookingPolicyRequest struct {
	MinAdvanceMinutes              int  `json:"minAdvanceMinutes"`
	MaxAdvanceDays                 int  `json:"maxAdvanceDays"`
	SlotGridMinutes                int  `json:"slotGridMinutes"`
	CancellationDeadlineMinutes    int  `json:"cancellationDeadlineMinutes"`
	LateCancellationClientAllowed  bool `json:"lateCancellationClientAllowed"`
	LateCancellationReasonRequired bool `json:"lateCancellationReasonRequired"`
}

// BarberBookingPolicyResponse es la ventana de reserva propia de un barbero
// (DEC-169). Solo existe para los barberos con configuración propia; los
// demás heredan la de la barbería y no aparecen en el listado.
type BarberBookingPolicyResponse struct {
	BarberID          string `json:"barberId"`
	MinAdvanceMinutes int    `json:"minAdvanceMinutes"`
	MaxAdvanceDays    int    `json:"maxAdvanceDays"`
	SlotGridMinutes   int    `json:"slotGridMinutes"`
}

// BarberBookingPolicyListResponse es la respuesta de
// GET /private/settings/booking-policy/barbers.
type BarberBookingPolicyListResponse struct {
	Items []BarberBookingPolicyResponse `json:"items"`
}

// PutBarberBookingPolicyRequest es el cuerpo cerrado de
// PUT /private/settings/booking-policy/barbers/{barberId} (DEC-169):
// reemplazo completo de los tres valores, sin token de versión.
type PutBarberBookingPolicyRequest struct {
	MinAdvanceMinutes int `json:"minAdvanceMinutes"`
	MaxAdvanceDays    int `json:"maxAdvanceDays"`
	SlotGridMinutes   int `json:"slotGridMinutes"`
}
