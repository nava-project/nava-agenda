package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"nava-agenda/internal/modules/access"
	"nava-agenda/internal/modules/auth"
	"nava-agenda/internal/modules/shops"
	"nava-agenda/internal/platform/apperr"
	"nava-agenda/internal/platform/httpserver"
)

// professionalIDURLParam es el parámetro de ruta del profesional (DEC-169).
const professionalIDURLParam = "professionalId"

// ProfessionalBookingPolicyHandler expone las tres operaciones de la ventana de
// reserva propia por profesional (DEC-169):
//   - GET    /private/settings/booking-policy/professionals
//   - PUT    /private/settings/booking-policy/professionals/{professionalId}
//   - DELETE /private/settings/booking-policy/professionals/{professionalId}
type ProfessionalBookingPolicyHandler struct {
	service *shops.ProfessionalBookingPolicyService
}

// NewProfessionalBookingPolicyHandler construye el handler.
func NewProfessionalBookingPolicyHandler(service *shops.ProfessionalBookingPolicyService) *ProfessionalBookingPolicyHandler {
	return &ProfessionalBookingPolicyHandler{service: service}
}

func principalBusinessID(w http.ResponseWriter, r *http.Request, requestID string) (string, bool) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return "", false
	}
	return principal.BusinessID, true
}

// List atiende GET /private/settings/booking-policy/professionals.
func (h *ProfessionalBookingPolicyHandler) List(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	businessID, ok := principalBusinessID(w, r, requestID)
	if !ok {
		return
	}

	policies, err := h.service.List(r.Context(), businessID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	// DEC-173: el empleado solo ve la ventana de su propio profesional.
	scope := access.ScopeFromContext(r.Context())
	resp := ProfessionalBookingPolicyListResponse{Items: make([]ProfessionalBookingPolicyResponse, 0, len(policies))}
	for _, p := range policies {
		if !scope.Owns(p.ProfessionalID) {
			continue
		}
		resp.Items = append(resp.Items, newProfessionalBookingPolicyResponse(p))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// Put atiende PUT /private/settings/booking-policy/professionals/{professionalId}.
func (h *ProfessionalBookingPolicyHandler) Put(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	businessID, ok := principalBusinessID(w, r, requestID)
	if !ok {
		return
	}

	var req PutProfessionalBookingPolicyRequest
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
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Invalid("cuerpo JSON inválido o con un campo desconocido"), requestID))
		return
	}

	// Rangos, coherencia y existencia del profesional viven en el servicio.
	policy, err := h.service.Put(r.Context(), businessID, httpserver.URLParam(r, professionalIDURLParam), shops.ProfessionalBookingPolicyInput{
		MinAdvanceMinutes: req.MinAdvanceMinutes,
		MaxAdvanceDays:    req.MaxAdvanceDays,
		SlotGridMinutes:   req.SlotGridMinutes,
	})
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(newProfessionalBookingPolicyResponse(policy))
}

// Delete atiende DELETE /private/settings/booking-policy/professionals/{professionalId}:
// el profesional vuelve a heredar la ventana del negocio. 204 aunque no
// tuviera configuración propia (idempotente).
func (h *ProfessionalBookingPolicyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	businessID, ok := principalBusinessID(w, r, requestID)
	if !ok {
		return
	}

	if err := h.service.Delete(r.Context(), businessID, httpserver.URLParam(r, professionalIDURLParam)); err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func newProfessionalBookingPolicyResponse(p shops.ProfessionalBookingPolicy) ProfessionalBookingPolicyResponse {
	return ProfessionalBookingPolicyResponse{
		ProfessionalID:    p.ProfessionalID,
		MinAdvanceMinutes: p.MinAdvanceMinutes,
		MaxAdvanceDays:    p.MaxAdvanceDays,
		SlotGridMinutes:   p.SlotGridMinutes,
	}
}
