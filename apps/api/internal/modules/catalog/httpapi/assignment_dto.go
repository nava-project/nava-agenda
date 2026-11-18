package httpapi

import "time"

// AssignmentResponse es la representación canónica de una asignación
// profesional-servicio (HU-023, CA-023-07): exactamente professionalId, serviceId y
// createdAt. Nunca nombre, duración, precio ni estado del profesional o del
// servicio: un consumidor que necesite mostrarlos cruza por identificador
// contra GET /private/professionals y GET /private/services, que ya los exponen.
type AssignmentResponse struct {
	ProfessionalID string    `json:"professionalId"`
	ServiceID      string    `json:"serviceId"`
	CreatedAt      time.Time `json:"createdAt"`
}

// AssignmentListResponse es la página paginada por cursor de
// GET /private/professionals/{professionalId}/services (CA-023-01). NextCursor es un
// puntero para que "sin página siguiente" serialice como `null` explícito,
// nunca como una cadena vacía (mismo patrón que ProfessionalListResponse/
// ServiceListResponse).
type AssignmentListResponse struct {
	Items      []AssignmentResponse `json:"items"`
	NextCursor *string              `json:"nextCursor"`
}
