package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"nava-agenda/internal/modules/staff"
	"nava-agenda/internal/platform/httpserver"
)

// GetMyProfessionalHandler expone GET /private/me/professional (DEC-100): el profesional que
// el usuario autenticado declaró ser, o 404 si no tiene ninguno.
type GetMyProfessionalHandler struct {
	service *staff.Service
}

// NewGetMyProfessionalHandler construye el handler de lectura del profesional propio.
func NewGetMyProfessionalHandler(service *staff.Service) *GetMyProfessionalHandler {
	return &GetMyProfessionalHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *GetMyProfessionalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	professional, err := h.service.LinkedProfessional(r.Context(), principal.BusinessID, principal.StaffUserID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	writeProfessional(w, professional)
}

// LinkMyProfessionalHandler expone PUT /private/me/professional (DEC-100). Actúa siempre
// sobre el principal de la sesión; el cuerpo solo nombra al profesional.
type LinkMyProfessionalHandler struct {
	service *staff.Service
}

// NewLinkMyProfessionalHandler construye el handler de vínculo propio.
func NewLinkMyProfessionalHandler(service *staff.Service) *LinkMyProfessionalHandler {
	return &LinkMyProfessionalHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *LinkMyProfessionalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	var req LinkMyProfessionalRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
			return
		}
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}
	if dec.More() {
		writeUnknownFieldOrInvalidJSONProblem(w, requestID)
		return
	}

	professional, err := h.service.LinkMyProfessional(r.Context(), principal.BusinessID, principal.StaffUserID, req.ProfessionalID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	writeProfessional(w, professional)
}

// UnlinkMyProfessionalHandler expone DELETE /private/me/professional (DEC-100).
type UnlinkMyProfessionalHandler struct {
	service *staff.Service
}

// NewUnlinkMyProfessionalHandler construye el handler que quita el vínculo propio.
func NewUnlinkMyProfessionalHandler(service *staff.Service) *UnlinkMyProfessionalHandler {
	return &UnlinkMyProfessionalHandler{service: service}
}

// ServeHTTP implementa http.Handler.
func (h *UnlinkMyProfessionalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	principal, ok := principalOrInternalError(w, r, requestID)
	if !ok {
		return
	}

	if err := h.service.UnlinkMyProfessional(r.Context(), principal.BusinessID, principal.StaffUserID); err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeProfessional(w http.ResponseWriter, professional staff.Professional) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newProfessionalResponse(professional))
}
