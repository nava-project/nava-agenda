package httpapi

import (
	"encoding/json"
	"time"
)

// ProfessionalResponse es la representación canónica de un profesional (CA-021-01,
// CA-021-07): exactamente id, fullName, createdAt, updatedAt y, por DEC-104,
// photoUpdatedAt (null mientras no hay fotografía; cuando existe, es la
// versión de la imagen) y, por DEC-127, description (null mientras no hay
// descripción). Nunca active, deletedAt, sortOrder, staffUserId,
// servicios ni horarios (DEC-047).
//
// ADVERTENCIA: postgres.professionalResponseWire (staff/postgres/repository.go)
// declara EXACTAMENTE la misma forma (mismos nombres de campo JSON, mismo
// orden, mismos tipos) para construir el cuerpo que la idempotencia
// persiste en el alta. Un cambio aquí debe reflejarse ahí en el mismo
// commit; ver TestCreate_StoredResponseBody_MatchesHTTPAPIWireShape en
// postgres/repository_test.go.
type ProfessionalResponse struct {
	ID             string     `json:"id"`
	FullName       string     `json:"fullName"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	PhotoUpdatedAt *time.Time `json:"photoUpdatedAt"`
	Description    *string    `json:"description"`
	Rating         *float64   `json:"rating"`
	RatingCount    int        `json:"ratingCount"`
}

// ProfessionalListResponse es la página paginada por cursor de GET /private/professionals
// (CA-021-02). NextCursor es un puntero para que "sin página siguiente"
// serialice como `null` explícito, nunca como una cadena vacía.
type ProfessionalListResponse struct {
	Items      []ProfessionalResponse `json:"items"`
	NextCursor *string                `json:"nextCursor"`
}

// CreateProfessionalRequest es el cuerpo de POST /private/professionals (CA-021-02).
// Cerrado: el handler rechaza cualquier campo desconocido. Nunca declara
// businessId: el tenant se deriva exclusivamente de auth.Principal.
type CreateProfessionalRequest struct {
	FullName string `json:"fullName"`
	// Description es opcional y admite null (DEC-127): ausente, null o vacía
	// equivalen a "sin descripción".
	Description *string `json:"description"`
}

// UpdateProfessionalRequest es el cuerpo de PATCH /private/professionals/{professionalId}
// (CA-021-04). Cerrado y limitado a los campos editables (el nombre de HU-021
// y, por DEC-127, la descripción): nunca active, deletedAt, sortOrder,
// staffUserId, servicios ni horarios (DEC-047, CA-021-07).
type UpdateProfessionalRequest struct {
	FullName    string       `json:"fullName"`
	Description OptionalText `json:"description"`
}

// OptionalText distingue un campo ausente de uno enviado como null o vacío:
// ausente conserva el valor actual y null/vacío lo quita. `encoding/json`
// llama a UnmarshalJSON solo cuando la clave viene en el cuerpo, así que Set
// queda en false si no vino.
type OptionalText struct {
	Set   bool
	Value *string
}

// UnmarshalJSON implementa json.Unmarshaler. Un valor que no es cadena ni
// null falla con el mismo error de JSON inválido que cualquier otro campo.
func (o *OptionalText) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

// LinkMyProfessionalRequest es el cuerpo de PUT /private/me/professional (DEC-100).
// Cerrado y limitado a professionalId: nunca lleva un staffUserId, porque el
// usuario es siempre el principal de la sesión y nadie asigna el vínculo de
// otra persona.
type LinkMyProfessionalRequest struct {
	ProfessionalID string `json:"professionalId"`
}
