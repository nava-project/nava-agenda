package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"system-barbershop/internal/modules/auth"
	"system-barbershop/internal/modules/shops"
	"system-barbershop/internal/platform/apperr"
	"system-barbershop/internal/platform/httpserver"
)

// barberIDURLParam es el parámetro de ruta del barbero (DEC-169).
const barberIDURLParam = "barberId"

// BarberBookingPolicyHandler expone las tres operaciones de la ventana de
// reserva propia por barbero (DEC-169):
//   - GET    /private/settings/booking-policy/barbers
//   - PUT    /private/settings/booking-policy/barbers/{barberId}
//   - DELETE /private/settings/booking-policy/barbers/{barberId}
type BarberBookingPolicyHandler struct {
	service *shops.BarberBookingPolicyService
}

// NewBarberBookingPolicyHandler construye el handler.
func NewBarberBookingPolicyHandler(service *shops.BarberBookingPolicyService) *BarberBookingPolicyHandler {
	return &BarberBookingPolicyHandler{service: service}
}

func principalBarbershopID(w http.ResponseWriter, r *http.Request, requestID string) (string, bool) {
	principal, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		httpserver.WriteProblem(w, httpserver.Translate(
			apperr.Internal(errors.New("shops: falta el principal de sesión en el contexto")), requestID))
		return "", false
	}
	return principal.BarbershopID, true
}

// List atiende GET /private/settings/booking-policy/barbers.
func (h *BarberBookingPolicyHandler) List(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	barbershopID, ok := principalBarbershopID(w, r, requestID)
	if !ok {
		return
	}

	policies, err := h.service.List(r.Context(), barbershopID)
	if err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}

	resp := BarberBookingPolicyListResponse{Items: make([]BarberBookingPolicyResponse, 0, len(policies))}
	for _, p := range policies {
		resp.Items = append(resp.Items, newBarberBookingPolicyResponse(p))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// Put atiende PUT /private/settings/booking-policy/barbers/{barberId}.
func (h *BarberBookingPolicyHandler) Put(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	barbershopID, ok := principalBarbershopID(w, r, requestID)
	if !ok {
		return
	}

	var req PutBarberBookingPolicyRequest
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

	// Rangos, coherencia y existencia del barbero viven en el servicio.
	policy, err := h.service.Put(r.Context(), barbershopID, httpserver.URLParam(r, barberIDURLParam), shops.BarberBookingPolicyInput{
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
	_ = json.NewEncoder(w).Encode(newBarberBookingPolicyResponse(policy))
}

// Delete atiende DELETE /private/settings/booking-policy/barbers/{barberId}:
// el barbero vuelve a heredar la ventana de la barbería. 204 aunque no
// tuviera configuración propia (idempotente).
func (h *BarberBookingPolicyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	requestID := httpserver.RequestIDFromContext(r.Context())
	barbershopID, ok := principalBarbershopID(w, r, requestID)
	if !ok {
		return
	}

	if err := h.service.Delete(r.Context(), barbershopID, httpserver.URLParam(r, barberIDURLParam)); err != nil {
		httpserver.WriteProblem(w, httpserver.Translate(err, requestID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func newBarberBookingPolicyResponse(p shops.BarberBookingPolicy) BarberBookingPolicyResponse {
	return BarberBookingPolicyResponse{
		BarberID:          p.BarberID,
		MinAdvanceMinutes: p.MinAdvanceMinutes,
		MaxAdvanceDays:    p.MaxAdvanceDays,
		SlotGridMinutes:   p.SlotGridMinutes,
	}
}
