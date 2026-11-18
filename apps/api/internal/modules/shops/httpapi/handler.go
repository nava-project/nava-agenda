// Package httpapi es el adaptador HTTP del módulo shops: decodifica,
// invoca shops.Service y traduce el resultado a HTTP
// (docs/03-desarrollo/estandar-backend-go.md §4). No importa Chi: la
// composición de rutas es responsabilidad exclusiva de cmd/api sobre el
// subrouter privado que internal/platform/httpserver ya construye.
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
)

// GetBusinessSettingsHandler expone GET /private/settings/business
// (CA-020-01): lectura autenticada de la configuración básica del
// negocio activo.
type GetBusinessSettingsHandler struct {
	service *shops.Service
}

// NewGetBusinessSettingsHandler construye el handler de lectura.
func NewGetBusinessSettingsHandler(service *shops.Service) *GetBusinessSettingsHandler {
	return &GetBusinessSettingsHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *GetBusinessSettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		// Mismo defecto de wiring que SessionContextHandler contempla: solo
		// puede ocurrir si esta ruta se montó fuera del subrouter protegido
		// por SessionMiddleware (CA-006-04 lo evita estructuralmente).
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}

	business, err := h.service.Get(r.Context(), principal.BusinessID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newBusinessSettingsResponse(business))
}

// UpdateBusinessSettingsHandler expone PATCH /private/settings/business
// (CA-020-02, CA-020-03, CA-020-06): actualización autenticada de la
// configuración básica del negocio activo.
type UpdateBusinessSettingsHandler struct {
	service *shops.Service
}

// NewUpdateBusinessSettingsHandler construye el handler de actualización.
func NewUpdateBusinessSettingsHandler(service *shops.Service) *UpdateBusinessSettingsHandler {
	return &UpdateBusinessSettingsHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *UpdateBusinessSettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())

	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return
	}

	var req UpdateBusinessSettingsRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
		return
	}
	if dec.More() {
		// Más de un valor JSON en el cuerpo (p. ej. "{}{}"): mismo
		// tratamiento que un JSON malformado (igual que LoginHandler).
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
		return
	}

	// Normalización, validación de campo y persistencia atómica viven en
	// shops.Service: este handler no repite ninguna regla de negocio
	// (docs/03-desarrollo/estandar-backend-go.md §4).
	business, err := h.service.Update(r.Context(), principal.BusinessID, shops.Input{
		Name:         req.Name,
		Timezone:     req.Timezone,
		ContactEmail: req.ContactEmail,
		ContactPhone: req.ContactPhone,
	})
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newBusinessSettingsResponse(business))
}

// newBusinessSettingsResponse construye la representación canónica
// (CA-020-07): siempre los mismos cuatro campos, en la misma forma tanto
// para GET como para la respuesta 200 de PATCH.
func newBusinessSettingsResponse(b shops.Business) BusinessSettingsResponse {
	return BusinessSettingsResponse{
		Name:         b.Name,
		Timezone:     b.Timezone,
		ContactEmail: b.ContactEmail,
		ContactPhone: b.ContactPhone,
	}
}
