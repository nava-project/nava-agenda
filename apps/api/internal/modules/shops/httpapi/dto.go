package httpapi

// BusinessSettingsResponse es la representación canónica de la
// configuración básica del negocio (CA-020-01, CA-020-07): exactamente
// los cuatro campos autorizados. ContactEmail/ContactPhone son punteros
// para que un contacto ausente serialice como `null` explícito (no se
// omiten del cuerpo, nava-docs/agenda/06-api/estandar-openapi.md §9.3), nunca como
// cadena vacía.
type BusinessSettingsResponse struct {
	Name         string  `json:"name"`
	Timezone     string  `json:"timezone"`
	ContactEmail *string `json:"contactEmail"`
	ContactPhone *string `json:"contactPhone"`
}

// UpdateBusinessSettingsRequest es el cuerpo de
// PATCH /private/settings/business (CA-020-02, CA-020-06). Cerrado: el
// handler rechaza cualquier campo desconocido, igual que LoginRequest.
// ContactEmail/ContactPhone vacíos representan "sin contacto" en el
// alambre; shops.Service los normaliza a ausencia antes de persistir.
// Nunca declara businessId: el tenant se deriva exclusivamente de
// auth.Principal (CA-020-05).
type UpdateBusinessSettingsRequest struct {
	Name         string `json:"name"`
	Timezone     string `json:"timezone"`
	ContactEmail string `json:"contactEmail"`
	ContactPhone string `json:"contactPhone"`
}
